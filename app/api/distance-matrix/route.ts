import { NextRequest, NextResponse } from 'next/server';
import { buildDistanceMatrix, Location } from '@/lib/preprocessing/distance-matrix';
import { applyModifiers } from '@/lib/preprocessing/modifiers';

/**
 * POST /api/distance-matrix
 * Debug endpoint: returns the raw & weighted distance matrices.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { locations, params = {} } = body as {
            locations: Location[];
            params: Record<string, unknown>;
        };

        if (!locations || locations.length < 2) {
            return NextResponse.json({ error: 'At least 2 locations are required' }, { status: 400 });
        }

        const { distances, durations } = await buildDistanceMatrix(locations);
        const { weightedDistances, weightedDurations } = applyModifiers(distances, durations, params);

        return NextResponse.json({
            raw: { distances, durations },
            weighted: { distances: weightedDistances, durations: weightedDurations },
            locationCount: locations.length,
        });
    } catch (err: unknown) {
        console.error('Distance matrix error:', err);
        const message = err instanceof Error ? err.message : 'Internal server error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
