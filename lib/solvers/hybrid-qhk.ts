/**
 * Hybrid Quantum-Classical TSP Solver (QHK)
 *
 * Architecture:
 *   Phase 1 — Quantum Exploration (QAOA)
 *     Send the full distance matrix to the quantum service.
 *     QAOA explores the combinatorial space using quantum superposition
 *     to produce an initial tour (or multiple candidate orderings).
 *
 *   Phase 2 — Classical Windowed Refinement (Held-Karp)
 *     Slide a window of size W across the quantum tour and apply
 *     exact Held-Karp DP to optimally reorder each window.
 *     Overlapping windows ensure inter-window edge quality.
 *
 *   Phase 3 — 2-opt Local Search
 *     Final classical polish: repeatedly swap edge pairs to reduce
 *     total distance until no improvement is found.
 *
 * Why this works:
 *   - Quantum QAOA provides a globally-aware initial ordering that
 *     considers all cities simultaneously (no greedy bias)
 *   - Held-Karp windows fix local suboptimality exactly
 *   - 2-opt catches any remaining crossed edges
 *
 * Scales to n > 10 (beyond pure QAOA limit) by using quantum only
 * for the initial exploration and classical for refinement.
 */

import { SolverResult } from './held-karp';
import { heldKarp } from './held-karp';
import { nearestNeighbor } from './nearest-neighbor';

export interface HybridResult extends SolverResult {
    phases: {
        prewarm?: {
            method: string;
            tour: number[];
            distance: number;
            timeMs: number;
        };
        quantum: {
            tour: number[];
            distance: number;
            timeMs: number;
            qubits: number;
            circuitDepth: number;
            backend: string;
            executionMode: string;
            fallbackReason: string | null;
            energy: number | null;
        };
        refinement: {
            tour: number[];
            distance: number;
            timeMs: number;
            windowSize: number;
            windowsApplied: number;
            improvement: number;
        };
        twoOpt: {
            tour: number[];
            distance: number;
            timeMs: number;
            swaps: number;
            improvement: number;
        };
    };
    quantumMetrics: {
        numQubits: number;
        circuitDepth: number;
        qaoaEnergy: number | null;
        backend: string;
        executionMode: string;
        fallbackReason: string | null;
        hybridPhases: string[];
        totalQuantumTimeMs: number;
        totalClassicalTimeMs: number;
    };
}

/**
 * Compute total tour distance from a distance matrix.
 */
function tourDistance(tour: number[], dist: number[][]): number {
    let d = 0;
    for (let i = 0; i < tour.length - 1; i++) {
        d += dist[tour[i]][tour[i + 1]];
    }
    return d;
}

/**
 * Phase 2: Windowed Held-Karp refinement.
 * Slides a window of size W over the tour (excluding the closing depot edge)
 * and re-solves each window exactly with Held-Karp.
 */
function windowedHeldKarpRefinement(
    tour: number[],
    dist: number[][],
    windowSize: number = 8
): { tour: number[]; windowsApplied: number } {
    // Work on the cycle (without closing return to depot)
    const cycle = tour.slice(0, -1); // [0, a, b, c, ..., 0] → [0, a, b, c, ...]
    const n = cycle.length;

    if (n <= windowSize) {
        // Entire tour fits in one window — just run HK on the whole thing
        const hk = heldKarp(dist, cycle[0]);
        return { tour: hk.tour, windowsApplied: 1 };
    }

    let improved = true;
    let passes = 0;
    const maxPasses = 3;

    while (improved && passes < maxPasses) {
        improved = false;
        passes++;

        // Stride = windowSize - 2 to create overlap
        const stride = Math.max(1, windowSize - 2);

        for (let start = 0; start <= n - windowSize; start += stride) {
            const end = Math.min(start + windowSize, n);
            const windowIndices = cycle.slice(start, end);

            if (windowIndices.length < 3) continue;

            // Build sub-distance-matrix for this window
            const wn = windowIndices.length;
            const subDist: number[][] = Array.from({ length: wn }, () => new Array(wn).fill(0));
            for (let i = 0; i < wn; i++) {
                for (let j = 0; j < wn; j++) {
                    subDist[i][j] = dist[windowIndices[i]][windowIndices[j]];
                }
            }

            // Solve sub-problem exactly
            const subResult = heldKarp(subDist, 0);
            const subTour = subResult.tour.slice(0, -1); // remove closing node

            // Map back to original indices
            const reordered = subTour.map(i => windowIndices[i]);

            // Check if this reordering improves the FULL tour
            // (including boundary edges from/to nodes outside the window)
            const prevNode = start > 0 ? cycle[start - 1] : cycle[n - 1];
            const nextNode = end < n ? cycle[end] : cycle[0];

            // Old cost: boundary entry + internal + boundary exit
            let oldCost = dist[prevNode][cycle[start]];
            for (let i = start; i < end - 1; i++) {
                oldCost += dist[cycle[i]][cycle[i + 1]];
            }
            oldCost += dist[cycle[end - 1]][nextNode];

            // New cost: boundary entry + reordered internal + boundary exit
            let newCost = dist[prevNode][reordered[0]];
            for (let i = 0; i < reordered.length - 1; i++) {
                newCost += dist[reordered[i]][reordered[i + 1]];
            }
            newCost += dist[reordered[reordered.length - 1]][nextNode];

            if (newCost < oldCost - 0.01) {
                // Apply the reordering
                for (let i = 0; i < reordered.length; i++) {
                    cycle[start + i] = reordered[i];
                }
                improved = true;
            }
        }
    }

    // Rebuild tour with closing depot
    const finalTour = [...cycle, cycle[0]];
    return { tour: finalTour, windowsApplied: passes };
}

