'use client';

import { useState, useCallback } from 'react';

export interface RoadBlock {
    id: string;
    lat: number;
    lng: number;
    /** Radius in meters — edges passing through this circle get infinite weight */
    radius: number;
}

export interface TrafficZone {
    id: string;
    lat: number;
    lng: number;
    /** Radius in meters */
    radius: number;
    /** Multiplier applied to edges traversing this zone (e.g. 2.0 = 2× slower) */
    multiplier: number;
}

export interface Constraints {
    roadBlocks: RoadBlock[];
    trafficZones: TrafficZone[];
}

let _nextId = 1;
function uid(prefix: string) {
    return `${prefix}_${_nextId++}_${Date.now()}`;
}

export function useConstraints() {
    const [roadBlocks, setRoadBlocks] = useState<RoadBlock[]>([]);
    const [trafficZones, setTrafficZones] = useState<TrafficZone[]>([]);
    const [activeTool, setActiveTool] = useState<'roadblock' | 'traffic' | null>(null);

    /* ── road blocks ─────────────────────────────────────── */
    const addRoadBlock = useCallback((lat: number, lng: number) => {
        const rb: RoadBlock = { id: uid('rb'), lat, lng, radius: 500 };
        setRoadBlocks((prev) => [...prev, rb]);
    }, []);

    const moveRoadBlock = useCallback((id: string, lat: number, lng: number) => {
        setRoadBlocks((prev) =>
            prev.map((rb) => (rb.id === id ? { ...rb, lat, lng } : rb))
        );
    }, []);

    const removeRoadBlock = useCallback((id: string) => {
        setRoadBlocks((prev) => prev.filter((rb) => rb.id !== id));
    }, []);

    /* ── traffic zones ───────────────────────────────────── */
    const addTrafficZone = useCallback((lat: number, lng: number) => {
        const tz: TrafficZone = { id: uid('tz'), lat, lng, radius: 1500, multiplier: 2.5 };
        setTrafficZones((prev) => [...prev, tz]);
    }, []);

    const moveTrafficZone = useCallback((id: string, lat: number, lng: number) => {
        setTrafficZones((prev) =>
            prev.map((tz) => (tz.id === id ? { ...tz, lat, lng } : tz))
        );
    }, []);

    const updateTrafficZone = useCallback(
        (id: string, patch: Partial<Pick<TrafficZone, 'radius' | 'multiplier'>>) => {
            setTrafficZones((prev) =>
                prev.map((tz) => (tz.id === id ? { ...tz, ...patch } : tz))
            );
        },
        []
    );

    const removeTrafficZone = useCallback((id: string) => {
        setTrafficZones((prev) => prev.filter((tz) => tz.id !== id));
    }, []);

    const clearAll = useCallback(() => {
        setRoadBlocks([]);
        setTrafficZones([]);
        setActiveTool(null);
    }, []);

    return {
        roadBlocks,
        trafficZones,
        activeTool,
        setActiveTool,
        addRoadBlock,
        moveRoadBlock,
        removeRoadBlock,
        addTrafficZone,
        moveTrafficZone,
        updateTrafficZone,
        removeTrafficZone,
        clearAll,
    };
}
