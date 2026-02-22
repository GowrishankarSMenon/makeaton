'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapLocation } from '@/hooks/useLocations';
import { SolveResult } from '@/hooks/useSolver';
import { RoadBlock, CongestionZone } from '@/hooks/useRestrictions';
import { getRoadRoute, RoadBlockForRoute } from '@/lib/visualization';

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
    showPolygon: boolean;
    onLocationAdd: (lat: number, lng: number) => void;
    onLocationRemove: (index: number) => void;
    onRoadRouteDrawn: () => void;
    onRoadRouteError: (error: string) => void;
    // Restrictions
    roadBlocks: RoadBlock[];
    congestionZones: CongestionZone[];
    blockModeActive: boolean;
    congestionModeActive: boolean;
    onRemoveBlock: (id: string) => void;
    onRemoveCongestion: (id: string) => void;
    onUpdateBlockPosition: (id: string, lat: number, lng: number) => void;
    onUpdateCongestionPosition: (id: string, lat: number, lng: number) => void;
}

export default function MapView({
    locations,
    solveResult,
    showRoad,
    showPolygon,
    onLocationAdd,
    onLocationRemove,
    onRoadRouteDrawn,
    onRoadRouteError,
    // Restrictions
    roadBlocks,
    congestionZones,
    blockModeActive,
    congestionModeActive,
    onRemoveBlock,
    onRemoveCongestion,
    onUpdateBlockPosition,
    onUpdateCongestionPosition,
}: MapViewProps) {
    const mapRef = useRef<L.Map | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const markersRef = useRef<L.Marker[]>([]);
    const routeLayersRef = useRef<L.Layer[]>([]);
    const blockMarkersRef = useRef<L.Marker[]>([]);
    const blockCirclesRef = useRef<L.Circle[]>([]);
    const congestionLayersRef = useRef<L.Circle[]>([]);
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

    // Render road block markers with radius circles
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Clear old block markers and circles
        blockMarkersRef.current.forEach((m) => map.removeLayer(m));
        blockMarkersRef.current = [];
        blockCirclesRef.current.forEach((c) => map.removeLayer(c));
        blockCirclesRef.current = [];

        roadBlocks.forEach((block) => {
            // Draw the block radius circle
            const radiusCircle = L.circle([block.lat, block.lng], {
                radius: (block.radiusKm ?? 1.0) * 1000, // km to meters
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.08,
                weight: 2,
                dashArray: '8 4',
                className: 'block-radius-circle',
            }).addTo(map);
            blockCirclesRef.current.push(radiusCircle);

            const blockHtml = `
                <div class="block-marker">
                    <div class="block-marker-inner">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="8" width="18" height="8" rx="2" fill="#ef4444" stroke="#fff"/>
                            <line x1="3" y1="12" x2="21" y2="12" stroke="#fff" stroke-width="1.5"/>
                            <line x1="7" y1="16" x2="7" y2="20" stroke="#fff"/>
                            <line x1="17" y1="16" x2="17" y2="20" stroke="#fff"/>
                        </svg>
                    </div>
                    <div class="block-marker-pulse"></div>
                </div>
            `;

            const icon = L.divIcon({
                html: blockHtml,
                className: '',
                iconSize: [36, 36],
                iconAnchor: [18, 18],
            });

            const marker = L.marker([block.lat, block.lng], {
                icon,
                draggable: true,
                title: `Road Block (${(block.radiusKm ?? 1.0).toFixed(1)} km radius)`,
                zIndexOffset: 500,
            }).addTo(map);

            marker.on('dragend', () => {
                const pos = marker.getLatLng();
                onUpdateBlockPosition(block.id, pos.lat, pos.lng);
            });

            marker.bindPopup(`
                <div style="text-align:center">
                    <strong style="color:#ef4444">🚧 Road Block</strong><br>
                    <span style="font-size:11px;color:#94a3b8">
                        ${block.lat.toFixed(5)}, ${block.lng.toFixed(5)}
                    </span><br>
                    <span style="font-size:10px;color:#f87171">
                        Radius: ${(block.radiusKm ?? 1.0).toFixed(1)} km
                    </span><br>
                    <button onclick="window.__removeBlock('${block.id}')" 
                        style="margin-top:6px;padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">
                        Remove
                    </button>
                </div>
            `);

            blockMarkersRef.current.push(marker);
        });

        // Expose remove function globally for popup buttons
        (window as any).__removeBlock = (id: string) => {
            onRemoveBlock(id);
        };
    }, [roadBlocks, onRemoveBlock, onUpdateBlockPosition]);

    // Render congestion zone circles
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Clear old circles
        congestionLayersRef.current.forEach((c) => map.removeLayer(c));
        congestionLayersRef.current = [];

        congestionZones.forEach((zone) => {
            const color = getIntensityColor(zone.intensity);

            const circle = L.circle([zone.lat, zone.lng], {
                radius: zone.radiusKm * 1000,
                color: color,
                fillColor: color,
                fillOpacity: 0.15 + (zone.intensity - 1.5) * 0.04,
                weight: 2,
                dashArray: '6 4',
                className: 'congestion-zone-circle',
            }).addTo(map);

            circle.bindPopup(`
                <div style="text-align:center">
                    <strong style="color:${color}">🔴 Congestion Zone</strong><br>
                    <span style="font-size:11px;color:#94a3b8">
                        Radius: ${zone.radiusKm} km · Intensity: ${zone.intensity.toFixed(1)}×
                    </span><br>
                    <button onclick="window.__removeCongestion('${zone.id}')" 
                        style="margin-top:6px;padding:4px 10px;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">
                        Remove
                    </button>
                </div>
            `);

            // Enable dragging via a center marker
            const centerHtml = `
                <div class="congestion-center-marker">
                    <div class="congestion-center-dot" style="background:${color}"></div>
                </div>
            `;

            const centerIcon = L.divIcon({
                html: centerHtml,
                className: '',
                iconSize: [20, 20],
                iconAnchor: [10, 10],
            });

            const centerMarker = L.marker([zone.lat, zone.lng], {
                icon: centerIcon,
                draggable: true,
                title: `Congestion Zone (${zone.intensity.toFixed(1)}×)`,
                zIndexOffset: 400,
            }).addTo(map);

            centerMarker.on('dragend', () => {
                const pos = centerMarker.getLatLng();
                onUpdateCongestionPosition(zone.id, pos.lat, pos.lng);
            });

            congestionLayersRef.current.push(circle);
            // Also track center markers for cleanup — store on the circle
            (circle as any)._centerMarker = centerMarker;
        });

        // Expose remove function globally for popup buttons
        (window as any).__removeCongestion = (id: string) => {
            onRemoveCongestion(id);
        };

        return () => {
            // Cleanup center markers
            congestionLayersRef.current.forEach((c) => {
                const cm = (c as any)._centerMarker;
                if (cm && map) map.removeLayer(cm);
            });
        };
    }, [congestionZones, onRemoveCongestion, onUpdateCongestionPosition]);

    // Clear routes when solveResult changes (new solve started)
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        routeLayersRef.current.forEach((l) => map.removeLayer(l));
        routeLayersRef.current = [];
        roadDrawnForResultRef.current = null;
    }, [solveResult]);

    // Draw polygon (straight-line) fallback when showPolygon is set
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !solveResult || !showPolygon) return;

        // Clear old routes (road or previous)
        routeLayersRef.current.forEach((l) => map.removeLayer(l));
        routeLayersRef.current = [];
        roadDrawnForResultRef.current = null;

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
    }, [solveResult, showPolygon]);

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

                // Convert roadBlocks so the visualization can reroute displayed
                // road geometry around blocks (the solver already avoided blocked
                // edges, but OSRM road geometry between chosen stops might still
                // visually curve through the block area).
                const blocks: RoadBlockForRoute[] = roadBlocks.map(b => ({
                    lat: b.lat,
                    lng: b.lng,
                    radiusKm: b.radiusKm ?? 1.0,
                    id: b.id,
                }));

                if (solveResult.algorithm === 'compare') {
                    const promises: Promise<void>[] = [];

                    if (solveResult.heldKarpRouteCoords && solveResult.heldKarpRouteCoords.length > 0) {
                        promises.push(
                            getRoadRoute(solveResult.heldKarpRouteCoords, blocks).then((latlngs) => {
                                drawPolylineGroup(map, latlngs, ROUTE_COLORS.heldKarp, 5);
                            })
                        );
                    }
                    if (solveResult.nnRouteCoords && solveResult.nnRouteCoords.length > 0) {
                        promises.push(
                            getRoadRoute(solveResult.nnRouteCoords, blocks).then((latlngs) => {
                                drawPolylineGroup(map, latlngs, ROUTE_COLORS.nearestNeighbor, 3, '10 8');
                            })
                        );
                    }
                    await Promise.all(promises);
                } else if (solveResult.routeCoords && solveResult.routeCoords.length >= 2) {
                    const roadLatlngs = await getRoadRoute(solveResult.routeCoords, blocks);
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
    }, [showRoad, solveResult, roadBlocks, onRoadRouteDrawn, onRoadRouteError]);

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

    // Cursor change based on active mode
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const container = map.getContainer();
        if (blockModeActive) {
            container.style.cursor = 'crosshair';
        } else if (congestionModeActive) {
            container.style.cursor = 'crosshair';
        } else {
            container.style.cursor = '';
        }
    }, [blockModeActive, congestionModeActive]);

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

            {/* Active mode indicator on map */}
            {(blockModeActive || congestionModeActive) && (
                <div className="map-mode-indicator">
                    <div className={`mode-indicator-badge ${blockModeActive ? 'block-mode' : 'congestion-mode'}`}>
                        <span className="mode-indicator-icon">
                            {blockModeActive ? '🚧' : '🔴'}
                        </span>
                        <span className="mode-indicator-text">
                            {blockModeActive ? 'Placing Road Blocks' : 'Placing Congestion Zones'}
                        </span>
                    </div>
                </div>
            )}
        </>
    );
}

function getIntensityColor(intensity: number): string {
    // Gradient from orange to deep red based on intensity
    if (intensity <= 2.0) return '#f59e0b';
    if (intensity <= 3.0) return '#ef4444';
    if (intensity <= 4.0) return '#dc2626';
    return '#991b1b';
}
