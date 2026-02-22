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

export interface WeatherZoneParam {
    lat: number;
    lng: number;
    radiusKm: number;
    type: 'rain' | 'lightning';
    fragile: boolean;
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
    weatherZones?: WeatherZoneParam[];
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

// Effective blocking radius for road blocks (km).
// 0.3 km (300 m) — tight enough to block only edges that truly cross
// the block point, without nuking half the graph for nearby stops.
export const BLOCK_RADIUS_KM = 0.3;

export function applyModifiers(
    distances: number[][],
    durations: number[][],
    params: LogisticsParams = {},
    locations?: LocationForModifier[]
): ModifiedMatrices {
    const n = distances.length;
    const {
        trafficCongestion = 1.0,
        rushHourMultiplier = 1.0,
        roadTypePreference = 1.0,
        fuelEfficiency = 1.0,
        deliveryPriority = null,
        roadBlocks = [],
        weatherZones = [],
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

    // Apply road blocks: block ALL edges whose path passes near the block.
    // An edge i→j is blocked if:
    //   (a) the segment intersects the block circle (flat-earth approx), OR
    //   (b) either endpoint i or j lies inside the block radius (haversine, exact).
    if (locations && roadBlocks.length > 0) {
        let totalBlocked = 0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (weightedDistances[i][j] >= BLOCKED_DISTANCE) continue;

                for (const block of roadBlocks) {
                    // (a) Segment-to-circle intersection (flat-earth approx)
                    const segmentHit = segmentIntersectsCircle(
                        locations[i],
                        locations[j],
                        block,
                        BLOCK_RADIUS_KM
                    );

                    // (b) Either endpoint inside block radius (haversine, exact)
                    const endpointHit =
                        haversineKm(locations[i], block) <= BLOCK_RADIUS_KM ||
                        haversineKm(locations[j], block) <= BLOCK_RADIUS_KM;

                    if (segmentHit || endpointHit) {
                        weightedDistances[i][j] = BLOCKED_DISTANCE;
                        weightedDurations[i][j] = BLOCKED_DISTANCE;
                        totalBlocked++;
                        console.log(
                            `[Modifiers] Blocked edge ${i}→${j} by roadBlock "${block.id}"` +
                            ` (segment=${segmentHit}, endpoint=${endpointHit})`
                        );
                        break; // one block is enough to block this edge
                    }
                }
            }
        }

        console.log(
            `[Modifiers] Applied ${roadBlocks.length} road block(s) — ` +
            `total blocked edges: ${totalBlocked}`
        );
    }

    // Apply weather zones: fragile = block edges entirely, non-fragile = weather multiplier
    if (locations && weatherZones.length > 0) {
        let blockedEdges = 0;
        let affectedEdges = 0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (weightedDistances[i][j] >= BLOCKED_DISTANCE) continue;

                for (const zone of weatherZones) {
                    if (
                        segmentIntersectsCircle(
                            locations[i],
                            locations[j],
                            zone,
                            zone.radiusKm
                        )
                    ) {
                        if (zone.fragile) {
                            // Fragile item: completely avoid this zone (block edges)
                            weightedDistances[i][j] = BLOCKED_DISTANCE;
                            weightedDurations[i][j] = BLOCKED_DISTANCE;
                            blockedEdges++;
                            console.log(
                                `[Modifiers] Blocked edge ${i}→${j} by fragile weather zone "${zone.id}" (${zone.type})`
                            );
                            break; // one fragile zone is enough to block
                        } else {
                            // Non-fragile: apply weather penalty multiplier
                            const weatherMultiplier = zone.type === 'lightning' ? 2.0 : 1.5;
                            weightedDistances[i][j] *= weatherMultiplier;
                            weightedDurations[i][j] *= weatherMultiplier;
                            affectedEdges++;
                        }
                    }
                }
            }
        }

        console.log(
            `[Modifiers] Applied ${weatherZones.length} weather zone(s) — ` +
            `blocked edges: ${blockedEdges}, penalized edges: ${affectedEdges}`
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
