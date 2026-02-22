'use client';

import { useState, useCallback } from 'react';

export interface RoadBlock {
    lat: number;
    lng: number;
    id: string;
}

export interface WeatherZone {
    lat: number;
    lng: number;
    radiusKm: number;
    type: 'rain' | 'lightning';
    fragile: boolean;
    id: string;
}

let blockCounter = 0;
let zoneCounter = 0;

export function useRestrictions() {
    const [roadBlocks, setRoadBlocks] = useState<RoadBlock[]>([]);
    const [weatherZones, setWeatherZones] = useState<WeatherZone[]>([]);

    const addBlock = useCallback((lat: number, lng: number) => {
        blockCounter++;
        setRoadBlocks((prev) => [
            ...prev,
            { lat, lng, id: `block-${blockCounter}-${Date.now()}` },
        ]);
    }, []);

    const removeBlock = useCallback((id: string) => {
        setRoadBlocks((prev) => prev.filter((b) => b.id !== id));
    }, []);

    const addWeather = useCallback((lat: number, lng: number) => {
        zoneCounter++;
        setWeatherZones((prev) => [
            ...prev,
            {
                lat,
                lng,
                radiusKm: 2,
                type: 'rain',
                fragile: false,
                id: `weather-${zoneCounter}-${Date.now()}`,
            },
        ]);
    }, []);

    const removeWeather = useCallback((id: string) => {
        setWeatherZones((prev) => prev.filter((z) => z.id !== id));
    }, []);

    const updateWeather = useCallback(
        (id: string, updates: Partial<Pick<WeatherZone, 'radiusKm' | 'type' | 'fragile'>>) => {
            setWeatherZones((prev) =>
                prev.map((z) => (z.id === id ? { ...z, ...updates } : z))
            );
        },
        []
    );

    const updateBlockPosition = useCallback((id: string, lat: number, lng: number) => {
        setRoadBlocks((prev) =>
            prev.map((b) => (b.id === id ? { ...b, lat, lng } : b))
        );
    }, []);

    const updateWeatherPosition = useCallback((id: string, lat: number, lng: number) => {
        setWeatherZones((prev) =>
            prev.map((z) => (z.id === id ? { ...z, lat, lng } : z))
        );
    }, []);

    const clearRestrictions = useCallback(() => {
        setRoadBlocks([]);
        setWeatherZones([]);
    }, []);

    return {
        roadBlocks,
        weatherZones,
        addBlock,
        removeBlock,
        addWeather,
        removeWeather,
        updateWeather,
        updateBlockPosition,
        updateWeatherPosition,
        clearRestrictions,
    };
}
