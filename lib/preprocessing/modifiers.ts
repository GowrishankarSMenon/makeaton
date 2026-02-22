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
 * Detection radius (km): if any point on the actual OSRM road geometry
 * between two locations is within this distance of a road block, that
 * edge is considered blocked. 250m is tight enough for road-level
 * accuracy while accounting for OSRM geometry resolution.
 */
const ROUTE_BLOCK_DETECTION_KM = 0.25;

/**
 * Detect which edges should be blocked by fetching the actual OSRM road
 * geometry for each pair of locations and checking if the road physically
 * passes near any road block point.
 *
 * This is the most reliable approach because it checks the real road path
 * (the sequence of lat/lng coordinates along the road) rather than making
 * indirect distance comparisons.
 *
 * Strategy (multi-phase):
 *   Phase 1 — OSRM Route Geometry: fetch the actual road path for each
 *             location pair and check if ANY geometry point is within
 *             250m of a block.  Most reliable.
 *   Phase 2 — OSRM Table fallback: include blocks as extra nodes in an
 *             OSRM distance table and check the triangle inequality.
 *   Phase 3 — Straight-line proximity (last resort): Haversine check.
 */
export async function detectBlockedEdges(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    rawDistances: number[][]
): Promise<Set<string>> {
    const blockedEdges = new Set<string>();
    if (roadBlocks.length === 0 || locations.length < 2) return blockedEdges;

    const n = locations.length;

    // Build list of all directed pairs to check
    const pairsToCheck: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            // Pre-filter: skip pairs where no block is within 80km
            // of either endpoint (impossible for the route to pass through the block)
            const relevant = roadBlocks.some(block => {
                const di = haversineKm(locations[i], block);
                const dj = haversineKm(locations[j], block);
                return Math.min(di, dj) < 80;
            });
            if (relevant) pairsToCheck.push([i, j]);
        }
    }

    console.log(
        `[BlockDetect] Phase 1: Checking ${pairsToCheck.length} location pairs ` +
        `against ${roadBlocks.length} block(s) via OSRM route geometry`
    );

    // ── Phase 1: OSRM Route Geometry ────────────────────────────────────
    let routeGeometrySucceeded = false;
    const BATCH_SIZE = 4;

    for (let batchStart = 0; batchStart < pairsToCheck.length; batchStart += BATCH_SIZE) {
        const batch = pairsToCheck.slice(batchStart, batchStart + BATCH_SIZE);

        const results = await Promise.allSettled(
            batch.map(async ([i, j]) => {
                const from = locations[i];
                const to = locations[j];
                const url =
                    `https://router.project-osrm.org/route/v1/driving/` +
                    `${from.lng},${from.lat};${to.lng},${to.lat}` +
                    `?overview=full&geometries=geojson`;

                const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                return { i, j, data };
            })
        );

        for (const result of results) {
            if (result.status !== 'fulfilled') {
                console.warn('[BlockDetect] Route fetch failed:', (result as PromiseRejectedResult).reason);
                continue;
            }

            const { i, j, data } = result.value;
            if (!data || data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) continue;

            routeGeometrySucceeded = true;

            const routeCoords: { lat: number; lng: number }[] =
                data.routes[0].geometry.coordinates.map(
                    (c: [number, number]) => ({ lat: c[1], lng: c[0] })
                );

            for (const block of roadBlocks) {
                const passesThrough = routeCoords.some(
                    pt => haversineKm(pt, block) <= ROUTE_BLOCK_DETECTION_KM
                );
                if (passesThrough) {
                    blockedEdges.add(`${i}->${j}`);
                    blockedEdges.add(`${j}->${i}`);
                    console.log(
                        `[BlockDetect] ✓ Edge ${i}↔${j} BLOCKED by ${block.id} ` +
                        `(route geometry — road passes within ${ROUTE_BLOCK_DETECTION_KM * 1000}m)`
                    );
                    break; // one block is enough to block this edge
                }
            }
        }

        // Small delay between batches to be polite to the public OSRM server
        if (batchStart + BATCH_SIZE < pairsToCheck.length) {
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }

    // ── Phase 2: OSRM Table fallback (if route geometry failed) ─────────
    if (!routeGeometrySucceeded && pairsToCheck.length > 0) {
        console.log('[BlockDetect] Phase 2: Route geometry failed — trying OSRM table fallback...');
        await detectViaOSRMTable(locations, roadBlocks, n, blockedEdges);
    }

    // ── Phase 3: Straight-line proximity (if both OSRM approaches failed)
    if (!routeGeometrySucceeded && blockedEdges.size === 0 && pairsToCheck.length > 0) {
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
 * Phase 2 fallback: OSRM Table with block points as extra nodes.
 * Checks if dist(i→block) + dist(block→j) ≈ dist(i→j).
 */
async function detectViaOSRMTable(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    n: number,
    blockedEdges: Set<string>
): Promise<void> {
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
        }
    } catch (err) {
        console.warn('[BlockDetect] OSRM table fetch failed:', err);
        return;
    }

    if (!extDist) return;

    const TOLERANCE = 0.20; // 20% — slightly generous

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

                // Skip if any distance is null (unreachable point)
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
            `[BlockDetect] Block "${roadBlocks[b].id}" — ` +
            `${edgesBlocked} edges via OSRM table (phase 2)`
        );
    }
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
