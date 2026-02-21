/**
 * Compare Mode — Runs both Held-Karp and Nearest Neighbor simultaneously,
 * then quantifies the suboptimality gap.
 */

import { heldKarp, SolverResult } from './held-karp';
import { nearestNeighbor } from './nearest-neighbor';

export interface CompareResult {
    heldKarp: SolverResult;
    nearestNeighbor: SolverResult;
    suboptimalityGap: number | null;
    gapPercent: string;
}

export function compareSolvers(dist: number[][], startNode: number = 0): CompareResult {
    const n = dist.length;

    // Run Nearest Neighbor (always runs)
    const nnStart = performance.now();
    const nnResult = nearestNeighbor(dist, startNode);
    const nnTime = performance.now() - nnStart;
    nnResult.timeMs = Math.round(nnTime * 100) / 100;

    // Run Held-Karp (only if feasible)
    let hkResult: SolverResult;
    let suboptimalityGap: number | null = null;
    let gapPercent = 'N/A';

    if (n <= 18) {
        const hkStart = performance.now();
        hkResult = heldKarp(dist, startNode);
        const hkTime = performance.now() - hkStart;
        hkResult.timeMs = Math.round(hkTime * 100) / 100;

        // Gap = (NN - HK) / HK * 100
        if (hkResult.distance > 0) {
            suboptimalityGap = nnResult.distance - hkResult.distance;
            gapPercent = ((suboptimalityGap / hkResult.distance) * 100).toFixed(2) + '%';
        }
    } else {
        hkResult = {
            tour: [],
            distance: 0,
            solverName: 'Held-Karp (Exact)',
            timeMs: 0,
            skipped: true,
            reason: `Skipped: n=${n} exceeds max 18 for exact solver`,
        };
    }

    return {
        heldKarp: hkResult,
        nearestNeighbor: nnResult,
        suboptimalityGap,
        gapPercent,
    };
}
