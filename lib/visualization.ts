/**
 * visualization.ts — Road geometry fetching utilities.
 * Used by the MapView component for OSRM road route rendering.
 */

import { Location } from './preprocessing/distance-matrix';

/**
 * Fetch real road geometry between two points from OSRM.
 * Returns an array of [lat, lng] pairs tracing the actual road.
 * Falls back to a straight line if the API fails.
 */
export async function fetchRoadGeometry(
    from: Location,
    to: Location
): Promise<[number, number][]> {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            // OSRM returns [lng, lat], Leaflet needs [lat, lng]
            return data.routes[0].geometry.coordinates.map(
                (c: [number, number]) => [c[1], c[0]] as [number, number]
            );
        }
    } catch (err) {
        console.warn('OSRM route fetch failed, falling back to straight line:', err);
    }
    // Fallback: straight line between points
    return [
        [from.lat, from.lng],
        [to.lat, to.lng],
    ];
}

/**
 * Get full road geometry for an ordered array of waypoints.
 * Fetches OSRM road segments between each consecutive pair in parallel.
 */
export async function getRoadRoute(coords: Location[]): Promise<[number, number][]> {
    if (!coords || coords.length < 2) return [];

    // Fetch all segments in parallel for speed
    const segmentPromises: Promise<[number, number][]>[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
        segmentPromises.push(fetchRoadGeometry(coords[i], coords[i + 1]));
    }
    const segments = await Promise.all(segmentPromises);

    // Concatenate segments, removing duplicate junction points
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
