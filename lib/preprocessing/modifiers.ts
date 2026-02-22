/**
 * Applies logistics parameter modifiers to the raw distance matrix.
 * Each modifier is a multiplicative factor on edge weights, directly
 * influencing the structure of the distance matrix before TSP solving.
 */

export interface RoadBlockParam {
    lat: number;
    lng: number;
    id: string;
}

export interface CongestionZoneParam {
    lat: number;
    lng: number;
    radiusKm: number;
    intensity: number;
    id: string;
}

export interface LocationForModifier {
    lat: number;
    lng: number;
}

export interface LogisticsParams {
    trafficCongestion?: number;
    rushHourMultiplier?: number;
    roadTypePreference?: number;
    fuelEfficiency?: number;
    deliveryPriority?: number[] | null;
    roadBlocks?: RoadBlockParam[];
    congestionZones?: CongestionZoneParam[];
}

export interface ModifiedMatrices {
    weightedDistances: number[][];
    weightedDurations: number[][];
}

/**
 * Haversine distance in km between two lat/lng points.
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
 * Approximate minimum distance (km) from point P to the line segment A→B.
 * Converts lat/lng to a flat km-based coordinate system first, then
 * computes the point-to-segment distance entirely in km space.
 */
function pointToSegmentDistKm(
    p: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    // Convert to km-based coordinates (equirectangular projection)
    const DEG_TO_KM = 111.32;
    const midLat = (a.lat + b.lat + p.lat) / 3;
    const cosLat = Math.cos(midLat * (Math.PI / 180));

    const ax = a.lng * cosLat * DEG_TO_KM;
    const ay = a.lat * DEG_TO_KM;
    const bx = b.lng * cosLat * DEG_TO_KM;
    const by = b.lat * DEG_TO_KM;
    const px = p.lng * cosLat * DEG_TO_KM;
    const py = p.lat * DEG_TO_KM;

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
        t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
    }

    const closestX = ax + t * dx;
    const closestY = ay + t * dy;

    // Already in km, just compute Euclidean distance
    return Math.sqrt(
        (px - closestX) * (px - closestX) + (py - closestY) * (py - closestY)
    );
}

/**
 * Check if a line segment A→B passes through a circle centered at C with radius r (km).
 */
function segmentIntersectsCircle(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
    center: { lat: number; lng: number },
    radiusKm: number
): boolean {
    return pointToSegmentDistKm(center, a, b) <= radiusKm;
}

// A very large distance value that won't overflow when summed in C++ solver
// (1 billion meters = 1 million km — larger than any real route)
export const BLOCKED_DISTANCE = 1e9;

/**
 * Detection radius (km): if the actual OSRM road geometry between two
 * locations passes within this distance of a road block, that edge is
 * considered blocked. 300m accounts for road width + GPS placement error
 * + OSRM geometry resolution.
 */
const ROUTE_BLOCK_DETECTION_KM = 0.30;

/**
 * Check if a block point is near any SEGMENT of a route polyline.
 * Uses pointToSegmentDistKm for each consecutive pair of geometry points.
 * This catches blocks that sit between two sparse geometry points (where
 * a point-only check would miss them).
 */
function routePassesNearBlock(
    routeCoords: { lat: number; lng: number }[],
    block: { lat: number; lng: number },
    radiusKm: number
): boolean {
    // Quick point check first (fast path)
    for (const pt of routeCoords) {
        if (haversineKm(pt, block) <= radiusKm) return true;
    }
    // Segment check: block between two consecutive geometry points
    for (let k = 0; k < routeCoords.length - 1; k++) {
        if (pointToSegmentDistKm(block, routeCoords[k], routeCoords[k + 1]) <= radiusKm) {
            return true;
        }
    }
    return false;
}

/**
 * Detect which edges should be blocked. Uses a multi-phase strategy so
 * that ANY block—no matter how many—is reliably detected:
 *
 *   Phase 1 — OSRM Distance Table (always runs first; 1 request, reliable).
 *     Includes all block points as extra nodes and checks the triangle
 *     inequality: if dist(i→block)+dist(block→j) ≈ dist(i→j), the road
 *     passes through the block. Covers all pairs in one API call.
 *
 *   Phase 2 — OSRM Route Geometry (sequential, for additional precision).
 *     Fetches the actual road path for pairs not yet blocked and checks
 *     if ANY geometry segment passes within 300m of a block. Requests
 *     are serialized with delays to avoid OSRM rate limiting.
 *
 *   Phase 3 — Straight-line proximity (last resort if OSRM is down).
 */
