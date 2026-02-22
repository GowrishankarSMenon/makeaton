/**
 * visualization.ts — Road geometry fetching utilities.
 * Used by the MapView component for OSRM road route rendering.
 * Supports road block avoidance by detecting when a road segment
 * passes through a block zone and rerouting around it.
 */

import { Location } from './preprocessing/distance-matrix';

export interface RoadBlockForRoute {
    lat: number;
    lng: number;
    id: string;
}

/**
 * Fixed radius (km) for checking if a drawn road route geometry point
 * falls near a road block. This is purely for visual route rendering —
 * the solver uses OSRM table-based detection separately.
 * 0.15 km (150 m) is tight enough for road-level detection.
 */
const ROUTE_BLOCK_DETECTION_KM = 0.15;

/**
 * Haversine distance in km between two [lat, lng] points.
 */
function haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    const R = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
        sinLat * sinLat +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Minimum distance (km) from point P to line segment A→B.
 */
function pointToSegmentDistKm(
    p: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    const DEG_TO_KM = 111.32;
    const midLat = (a.lat + b.lat + p.lat) / 3;
    const cosLat = Math.cos(midLat * (Math.PI / 180));
    const ax = a.lng * cosLat * DEG_TO_KM, ay = a.lat * DEG_TO_KM;
    const bx = b.lng * cosLat * DEG_TO_KM, by = b.lat * DEG_TO_KM;
    const px = p.lng * cosLat * DEG_TO_KM, py = p.lat * DEG_TO_KM;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
        t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    }
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
}

/**
 * Check if any road geometry point falls within a block's detection radius.
 */
function routePassesThroughBlock(
    routePoints: [number, number][],
    block: RoadBlockForRoute
): boolean {
    for (let i = 0; i < routePoints.length; i++) {
        const [lat, lng] = routePoints[i];
        if (haversineKm({ lat, lng }, block) <= ROUTE_BLOCK_DETECTION_KM) return true;
    }
    return false;
}

/**
 * Compute a detour waypoint that goes around a block.
 * Places a point perpendicular to the A→B line, offset from the block.
 */
function computeDetourPoint(
    from: Location,
    to: Location,
    block: RoadBlockForRoute,
    offsetDeg?: number
): Location {
    const midLat = (from.lat + to.lat) / 2;
    const midLng = (from.lng + to.lng) / 2;

    // Perpendicular direction to the segment
    const dLat = to.lat - from.lat;
    const dLng = to.lng - from.lng;

    // Perpendicular vector (rotated 90°)
    const perpLat = -dLng;
    const perpLng = dLat;
    const perpLen = Math.sqrt(perpLat * perpLat + perpLng * perpLng);

    if (perpLen === 0) {
        return { lat: block.lat + 0.005, lng: block.lng + 0.005 };
    }

    // Normalize and scale — offset ~500m by default
    const effectiveOffset = offsetDeg ?? 0.005;
    const normLat = (perpLat / perpLen) * effectiveOffset;
    const normLng = (perpLng / perpLen) * effectiveOffset;

    // Choose the side of the segment that's away from the block
    const sideA = { lat: midLat + normLat, lng: midLng + normLng };
    const sideB = { lat: midLat - normLat, lng: midLng - normLng };

    const distA = haversineKm(sideA, block);
    const distB = haversineKm(sideB, block);

    return distA > distB ? sideA : sideB;
}

/**
 * Fetch road geometry for a single segment, avoiding road blocks.
 * Strategy:
 *   1. Ask OSRM for the direct route + alternatives.
 *   2. If the primary route is blocked, try each alternative.
 *   3. If no alternative avoids the block, compute detour waypoints
 *      at multiple offsets (scaled by the block radius) and try each.
 *   4. Falls back to the direct route only as a last resort.
 */
async function fetchSegmentAvoidingBlocks(
    from: Location,
    to: Location,
    blocks: RoadBlockForRoute[]
): Promise<[number, number][]> {
    if (blocks.length === 0) {
        return fetchRoadGeometry(from, to);
    }

    // Ask OSRM for alternatives so we can pick the best unblocked one
    const allRoutes = await fetchRoadGeometryWithAlternatives(from, to);

    // Helper: check if a route is clear of ALL blocks
    const routeClear = (route: [number, number][]) =>
        blocks.every(b => !routePassesThroughBlock(route, b));

    // Try each OSRM-returned route (primary first, then alternatives)
    for (let ri = 0; ri < allRoutes.length; ri++) {
        if (routeClear(allRoutes[ri])) {
            if (ri > 0) console.log(`[Road] Using alternative route #${ri + 1} to avoid blocks`);
            return allRoutes[ri];
        }
    }

    // All OSRM routes pass through at least one block — try detour waypoints
    // Identify which blocks actually intersect our best route
    const directRoute = allRoutes[0];
    const hitBlocks = blocks.filter(b => routePassesThroughBlock(directRoute, b));

    for (const block of hitBlocks) {
        // Try progressively larger detour offsets (degrees, ~111m per 0.001°)
        const offsets = [0.005, 0.012, 0.025];

        for (const offsetDeg of offsets) {
            const detour = computeDetourPoint(from, to, block, offsetDeg);

            const waypointStr = `${from.lng},${from.lat};${detour.lng},${detour.lat};${to.lng},${to.lat}`;
            const url = `/api/osrm?waypoints=${encodeURIComponent(waypointStr)}&alternatives=true`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const data = await response.json();
                    if (data.code === 'Ok' && data.routes) {
                        for (const r of data.routes) {
                            const detourRoute: [number, number][] = r.geometry.coordinates.map(
                                (c: [number, number]) => [c[1], c[0]] as [number, number]
                            );
                            if (routeClear(detourRoute)) {
                                console.log(`[Road] Detour successful for block ${block.id} (offset=${offsetDeg.toFixed(4)}°)`);
                                return detourRoute;
                            }
                        }
                    }
                }
            } catch {
                console.warn(`[Road] Detour routing failed for block ${block.id}`);
            }
        }
    }

    console.warn('[Road] Could not find a route avoiding all blocks — using primary route');
    return directRoute;
}

