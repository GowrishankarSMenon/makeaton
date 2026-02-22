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

/**
 * In-memory cache for distance matrices.
 * Key: sorted coordinate fingerprint. Avoids redundant OSRM round-trips
 * when the user re-solves with the same locations but different params.
 */
const _matrixCache = new Map<string, { result: DistanceMatrixResult; ts: number }>();
const CACHE_MAX_SIZE = 50;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function matrixCacheKey(locations: Location[]): string {
    return locations.map((l) => `${l.lat.toFixed(6)},${l.lng.toFixed(6)}`).join('|');
}

export async function buildDistanceMatrix(locations: Location[]): Promise<DistanceMatrixResult> {
    if (locations.length < 2) {
        throw new Error('At least 2 locations are required');
    }

    // Check cache first
    const cacheKey = matrixCacheKey(locations);
    const cached = _matrixCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        console.log(`[Matrix] Cache hit — skipping OSRM fetch (${locations.length} locations)`);
        return cached.result;
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

        const result: DistanceMatrixResult = {
            distances: data.distances, // meters (N×N matrix)
            durations: data.durations, // seconds (N×N matrix)
        };

        // Store in cache
        _matrixCache.set(cacheKey, { result, ts: Date.now() });
        if (_matrixCache.size > CACHE_MAX_SIZE) {
            // Evict oldest entry
            const oldestKey = _matrixCache.keys().next().value;
            if (oldestKey) _matrixCache.delete(oldestKey);
        }
        console.log(`[Matrix] Cached OSRM result (${locations.length} locations)`);

        return result;
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
