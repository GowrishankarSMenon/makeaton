'use client';

import { useState, useCallback } from 'react';

export interface RoadBlock {
    lat: number;
    lng: number;
    radiusKm: number;
    id: string;
}

export interface CongestionZone {
    lat: number;
    lng: number;
    radiusKm: number;
    intensity: number;
    id: string;
}

let blockCounter = 0;
let zoneCounter = 0;

export function useRestrictions() {
    const [roadBlocks, setRoadBlocks] = useState<RoadBlock[]>([]);
    const [congestionZones, setCongestionZones] = useState<CongestionZone[]>([]);

    const addBlock = useCallback((lat: number, lng: number) => {
        blockCounter++;
        setRoadBlocks((prev) => [
            ...prev,
            { lat, lng, radiusKm: 1.0, id: `block-${blockCounter}-${Date.now()}` },
        ]);
    }, []);

    const removeBlock = useCallback((id: string) => {
        setRoadBlocks((prev) => prev.filter((b) => b.id !== id));
    }, []);

    const addCongestion = useCallback((lat: number, lng: number) => {
        zoneCounter++;
        setCongestionZones((prev) => [
            ...prev,
            {
                lat,
                lng,
                radiusKm: 2,
                intensity: 2.0,
                id: `zone-${zoneCounter}-${Date.now()}`,
            },
        ]);
    }, []);

    const removeCongestion = useCallback((id: string) => {
        setCongestionZones((prev) => prev.filter((z) => z.id !== id));
    }, []);

    const updateCongestion = useCallback(
        (id: string, updates: Partial<Pick<CongestionZone, 'radiusKm' | 'intensity'>>) => {
            setCongestionZones((prev) =>
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

    const updateBlock = useCallback(
        (id: string, updates: Partial<Pick<RoadBlock, 'radiusKm'>>) => {
            setRoadBlocks((prev) =>
                prev.map((b) => (b.id === id ? { ...b, ...updates } : b))
            );
        },
        []
    );

    const updateCongestionPosition = useCallback((id: string, lat: number, lng: number) => {
        setCongestionZones((prev) =>
            prev.map((z) => (z.id === id ? { ...z, lat, lng } : z))
        );
    }, []);

    const clearRestrictions = useCallback(() => {
        setRoadBlocks([]);
        setCongestionZones([]);
    }, []);

    return {
        roadBlocks,
        congestionZones,
        addBlock,
        removeBlock,
        addCongestion,
        removeCongestion,
        updateCongestion,
        updateBlockPosition,
        updateBlock,
        updateCongestionPosition,
        clearRestrictions,
    };
}