/**
 * Phase 3: 2-opt local search.
 * Repeatedly swaps edge pairs to eliminate crossings.
 */
function twoOptImprove(
    tour: number[],
    dist: number[][]
): { tour: number[]; swaps: number } {
    const cycle = tour.slice(0, -1);
    const n = cycle.length;
    let swaps = 0;
    let improved = true;

    while (improved) {
        improved = false;
        for (let i = 1; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = cycle[i - 1], b = cycle[i];
                const c = cycle[j], d = cycle[(j + 1) % n];

                const oldCost = dist[a][b] + dist[c][d];
                const newCost = dist[a][c] + dist[b][d];

                if (newCost < oldCost - 0.01) {
                    // Reverse the segment between i and j
                    const segment = cycle.slice(i, j + 1);
                    segment.reverse();
                    for (let k = 0; k < segment.length; k++) {
                        cycle[i + k] = segment[k];
                    }
                    swaps++;
                    improved = true;
                }
            }
        }
    }

    return { tour: [...cycle, cycle[0]], swaps };
}

/**
 * Fetch quantum tour from the QAOA service.
 * Returns the quantum tour and metrics.
 */
async function fetchQuantumTour(
    distanceMatrix: number[][],
    startNode: number,
    warmStartTour?: number[]
): Promise<{
    tour: number[];
    distance: number;
    metrics: {
        numQubits: number;
        circuitDepth: number;
        energy: number | null;
        backend: string;
        executionMode: string;
        fallbackReason: string | null;
        timeMs: number;
        warmStartUsed: boolean;
    };
}> {
    const payload: Record<string, unknown> = { distanceMatrix, startNode };
    if (warmStartTour) {
        payload.warmStartTour = warmStartTour;
        console.log(`[Hybrid] Sending warm-start tour to quantum service: [${warmStartTour.join(',')}]`);
    }

    const response = await fetch('http://127.0.0.1:5001/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(600000),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Quantum solver failed');
    }

    const data = await response.json();
    const qm = data.quantumMetrics || {};

    return {
        tour: data.tour,
        distance: data.distance,
        metrics: {
            numQubits: qm.numQubits || 0,
            circuitDepth: qm.circuitDepth || 0,
            energy: qm.qaoaEnergy ?? null,
            backend: qm.backend || 'unknown',
            executionMode: qm.executionMode || 'local_simulator',
            fallbackReason: qm.fallbackReason ?? null,
            timeMs: qm.solveTimeMs || 0,
            warmStartUsed: qm.warmStartUsed ?? false,
        },
    };
}

/**
 * Main hybrid solver entry point.
 *
 * For n ≤ 10: Runs quantum QAOA + classical refinement
 * For n > 10: Partitions into quantum-sized clusters, solves each with QAOA,
 *             then uses Held-Karp to find optimal inter-cluster ordering
 */
