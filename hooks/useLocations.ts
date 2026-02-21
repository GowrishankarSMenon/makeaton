'use client';

import { useState, useCallback } from 'react';

export interface MapLocation {
    lat: number;
    lng: number;
    label: string;
    priority: number;
}

export function useLocations() {
    const [locations, setLocations] = useState<MapLocation[]>([]);

    const addLocation = useCallback((lat: number, lng: number) => {
        setLocations((prev) => {
            const index = prev.length;
            const isDepot = index === 0;
            return [
                ...prev,
                {
                    lat: Math.round(lat * 1000000) / 1000000,
                    lng: Math.round(lng * 1000000) / 1000000,
                    label: isDepot ? 'Depot' : `Stop ${index}`,
                    priority: 1.0,
                },
            ];
        });
    }, []);

    const removeLocation = useCallback((index: number) => {
        setLocations((prev) => {
            const next = prev.filter((_, i) => i !== index);
            // Rebuild labels after removal
            return next.map((loc, i) => ({
                ...loc,
                label: i === 0 ? 'Depot' : `Stop ${i}`,
            }));
        });
    }, []);

    const updatePriority = useCallback((index: number, priority: number) => {
        setLocations((prev) =>
            prev.map((loc, i) => (i === index ? { ...loc, priority } : loc))
        );
    }, []);

    const clearAll = useCallback(() => {
        setLocations([]);
    }, []);

    return {
        locations,
        addLocation,
        removeLocation,
        updatePriority,
        clearAll,
    };
}