export async function detectBlockedEdges(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    rawDistances: number[][]
): Promise<Set<string>> {
    const blockedEdges = new Set<string>();
    if (roadBlocks.length === 0 || locations.length < 2) return blockedEdges;

    const n = locations.length;

    // ── Phase 1: OSRM Distance Table (always runs — 1 request) ─────────
    console.log(
        `[BlockDetect] Phase 1: OSRM table check for ${roadBlocks.length} block(s) ` +
        `across ${n} locations`
    );
    const tableOk = await detectViaOSRMTable(locations, roadBlocks, n, blockedEdges);
    const edgesAfterPhase1 = blockedEdges.size;
    console.log(`[BlockDetect] Phase 1 result: ${edgesAfterPhase1} edges blocked (table ${tableOk ? 'OK' : 'FAILED'})`);

    // ── Phase 2: OSRM Route Geometry (sequential, additional precision) ─
    // Build list of pairs to geometry-check. Skip pairs already blocked.
    const pairsToCheck: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (blockedEdges.has(`${i}->${j}`)) continue; // already blocked
            // Pre-filter: skip pairs where no block is within 50km of midpoint
            const mid = {
                lat: (locations[i].lat + locations[j].lat) / 2,
                lng: (locations[i].lng + locations[j].lng) / 2,
            };
            const relevant = roadBlocks.some(block => haversineKm(mid, block) < 50);
            if (relevant) pairsToCheck.push([i, j]);
        }
    }

    if (pairsToCheck.length > 0) {
        console.log(
            `[BlockDetect] Phase 2: Checking ${pairsToCheck.length} remaining pairs ` +
            `via OSRM route geometry (sequential)`
        );

        let geometrySuccessCount = 0;

        // Sequential requests with delays to avoid rate limiting
        for (const [i, j] of pairsToCheck) {
            if (blockedEdges.has(`${i}->${j}`)) continue; // blocked by earlier geometry check

            try {
                const from = locations[i];
                const to = locations[j];
                const url =
                    `https://router.project-osrm.org/route/v1/driving/` +
                    `${from.lng},${from.lat};${to.lng},${to.lat}` +
                    `?overview=full&geometries=geojson`;

                const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();

                if (!data || data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) {
                    console.warn(`[BlockDetect] Route ${i}↔${j} — OSRM returned ${data?.code}`);
                    continue;
                }

                geometrySuccessCount++;

                const routeCoords: { lat: number; lng: number }[] =
                    data.routes[0].geometry.coordinates.map(
                        (c: [number, number]) => ({ lat: c[1], lng: c[0] })
                    );

                for (const block of roadBlocks) {
                    if (routePassesNearBlock(routeCoords, block, ROUTE_BLOCK_DETECTION_KM)) {
                        blockedEdges.add(`${i}->${j}`);
                        blockedEdges.add(`${j}->${i}`);
                        console.log(
                            `[BlockDetect] ✓ Edge ${i}↔${j} BLOCKED by ${block.id} ` +
                            `(route geometry — road within ${ROUTE_BLOCK_DETECTION_KM * 1000}m)`
                        );
                        break; // one block is enough to block this edge
                    }
                }

                // Delay between requests to avoid OSRM rate limits
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (err) {
                console.warn(`[BlockDetect] Route geometry ${i}↔${j} failed:`, err);
            }
        }

        const edgesAfterPhase2 = blockedEdges.size - edgesAfterPhase1;
        console.log(
            `[BlockDetect] Phase 2 result: ${edgesAfterPhase2} additional edges blocked ` +
            `(${geometrySuccessCount}/${pairsToCheck.length} routes fetched)`
        );
    }

    // ── Phase 3: Straight-line proximity (if both OSRM approaches yielded nothing)
    if (!tableOk && blockedEdges.size === 0 && n > 0) {
        console.warn('[BlockDetect] Phase 3: OSRM unavailable — using straight-line proximity (last resort)');
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                for (const block of roadBlocks) {
                    const segDist = pointToSegmentDistKm(block, locations[i], locations[j]);
                    if (segDist <= 0.5) {
                        blockedEdges.add(`${i}->${j}`);
                        break;
                    }
                }
            }
        }
    }

    console.log(`[BlockDetect] Total blocked edges: ${blockedEdges.size}`);
    return blockedEdges;
}

/**
 * OSRM Table check: include block points as extra nodes. If
 * dist(i→block)+dist(block→j) ≈ dist(i→j), the road passes through it.
 * Returns true if the table request succeeded.
 */
