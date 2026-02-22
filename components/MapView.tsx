'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapLocation } from '@/hooks/useLocations';
import { SolveResult } from '@/hooks/useSolver';
import { RoadBlock, WeatherZone } from '@/hooks/useRestrictions';
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
    heldKarp: '#e8733a',
    nearestNeighbor: '#00b0ff',
    primary: '#e8733a',
};

/* ── Delivery Driver Animation Helpers ─────────────────── */

/** Compute cumulative distances along a polyline */
function computeCumulativeDistances(latlngs: L.LatLng[]): number[] {
    const distances: number[] = [0];
    for (let i = 1; i < latlngs.length; i++) {
        distances.push(distances[i - 1] + latlngs[i - 1].distanceTo(latlngs[i]));
    }
    return distances;
}

/** Interpolate a position along a polyline at a given fraction (0–1) */
function interpolateAlongRoute(
    latlngs: L.LatLng[],
    cumDist: number[],
    fraction: number
): { latlng: L.LatLng; bearing: number } {
    const totalDist = cumDist[cumDist.length - 1];
    const targetDist = fraction * totalDist;

    // Find the segment
    let segIdx = 0;
    for (let i = 1; i < cumDist.length; i++) {
        if (cumDist[i] >= targetDist) {
            segIdx = i - 1;
            break;
        }
    }

    const segStart = cumDist[segIdx];
    const segEnd = cumDist[segIdx + 1] || segStart;
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (targetDist - segStart) / segLen : 0;

    const lat = latlngs[segIdx].lat + t * (latlngs[segIdx + 1].lat - latlngs[segIdx].lat);
    const lng = latlngs[segIdx].lng + t * (latlngs[segIdx + 1].lng - latlngs[segIdx].lng);

    // Compute bearing for rotation
    const dLat = latlngs[segIdx + 1].lat - latlngs[segIdx].lat;
    const dLng = latlngs[segIdx + 1].lng - latlngs[segIdx].lng;
    const bearing = (Math.atan2(dLng, dLat) * 180) / Math.PI;

    return { latlng: L.latLng(lat, lng), bearing };
}

interface MapViewProps {
    locations: MapLocation[];
    solveResult: SolveResult | null;
    showRoad: boolean;
    showPolygon: boolean;
    onLocationAdd: (lat: number, lng: number) => void;
    onLocationRemove: (index: number) => void;
    onLocationUpdate: (index: number, lat: number, lng: number) => void;
    onRoadRouteDrawn: () => void;
    onRoadRouteError: (error: string) => void;
    // Restrictions
    roadBlocks: RoadBlock[];
    weatherZones: WeatherZone[];
    blockModeActive: boolean;
    weatherModeActive: boolean;
    onRemoveBlock: (id: string) => void;
    onRemoveWeather: (id: string) => void;
    onUpdateBlockPosition: (id: string, lat: number, lng: number) => void;
    onUpdateWeatherPosition: (id: string, lat: number, lng: number) => void;
}

