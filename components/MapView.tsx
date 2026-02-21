'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapLocation } from '@/hooks/useLocations';
import { SolveResult } from '@/hooks/useSolver';
import { getRoadRoute } from '@/lib/visualization';

const TILE_LAYERS = {
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
    light: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
};

const ROUTE_COLORS = {
    heldKarp: '#8b5cf6',
    nearestNeighbor: '#f59e0b',
    primary: '#6366f1',
};

interface MapViewProps {
    locations: MapLocation[];
    solveResult: SolveResult | null;
    showRoad: boolean;
    onLocationAdd: (lat: number, lng: number) => void;
    onLocationRemove: (index: number) => void;
    onRoadRouteDrawn: () => void;
    onRoadRouteError: (error: string) => void;
}

export default function MapView({
    locations,
    solveResult,
    showRoad,
    onLocationAdd,
    onLocationRemove,
    onRoadRouteDrawn,
    onRoadRouteError,
}: MapViewProps) {
    const mapRef = useRef<L.Map | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const markersRef = useRef<L.Marker[]>([]);
    const routeLayersRef = useRef<L.Layer[]>([]);
    const [isDark, setIsDark] = useState(false);
    const tileLayerRef = useRef<L.TileLayer | null>(null);
    const onLocationAddRef = useRef(onLocationAdd);
    const onLocationRemoveRef = useRef(onLocationRemove);
    const roadDrawnForResultRef = useRef<string | null>(null);

    // Keep refs updated
    onLocationAddRef.current = onLocationAdd;
    onLocationRemoveRef.current = onLocationRemove;

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: [10.8505, 76.2711],
            zoom: 8,
            zoomControl: true,
            attributionControl: true,
        });

        tileLayerRef.current = L.tileLayer(TILE_LAYERS.light.url, {
            attribution: TILE_LAYERS.light.attribution,
            subdomains: 'abc',
            maxZoom: 19,
        }).addTo(map);

        map.on('click', (e: L.LeafletMouseEvent) => {
            onLocationAddRef.current(e.latlng.lat, e.latlng.lng);
        });

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Update markers when locations change
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Remove old markers
        markersRef.current.forEach((m) => map.removeLayer(m));
        markersRef.current = [];

        // Add new markers
        locations.forEach((loc, i) => {
            const isDepot = i === 0;

            const markerHtml = `
        <div class="custom-marker ${isDepot ? 'depot' : 'stop'}">
          ${isDepot ? '<i class="fas fa-warehouse" style="font-size:14px"></i>' : i}
          <div class="marker-pulse"></div>
        </div>
      `;

            const icon = L.divIcon({
                html: markerHtml,
                className: '',
                iconSize: [isDepot ? 38 : 32, isDepot ? 38 : 32],
                iconAnchor: [isDepot ? 19 : 16, isDepot ? 19 : 16],
            });

            const marker = L.marker([loc.lat, loc.lng], {
                icon,
                draggable: true,
                title: loc.label,
            }).addTo(map);

            marker.bindPopup(`
        <div style="text-align:center">
          <strong>${loc.label}</strong><br>
          <span style="font-family:var(--font-mono);font-size:11px;color:#94a3b8">
            ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}
          </span>
        </div>
      `);

            markersRef.current.push(marker);
        });
    }, [locations]);

    // Draw route visualization
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Clear old routes
        routeLayersRef.current.forEach((l) => map.removeLayer(l));
        routeLayersRef.current = [];
        roadDrawnForResultRef.current = null;

        if (!solveResult) return;

        // Draw polygon (straight-line) route
        if (solveResult.algorithm === 'compare') {
            if (solveResult.heldKarpRouteCoords && solveResult.heldKarpRouteCoords.length > 0) {
                const latlngs = solveResult.heldKarpRouteCoords.map(
                    (c) => [c.lat, c.lng] as [number, number]
                );
                drawPolylineGroup(map, latlngs, ROUTE_COLORS.heldKarp, 5, '12 8');
            }
            if (solveResult.nnRouteCoords && solveResult.nnRouteCoords.length > 0) {
                const latlngs = solveResult.nnRouteCoords.map(
                    (c) => [c.lat, c.lng] as [number, number]
                );
                drawPolylineGroup(map, latlngs, ROUTE_COLORS.nearestNeighbor, 3, '10 8');
            }
            const allCoords = [
                ...(solveResult.heldKarpRouteCoords || []),
                ...(solveResult.nnRouteCoords || []),
            ].map((c) => [c.lat, c.lng] as [number, number]);
            if (allCoords.length > 0) fitToRoute(map, allCoords);
        } else if (solveResult.routeCoords && solveResult.routeCoords.length >= 2) {
            const latlngs = solveResult.routeCoords.map(
                (c) => [c.lat, c.lng] as [number, number]
            );
            drawPolylineGroup(map, latlngs, ROUTE_COLORS.primary, 4, '12 8');
            fitToRoute(map, latlngs);
        }
    }, [solveResult]);

    // Draw road route when showRoad toggles
    useEffect(() => {
        if (!showRoad || !solveResult || !mapRef.current) return;

        const resultId = JSON.stringify(solveResult.metadata);
        if (roadDrawnForResultRef.current === resultId) return;

        const map = mapRef.current;

        const drawRoad = async () => {
            try {
                // Clear polygon routes
                routeLayersRef.current.forEach((l) => map.removeLayer(l));
                routeLayersRef.current = [];

                if (solveResult.algorithm === 'compare') {
                    const promises: Promise<void>[] = [];

                    if (solveResult.heldKarpRouteCoords && solveResult.heldKarpRouteCoords.length > 0) {
                        promises.push(
                            getRoadRoute(solveResult.heldKarpRouteCoords).then((latlngs) => {
                                drawPolylineGroup(map, latlngs, ROUTE_COLORS.heldKarp, 5);
                            })
                        );
                    }
                    if (solveResult.nnRouteCoords && solveResult.nnRouteCoords.length > 0) {
                        promises.push(
                            getRoadRoute(solveResult.nnRouteCoords).then((latlngs) => {
                                drawPolylineGroup(map, latlngs, ROUTE_COLORS.nearestNeighbor, 3, '10 8');
                            })
                        );
                    }
                    await Promise.all(promises);
                } else if (solveResult.routeCoords && solveResult.routeCoords.length >= 2) {
                    const roadLatlngs = await getRoadRoute(solveResult.routeCoords);
                    drawPolylineGroup(map, roadLatlngs, ROUTE_COLORS.primary, 4);
                    fitToRoute(map, roadLatlngs);
                }

                roadDrawnForResultRef.current = resultId;
                onRoadRouteDrawn();
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to fetch road route';
                onRoadRouteError(message);
            }
        };

        drawRoad();
    }, [showRoad, solveResult, onRoadRouteDrawn, onRoadRouteError]);

    const drawPolylineGroup = useCallback(
        (
            map: L.Map,
            latlngs: [number, number][],
            color: string,
            weight: number,
            dashArray?: string
        ) => {
            if (!latlngs || latlngs.length < 2) return;

            const line = L.polyline(latlngs, {
                color,
                weight,
                opacity: 0.85,
                dashArray: dashArray || undefined,
                lineCap: 'round',
                lineJoin: 'round',
            }).addTo(map);
            routeLayersRef.current.push(line);

            // Glow effect
            const glow = L.polyline(latlngs, {
                color,
                weight: weight + 6,
                opacity: 0.15,
                lineCap: 'round',
                lineJoin: 'round',
            }).addTo(map);
            routeLayersRef.current.push(glow);

            // Animated dash overlay
            const animated = L.polyline(latlngs, {
                color: '#ffffff',
                weight: 2,
                opacity: 0.4,
                dashArray: '8 12',
                lineCap: 'round',
                className: 'route-line-animated',
            }).addTo(map);
            routeLayersRef.current.push(animated);
        },
        []
    );

    const fitToRoute = useCallback((map: L.Map, latlngs: [number, number][]) => {
        if (!latlngs || latlngs.length === 0) return;
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 14 });
    }, []);

    const toggleTheme = useCallback(() => {
        const map = mapRef.current;
        if (!map) return;

        const newDark = !isDark;
        setIsDark(newDark);
        const theme = newDark ? TILE_LAYERS.dark : TILE_LAYERS.light;

        if (tileLayerRef.current) {
            map.removeLayer(tileLayerRef.current);
        }

        tileLayerRef.current = L.tileLayer(theme.url, {
            attribution: theme.attribution,
            subdomains: newDark ? 'abcd' : 'abc',
            maxZoom: 19,
        }).addTo(map);

        map.getContainer().style.background = newDark ? '#0a0e1a' : '#f2efe9';
    }, [isDark]);

    return (
        <>
            <div id="map" className="map-container" ref={containerRef}></div>
            <button
                id="map-theme-toggle"
                className={`map-theme-toggle${!isDark ? ' light-active' : ''}`}
                title="Toggle light/dark map"
                onClick={toggleTheme}
            >
                <i className={`fas fa-${isDark ? 'sun' : 'moon'}`}></i>
            </button>
        </>
    );
}
