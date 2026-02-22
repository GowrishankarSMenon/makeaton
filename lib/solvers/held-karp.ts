/**
 * Held-Karp Algorithm — Exact TSP solver using bitmask dynamic programming.
 *
 * Binary Encoding (Quantum Mapping):
 *   Each subset S of cities is encoded as a bitmask integer where bit i = 1
 *   means city i is included in the subset.
 *
 * DP Recurrence:
 *   dp[S][i] = min cost to visit all cities in subset S, ending at city i
 *   dp[S][i] = min over j in S\{i} of { dp[S\{i}][j] + dist[j][i] }
 *
 * Complexity: O(n² · 2ⁿ)  — feasible for n ≤ 18
 */

export interface SolverResult {
    tour: number[];
    distance: number;
    solverName: string;
    timeMs?: number;
    skipped?: boolean;
    reason?: string;
}

// Must match the value in modifiers.ts — edges with cost >= this are blocked
const BLOCKED_THRESHOLD = 1e9;

export function heldKarp(dist: number[][], startNode: number = 0): SolverResult {
    const n = dist.length;

    if (n > 20) {
        throw new Error(`Held-Karp is infeasible for n=${n} (max 18–20). Use Nearest Neighbor instead.`);
    }

    if (n === 1) {
        return { tour: [startNode], distance: 0, solverName: 'Held-Karp (Exact)' };
    }

    if (n === 2) {
        const other = startNode === 0 ? 1 : 0;
        return {
            tour: [startNode, other, startNode],
            distance: dist[startNode][other] + dist[other][startNode],
            solverName: 'Held-Karp (Exact)',
        };
    }

    const FULL_MASK = (1 << n) - 1;
    // Use a value larger than any possible sum of blocked edges so blocked
    // paths always lose to non-blocked ones. n * BLOCKED_THRESHOLD guarantees
    // that even a full tour of blocked edges sums to less than INF.
    const INF = (n + 1) * BLOCKED_THRESHOLD;

    const dp = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(INF));
    const parent = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));

    // Base case: start at startNode
    dp[1 << startNode][startNode] = 0;

    // Fill DP table
    for (let mask = 1; mask <= FULL_MASK; mask++) {
        if (!(mask & (1 << startNode))) continue;

        for (let u = 0; u < n; u++) {
            if (!(mask & (1 << u))) continue;
            if (dp[mask][u] === INF) continue;

            for (let v = 0; v < n; v++) {
                if (mask & (1 << v)) continue;
                const newMask = mask | (1 << v);
                const newCost = dp[mask][u] + dist[u][v];

                if (newCost < dp[newMask][v]) {
                    dp[newMask][v] = newCost;
                    parent[newMask][v] = u;
                }
            }
        }
    }

    // Find optimal last city before returning to start
    let minCost = INF;
    let lastCity = -1;

    for (let u = 0; u < n; u++) {
        if (u === startNode) continue;
        const totalCost = dp[FULL_MASK][u] + dist[u][startNode];
        if (totalCost < minCost) {
            minCost = totalCost;
            lastCity = u;
        }
    }

    // Reconstruct tour
    const tour: number[] = [startNode];
    let mask = FULL_MASK;
    let current = lastCity;

    const path: number[] = [];
    while (current !== startNode) {
        path.push(current);
        const prev = parent[mask][current];
        mask ^= 1 << current;
        current = prev;
    }

    path.reverse();
    tour.push(...path);
    tour.push(startNode); // Return to depot

    return {
        tour,
        distance: minCost,
        solverName: 'Held-Karp (Exact)',
    };
}