async function detectViaOSRMTable(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    n: number,
    blockedEdges: Set<string>
): Promise<boolean> {
    const allPoints = [
        ...locations,
        ...roadBlocks.map(b => ({ lat: b.lat, lng: b.lng })),
    ];

    const coords = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`;

    let extDist: (number | null)[][] | null = null;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.code === 'Ok' && data.distances) {
            extDist = data.distances;
        } else {
            console.warn(`[BlockDetect] OSRM table code: ${data.code}`);
            return false;
        }
    } catch (err) {
        console.warn('[BlockDetect] OSRM table fetch failed:', err);
        return false;
    }

    if (!extDist) return false;

    const TOLERANCE = 0.20; // 20% tolerance

    for (let b = 0; b < roadBlocks.length; b++) {
        const blockIdx = n + b;
        let edgesBlocked = 0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (blockedEdges.has(`${i}->${j}`)) continue;

                const directDist = extDist[i]?.[j];
                const distIBlock = extDist[i]?.[blockIdx];
                const distBlockJ = extDist[blockIdx]?.[j];

                if (directDist == null || distIBlock == null || distBlockJ == null) continue;
                if (directDist <= 0) continue;

                const viaBlockDist = distIBlock + distBlockJ;
                if (viaBlockDist <= directDist * (1 + TOLERANCE)) {
                    blockedEdges.add(`${i}->${j}`);
                    edgesBlocked++;
                }
            }
        }

        console.log(
            `[BlockDetect] Table: Block "${roadBlocks[b].id}" — ${edgesBlocked} edges blocked`
        );
    }

    return true;
}

export function applyModifiers(
    distances: number[][],
    durations: number[][],
    params: LogisticsParams = {},
    locations?: LocationForModifier[],
    precomputedBlockedEdges?: Set<string>
): ModifiedMatrices {
    const n = distances.length;
    const {
        trafficCongestion = 1.0,
        rushHourMultiplier = 1.0,
        roadTypePreference = 1.0,
        fuelEfficiency = 1.0,
        deliveryPriority = null,
        congestionZones = [],
    } = params;

    const weightedDistances = Array.from({ length: n }, () =>
        new Array(n).fill(0)
    );
    const weightedDurations = Array.from({ length: n }, () =>
        new Array(n).fill(0)
    );

    // Combined edge-level modifier (applies uniformly to all edges)
    const edgeMultiplier =
        trafficCongestion * rushHourMultiplier * roadTypePreference * fuelEfficiency;

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) continue;

            let distMod = edgeMultiplier;
            let durMod = trafficCongestion * rushHourMultiplier;

            // Delivery priority: edges leading TO high-priority nodes get reduced weight
            if (deliveryPriority && deliveryPriority[j] !== undefined) {
                distMod *= deliveryPriority[j];
                durMod *= deliveryPriority[j];
            }

            weightedDistances[i][j] = distances[i][j] * distMod;
            weightedDurations[i][j] = durations[i][j] * durMod;
        }
    }

    // Apply road blocks via precomputed blocked-edge set (from OSRM distance detection).
    if (precomputedBlockedEdges && precomputedBlockedEdges.size > 0) {
        let totalBlocked = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (weightedDistances[i][j] >= BLOCKED_DISTANCE) continue;
                if (precomputedBlockedEdges.has(`${i}->${j}`)) {
                    weightedDistances[i][j] = BLOCKED_DISTANCE;
                    weightedDurations[i][j] = BLOCKED_DISTANCE;
                    totalBlocked++;
                }
            }
        }
        console.log(`[Modifiers] Applied precomputed road blocks — total blocked edges: ${totalBlocked}`);
    }

    // Apply congestion zones: multiply edge weights if the path passes through a zone
    if (locations && congestionZones.length > 0) {
        let affectedEdges = 0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (weightedDistances[i][j] >= BLOCKED_DISTANCE) continue;

                for (const zone of congestionZones) {
                    if (
                        segmentIntersectsCircle(
                            locations[i],
                            locations[j],
                            zone,
                            zone.radiusKm
                        )
                    ) {
                        weightedDistances[i][j] *= zone.intensity;
                        weightedDurations[i][j] *= zone.intensity;
                        affectedEdges++;
                    }
                }
            }
        }

        console.log(
            `[Modifiers] Applied ${congestionZones.length} congestion zone(s) — ` +
            `affected edges: ${affectedEdges}`
        );
    }

    return { weightedDistances, weightedDurations };
}

function countBlocked(matrix: number[][], n: number): number {
    let count = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i !== j && matrix[i][j] >= BLOCKED_DISTANCE) count++;
        }
    }
    return count;
}
