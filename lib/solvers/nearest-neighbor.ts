/**
 * Nearest Neighbor Algorithm — Greedy TSP approximation.
 *
 * Strategy: From the depot, always visit the nearest unvisited city.
 * Fast O(n²) complexity, works for any N, but does NOT guarantee optimality.
 */

import { SolverResult } from './held-karp';

// Must match the value in modifiers.ts — edges with cost >= this are blocked
const BLOCKED_THRESHOLD = 1e9;

export function nearestNeighbor(dist: number[][], startNode: number = 0): SolverResult {
    const n = dist.length;

    if (n === 1) {
        return { tour: [startNode], distance: 0, solverName: 'Nearest Neighbor (Greedy)' };
    }

    const visited = new Set([startNode]);
    const tour: number[] = [startNode];
    let totalDistance = 0;
    let current = startNode;

    while (visited.size < n) {
        let nearest = -1;
        let nearestDist = Infinity;
        let nearestBlocked = -1;
        let nearestBlockedDist = Infinity;

        for (let j = 0; j < n; j++) {
            if (visited.has(j)) continue;

            if (dist[current][j] < BLOCKED_THRESHOLD) {
                // Prefer non-blocked edges
                if (dist[current][j] < nearestDist) {
                    nearestDist = dist[current][j];
                    nearest = j;
                }
            } else {
                // Track nearest blocked as last resort
                if (dist[current][j] < nearestBlockedDist) {
                    nearestBlockedDist = dist[current][j];
                    nearestBlocked = j;
                }
            }
        }

        // Use non-blocked if available, otherwise forced to use blocked
        if (nearest === -1) {
            nearest = nearestBlocked;
            nearestDist = nearestBlockedDist;
            console.warn(
                `[NN] ⚠ Forced to use blocked edge ${current}→${nearest} — no unblocked neighbor available`
            );
        }

        visited.add(nearest);
        tour.push(nearest);
        totalDistance += nearestDist;
        current = nearest;
    }

    // Return to depot
    totalDistance += dist[current][startNode];
    tour.push(startNode);

    return {
        tour,
        distance: totalDistance,
        solverName: 'Nearest Neighbor (Greedy)',
    };
}