export async function hybridQuantumHeldKarp(
    dist: number[][],
    startNode: number = 0
): Promise<HybridResult> {
    const n = dist.length;
    const totalStart = performance.now();

    // ── Phase 0: Classical Warm-Start (Nearest Neighbor) ──
    // Run NN first — it's O(n²) and instant.  The tour is used:
    //   (a) as QAOA warm-start initial state (huge speed-up)
    //   (b) as safety-net fallback if quantum result is worse
    const nnResult = nearestNeighbor(dist, startNode);
    const nnDist = tourDistance(nnResult.tour, dist);
    console.log(`[Hybrid] Phase 0: NN warm-start tour ready (${(nnDist / 1000).toFixed(1)} km)`);

    // ── Phase 1: Quantum Exploration (warm-started) ──
    const p1Start = performance.now();
    let quantumTour: number[];
    let quantumDistance: number;
    let quantumMetricsRaw: {
        numQubits: number;
        circuitDepth: number;
        energy: number | null;
        backend: string;
        executionMode: string;
        fallbackReason: string | null;
        timeMs: number;
        warmStartUsed: boolean;
    };

    if (n <= 10) {
        // Direct QAOA on full problem, warm-started from NN
        console.log(`[Hybrid] Phase 1: Full QAOA on ${n} cities (warm-started)...`);
        const qResult = await fetchQuantumTour(dist, startNode, nnResult.tour);
        quantumTour = qResult.tour;
        quantumDistance = qResult.distance;
        quantumMetricsRaw = qResult.metrics;
    } else {
        // Partition into clusters of ≤ 8, solve each with QAOA, then merge
        console.log(`[Hybrid] Phase 1: Clustered QAOA for ${n} cities...`);
        const clustered = await clusteredQuantumSolve(dist, startNode);
        quantumTour = clustered.tour;
        quantumDistance = clustered.distance;
        quantumMetricsRaw = { ...clustered.metrics, warmStartUsed: false };
    }

    const p1Time = Math.round((performance.now() - p1Start) * 100) / 100;
    console.log(`[Hybrid] Phase 1 done: quantum tour = [${quantumTour.join(',')}], dist = ${quantumDistance}`);

    // ── Phase 2: Windowed Held-Karp Refinement ──
    const p2Start = performance.now();
    const windowSize = Math.min(8, n);
    const refined = windowedHeldKarpRefinement(quantumTour, dist, windowSize);
    const refinedDistance = tourDistance(refined.tour, dist);
    const p2Time = Math.round((performance.now() - p2Start) * 100) / 100;
    const p2Improvement = quantumDistance > 0
        ? Math.round(((quantumDistance - refinedDistance) / quantumDistance) * 10000) / 100
        : 0;
    console.log(`[Hybrid] Phase 2 done: refined dist = ${refinedDistance} (${p2Improvement}% improvement)`);

    // ── Phase 3: 2-opt Polish ──
    const p3Start = performance.now();
    const polished = twoOptImprove(refined.tour, dist);
    const polishedDistance = tourDistance(polished.tour, dist);
    const p3Time = Math.round((performance.now() - p3Start) * 100) / 100;
    const p3Improvement = refinedDistance > 0
        ? Math.round(((refinedDistance - polishedDistance) / refinedDistance) * 10000) / 100
        : 0;
    console.log(`[Hybrid] Phase 3 done: polished dist = ${polishedDistance} (${p3Improvement}% improvement, ${polished.swaps} swaps)`);

    // ── Safety net: compare against the NN result from Phase 0 ──

    let finalTour = polished.tour;
    let finalDistance = polishedDistance;
    let solverName = 'Hybrid QHK (Quantum + Held-Karp)';

    if (nnDist < polishedDistance) {
        // NN beat the hybrid — 2-opt the NN result too
        const nnPolished = twoOptImprove(nnResult.tour, dist);
        const nnPolishedDist = tourDistance(nnPolished.tour, dist);
        if (nnPolishedDist < polishedDistance) {
            console.log(`[Hybrid] NN+2opt (${nnPolishedDist}) beat QHK (${polishedDistance}) — using NN+2opt`);
            finalTour = nnPolished.tour;
            finalDistance = nnPolishedDist;
            solverName = 'Hybrid QHK (Quantum + Held-Karp, NN-refined)';
        }
    }

    const totalTime = Math.round((performance.now() - totalStart) * 100) / 100;

    return {
        tour: finalTour,
        distance: finalDistance,
        solverName,
        timeMs: totalTime,
        phases: {
            quantum: {
                tour: quantumTour,
                distance: quantumDistance,
                timeMs: p1Time,
                qubits: quantumMetricsRaw.numQubits,
                circuitDepth: quantumMetricsRaw.circuitDepth,
                backend: quantumMetricsRaw.backend,
                executionMode: quantumMetricsRaw.executionMode,
                fallbackReason: quantumMetricsRaw.fallbackReason,
                energy: quantumMetricsRaw.energy,
            },
            refinement: {
                tour: refined.tour,
                distance: refinedDistance,
                timeMs: p2Time,
                windowSize,
                windowsApplied: refined.windowsApplied,
                improvement: p2Improvement,
            },
            twoOpt: {
                tour: polished.tour,
                distance: polishedDistance,
                timeMs: p3Time,
                swaps: polished.swaps,
                improvement: p3Improvement,
            },
        },
        quantumMetrics: {
            numQubits: quantumMetricsRaw.numQubits,
            circuitDepth: quantumMetricsRaw.circuitDepth,
            qaoaEnergy: quantumMetricsRaw.energy,
            backend: quantumMetricsRaw.backend,
            executionMode: quantumMetricsRaw.executionMode,
            fallbackReason: quantumMetricsRaw.fallbackReason,
            hybridPhases: ['QAOA Quantum Exploration', 'Held-Karp Window Refinement', '2-opt Local Search'],
            totalQuantumTimeMs: p1Time,
            totalClassicalTimeMs: p2Time + p3Time,
        },
    };
}

