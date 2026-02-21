/**
 * Fetches the pairwise distance/duration matrix from OSRM Table API.
 * OSRM uses Dijkstra / Contraction Hierarchies on the road network graph,
 * giving true shortest-path road distances between all location pairs.
 */

export interface Location {
    lat: number;
    lng: number;
    label?: string;
    priority?: number;
}

export interface DistanceMatrixResult {
    distances: number[][];
    durations: number[][];
}

export async function buildDistanceMatrix(locations: Location[]): Promise<DistanceMatrixResult> {
    if (locations.length < 2) {
        throw new Error('At least 2 locations are required');
    }

    // Build OSRM coordinates string: lng,lat;lng,lat;...
    const coords = locations.map((l) => `${l.lng},${l.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=distance,duration`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.code !== 'Ok') {
            throw new Error(`OSRM API error: ${data.code} — ${data.message || 'unknown error'}`);
        }

        return {
            distances: data.distances, // meters (N×N matrix)
            durations: data.durations, // seconds (N×N matrix)
        };
    } catch (err: unknown) {
        // Fallback: compute Haversine distances if OSRM fails
        const message = err instanceof Error ? err.message : 'unknown error';
        console.warn('OSRM API failed, falling back to Haversine distances:', message);
        return buildHaversineMatrix(locations);
    }
}

/**
 * Fallback: Haversine distance matrix (straight-line, not road-based).
 */
function buildHaversineMatrix(locations: Location[]): DistanceMatrixResult {
    const n = locations.length;
    const distances = Array.from({ length: n }, () => new Array(n).fill(0));
    const durations = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i !== j) {
                const d = haversine(locations[i], locations[j]);
                distances[i][j] = d;
                // Estimate duration at ~40 km/h average speed
                durations[i][j] = ((d / 1000) / 40) * 3600;
            }
        }
    }

    return { distances, durations };
}

/**
 * Haversine formula — great-circle distance in meters.
 */
function haversine(a: Location, b: Location): number {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 2 * R * Math.asin(Math.sqrt(h));
}
