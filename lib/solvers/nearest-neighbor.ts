/**
 * Nearest Neighbor Algorithm — Greedy TSP approximation.
 *
 * Strategy: From the depot, always visit the nearest unvisited city.
 * Fast O(n²) complexity, works for any N, but does NOT guarantee optimality.
 */

import { SolverResult } from './held-karp';

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

        for (let j = 0; j < n; j++) {
            if (!visited.has(j) && dist[current][j] < nearestDist) {
                nearestDist = dist[current][j];
                nearest = j;
            }
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
