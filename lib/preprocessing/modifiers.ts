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

// Penalty multiplier for blocked edges. The solver will heavily penalize
// routes through blocked edges but can still use them if no alternative
// tour order exists (e.g., block on the only road from depot).
// The visualization layer handles showing the actual detour road.
export const BLOCK_PENALTY_MULTIPLIER = 100;

// Threshold to detect penalized edges in the matrix (for logging).
// An edge is considered "penalized" if its weighted distance is ≥50× the
// original raw distance. We use 50× instead of 100× to account for
// other modifiers that might also scale the edge.
export const PENALTY_THRESHOLD_FACTOR = 50;

/**
 * Detection radius (km): if the actual OSRM road geometry between two
 * locations passes within this distance of a road block, that edge is
 * considered blocked. 50m is tight enough to catch blocks ON the road
 * (~0-20m distance) but NOT flag parallel roads (~100m+ away).
 * Covers road width (~10m) + GPS click imprecision (~20m) +
 * OSRM geometry resolution (~10m).
 */
const ROUTE_BLOCK_DETECTION_KM = 0.05;

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
 * Detect which edges should be blocked. Uses a multi-phase strategy:
 *
 *   Phase 1 — OSRM Route Geometry (PRIMARY — most accurate).
 *     Fetches the actual road path for each location pair and checks
 *     if ANY geometry segment passes within 300m of a block. This is
 *     the ground-truth approach — it examines the real road coordinates.
 *     Requests are serialized to avoid OSRM rate limiting.
 *
 *   Phase 2 — OSRM Distance Table (fallback for failed geometry pairs).
 *     Only runs for pairs where the Route Geometry request failed.
 *     Uses a tight 5% tolerance to avoid false positives that would
 *     block edges where the road merely passes "near" the block.
 *
 *   Phase 3 — Straight-line proximity (last resort if OSRM is down).
 *
 * IMPORTANT: Route Geometry is the primary method because the OSRM Table
 * approach with loose tolerance massively over-detects (a single block can
 * incorrectly block ALL edges in a city-scale graph).
 */