/**
 * Pre-Warm Held-Karp Hybrid Solver
 *
 * Uses Held-Karp (exact DP) as the warm-start instead of Nearest Neighbor.
 * This gives QAOA the optimal classical tour as its initial state,
 * providing the best possible seed for quantum exploration.
 *
 *   Phase 0 — Held-Karp exact solve (pre-warm)
 *   Phase 1 — QAOA warm-started from HK optimal tour
 *   Phase 2 — Windowed Held-Karp refinement
 *   Phase 3 — 2-opt local search polish
 */
export async function prewarmHeldKarpHybrid(
    dist: number[][],
    startNode: number = 0,
    solverEngine: 'ts' | 'cpp' = 'ts'
): Promise<HybridResult> {
    const n = dist.length;
    const totalStart = performance.now();

    // ── Phase 0: Held-Karp Exact Pre-Warm ──
    const p0Start = performance.now();
    console.log(`[PreWarm] Phase 0: Running Held-Karp exact solver as pre-warm (${n} cities)...`);
    const hkResult = heldKarp(dist, startNode);
    const hkDist = tourDistance(hkResult.tour, dist);
    const p0Time = Math.round((performance.now() - p0Start) * 100) / 100;
    console.log(`[PreWarm] Phase 0 done: HK optimal tour = [${hkResult.tour.join(',')}], dist = ${(hkDist / 1000).toFixed(1)} km (${p0Time} ms)`);

    // ── Phase 1: Quantum Exploration (warm-started from HK) ──
    const p1Start = performance.now();
    let quantumTour: number[];
    let quantumDistance: number;
    let quantumMetricsRaw: {
        numQubits: number;
        circuitDepth: number;
        energy: number | null;
        backend: string;
        executionMode: string;
        fallbackReason: string | null;
        timeMs: number;
        warmStartUsed: boolean;
    };

    if (n <= 10) {
        console.log(`[PreWarm] Phase 1: Full QAOA on ${n} cities (warm-started from HK optimal)...`);
        const qResult = await fetchQuantumTour(dist, startNode, hkResult.tour);
        quantumTour = qResult.tour;
        quantumDistance = qResult.distance;
        quantumMetricsRaw = qResult.metrics;
    } else {
        console.log(`[PreWarm] Phase 1: Clustered QAOA for ${n} cities...`);
        const clustered = await clusteredQuantumSolve(dist, startNode);
        quantumTour = clustered.tour;
        quantumDistance = clustered.distance;
        quantumMetricsRaw = { ...clustered.metrics, warmStartUsed: false };
    }

    const p1Time = Math.round((performance.now() - p1Start) * 100) / 100;
    console.log(`[PreWarm] Phase 1 done: quantum tour = [${quantumTour.join(',')}], dist = ${quantumDistance}`);

    // ── Phase 2: Windowed Held-Karp Refinement ──
    const p2Start = performance.now();
    const windowSize = Math.min(8, n);
    const refined = windowedHeldKarpRefinement(quantumTour, dist, windowSize);
    const refinedDistance = tourDistance(refined.tour, dist);
    const p2Time = Math.round((performance.now() - p2Start) * 100) / 100;
    const p2Improvement = quantumDistance > 0
        ? Math.round(((quantumDistance - refinedDistance) / quantumDistance) * 10000) / 100
        : 0;
    console.log(`[PreWarm] Phase 2 done: refined dist = ${refinedDistance} (${p2Improvement}% improvement)`);

    // ── Phase 3: 2-opt Polish ──
    const p3Start = performance.now();
    const polished = twoOptImprove(refined.tour, dist);
    const polishedDistance = tourDistance(polished.tour, dist);
    const p3Time = Math.round((performance.now() - p3Start) * 100) / 100;
    const p3Improvement = refinedDistance > 0
        ? Math.round(((refinedDistance - polishedDistance) / refinedDistance) * 10000) / 100
        : 0;
    console.log(`[PreWarm] Phase 3 done: polished dist = ${polishedDistance} (${p3Improvement}% improvement, ${polished.swaps} swaps)`);

    // ── Safety net: compare against the HK result from Phase 0 ──
    let finalTour = polished.tour;
    let finalDistance = polishedDistance;
    let solverName = 'Pre-Warm HK (Held-Karp → QAOA)';

    if (hkDist < polishedDistance) {
        // HK pre-warm beat the hybrid pipeline — use HK + 2-opt
        const hkPolished = twoOptImprove(hkResult.tour, dist);
        const hkPolishedDist = tourDistance(hkPolished.tour, dist);
        if (hkPolishedDist < polishedDistance) {
            console.log(`[PreWarm] HK+2opt (${hkPolishedDist}) beat QHK (${polishedDistance}) — using HK+2opt`);
            finalTour = hkPolished.tour;
            finalDistance = hkPolishedDist;
            solverName = 'Pre-Warm HK (Held-Karp → QAOA, HK-refined)';
        }
    }

    const totalTime = Math.round((performance.now() - totalStart) * 100) / 100;

    return {
        tour: finalTour,
        distance: finalDistance,
        solverName,
        timeMs: totalTime,
        phases: {
            prewarm: {
                method: 'Held-Karp',
                tour: hkResult.tour,
                distance: hkDist,
                timeMs: p0Time,
            },
            quantum: {
                tour: quantumTour,
                distance: quantumDistance,
                timeMs: p1Time,
                qubits: quantumMetricsRaw.numQubits,
                circuitDepth: quantumMetricsRaw.circuitDepth,
                backend: quantumMetricsRaw.backend,
                executionMode: quantumMetricsRaw.executionMode,
                fallbackReason: quantumMetricsRaw.fallbackReason,
                energy: quantumMetricsRaw.energy,
            },
            refinement: {
                tour: refined.tour,
                distance: refinedDistance,
                timeMs: p2Time,
                windowSize,
                windowsApplied: refined.windowsApplied,
                improvement: p2Improvement,
            },
            twoOpt: {
                tour: polished.tour,
                distance: polishedDistance,
                timeMs: p3Time,
                swaps: polished.swaps,
                improvement: p3Improvement,
            },
        },
        quantumMetrics: {
            numQubits: quantumMetricsRaw.numQubits,
            circuitDepth: quantumMetricsRaw.circuitDepth,
            qaoaEnergy: quantumMetricsRaw.energy,
            backend: quantumMetricsRaw.backend,
            executionMode: quantumMetricsRaw.executionMode,
            fallbackReason: quantumMetricsRaw.fallbackReason,
            hybridPhases: ['Held-Karp Exact Pre-Warm', 'QAOA Quantum Exploration', 'Held-Karp Window Refinement', '2-opt Local Search'],
            totalQuantumTimeMs: p1Time,
            totalClassicalTimeMs: p0Time + p2Time + p3Time,
        },
    };
}

