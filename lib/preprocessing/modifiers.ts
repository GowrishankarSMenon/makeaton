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
 * Uses a flat-earth approximation (lat/lng treated as Cartesian) which
 * is accurate enough for route-level distances.
 */
function pointToSegmentDistKm(
    p: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
): number {
    // Convert to approximate km-based coordinates
    const cosLat = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    const ax = a.lng * cosLat;
    const ay = a.lat;
    const bx = b.lng * cosLat;
    const by = b.lat;
    const px = p.lng * cosLat;
    const py = p.lat;

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

    // Convert back to km (1 degree latitude ≈ 111.32 km)
    const distDeg = Math.sqrt(
        (px - closestX) * (px - closestX) + (py - closestY) * (py - closestY)
    );
    return distDeg * 111.32;
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
const BLOCKED_DISTANCE = 1e9;

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

    // Apply road blocks: block ALL edges whose path passes near the block
    // A road block has an effective radius of 2km — any edge passing within 2km is blocked
    if (locations && roadBlocks.length > 0) {
        const BLOCK_RADIUS_KM = 2.0;

        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                if (weightedDistances[i][j] >= BLOCKED_DISTANCE) continue;

                for (const block of roadBlocks) {
                    if (
                        segmentIntersectsCircle(
                            locations[i],
                            locations[j],
                            block,
                            BLOCK_RADIUS_KM
                        )
                    ) {
                        weightedDistances[i][j] = BLOCKED_DISTANCE;
                        weightedDurations[i][j] = BLOCKED_DISTANCE;
                        break; // one block is enough to block this edge
                    }
                }
            }
        }

        console.log(
            `[Modifiers] Applied ${roadBlocks.length} road block(s) — ` +
            `blocked edges: ${countBlocked(weightedDistances, n)}`
        );
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
