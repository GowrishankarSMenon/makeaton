'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useLocations } from '@/hooks/useLocations';
import { useParams } from '@/hooks/useParams';
import { useSolver } from '@/hooks/useSolver';
import { useRestrictions } from '@/hooks/useRestrictions';
import { useToast, ToastContainer } from '@/components/Toast';
import Sidebar from '@/components/Sidebar';
import QuantumOverlay from '@/components/QuantumOverlay';
import AlgorithmPicker from '@/components/AlgorithmPicker';

// Dynamic import to avoid SSR for Leaflet
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
    const { locations, addLocation, removeLocation, updatePriority, updatePosition, clearAll } = useLocations();
    const { params, priorityEnabled, updateParam, togglePriority, resetParams, getParamsForSolve } =
        useParams();
    const { isLoading, result, solve, clearResult } = useSolver();
    const { toasts, showToast } = useToast();
    const {
        roadBlocks,
        congestionZones,
        addBlock,
        removeBlock,
        addCongestion,
        removeCongestion,
        updateCongestion,
        updateBlockPosition,
        updateCongestionPosition,
        clearRestrictions,
    } = useRestrictions();

    const [algorithm, setAlgorithm] = useState('held-karp');
    const [solverEngine, setSolverEngine] = useState<'ts' | 'cpp'>('ts');

    // Algorithm picker modal
    const [algoPickerOpen, setAlgoPickerOpen] = useState(false);

    // Hydration-safe flag — AlgorithmPicker rendered only after mount
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Sidebar collapse state
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), []);

    // Quantum overlay state
    const [overlayVisible, setOverlayVisible] = useState(false);
    const [overlayStatus, setOverlayStatus] = useState('');

    // Route display state — road is default, polygon is fallback
    const [showPolygonBtn, setShowPolygonBtn] = useState(false);
    const [showRoad, setShowRoad] = useState(false);
    const [showPolygon, setShowPolygon] = useState(false);
    const [roadRouteLoading, setRoadRouteLoading] = useState(false);

    // Restriction placement modes
    const [blockModeActive, setBlockModeActive] = useState(false);
    const [congestionModeActive, setCongestionModeActive] = useState(false);

    const handleToggleBlockMode = useCallback((active: boolean) => {
        setBlockModeActive(active);
        if (active) setCongestionModeActive(false);
    }, []);

    const handleToggleCongestionMode = useCallback((active: boolean) => {
        setCongestionModeActive(active);
        if (active) setBlockModeActive(false);
    }, []);

    const updateLocationPosition = useCallback(
        (index: number, lat: number, lng: number) => {
            updatePosition(index, lat, lng);
        },
        [updatePosition]
    );

    const handleMapClick = useCallback(
        (lat: number, lng: number) => {
            if (blockModeActive) {
                addBlock(lat, lng);
                showToast('Road block placed', 'info');
            } else if (congestionModeActive) {
                addCongestion(lat, lng);
                showToast('Congestion zone placed', 'info');
            } else {
                addLocation(lat, lng);
            }
        },
        [blockModeActive, congestionModeActive, addBlock, addCongestion, addLocation, showToast]
    );

    const handleSolve = useCallback(async () => {
        if (locations.length < 2) {
            showToast('Add at least 2 locations to the map', 'warning');
            return;
        }

        if (algorithm === 'held-karp' && solverEngine !== 'cpp' && locations.length > 18) {
            showToast('Held-Karp supports max 18 locations. Switch to Nearest Neighbor or Compare.', 'warning');
            return;
        }

        // Show quantum overlay
        setOverlayVisible(true);
        setOverlayStatus('Preprocessing road network with Dijkstra...');

        // Reset route display state
        setShowPolygonBtn(false);
        setShowRoad(false);
        setShowPolygon(false);

        try {
            await delay(400);
            setOverlayStatus('Building distance matrix via OSRM...');
            await delay(300);

            if (roadBlocks.length > 0 || congestionZones.length > 0) {
                setOverlayStatus('Applying logistical restrictions...');
                await delay(300);
            }

            setOverlayStatus('Encoding binary variables into qubit states...');
            await delay(300);

            const statusMsg =
                algorithm === 'held-karp'
                    ? `Exploring 2^${locations.length} state space with Held-Karp DP...`
                    : algorithm === 'nearest-neighbor'
                        ? 'Applying greedy nearest-neighbor heuristic...'
                        : algorithm === 'qaoa'
                            ? 'Executing QAOA quantum circuit on simulator...'
                            : algorithm === 'hybrid-qhk'
                                ? 'Phase 1: Quantum exploration via QAOA → Phase 2: Held-Karp refinement...'
                                : algorithm === 'prewarm-hk'
                                    ? 'Phase 0: Held-Karp exact pre-warm → QAOA quantum warm-start...'
                                    : 'Running dual solver comparison...';
            setOverlayStatus(statusMsg);

            const solveParams = getParamsForSolve(locations.map((l) => l.priority));
            // Attach restrictions to params
            const paramsWithRestrictions = {
                ...solveParams,
                roadBlocks: roadBlocks.length > 0 ? roadBlocks : undefined,
                congestionZones: congestionZones.length > 0 ? congestionZones : undefined,
            };
            const data = await solve(locations, algorithm, paramsWithRestrictions, solverEngine);
            setOverlayStatus('Collapsing quantum state to optimal route...');
            await delay(400);
            setOverlayVisible(false);

            const distKm =
                data.algorithm === 'compare'
                    ? (data.nearestNeighbor.distance / 1000).toFixed(2)
                    : (data.solution.distance / 1000).toFixed(2);
            showToast(`Route optimized: ${distKm} km (${data.metadata.totalTimeMs} ms)`, 'success');

            // Auto-trigger road route fetch AFTER success confirmed
            setRoadRouteLoading(true);
            setShowRoad(true);
        } catch (err: unknown) {
            setOverlayVisible(false);
            const message = err instanceof Error ? err.message : 'Unknown error';
            showToast(message, 'error');
        }
    }, [locations, algorithm, getParamsForSolve, solve, showToast, solverEngine, roadBlocks, congestionZones]);

    const handleShowPolygon = useCallback(() => {
        setShowPolygon(true);
        setShowRoad(false);
    }, []);

    const handleRoadRouteDrawn = useCallback(() => {
        setRoadRouteLoading(false);
        setShowPolygonBtn(true);
    }, []);

    const handleRoadRouteError = useCallback(
        (error: string) => {
            setRoadRouteLoading(false);
            // Auto-fallback to polygon on road fetch failure
            setShowPolygon(true);
            setShowRoad(false);
            setShowPolygonBtn(false);
            showToast('Road route failed, showing straight lines: ' + error, 'warning');
        },
        [showToast]
    );

    const handleClearAll = useCallback(() => {
        clearAll();
        clearResult();
        clearRestrictions();
        setShowPolygonBtn(false);
        setShowRoad(false);
        setShowPolygon(false);
        setBlockModeActive(false);
        setCongestionModeActive(false);
        showToast('All locations and restrictions cleared', 'info');
    }, [clearAll, clearResult, clearRestrictions, showToast]);

    // Mobile sidebar toggle
    const toggleMobileSidebar = useCallback(() => {
        setSidebarCollapsed((v) => !v);
    }, []);

    return (
        <>
            <QuantumOverlay isVisible={overlayVisible} statusText={overlayStatus} />
            <ToastContainer toasts={toasts} />

            {mounted && (
                <AlgorithmPicker
                    isOpen={algoPickerOpen}
                    onClose={() => setAlgoPickerOpen(false)}
                    algorithm={algorithm}
                    onAlgorithmChange={setAlgorithm}
                    solverEngine={solverEngine}
                    onSolverEngineChange={setSolverEngine}
                />
            )}

            <div className="app-layout">
                <Sidebar
                    locations={locations}
                    algorithm={algorithm}
                    onOpenAlgorithmPicker={() => setAlgoPickerOpen(true)}
                    params={params}
                    onParamChange={updateParam}
                    onResetParams={resetParams}
                    onRemoveLocation={removeLocation}
                    onClearAll={handleClearAll}
                    onSolve={handleSolve}
                    solveResult={result}
                    isLoading={isLoading}
                    showPolygonBtn={showPolygonBtn}
                    polygonShown={showPolygon}
                    roadRouteLoading={roadRouteLoading}
                    onShowPolygon={handleShowPolygon}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={toggleSidebar}
                    // Restrictions
                    roadBlocks={roadBlocks}
                    congestionZones={congestionZones}
                    blockModeActive={blockModeActive}
                    congestionModeActive={congestionModeActive}
                    onToggleBlockMode={handleToggleBlockMode}
                    onToggleCongestionMode={handleToggleCongestionMode}
                    onRemoveBlock={removeBlock}
                    onRemoveCongestion={removeCongestion}
                    onUpdateCongestion={updateCongestion}
                    onClearRestrictions={clearRestrictions}
                />

                {/* Expand sidebar button — visible when collapsed */}
                {sidebarCollapsed && (
                    <button className="sidebar-expand-btn" onClick={toggleSidebar} title="Expand sidebar">
                        <i className="fas fa-chevron-right"></i>
                    </button>
                )}

                <button id="mobile-sidebar-toggle" className="mobile-sidebar-toggle" onClick={toggleMobileSidebar}>
                    <i className="fas fa-bars"></i>
                </button>

                <MapView
                    locations={locations}
                    solveResult={result}
                    showRoad={showRoad}
                    showPolygon={showPolygon}
                    onLocationAdd={handleMapClick}
                    onLocationRemove={removeLocation}
                    onLocationUpdate={updateLocationPosition}
                    onRoadRouteDrawn={handleRoadRouteDrawn}
                    onRoadRouteError={handleRoadRouteError}
                    // Restrictions
                    roadBlocks={roadBlocks}
                    congestionZones={congestionZones}
                    blockModeActive={blockModeActive}
                    congestionModeActive={congestionModeActive}
                    onRemoveBlock={removeBlock}
                    onRemoveCongestion={removeCongestion}
                    onUpdateBlockPosition={updateBlockPosition}
                    onUpdateCongestionPosition={updateCongestionPosition}
                />
            </div>
        </>
    );
}