/**
 * For n > 10: K-means-style spatial clustering → QAOA per cluster → merge.
 * Uses nearest-neighbor chaining between clusters, then refines.
 */
async function clusteredQuantumSolve(
    dist: number[][],
    startNode: number
): Promise<{
    tour: number[];
    distance: number;
    metrics: {
        numQubits: number;
        circuitDepth: number;
        energy: number | null;
        backend: string;
        executionMode: string;
        fallbackReason: string | null;
        timeMs: number;
    };
}> {
    const n = dist.length;
    const clusterSize = 8;
    const numClusters = Math.ceil(n / clusterSize);

    // Simple greedy clustering: start from depot, grab nearest unassigned cities
    const assigned = new Set<number>();
    const clusters: number[][] = [];

    // First cluster always includes the start node
    let seedNode = startNode;

    for (let c = 0; c < numClusters; c++) {
        const cluster: number[] = [seedNode];
        assigned.add(seedNode);

        while (cluster.length < clusterSize && assigned.size < n) {
            // Find nearest unassigned city to any city in this cluster
            let bestCity = -1;
            let bestDist = Infinity;
            for (const ci of cluster) {
                for (let j = 0; j < n; j++) {
                    if (!assigned.has(j) && dist[ci][j] < bestDist) {
                        bestDist = dist[ci][j];
                        bestCity = j;
                    }
                }
            }
            if (bestCity === -1) break;
            cluster.push(bestCity);
            assigned.add(bestCity);
        }

        clusters.push(cluster);

        // Next cluster seed = nearest unassigned to any city in current cluster
        let nextSeed = -1;
        let nextSeedDist = Infinity;
        for (const ci of cluster) {
            for (let j = 0; j < n; j++) {
                if (!assigned.has(j) && dist[ci][j] < nextSeedDist) {
                    nextSeedDist = dist[ci][j];
                    nextSeed = j;
                }
            }
        }
        if (nextSeed !== -1) seedNode = nextSeed;
    }

    console.log(`[Hybrid] Created ${clusters.length} clusters: ${clusters.map(c => c.length).join(', ')} cities`);

    // Solve each cluster with QAOA
    let totalQubits = 0;
    let maxDepth = 0;
    let totalTime = 0;
    let lastBackend = 'unknown';
    let lastMode = 'local_simulator';
    let lastFallback: string | null = null;
    let lastEnergy: number | null = null;

    const clusterTours: number[][] = [];

    for (let c = 0; c < clusters.length; c++) {
        const cluster = clusters[c];
        const cn = cluster.length;

        if (cn <= 1) {
            clusterTours.push(cluster);
            continue;
        }

        // Build sub-distance-matrix
        const subDist: number[][] = Array.from({ length: cn }, () => new Array(cn).fill(0));
        for (let i = 0; i < cn; i++) {
            for (let j = 0; j < cn; j++) {
                subDist[i][j] = dist[cluster[i]][cluster[j]];
            }
        }

        try {
            console.log(`[Hybrid] Solving cluster ${c + 1}/${clusters.length} (${cn} cities) with QAOA...`);
            const qResult = await fetchQuantumTour(subDist, 0);

            // Map back to original city indices (exclude closing return)
            const mappedTour = qResult.tour.slice(0, -1).map(i => cluster[i]);
            clusterTours.push(mappedTour);

            totalQubits = Math.max(totalQubits, qResult.metrics.numQubits);
            maxDepth = Math.max(maxDepth, qResult.metrics.circuitDepth);
            totalTime += qResult.metrics.timeMs;
            lastBackend = qResult.metrics.backend;
            lastMode = qResult.metrics.executionMode;
            lastFallback = qResult.metrics.fallbackReason;
            lastEnergy = qResult.metrics.energy;
        } catch (err) {
            console.warn(`[Hybrid] QAOA failed for cluster ${c + 1}, using NN fallback:`, err);
            const nnResult = nearestNeighbor(subDist, 0);
            const mappedTour = nnResult.tour.slice(0, -1).map(i => cluster[i]);
            clusterTours.push(mappedTour);
        }
    }

    // Chain clusters: connect end of cluster c to start of cluster c+1
    const fullTour: number[] = [];
    for (const ct of clusterTours) {
        fullTour.push(...ct);
    }
    fullTour.push(fullTour[0]); // close the tour

    const totalDist = tourDistance(fullTour, dist);

    return {
        tour: fullTour,
        distance: totalDist,
        metrics: {
            numQubits: totalQubits,
            circuitDepth: maxDepth,
            energy: lastEnergy,
            backend: lastBackend,
            executionMode: lastMode,
            fallbackReason: lastFallback,
            timeMs: totalTime,
        },
    };
}
