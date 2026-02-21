'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useLocations } from '@/hooks/useLocations';
import { useParams } from '@/hooks/useParams';
import { useSolver } from '@/hooks/useSolver';
import { useRestrictions } from '@/hooks/useRestrictions';
import { useToast, ToastContainer } from '@/components/Toast';
import Sidebar from '@/components/Sidebar';
import QuantumOverlay from '@/components/QuantumOverlay';

// Dynamic import to avoid SSR for Leaflet
const MapView = dynamic(() => import('@/components/MapView'), { ssr: false });

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Home() {
    const { locations, addLocation, removeLocation, updatePriority, clearAll } = useLocations();
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

    // Quantum overlay state
    const [overlayVisible, setOverlayVisible] = useState(false);
    const [overlayStatus, setOverlayStatus] = useState('');

    // Road route state
    const [showRoadRouteBtn, setShowRoadRouteBtn] = useState(false);
    const [showRoad, setShowRoad] = useState(false);
    const [roadRouteShown, setRoadRouteShown] = useState(false);
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

        // Reset road route state
        setShowRoadRouteBtn(false);
        setShowRoad(false);
        setRoadRouteShown(false);

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

            setShowRoadRouteBtn(true);

            const distKm =
                data.algorithm === 'compare'
                    ? (data.nearestNeighbor.distance / 1000).toFixed(2)
                    : (data.solution.distance / 1000).toFixed(2);
            showToast(`Route optimized: ${distKm} km (${data.metadata.totalTimeMs} ms)`, 'success');
        } catch (err: unknown) {
            setOverlayVisible(false);
            const message = err instanceof Error ? err.message : 'Unknown error';
            showToast(message, 'error');
        }
    }, [locations, algorithm, getParamsForSolve, solve, showToast, solverEngine, roadBlocks, congestionZones]);

    const handleShowRoadRoute = useCallback(() => {
        setRoadRouteLoading(true);
        setOverlayVisible(true);
        setOverlayStatus('Fetching road geometry from OSRM...');
        setShowRoad(true);
    }, []);

    const handleRoadRouteDrawn = useCallback(() => {
        setOverlayVisible(false);
        setRoadRouteLoading(false);
        setRoadRouteShown(true);
        showToast('Road route rendered successfully', 'success');
    }, [showToast]);

    const handleRoadRouteError = useCallback(
        (error: string) => {
            setOverlayVisible(false);
            setRoadRouteLoading(false);
            showToast('Failed to fetch road route: ' + error, 'error');
        },
        [showToast]
    );

    const handleClearAll = useCallback(() => {
        clearAll();
        clearResult();
        clearRestrictions();
        setShowRoadRouteBtn(false);
        setShowRoad(false);
        setRoadRouteShown(false);
        setBlockModeActive(false);
        setCongestionModeActive(false);
        showToast('All locations and restrictions cleared', 'info');
    }, [clearAll, clearResult, clearRestrictions, showToast]);

    // Mobile sidebar toggle
    const toggleMobileSidebar = () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('collapsed');
    };

    return (
        <>
            <QuantumOverlay isVisible={overlayVisible} statusText={overlayStatus} />
            <ToastContainer toasts={toasts} />

            <div className="app-layout">
                <Sidebar
                    solverEngine={solverEngine}
                    onSolverEngineChange={setSolverEngine}
                    locations={locations}
                    algorithm={algorithm}
                    onAlgorithmChange={setAlgorithm}
                    params={params}
                    priorityEnabled={priorityEnabled}
                    onParamChange={updateParam}
                    onPriorityToggle={togglePriority}
                    onResetParams={resetParams}
                    onRemoveLocation={removeLocation}
                    onUpdatePriority={updatePriority}
                    onClearAll={handleClearAll}
                    onSolve={handleSolve}
                    solveResult={result}
                    isLoading={isLoading}
                    showRoadRouteBtn={showRoadRouteBtn}
                    roadRouteShown={roadRouteShown}
                    roadRouteLoading={roadRouteLoading}
                    onShowRoadRoute={handleShowRoadRoute}
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

                <button id="mobile-sidebar-toggle" className="mobile-sidebar-toggle" onClick={toggleMobileSidebar}>
                    <i className="fas fa-bars"></i>
                </button>

                <MapView
                    locations={locations}
                    solveResult={result}
                    showRoad={showRoad}
                    onLocationAdd={handleMapClick}
                    onLocationRemove={removeLocation}
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
