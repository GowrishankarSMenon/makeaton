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

// Small radius (km) for point-proximity fallback check (straight-line).
// Only used as a secondary heuristic; primary detection is OSRM-distance-based.
export const BLOCK_PROXIMITY_KM = 0.5;

/**
 * Detect which edges should be blocked by querying OSRM with block points
 * included as extra nodes. If dist(i→block) + dist(block→j) ≈ dist(i→j),
 * then the shortest road from i to j passes through/near the block.
 *
 * This is the correct approach because it uses actual OSRM road distances
 * rather than straight-line geometry which misses curved roads.
 */
export async function detectBlockedEdges(
    locations: LocationForModifier[],
    roadBlocks: RoadBlockParam[],
    rawDistances: number[][]
): Promise<Set<string>> {
    const blockedEdges = new Set<string>();
    if (roadBlocks.length === 0 || locations.length < 2) return blockedEdges;

    const n = locations.length;

    // Build extended point list: [all locations, then all block points]
    const allPoints = [
        ...locations,
        ...roadBlocks.map(b => ({ lat: b.lat, lng: b.lng })),
    ];

    // Query OSRM Table API for the extended distance matrix
    const coords = allPoints.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance`;

    let extDist: number[][] | null = null;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (data.code === 'Ok' && data.distances) {
            extDist = data.distances;
        } else {
            console.warn(`[BlockDetect] OSRM table failed: ${data.code}`);
        }
    } catch (err) {
        console.warn('[BlockDetect] OSRM extended table fetch failed:', err);
    }

    if (extDist) {
        // OSRM-distance-based detection: if the shortest road from i to j
        // passes through the block point, then dist(i→block)+dist(block→j)
        // should be close to dist(i→j).
        const TOLERANCE = 0.15; // 15% — generous to catch near-block roads

        for (let b = 0; b < roadBlocks.length; b++) {
            const blockIdx = n + b;
            let edgesBlocked = 0;

            for (let i = 0; i < n; i++) {
                for (let j = 0; j < n; j++) {
                    if (i === j) continue;
                    if (blockedEdges.has(`${i}->${j}`)) continue;

                    const directDist = extDist[i][j];
                    const viaBlockDist = extDist[i][blockIdx] + extDist[blockIdx][j];

                    // If going through the block point adds ≤15% extra,
                    // the shortest road likely passes through it
                    if (directDist > 0 && viaBlockDist <= directDist * (1 + TOLERANCE)) {
                        blockedEdges.add(`${i}->${j}`);
                        edgesBlocked++;
                    }
                }
            }

            console.log(
                `[BlockDetect] Block "${roadBlocks[b].id}" — ` +
                `${edgesBlocked} edges detected via OSRM distance comparison`
            );
        }
    } else {
        // Fallback: use straight-line proximity if OSRM fails
        console.warn('[BlockDetect] Falling back to straight-line proximity check');
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                for (const block of roadBlocks) {
                    const segDist = pointToSegmentDistKm(block, locations[i], locations[j]);
                    const epDist = Math.min(
                        haversineKm(locations[i], block),
                        haversineKm(locations[j], block)
                    );
                    if (segDist <= BLOCK_PROXIMITY_KM || epDist <= BLOCK_PROXIMITY_KM) {
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