/**
 * Fetch road geometry with alternatives from OSRM.
 * Returns an array of routes (each is an array of [lat, lng] pairs).
 * The first route is the primary (shortest), subsequent ones are alternatives.
 */
async function fetchRoadGeometryWithAlternatives(
    from: Location,
    to: Location
): Promise<[number, number][][]> {
    const url = `/api/osrm?from=${from.lng},${from.lat}&to=${to.lng},${to.lat}&alternatives=true`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`OSRM ${response.status}`);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            return data.routes.map((route: any) =>
                route.geometry.coordinates.map(
                    (c: [number, number]) => [c[1], c[0]] as [number, number]
                )
            );
        }
        throw new Error(data.code || 'No route');
    } catch (err) {
        console.warn('OSRM alternatives fetch failed, falling back to straight line:', err);
    }
    return [
        [
            [from.lat, from.lng],
            [to.lat, to.lng],
        ],
    ];
}

/**
 * Fetch real road geometry between two points from OSRM.
 * Returns an array of [lat, lng] pairs tracing the actual road.
 * Falls back to a straight line if the API fails.
 */
export async function fetchRoadGeometry(
    from: Location,
    to: Location
): Promise<[number, number][]> {
    const url = `/api/osrm?from=${from.lng},${from.lat}&to=${to.lng},${to.lat}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`OSRM ${response.status}`);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            return data.routes[0].geometry.coordinates.map(
                (c: [number, number]) => [c[1], c[0]] as [number, number]
            );
        }
        throw new Error(data.code || 'No route');
    } catch (err) {
        console.warn('OSRM segment fetch failed, falling back to straight line:', err);
    }
    return [
        [from.lat, from.lng],
        [to.lat, to.lng],
    ];
}

/**
 * Get full road geometry for an ordered array of waypoints.
 * Respects road blocks by rerouting segments that pass through blocked zones.
 * Falls back to multi-waypoint OSRM when no blocks are present.
 */
export async function getRoadRoute(
    coords: Location[],
    roadBlocks: RoadBlockForRoute[] = []
): Promise<[number, number][]> {
    if (!coords || coords.length < 2) return [];

    // If blocks exist, route segment-by-segment with block avoidance
    if (roadBlocks.length > 0) {
        console.log(`[Road] Routing with ${roadBlocks.length} road block(s)`);
        const segmentPromises: Promise<[number, number][]>[] = [];
        for (let i = 0; i < coords.length - 1; i++) {
            segmentPromises.push(fetchSegmentAvoidingBlocks(coords[i], coords[i + 1], roadBlocks));
        }
        const segments = await Promise.all(segmentPromises);
        const fullRoute: [number, number][] = [];
        segments.forEach((seg, idx) => {
            if (idx === 0) fullRoute.push(...seg);
            else fullRoute.push(...seg.slice(1));
        });
        return fullRoute;
    }

    // No blocks — try single multi-waypoint request first (most reliable)
    try {
        const waypointStr = coords.map(c => `${c.lng},${c.lat}`).join(';');
        const url = `/api/osrm?waypoints=${encodeURIComponent(waypointStr)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`OSRM ${response.status}`);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const roadLatLngs: [number, number][] = data.routes[0].geometry.coordinates.map(
                (c: [number, number]) => [c[1], c[0]] as [number, number]
            );
            if (roadLatLngs.length >= 2) {
                console.log(`[Road] Got ${roadLatLngs.length} points from OSRM`);
                return roadLatLngs;
            }
        }
        throw new Error(data.code || 'No route returned');
    } catch (err) {
        console.warn('[Road] Multi-waypoint OSRM failed, trying segment-by-segment:', err);
    }

    // Fallback: fetch each segment individually
    const segmentPromises: Promise<[number, number][]>[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
        segmentPromises.push(fetchRoadGeometry(coords[i], coords[i + 1]));
    }
    const segments = await Promise.all(segmentPromises);

    const fullRoute: [number, number][] = [];
    segments.forEach((seg, idx) => {
        if (idx === 0) {
            fullRoute.push(...seg);
        } else {
            fullRoute.push(...seg.slice(1));
        }
    });

    return fullRoute;
}