export default function MapView({
    locations,
    solveResult,
    showRoad,
    showPolygon,
    onLocationAdd,
    onLocationRemove,
    onLocationUpdate,
    onRoadRouteDrawn,
    onRoadRouteError,
    // Restrictions
    roadBlocks,
    weatherZones,
    blockModeActive,
    weatherModeActive,
    onRemoveBlock,
    onRemoveWeather,
    onUpdateBlockPosition,
    onUpdateWeatherPosition,
}: MapViewProps) {
    const mapRef = useRef<L.Map | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const markersRef = useRef<L.Marker[]>([]);
    const routeLayersRef = useRef<L.Layer[]>([]);
    const blockMarkersRef = useRef<L.Marker[]>([]);
    const weatherLayersRef = useRef<L.Circle[]>([]);
    const [isDark, setIsDark] = useState(false);
    const tileLayerRef = useRef<L.TileLayer | null>(null);
    const onLocationAddRef = useRef(onLocationAdd);
    const onLocationRemoveRef = useRef(onLocationRemove);
    const onLocationUpdateRef = useRef(onLocationUpdate);
    const roadDrawnForResultRef = useRef<string | null>(null);

    // Delivery driver animation state
    const driverMarkerRef = useRef<L.Marker | null>(null);
    const driverAnimFrameRef = useRef<number | null>(null);
    const routeLatLngsRef = useRef<L.LatLng[]>([]);
    const routeCumDistRef = useRef<number[]>([]);

    // Keep refs updated
    onLocationAddRef.current = onLocationAdd;
    onLocationRemoveRef.current = onLocationRemove;
    onLocationUpdateRef.current = onLocationUpdate;

    /** Stop any running delivery driver animation */
    const stopDriverAnimation = useCallback(() => {
        if (driverAnimFrameRef.current !== null) {
            cancelAnimationFrame(driverAnimFrameRef.current);
            driverAnimFrameRef.current = null;
        }
        if (driverMarkerRef.current && mapRef.current) {
            mapRef.current.removeLayer(driverMarkerRef.current);
            driverMarkerRef.current = null;
        }
        routeLatLngsRef.current = [];
        routeCumDistRef.current = [];
    }, []);

    /** Start the looping delivery driver animation along a path */
    const startDriverAnimation = useCallback(
        (latlngs: [number, number][]) => {
            stopDriverAnimation();
            const map = mapRef.current;
            if (!map || latlngs.length < 2) return;

            // Convert to L.LatLng array
            const path = latlngs.map(([lat, lng]) => L.latLng(lat, lng));
            routeLatLngsRef.current = path;
            routeCumDistRef.current = computeCumulativeDistances(path);

            // Create driver marker — top-down scooter SVG (bird's-eye view)
            const scooterSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="38" height="38">
  <!-- rear wheel -->
  <ellipse cx="32" cy="52" rx="8" ry="5" fill="#333" stroke="#555" stroke-width="1"/>
  <!-- scooter body -->
  <rect x="27" y="22" width="10" height="26" rx="5" fill="#e8733a"/>
  <!-- seat -->
  <rect x="26" y="30" width="12" height="8" rx="3" fill="#c45a28"/>
  <!-- front wheel -->
  <ellipse cx="32" cy="14" rx="7" ry="4.5" fill="#333" stroke="#555" stroke-width="1"/>
  <!-- handlebar -->
  <rect x="24" y="16" width="16" height="3" rx="1.5" fill="#555"/>
  <!-- rider helmet (top-down circle) -->
  <circle cx="32" cy="26" r="7" fill="#e8733a" stroke="#fff" stroke-width="2"/>
  <circle cx="32" cy="26" r="4" fill="#c45a28"/>
  <!-- delivery box -->
  <rect x="26" y="38" width="12" height="10" rx="2" fill="#f09a4e" stroke="#e8733a" stroke-width="1"/>
  <text x="32" y="45" text-anchor="middle" font-size="6" font-weight="bold" fill="#fff" font-family="sans-serif">⚡</text>
</svg>`;
            const driverHtml = `
                <div class="delivery-driver-marker">
                    <div class="delivery-driver-icon">
                        ${scooterSvg}
                    </div>
                </div>
            `;
            const driverIcon = L.divIcon({
                html: driverHtml,
                className: '',
                iconSize: [44, 44],
                iconAnchor: [22, 22],
            });

            const marker = L.marker(path[0], {
                icon: driverIcon,
                zIndexOffset: 2000,
                interactive: false,
            }).addTo(map);

            driverMarkerRef.current = marker;

            // Animation loop: ~60 seconds for a full circuit, looping
            const LOOP_DURATION_MS = 30000; // 30 seconds per loop
            let startTime: number | null = null;

            const animate = (timestamp: number) => {
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const fraction = (elapsed % LOOP_DURATION_MS) / LOOP_DURATION_MS;

                const { latlng, bearing } = interpolateAlongRoute(
                    routeLatLngsRef.current,
                    routeCumDistRef.current,
                    fraction
                );

                if (driverMarkerRef.current) {
                    driverMarkerRef.current.setLatLng(latlng);
                    // Rotate icon to face direction of travel
                    const el = driverMarkerRef.current.getElement();
                    if (el) {
                        el.style.transformOrigin = 'center center';
                        el.style.transform = `rotate(${bearing}deg)`;
                    }
                }

                driverAnimFrameRef.current = requestAnimationFrame(animate);
            };

            driverAnimFrameRef.current = requestAnimationFrame(animate);
        },
        [stopDriverAnimation]
    );

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

        // Invalidate map size when container resizes (e.g. sidebar collapse)
        const ro = new ResizeObserver(() => {
            map.invalidateSize({ animate: true });
        });
        if (containerRef.current) ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            // Stop delivery driver animation
            if (driverAnimFrameRef.current !== null) {
                cancelAnimationFrame(driverAnimFrameRef.current);
            }
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

            // Update React state when marker is dragged
            marker.on('dragend', () => {
                const pos = marker.getLatLng();
                onLocationUpdateRef.current(i, pos.lat, pos.lng);
            });

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

    // Render road block markers
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Clear old block markers
        blockMarkersRef.current.forEach((m) => map.removeLayer(m));
        blockMarkersRef.current = [];

        roadBlocks.forEach((block) => {
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
                title: 'Road Block',
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

    // Render weather zone circles
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        // Clear old circles
        weatherLayersRef.current.forEach((c) => map.removeLayer(c));
        weatherLayersRef.current = [];

        weatherZones.forEach((zone) => {
            const isLightning = zone.type === 'lightning';
            const color = isLightning ? '#f59e0b' : '#3b82f6';
            const fragileColor = '#ef4444';

            const circle = L.circle([zone.lat, zone.lng], {
                radius: zone.radiusKm * 1000,
                color: zone.fragile ? fragileColor : color,
                fillColor: color,
                fillOpacity: 0.08,
                weight: zone.fragile ? 3 : 2,
                dashArray: zone.fragile ? '8 4' : '6 4',
                className: 'weather-zone-circle',
            }).addTo(map);

            const typeLabel = isLightning ? '⚡ Lightning Zone' : '🌧️ Rain Zone';
            const fragileLabel = zone.fragile ? '<br><span style="color:#ef4444;font-weight:700">📦 Fragile — Route Avoided</span>' : '';

            circle.bindPopup(`
                <div style="text-align:center">
                    <strong style="color:${color}">${typeLabel}</strong>${fragileLabel}<br>
                    <span style="font-size:11px;color:#94a3b8">
                        Radius: ${zone.radiusKm} km
                    </span><br>
                    <button onclick="window.__removeWeather('${zone.id}')" 
                        style="margin-top:6px;padding:4px 10px;background:${color};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">
                        Remove
                    </button>
                </div>
            `);

            // Enable dragging via a center marker
            const centerEmoji = isLightning ? '⚡' : '🌧️';
            const centerHtml = `
                <div class="weather-center-marker">
                    <div class="weather-center-dot" style="background:${color}">${centerEmoji}</div>
                </div>
            `;

            const centerIcon = L.divIcon({
                html: centerHtml,
                className: '',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            });

            const centerMarker = L.marker([zone.lat, zone.lng], {
                icon: centerIcon,
                draggable: true,
                title: `${typeLabel}${zone.fragile ? ' (Fragile)' : ''}`,
                zIndexOffset: 400,
            }).addTo(map);

            centerMarker.on('dragend', () => {
                const pos = centerMarker.getLatLng();
                onUpdateWeatherPosition(zone.id, pos.lat, pos.lng);
            });

            weatherLayersRef.current.push(circle);
            // Also track center markers for cleanup — store on the circle
            (circle as any)._centerMarker = centerMarker;
        });

        // Expose remove function globally for popup buttons
        (window as any).__removeWeather = (id: string) => {
            onRemoveWeather(id);
        };

        return () => {
            // Cleanup center markers
            weatherLayersRef.current.forEach((c) => {
                const cm = (c as any)._centerMarker;
                if (cm && map) map.removeLayer(cm);
            });
        };
    }, [weatherZones, onRemoveWeather, onUpdateWeatherPosition]);

    // Clear routes when solveResult changes (new solve started)
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        routeLayersRef.current.forEach((l) => map.removeLayer(l));
        routeLayersRef.current = [];
        roadDrawnForResultRef.current = null;
        stopDriverAnimation();
    }, [solveResult, stopDriverAnimation]);

    // Draw polygon (straight-line) fallback when showPolygon is set
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !solveResult || !showPolygon) return;

        // Clear old routes (road or previous)
        routeLayersRef.current.forEach((l) => map.removeLayer(l));
        routeLayersRef.current = [];
        roadDrawnForResultRef.current = null;
        stopDriverAnimation();

        if (solveResult.algorithm === 'compare') {
            if (solveResult.heldKarpRouteCoords && solveResult.heldKarpRouteCoords.length > 0) {
                const latlngs = solveResult.heldKarpRouteCoords.map(
                    (c) => [c.lat, c.lng] as [number, number]
                );
                drawPolylineGroup(map, latlngs, ROUTE_COLORS.heldKarp, 5, '12 8');
                // Animate on the first (Held-Karp) route
                startDriverAnimation(latlngs);
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
            startDriverAnimation(latlngs);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [solveResult, showPolygon, stopDriverAnimation, startDriverAnimation]);

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
                stopDriverAnimation();

                // Convert roadBlocks so the visualization can reroute displayed
                // road geometry around blocks (the solver already avoided blocked
                // edges, but OSRM road geometry between chosen stops might still
                // visually curve through the block area).
                const blocks: RoadBlockForRoute[] = roadBlocks.map(b => ({
                    lat: b.lat,
                    lng: b.lng,
                    id: b.id,
                }));

                // Also treat 'fragile' weather zones as blocks so the map
                // visualization accurately draws routes around them
                weatherZones.filter(w => w.fragile).forEach(w => {
                    blocks.push({
                        lat: w.lat,
                        lng: w.lng,
                        id: w.id,
                        radiusKm: w.radiusKm
                    });
                });

                let animationPath: [number, number][] = [];

                if (solveResult.algorithm === 'compare') {
                    const promises: Promise<void>[] = [];

                    if (solveResult.heldKarpRouteCoords && solveResult.heldKarpRouteCoords.length > 0) {
                        promises.push(
                            getRoadRoute(solveResult.heldKarpRouteCoords, blocks).then((latlngs) => {
                                drawPolylineGroup(map, latlngs, ROUTE_COLORS.heldKarp, 5);
                                // Use first route (Held-Karp) for animation
                                if (animationPath.length === 0) animationPath = latlngs;
                            })
                        );
                    }
                    if (solveResult.nnRouteCoords && solveResult.nnRouteCoords.length > 0) {
                        promises.push(
                            getRoadRoute(solveResult.nnRouteCoords, blocks).then((latlngs) => {
                                drawPolylineGroup(map, latlngs, ROUTE_COLORS.nearestNeighbor, 3, '10 8');
                                if (animationPath.length === 0) animationPath = latlngs;
                            })
                        );
                    }
                    await Promise.all(promises);
                } else if (solveResult.routeCoords && solveResult.routeCoords.length >= 2) {
                    const roadLatlngs = await getRoadRoute(solveResult.routeCoords, blocks);
                    drawPolylineGroup(map, roadLatlngs, ROUTE_COLORS.primary, 4);
                    fitToRoute(map, roadLatlngs);
                    animationPath = roadLatlngs;
                }

                // Start delivery driver animation along the drawn route
                if (animationPath.length >= 2) {
                    startDriverAnimation(animationPath);
                }

                roadDrawnForResultRef.current = resultId;
                onRoadRouteDrawn();
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to fetch road route';
                onRoadRouteError(message);
            }
        };

        drawRoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showRoad, solveResult, roadBlocks, weatherZones, onRoadRouteDrawn, onRoadRouteError, stopDriverAnimation, startDriverAnimation]);

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
        } else if (weatherModeActive) {
            container.style.cursor = 'crosshair';
        } else {
            container.style.cursor = '';
        }
    }, [blockModeActive, weatherModeActive]);

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
            {(blockModeActive || weatherModeActive) && (
                <div className="map-mode-indicator">
                    <div className={`mode-indicator-badge ${blockModeActive ? 'block-mode' : 'weather-mode'}`}>
                        <span className="mode-indicator-icon">
                            {blockModeActive ? '🚧' : '🌧️'}
                        </span>
                        <span className="mode-indicator-text">
                            {blockModeActive ? 'Placing Road Blocks' : 'Placing Weather Zones'}
                        </span>
                    </div>
                </div>
            )}
        </>
    );
}
