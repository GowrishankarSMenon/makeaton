import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

import { buildDistanceMatrix, Location } from '@/lib/preprocessing/distance-matrix';
import { applyModifiers } from '@/lib/preprocessing/modifiers';

import { heldKarp } from '@/lib/solvers/held-karp';
import { nearestNeighbor } from '@/lib/solvers/nearest-neighbor';
import { compareSolvers } from '@/lib/solvers/compare';

export const runtime = 'nodejs';
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  try {
    const bodyJson = await request.json() as {
      locations: Location[];
      algorithm?: string;
      solverEngine?: 'ts' | 'cpp';
      params?: Record<string, unknown>;
    };

    const {
      locations,
      algorithm = 'held-karp',
      solverEngine = 'ts',
      params = {},
    } = bodyJson;

    if (!locations || locations.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 locations are required' },
        { status: 400 }
      );
    }

    // TS cap only
    if (
      algorithm === 'held-karp' &&
      solverEngine !== 'cpp' &&
      locations.length > 18
    ) {
      return NextResponse.json(
        {
          error: `Held-Karp (TS) is infeasible for ${locations.length} locations (max 18). Switch to the C++ engine.`,
        },
        { status: 400 }
      );
    }

    const startMatrix = performance.now();
    const { distances, durations } = await buildDistanceMatrix(locations);

    const matrixTimeMs =
      Math.round((performance.now() - startMatrix) * 100) / 100;

    // Log restrictions for debugging
    const rb = (params as any).roadBlocks;
    const cz = (params as any).congestionZones;
    if ((rb && rb.length > 0) || (cz && cz.length > 0)) {
      console.log(`[Solve] Restrictions received: ${rb?.length || 0} road blocks, ${cz?.length || 0} congestion zones`);
    }

    const { weightedDistances } = applyModifiers(
      distances,
      durations,
      params,
      locations
    );

    const startSolve = performance.now();

    let result: any;

    switch (algorithm) {
      case 'held-karp': {
        if (solverEngine === 'cpp') {
          try {
            const n = weightedDistances.length;

            const input =
              n +
              '\n' +
              weightedDistances.map((row) => row.join(' ')).join('\n') +
              '\n';

            const solution = await new Promise((resolve, reject) => {
              const bin = process.platform === 'win32'
                ? './held-karp-cpp/heldkarp.exe'
                : './held-karp-cpp/heldkarp';
              const proc = spawn(bin);

              let output = '';
              let errorOutput = '';

              proc.stdout.on('data', (data) => {
                output += data.toString();
              });

              proc.stderr.on('data', (data) => {
                errorOutput += data.toString();
              });

              proc.on('close', (code) => {
                if (code !== 0) {
                  return reject(
                    new Error(
                      errorOutput ||
                      `Held-Karp (C++) exited with code ${code}`
                    )
                  );
                }

                try {
                  const lines = output.trim().split('\n');

                  const distance = parseFloat(lines[0]);
                  const tour = lines[1].trim().split(' ').map(Number);

                  resolve({
                    tour,
                    distance,
                    solverName: 'Held-Karp (C++)',
                  });
                } catch {
                  reject(new Error('Failed to parse C++ solver output'));
                }
              });

              proc.stdin.write(input);
              proc.stdin.end();
            });

            result = { solution };
          } catch (err) {
            console.warn('C++ solver failed — falling back to TS', err);

            result = {
              solution: {
                ...heldKarp(weightedDistances, 0),
                solverName: 'Held-Karp (TS fallback)',
              },
            };
          }
        } else {
          result = {
            solution: heldKarp(weightedDistances, 0),
          };
        }

        break;
      }

      case 'nearest-neighbor':
        result = { solution: nearestNeighbor(weightedDistances, 0) };
        break;

      case 'compare':
        result = compareSolvers(weightedDistances, 0);
        break;

      case 'qaoa': {
        const quantumResponse = await fetch(
          'http://127.0.0.1:5001/solve',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              distanceMatrix: weightedDistances,
              startNode: 0,
            }),
            signal: AbortSignal.timeout(600000),
          }
        );

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
            backend: quantumData.quantumMetrics?.backend ?? 'unknown',
            executionMode: quantumData.quantumMetrics?.executionMode ?? 'local_simulator',
            fallbackReason: quantumData.quantumMetrics?.fallbackReason ?? null,
          },
        };

        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown algorithm: ${algorithm}` },
          { status: 400 }
        );
    }

    const solveTimeMs =
      Math.round((performance.now() - startSolve) * 100) / 100;

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

    const solution = result.solution as { tour: number[] } | undefined;
    const hkResult = result.heldKarp as { tour: number[] } | undefined;
    const nnResult = result.nearestNeighbor as { tour: number[] } | undefined;

    if (solution) {
      response.routeCoords = solution.tour.map((i: number) => locations[i]);
    }

    if (hkResult && hkResult.tour) {
      response.heldKarpRouteCoords = hkResult.tour.map((i: number) => locations[i]);
    }

    if (nnResult && nnResult.tour) {
      response.nnRouteCoords = nnResult.tour.map((i: number) => locations[i]);
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    console.error('Solve error:', err);

    const message =
      err instanceof Error ? err.message : 'Internal server error';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}