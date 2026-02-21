'use client';

import { useState, useCallback } from 'react';

export interface LogisticsParams {
    trafficCongestion: number;
    rushHourMultiplier: number;
    roadTypePreference: number;
    fuelEfficiency: number;
    deliveryPriority: number[] | null;
}

const DEFAULT_PARAMS: LogisticsParams = {
    trafficCongestion: 1.0,
    rushHourMultiplier: 1.0,
    roadTypePreference: 1.0,
    fuelEfficiency: 1.0,
    deliveryPriority: null,
};

export function useParams() {
    const [params, setParams] = useState<LogisticsParams>({ ...DEFAULT_PARAMS });
    const [priorityEnabled, setPriorityEnabled] = useState(false);

    const updateParam = useCallback(
        <K extends keyof LogisticsParams>(key: K, value: LogisticsParams[K]) => {
            setParams((prev) => ({ ...prev, [key]: value }));
        },
        []
    );

    const togglePriority = useCallback(
        (enabled: boolean) => {
            setPriorityEnabled(enabled);
            if (!enabled) {
                setParams((prev) => ({ ...prev, deliveryPriority: null }));
            }
        },
        []
    );

    const resetParams = useCallback(() => {
        setParams({ ...DEFAULT_PARAMS });
        setPriorityEnabled(false);
    }, []);

    const getParamsForSolve = useCallback(
        (locationPriorities?: number[]) => {
            const result = { ...params };
            if (priorityEnabled && locationPriorities) {
                result.deliveryPriority = locationPriorities;
            } else {
                result.deliveryPriority = null;
            }
            return result;
        },
        [params, priorityEnabled]
    );

    return {
        params,
        priorityEnabled,
        updateParam,
        togglePriority,
        resetParams,
        getParamsForSolve,
    };
}