export async function detectBlockedEdges(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    rawDistances: number[][]
): Promise<Set<string>> {
    const blockedEdges = new Set<string>();
    if (roadBlocks.length === 0 || locations.length < 2) return blockedEdges;

    const n = locations.length;

    // Build list of all undirected pairs to check
    const allPairs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            // Pre-filter: skip pairs where no block is within 50km of midpoint
            const mid = {
                lat: (locations[i].lat + locations[j].lat) / 2,
                lng: (locations[i].lng + locations[j].lng) / 2,
            };
            const relevant = roadBlocks.some(block => haversineKm(mid, block) < 50);
            if (relevant) allPairs.push([i, j]);
        }
    }

    console.log(
        `[BlockDetect] Checking ${allPairs.length} location pairs ` +
        `against ${roadBlocks.length} block(s)`
    );

    // ── Phase 1: OSRM Route Geometry (PRIMARY) ──────────────────────────
    // Fetch the actual road path for each pair and check proximity.
    // Track which pairs we successfully fetched geometry for.
    const geometryChecked = new Set<string>();
    let geometrySuccessCount = 0;

    console.log(`[BlockDetect] Phase 1: Route geometry (sequential)`);

    for (const [i, j] of allPairs) {
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
                console.warn(`[BlockDetect] Route ${i}↔${j}: OSRM returned ${data?.code}`);
                continue;
            }

            geometrySuccessCount++;
            geometryChecked.add(`${i}-${j}`);

            const routeCoords: { lat: number; lng: number }[] =
                data.routes[0].geometry.coordinates.map(
                    (c: [number, number]) => ({ lat: c[1], lng: c[0] })
                );

            for (const block of roadBlocks) {
                // Compute minimum distance from block to any segment of the route
                let minDistKm = Infinity;
                for (const pt of routeCoords) {
                    minDistKm = Math.min(minDistKm, haversineKm(pt, block));
                }
                for (let k = 0; k < routeCoords.length - 1; k++) {
                    minDistKm = Math.min(
                        minDistKm,
                        pointToSegmentDistKm(block, routeCoords[k], routeCoords[k + 1])
                    );
                }

                if (minDistKm <= ROUTE_BLOCK_DETECTION_KM) {
                    blockedEdges.add(`${i}->${j}`);
                    blockedEdges.add(`${j}->${i}`);
                    console.log(
                        `[BlockDetect] ✓ Edge ${i}↔${j} BLOCKED by ${block.id} ` +
                        `(min dist: ${(minDistKm * 1000).toFixed(0)}m, threshold: ${(ROUTE_BLOCK_DETECTION_KM * 1000).toFixed(0)}m)`
                    );
                    break; // one block is enough to block this edge
                } else {
                    console.log(
                        `[BlockDetect]   Edge ${i}↔${j} CLEAR of ${block.id} ` +
                        `(min dist: ${(minDistKm * 1000).toFixed(0)}m, threshold: ${(ROUTE_BLOCK_DETECTION_KM * 1000).toFixed(0)}m)`
                    );
                }
            }

            // Delay between requests to avoid OSRM rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (err) {
            console.warn(`[BlockDetect] Route geometry ${i}↔${j} failed:`, err);
        }
    }

    const edgesAfterPhase1 = blockedEdges.size;
    console.log(
        `[BlockDetect] Phase 1 result: ${edgesAfterPhase1} edges blocked ` +
        `(${geometrySuccessCount}/${allPairs.length} routes fetched)`
    );

    // ── Phase 2: OSRM Table fallback (only for pairs geometry missed) ───
    const uncheckedPairs = allPairs.filter(([i, j]) => !geometryChecked.has(`${i}-${j}`));

    if (uncheckedPairs.length > 0) {
        console.log(
            `[BlockDetect] Phase 2: OSRM table fallback for ${uncheckedPairs.length} ` +
            `unchecked pairs (geometry failed for these)`
        );
        await detectViaOSRMTable(locations, roadBlocks, n, blockedEdges, uncheckedPairs);
    }

    // ── Phase 3: Straight-line proximity (if geometry fetched nothing) ───
    if (geometrySuccessCount === 0 && blockedEdges.size === 0 && allPairs.length > 0) {
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
 * OSRM Table fallback: only checks specific pairs where geometry failed.
 * Uses a tight 5% tolerance to avoid false positives — the Table approach
 * over-detects at higher tolerances (a single block in a city can falsely
 * block ALL edges with 20% tolerance because OSRM snaps blocks to the
 * nearest road segment, which may be "on the way" for many short routes).
 */
async function detectViaOSRMTable(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    n: number,
    blockedEdges: Set<string>,
    pairsToCheck: [number, number][]
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

    // Tight tolerance — only block if via-block is ≤5% more than direct.
    // This means the block is essentially ON the shortest road path.
    const TOLERANCE = 0.05;

    // Only check the specific pairs that geometry failed for
    const pairSet = new Set(pairsToCheck.map(([i, j]) => `${i}-${j}`));

    for (let b = 0; b < roadBlocks.length; b++) {
        const blockIdx = n + b;
        let edgesBlocked = 0;

        for (const [i, j] of pairsToCheck) {
            // Check both directions
            for (const [a, c] of [[i, j], [j, i]] as [number, number][]) {
                if (blockedEdges.has(`${a}->${c}`)) continue;

                const directDist = extDist[a]?.[c];
                const distABlock = extDist[a]?.[blockIdx];
                const distBlockC = extDist[blockIdx]?.[c];

                if (directDist == null || distABlock == null || distBlockC == null) continue;
                if (directDist <= 0) continue;

                const viaBlockDist = distABlock + distBlockC;
                if (viaBlockDist <= directDist * (1 + TOLERANCE)) {
                    blockedEdges.add(`${a}->${c}`);
                    edgesBlocked++;
                }
            }
        }

        if (edgesBlocked > 0) {
            console.log(
                `[BlockDetect] Table: Block "${roadBlocks[b].id}" — ${edgesBlocked} edges blocked (fallback)`
            );
        }
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

    // Apply road blocks via precomputed blocked-edge set (from OSRM detection).
    // Uses a penalty multiplier (100×) instead of infinity — the solver will
    // strongly prefer unblocked edges but can still find a valid tour when
    // all edges from/to a node are blocked. The visualization layer handles
    // rendering actual detour roads around blocks.
    if (precomputedBlockedEdges && precomputedBlockedEdges.size > 0) {
        let totalBlocked = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (precomputedBlockedEdges.has(`${i}->${j}`)) {
                    weightedDistances[i][j] *= BLOCK_PENALTY_MULTIPLIER;
                    weightedDurations[i][j] *= BLOCK_PENALTY_MULTIPLIER;
                    totalBlocked++;
                }
            }
        }
        console.log(`[Modifiers] Applied road block penalty (${BLOCK_PENALTY_MULTIPLIER}×) to ${totalBlocked} edges`);
    }

    // Apply congestion zones: multiply edge weights if the path passes through a zone
    if (locations && congestionZones.length > 0) {
        let affectedEdges = 0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;

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

