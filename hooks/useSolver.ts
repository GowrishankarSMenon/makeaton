'use client';

import { useState, useCallback } from 'react';
import { MapLocation } from './useLocations';
import { LogisticsParams } from './useParams';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SolveResult {
    algorithm: string;
    solution?: any;
    heldKarp?: any;
    nearestNeighbor?: any;
    suboptimalityGap?: number | null;
    gapPercent?: string;
    metadata: {
        locationCount: number;
        matrixTimeMs: number;
        solveTimeMs: number;
        totalTimeMs: number;
    };
    routeCoords?: MapLocation[];
    heldKarpRouteCoords?: MapLocation[];
    nnRouteCoords?: MapLocation[];
    distanceMatrix?: number[][];
    rawDistanceMatrix?: number[][];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function useSolver() {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<SolveResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const solve = useCallback(
        async (locations: MapLocation[], algorithm: string, params: LogisticsParams) => {
            setIsLoading(true);
            setError(null);

            try {
                const response = await fetch('/api/solve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ locations, algorithm, params }),
                });

                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || `Server error: ${response.status}`);
                }

                const data: SolveResult = await response.json();
                setResult(data);
                return data;
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setError(message);
                throw err;
            } finally {
                setIsLoading(false);
            }
        },
        []
    );

    const clearResult = useCallback(() => {
        setResult(null);
        setError(null);
    }, []);

    return {
        isLoading,
        result,
        error,
        solve,
        clearResult,
    };
}
