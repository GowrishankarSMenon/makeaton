import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';

import { buildDistanceMatrix, Location } from '@/lib/preprocessing/distance-matrix';
import { applyModifiers, detectBlockedEdges, BLOCKED_DISTANCE } from '@/lib/preprocessing/modifiers';

import { heldKarp } from '@/lib/solvers/held-karp';
import { nearestNeighbor } from '@/lib/solvers/nearest-neighbor';
import { compareSolvers } from '@/lib/solvers/compare';
import { hybridQuantumHeldKarp, prewarmHeldKarpHybrid } from '@/lib/solvers/hybrid-qhk';

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

    // Debug: confirm roadBlocks and locations before modifier
    console.log(
      `[Solve] Pre-modifier: ${locations.length} locations, ` +
      `${(params as any).roadBlocks?.length ?? 0} roadBlocks, ` +
      `sample dist[0][1]=${distances[0]?.[1] ?? 'N/A'}`
    );

    // Detect blocked edges via OSRM distance-based analysis (async)
    let blockedEdges: Set<string> | undefined;
    if (rb && rb.length > 0) {
      console.log(`[Solve] Detecting blocked edges via OSRM table for ${rb.length} block(s)...`);
      blockedEdges = await detectBlockedEdges(locations, rb, distances);
    }

    const { weightedDistances } = applyModifiers(distances, durations, params, locations, blockedEdges);

    // Debug: confirm matrix changed after modifier
    console.log(
      `[Solve] Post-modifier: sample weightedDist[0][1]=${weightedDistances[0]?.[1] ?? 'N/A'}`
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

              proc.on('error', (err) => {
                reject(new Error(`Failed to start C++ solver: ${err.message}`));
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

                  console.log(`[Solve] C++ tour: [${tour.join(', ')}]`);
                  validateTourEdges(tour, weightedDistances);

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

            const fallbackSolution = heldKarp(weightedDistances, 0);
            console.log(`[Solve] TS-fallback tour: [${fallbackSolution.tour.join(', ')}]`);
            validateTourEdges(fallbackSolution.tour, weightedDistances);
            result = {
              solution: {
                ...fallbackSolution,
                solverName: 'Held-Karp (TS fallback)',
              },
            };
          }
        } else {
          const hkSolution = heldKarp(weightedDistances, 0);
          console.log(`[Solve] HK tour: [${hkSolution.tour.join(', ')}]`);
          validateTourEdges(hkSolution.tour, weightedDistances);
          result = {
            solution: hkSolution,
          };
        }

        break;
      }

      case 'nearest-neighbor': {
        const nnSolution = nearestNeighbor(weightedDistances, 0);
        console.log(`[Solve] NN tour: [${nnSolution.tour.join(', ')}]`);
        validateTourEdges(nnSolution.tour, weightedDistances);
        result = { solution: nnSolution };
        break;
      }

      case 'compare': {
        const cmpResult = compareSolvers(weightedDistances, 0);
        if (cmpResult.heldKarp?.tour?.length) {
          console.log(`[Solve] Compare HK tour: [${cmpResult.heldKarp.tour.join(', ')}]`);
          validateTourEdges(cmpResult.heldKarp.tour, weightedDistances);
        }
        if (cmpResult.nearestNeighbor?.tour?.length) {
          console.log(`[Solve] Compare NN tour: [${cmpResult.nearestNeighbor.tour.join(', ')}]`);
          validateTourEdges(cmpResult.nearestNeighbor.tour, weightedDistances);
        }
        result = cmpResult;
        break;
      }

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

        if (quantumData.tour) {
          console.log(`[Solve] QAOA tour: [${quantumData.tour.join(', ')}]`);
          validateTourEdges(quantumData.tour, weightedDistances);
        }

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

      case 'hybrid-qhk': {
        console.log(`[Solve] Starting Hybrid Quantum-Classical solver for ${weightedDistances.length} cities...`);
        const hybridSolution = await hybridQuantumHeldKarp(weightedDistances, 0);
        console.log(`[Solve] Hybrid tour: [${hybridSolution.tour.join(', ')}]`);
        validateTourEdges(hybridSolution.tour, weightedDistances);
        result = {
          solution: hybridSolution,
        };
        break;
      }

      case 'prewarm-hk': {
        console.log(`[Solve] Starting Pre-Warm HK solver for ${weightedDistances.length} cities...`);
        const prewarmSolution = await prewarmHeldKarpHybrid(weightedDistances, 0, solverEngine);
        console.log(`[Solve] PreWarm-HK tour: [${prewarmSolution.tour.join(', ')}]`);
        validateTourEdges(prewarmSolution.tour, weightedDistances);
        result = {
          solution: prewarmSolution,
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

    const solution = result.solution as { tour: number[]; distance: number } | undefined;
    const hkResult = result.heldKarp as { tour: number[]; distance: number } | undefined;
    const nnResult = result.nearestNeighbor as { tour: number[]; distance: number } | undefined;

    // Compute ACTUAL road distance from the raw (unweighted) matrix so the
    // UI shows real-world km, not the inflated solver-internal cost.
    if (solution && solution.tour.length > 1) {
      response.routeCoords = solution.tour.map((i: number) => locations[i]);
      solution.distance = tourRawDistance(solution.tour, distances);
    }

    if (hkResult && hkResult.tour && hkResult.tour.length > 1) {
      response.heldKarpRouteCoords = hkResult.tour.map((i: number) => locations[i]);
      hkResult.distance = tourRawDistance(hkResult.tour, distances);
    }

    if (nnResult && nnResult.tour && nnResult.tour.length > 1) {
      response.nnRouteCoords = nnResult.tour.map((i: number) => locations[i]);
      nnResult.distance = tourRawDistance(nnResult.tour, distances);
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    console.error('Solve error:', err);

    const message =
      err instanceof Error ? err.message : 'Internal server error';

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Compute the actual road distance (meters) of a tour using the raw
 * OSRM distance matrix — no modifiers, no blocking penalties.
 */
function tourRawDistance(tour: number[], rawDist: number[][]): number {
  let d = 0;
  for (let k = 0; k < tour.length - 1; k++) {
    d += rawDist[tour[k]][tour[k + 1]];
  }
  return d;
}

/**
 * Validate that no edge in the solver tour uses a blocked edge.
 * Logs a warning for each violation.
 */
function validateTourEdges(
  tour: number[],
  matrix: number[][]
): void {
  if (!tour || tour.length < 2) return;
  let violations = 0;
  for (let k = 0; k < tour.length - 1; k++) {
    const i = tour[k];
    const j = tour[k + 1];
    const cost = matrix[i]?.[j];
    if (cost != null && cost >= BLOCKED_DISTANCE) {
      violations++;
      console.warn(
        `[Solve] ⚠ BLOCKED EDGE in tour: ${i}→${j} cost=${cost}`
      );
    }
  }
  if (violations > 0) {
    console.warn(
      `[Solve] ⚠ Tour contains ${violations} blocked edge(s) — roadblock enforcement may have failed`
    );
  }
}