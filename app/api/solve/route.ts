import { NextRequest, NextResponse } from 'next/server';
import { buildDistanceMatrix, Location } from '@/lib/preprocessing/distance-matrix';
import { applyModifiers } from '@/lib/preprocessing/modifiers';
import { heldKarp } from '@/lib/solvers/held-karp';
import { nearestNeighbor } from '@/lib/solvers/nearest-neighbor';
import { compareSolvers } from '@/lib/solvers/compare';

// Allow long-running requests (QAOA quantum solver can take several minutes)
export const maxDuration = 600; // 10 minutes

/**
 * POST /api/solve
 * Main endpoint: builds distance matrix, applies modifiers, solves TSP.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { locations, algorithm = 'held-karp', params = {} } = body as {
            locations: Location[];
            algorithm: string;
            params: Record<string, unknown>;
        };

        if (!locations || locations.length < 2) {
            return NextResponse.json({ error: 'At least 2 locations are required' }, { status: 400 });
        }

        if (algorithm === 'held-karp' && locations.length > 18) {
            return NextResponse.json(
                { error: `Held-Karp is infeasible for ${locations.length} locations (max 18). Use Nearest Neighbor or Compare mode.` },
                { status: 400 }
            );
        }

        // Step 1: Build distance matrix via OSRM
        const startMatrix = performance.now();
        const { distances, durations } = await buildDistanceMatrix(locations);
        const matrixTimeMs = Math.round((performance.now() - startMatrix) * 100) / 100;

        // Step 2: Apply logistics modifiers
        const { weightedDistances, weightedDurations } = applyModifiers(distances, durations, params);

        // Step 3: Solve TSP
        const startSolve = performance.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: any;

        switch (algorithm) {
            case 'held-karp':
                result = { solution: heldKarp(weightedDistances, 0) };
                break;
            case 'nearest-neighbor':
                result = { solution: nearestNeighbor(weightedDistances, 0) };
                break;
            case 'compare':
                result = compareSolvers(weightedDistances, 0);
                break;
            case 'qaoa': {
                // Proxy to Python quantum service
                const quantumResponse = await fetch('http://127.0.0.1:5001/solve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        distanceMatrix: weightedDistances,
                        startNode: 0,
                    }),
                    signal: AbortSignal.timeout(600000), // 10 minute timeout for QAOA
                });

                if (!quantumResponse.ok) {
                    const err = await quantumResponse.json();
                    return NextResponse.json(
                        { error: err.error || 'Quantum solver failed' },
                        { status: quantumResponse.status }
                    );
                }

                const quantumData = await quantumResponse.json();
                result = {
                    solution: {
                        tour: quantumData.tour,
                        distance: quantumData.distance,
                        solverName: quantumData.solverName,
                        isFeasible: quantumData.isFeasible,
                        quantumMetrics: quantumData.quantumMetrics,
                    },
                };
                break;
            }
            default:
                return NextResponse.json({ error: `Unknown algorithm: ${algorithm}` }, { status: 400 });
        }

        const solveTimeMs = Math.round((performance.now() - startSolve) * 100) / 100;

        // Build response with route coordinates for map rendering
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = {
            algorithm,
            ...result,
            metadata: {
                locationCount: locations.length,
                matrixTimeMs,
                solveTimeMs,
                totalTimeMs: matrixTimeMs + solveTimeMs,
            },
            distanceMatrix: weightedDistances,
            rawDistanceMatrix: distances,
        };

        // Attach ordered coordinates for route visualization
        const solution = result.solution as { tour: number[] } | undefined;
        const hkResult = result.heldKarp as { tour: number[] } | undefined;
        const nnResult = result.nearestNeighbor as { tour: number[] } | undefined;

        if (solution) {
            response.routeCoords = solution.tour.map((i: number) => locations[i]);
        } else if (hkResult && hkResult.tour.length > 0) {
            response.heldKarpRouteCoords = hkResult.tour.map((i: number) => locations[i]);
            response.nnRouteCoords = nnResult!.tour.map((i: number) => locations[i]);
        } else if (nnResult) {
            response.nnRouteCoords = nnResult.tour.map((i: number) => locations[i]);
        }

        return NextResponse.json(response);
    } catch (err: unknown) {
        console.error('Solve error:', err);
        const message = err instanceof Error ? err.message : 'Internal server error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
