'use client';

import { MapLocation } from '@/hooks/useLocations';
import { LogisticsParams } from '@/hooks/useParams';
import { SolveResult } from '@/hooks/useSolver';
import { RoadBlock, CongestionZone } from '@/hooks/useRestrictions';

interface SidebarProps {
    locations: MapLocation[];
    algorithm: string;
    onAlgorithmChange: (algo: string) => void;

    solverEngine: 'ts' | 'cpp';
    onSolverEngineChange: (engine: 'ts' | 'cpp') => void;

    params: LogisticsParams;
    priorityEnabled: boolean;
    onParamChange: <K extends keyof LogisticsParams>(key: K, value: LogisticsParams[K]) => void;
    onPriorityToggle: (enabled: boolean) => void;
    onResetParams: () => void;
    onRemoveLocation: (index: number) => void;
    onUpdatePriority: (index: number, priority: number) => void;
    onClearAll: () => void;
    onSolve: () => void;
    solveResult: SolveResult | null;
    isLoading: boolean;
    showRoadRouteBtn: boolean;
    roadRouteShown: boolean;
    roadRouteLoading: boolean;
    onShowRoadRoute: () => void;

    // Restrictions
    roadBlocks: RoadBlock[];
    congestionZones: CongestionZone[];
    blockModeActive: boolean;
    congestionModeActive: boolean;
    onToggleBlockMode: (active: boolean) => void;
    onToggleCongestionMode: (active: boolean) => void;
    onRemoveBlock: (id: string) => void;
    onRemoveCongestion: (id: string) => void;
    onUpdateCongestion: (id: string, updates: Partial<Pick<CongestionZone, 'radiusKm' | 'intensity'>>) => void;
    onClearRestrictions: () => void;
}

const ALGORITHMS = [
    { value: 'held-karp', name: 'Held-Karp', desc: 'Exact · TS≤18 · C++⚡ larger n' },
    { value: 'nearest-neighbor', name: 'Nearest Neighbor', desc: 'Greedy · O(n²) · Any n' },
    { value: 'qaoa', name: 'Quantum QAOA', desc: 'Hybrid · Qiskit · n≤8' },
    { value: 'compare', name: 'Compare Mode', desc: 'Both · Gap Analysis' },
];

export default function Sidebar({
    locations,
    algorithm,
    onAlgorithmChange,

    solverEngine,
    onSolverEngineChange,

    params,
    priorityEnabled,
    onParamChange,
    onPriorityToggle,
    onResetParams,
    onRemoveLocation,
    onUpdatePriority,
    onClearAll,
    onSolve,
    solveResult,
    isLoading,
    showPolygonBtn,
    polygonShown,
    roadRouteLoading,
    onShowPolygon,

    // Restrictions
    roadBlocks,
    congestionZones,
    blockModeActive,
    congestionModeActive,
    onToggleBlockMode,
    onToggleCongestionMode,
    onRemoveBlock,
    onRemoveCongestion,
    onUpdateCongestion,
    onClearRestrictions,
}: SidebarProps) {
    const totalRestrictions = roadBlocks.length + congestionZones.length;

    return (
        <aside id="sidebar" className="sidebar">
            <SidebarHeader />
            <div className="sidebar-body">
                {/* Locations Section */}
                <section className="panel">
                    <div className="panel-header">
                        <h2><i className="fas fa-map-marker-alt"></i> Locations</h2>
                        <span className="badge" id="location-count">{locations.length}</span>
                    </div>
                    <div className="panel-body">
                        <p className="hint">
                            <i className="fas fa-mouse-pointer"></i> Click on the map to add locations. First = depot.
                        </p>
                        <ul id="location-list" className="location-list">
                            {locations.map((loc, i) => (
                                <LocationItem
                                    key={`${loc.lat}-${loc.lng}-${i}`}
                                    location={loc}
                                    index={i}
                                    priorityEnabled={priorityEnabled}
                                    onRemove={onRemoveLocation}
                                    onUpdatePriority={onUpdatePriority}
                                />
                            ))}
                        </ul>
                        <button
                            id="btn-clear-all"
                            className="btn btn-ghost btn-sm"
                            disabled={locations.length === 0}
                            onClick={onClearAll}
                        >
                            <i className="fas fa-trash-alt"></i> Clear All
                        </button>
                    </div>
                </section>

                {/* Algorithm Section */}
                <section className="panel">
                    <div className="panel-header">
                        <h2><i className="fas fa-microchip"></i> Algorithm</h2>
                    </div>
                    <div className="panel-body">
                        <div className="algo-selector">
                            {ALGORITHMS.map((algo) => (
                                <label
                                    key={algo.value}
                                    className={`algo-option${algorithm === algo.value ? ' active' : ''}`}
                                    data-algo={algo.value}
                                    onClick={() => onAlgorithmChange(algo.value)}
                                >
                                    <input
                                        type="radio"
                                        name="algorithm"
                                        value={algo.value}
                                        checked={algorithm === algo.value}
                                        onChange={() => onAlgorithmChange(algo.value)}
                                    />
                                    <div className="algo-card">
                                        <span className="algo-name">{algo.name}</span>
                                        <span className="algo-desc">{algo.desc}</span>
                                    </div>
                                </label>
                            ))}
                        </div>

                        {algorithm === 'held-karp' && (
                            <div className="engine-section">
                                <span className="engine-label">Engine</span>
                                <div className="engine-toggle">
                                    <button
                                        className={`engine-btn${solverEngine === 'ts' ? ' active' : ''}`}
                                        onClick={() => onSolverEngineChange('ts')}
                                    >
                                        <span className="engine-btn-icon">TS</span>
                                        <span className="engine-btn-text">TypeScript</span>
                                        <span className="engine-btn-tag">≤18 nodes</span>
                                    </button>
                                    <button
                                        className={`engine-btn cpp${solverEngine === 'cpp' ? ' active' : ''}`}
                                        onClick={() => onSolverEngineChange('cpp')}
                                    >
                                        <span className="engine-btn-icon">⚡</span>
                                        <span className="engine-btn-text">C++ Native</span>
                                        <span className="engine-btn-tag">Faster</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Logistics Parameters */}
                <section className="panel">
                    <div className="panel-header">
                        <h2><i className="fas fa-sliders-h"></i> Logistics Parameters</h2>
                        <button id="btn-reset-params" className="btn-icon" title="Reset to defaults" onClick={onResetParams}>
                            <i className="fas fa-undo"></i>
                        </button>
                    </div>
                    <div className="panel-body params-body">
                        <ParamSlider
                            icon="fas fa-car-burst"
                            label="Traffic Congestion"
                            value={params.trafficCongestion ?? 1.0}
                            min={1.0}
                            max={3.0}
                            step={0.1}
                            minLabel="Free Flow"
                            maxLabel="Heavy"
                            onChange={(v) => onParamChange('trafficCongestion', v)}
                        />
                        <ParamSlider
                            icon="fas fa-clock"
                            label="Rush Hour Multiplier"
                            value={params.rushHourMultiplier ?? 1.0}
                            min={1.0}
                            max={2.5}
                            step={0.1}
                            minLabel="Off-Peak"
                            maxLabel="Peak Hours"
                            onChange={(v) => onParamChange('rushHourMultiplier', v)}
                        />
                        <ParamSlider
                            icon="fas fa-road"
                            label="Road Preference"
                            value={params.roadTypePreference ?? 1.0}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                            minLabel="Prefer Highway"
                            maxLabel="Prefer City"
                            onChange={(v) => onParamChange('roadTypePreference', v)}
                        />
                        <ParamSlider
                            icon="fas fa-gas-pump"
                            label="Fuel Efficiency Cost"
                            value={params.fuelEfficiency ?? 1.0}
                            min={0.8}
                            max={2.0}
                            step={0.1}
                            minLabel="Efficient"
                            maxLabel="Costly"
                            onChange={(v) => onParamChange('fuelEfficiency', v)}
                        />
                        <div className="param-group">
                            <div className="param-label">
                                <span><i className="fas fa-flag"></i> Delivery Priority</span>
                                <span className="param-value">{priorityEnabled ? 'On' : 'Off'}</span>
                            </div>
                            <div className="toggle-row">
                                <label className="toggle">
                                    <input
                                        type="checkbox"
                                        checked={priorityEnabled}
                                        onChange={(e) => onPriorityToggle(e.target.checked)}
                                    />
                                    <span className="toggle-slider"></span>
                                </label>
                                <span className="toggle-text">Enable per-node priority</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ═══ Road Restrictions Panel ═══ */}
                <section className="panel restrictions-panel">
                    <div className="panel-header">
                        <h2><i className="fas fa-ban"></i> Road Restrictions</h2>
                        {totalRestrictions > 0 && (
                            <span className="badge restriction-badge">{totalRestrictions}</span>
                        )}
                    </div>
                    <div className="panel-body restrictions-body">
                        {/* Road Block Mode */}
                        <div className="restriction-section">
                            <div className="restriction-header">
                                <div className="restriction-title">
                                    <span className="restriction-icon block-icon">🚧</span>
                                    <div>
                                        <div className="restriction-name">Road Blocks</div>
                                        <div className="restriction-desc">Block a road segment between stops</div>
                                    </div>
                                </div>
                                <label className={`mode-toggle${blockModeActive ? ' active' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={blockModeActive}
                                        onChange={(e) => onToggleBlockMode(e.target.checked)}
                                    />
                                    <span className="mode-toggle-slider"></span>
                                    <span className="mode-toggle-label">{blockModeActive ? 'Placing' : 'Off'}</span>
                                </label>
                            </div>

                            {blockModeActive && (
                                <div className="restriction-hint">
                                    <i className="fas fa-crosshairs"></i>
                                    Click on the map to place a road block
                                </div>
                            )}

                            {roadBlocks.length > 0 && (
                                <ul className="restriction-list">
                                    {roadBlocks.map((block, idx) => (
                                        <li key={block.id} className="restriction-item block-item">
                                            <span className="restriction-item-icon">🚧</span>
                                            <div className="restriction-item-info">
                                                <span className="restriction-item-label">Block {idx + 1}</span>
                                                <span className="restriction-item-coords">
                                                    {block.lat.toFixed(4)}, {block.lng.toFixed(4)}
                                                </span>
                                            </div>
                                            <button
                                                className="restriction-remove"
                                                title="Remove block"
                                                onClick={() => onRemoveBlock(block.id)}
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="restriction-divider"></div>

                        {/* Congestion Zone Mode */}
                        <div className="restriction-section">
                            <div className="restriction-header">
                                <div className="restriction-title">
                                    <span className="restriction-icon congestion-icon">🔴</span>
                                    <div>
                                        <div className="restriction-name">Traffic Congestion Zones</div>
                                        <div className="restriction-desc">Simulate heavy traffic in an area</div>
                                    </div>
                                </div>
                                <label className={`mode-toggle congestion${congestionModeActive ? ' active' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={congestionModeActive}
                                        onChange={(e) => onToggleCongestionMode(e.target.checked)}
                                    />
                                    <span className="mode-toggle-slider"></span>
                                    <span className="mode-toggle-label">{congestionModeActive ? 'Placing' : 'Off'}</span>
                                </label>
                            </div>

                            {congestionModeActive && (
                                <div className="restriction-hint congestion-hint">
                                    <i className="fas fa-crosshairs"></i>
                                    Click on the map to place a congestion zone
                                </div>
                            )}

                            {congestionZones.length > 0 && (
                                <ul className="restriction-list">
                                    {congestionZones.map((zone, idx) => (
                                        <li key={zone.id} className="restriction-item congestion-item">
                                            <span className="restriction-item-icon">🔴</span>
                                            <div className="restriction-item-info">
                                                <span className="restriction-item-label">Zone {idx + 1}</span>
                                                <span className="restriction-item-coords">
                                                    {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                                                </span>
                                                <div className="zone-controls">
                                                    <div className="zone-control">
                                                        <span className="zone-control-label">Radius</span>
                                                        <input
                                                            type="range"
                                                            className="zone-slider"
                                                            min={0.5}
                                                            max={10}
                                                            step={0.5}
                                                            value={zone.radiusKm}
                                                            onChange={(e) =>
                                                                onUpdateCongestion(zone.id, {
                                                                    radiusKm: parseFloat(e.target.value),
                                                                })
                                                            }
                                                        />
                                                        <span className="zone-control-value">{zone.radiusKm} km</span>
                                                    </div>
                                                    <div className="zone-control">
                                                        <span className="zone-control-label">Intensity</span>
                                                        <input
                                                            type="range"
                                                            className="zone-slider intensity"
                                                            min={1.5}
                                                            max={5.0}
                                                            step={0.5}
                                                            value={zone.intensity}
                                                            onChange={(e) =>
                                                                onUpdateCongestion(zone.id, {
                                                                    intensity: parseFloat(e.target.value),
                                                                })
                                                            }
                                                        />
                                                        <span className="zone-control-value">{zone.intensity.toFixed(1)}×</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                className="restriction-remove"
                                                title="Remove zone"
                                                onClick={() => onRemoveCongestion(zone.id)}
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {totalRestrictions > 0 && (
                            <button
                                className="btn btn-ghost btn-sm restriction-clear"
                                onClick={onClearRestrictions}
                            >
                                <i className="fas fa-eraser"></i> Clear All Restrictions
                            </button>
                        )}
                    </div>
                </section>

                {/* Solve Button */}
                <div className="solve-section">
                    <button
                        id="btn-solve"
                        className="btn btn-solve"
                        disabled={locations.length < 2 || isLoading}
                        onClick={onSolve}
                    >
                        <span className={`btn-content${isLoading ? ' hidden' : ''}`}>
                            <i className="fas fa-bolt"></i>
                            <span>Optimize Route</span>
                        </span>
                        <span className={`btn-loading${!isLoading ? ' hidden' : ''}`}>
                            <i className="fas fa-spinner fa-spin"></i>
                            <span>Computing...</span>
                        </span>
                    </button>
                </div>

                {/* Results Panel */}
                {solveResult && (
                    <ResultsPanel
                        data={solveResult}
                        showPolygonBtn={showPolygonBtn}
                        polygonShown={polygonShown}
                        roadRouteLoading={roadRouteLoading}
                        onShowPolygon={onShowPolygon}
                    />
                )}
            </div>
        </aside>
    );
}

function SidebarHeader() {
    const toggleSidebar = () => {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
        const icon = document.querySelector('#sidebar-toggle i');
        if (icon) {
            icon.className = sidebar.classList.contains('collapsed')
                ? 'fas fa-chevron-right'
                : 'fas fa-chevron-left';
        }
    };

    return (
        <div className="sidebar-header">
            <div className="brand">
                <div className="brand-icon">
                    <i className="fas fa-atom"></i>
                </div>
                <div>
                    <h1 className="brand-name">QuantumRoute</h1>
                    <p className="brand-sub">Hybrid Delivery Optimizer</p>
                </div>
            </div>
            <button id="sidebar-toggle" className="sidebar-toggle" title="Toggle sidebar" onClick={toggleSidebar}>
                <i className="fas fa-chevron-left"></i>
            </button>
        </div>
    );
}

function LocationItem({
    location,
    index,
    priorityEnabled,
    onRemove,
    onUpdatePriority,
}: {
    location: MapLocation;
    index: number;
    priorityEnabled: boolean;
    onRemove: (i: number) => void;
    onUpdatePriority: (i: number, p: number) => void;
}) {
    const isDepot = index === 0;

    return (
        <li className="location-item">
            <div className={`location-number ${isDepot ? 'depot' : 'stop'}`}>
                {isDepot ? <i className="fas fa-warehouse" style={{ fontSize: '10px' }}></i> : index}
            </div>
            <div className="location-info">
                <div className="location-label">{location.label}</div>
                <div className="location-coords">
                    {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </div>
            </div>
            {!isDepot && priorityEnabled && (
                <input
                    type="range"
                    className="location-priority"
                    min="0.5"
                    max="1.5"
                    step="0.1"
                    value={location.priority}
                    title={`Priority: ${location.priority}`}
                    onChange={(e) => onUpdatePriority(index, parseFloat(e.target.value))}
                />
            )}
            <button
                className="location-remove"
                title="Remove"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove(index);
                }}
            >
                <i className="fas fa-times"></i>
            </button>
        </li>
    );
}

function ParamSlider({
    icon,
    label,
    value,
    min,
    max,
    step,
    minLabel,
    maxLabel,
    onChange,
}: {
    icon: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    minLabel: string;
    maxLabel: string;
    onChange: (v: number) => void;
}) {
    return (
        <div className="param-group">
            <div className="param-label">
                <span><i className={icon}></i> {label}</span>
                <span className="param-value">{value.toFixed(1)}×</span>
            </div>
            <input
                type="range"
                className="param-slider"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
            />
            <div className="param-range">
                <span>{minLabel}</span>
                <span>{maxLabel}</span>
            </div>
        </div>
    );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function ResultsPanel({
    data,
    showPolygonBtn,
    polygonShown,
    roadRouteLoading,
    onShowPolygon,
}: {
    data: SolveResult;
    showPolygonBtn: boolean;
    polygonShown: boolean;
    roadRouteLoading: boolean;
    onShowPolygon: () => void;
}) {
    if (data.algorithm === 'compare') {
        return <CompareResults data={data} showPolygonBtn={showPolygonBtn} polygonShown={polygonShown} roadRouteLoading={roadRouteLoading} onShowPolygon={onShowPolygon} />;
    }
    return <SingleResults data={data} showPolygonBtn={showPolygonBtn} polygonShown={polygonShown} roadRouteLoading={roadRouteLoading} onShowPolygon={onShowPolygon} />;
}

function PolygonRouteButton({
    show,
    shown,
    loading,
    onClick,
}: {
    show: boolean;
    shown: boolean;
    loading: boolean;
    onClick: () => void;
}) {
    if (!show) return null;
    return (
        <button
            id="btn-show-polygon"
            className={`btn btn-road-route${shown ? ' road-shown' : ''}`}
            disabled={shown || loading}
            onClick={onClick}
        >
            <span className={`btn-content${loading ? ' hidden' : ''}`}>
                <i className={`fas fa-${shown ? 'check-circle' : 'draw-polygon'}`}></i>
                <span>{shown ? 'Polygon Shown' : 'Show Straight Lines'}</span>
            </span>
            <span className={`btn-loading${!loading ? ' hidden' : ''}`}>
                <i className="fas fa-spinner fa-spin"></i>
                <span>Loading...</span>
            </span>
        </button>
    );
}

function SingleResults({ data, showPolygonBtn, polygonShown, roadRouteLoading, onShowPolygon }: { data: SolveResult; showPolygonBtn: boolean; polygonShown: boolean; roadRouteLoading: boolean; onShowPolygon: () => void }) {
    const solution = data.solution;
    if (!solution) return null;

    const distKm = (solution.distance / 1000).toFixed(2);
    const tour: number[] = solution.tour;
    const qm = solution.quantumMetrics;

    return (
        <section id="results-panel" className="panel results-panel">
            <div className="panel-header">
                <h2><i className="fas fa-chart-line"></i> Results</h2>
            </div>
            <div className="panel-body" id="results-body">
                <div className="result-grid">
                    <div className="result-card">
                        <div className="result-label">Total Distance</div>
                        <div className="result-value">{distKm} km</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Solver</div>
                        <div className="result-value small">{solution.solverName}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Matrix Time</div>
                        <div className="result-value small success">{data.metadata.matrixTimeMs} ms</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Solve Time</div>
                        <div className="result-value small success">{data.metadata.solveTimeMs} ms</div>
                    </div>
                </div>

                {qm && (
                    <div className="result-card full-width" style={{ marginTop: '8px' }}>
                        <div className="result-label"><i className="fas fa-atom"></i> Quantum Metrics</div>
                        <div className="result-grid" style={{ marginTop: '6px' }}>
                            <div className="result-card">
                                <div className="result-label">Qubits</div>
                                <div className="result-value">{qm.numQubits}</div>
                            </div>
                            <div className="result-card">
                                <div className="result-label">Circuit Depth</div>
                                <div className="result-value">{qm.circuitDepth || 'N/A'}</div>
                            </div>
                            <div className="result-card">
                                <div className="result-label">QAOA Energy</div>
                                <div className="result-value small">{qm.qaoaEnergy != null ? qm.qaoaEnergy.toFixed(3) : 'N/A'}</div>
                            </div>
                            <div className="result-card">
                                <div className="result-label">Optimizer Iters</div>
                                <div className="result-value">{qm.optimizerIterations || 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="result-card full-width">
                    <div className="result-label">Route Order</div>
                    <div className="route-order">
                        {tour.map((nodeIdx: number, i: number) => (
                            <span key={i}>
                                {i > 0 && (
                                    <span className="route-arrow"><i className="fas fa-arrow-right"></i></span>
                                )}
                                <span className={`route-node${nodeIdx === 0 ? ' depot' : ''}`}>
                                    {nodeIdx === 0 ? '★' : nodeIdx}
                                </span>
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <PolygonRouteButton show={showPolygonBtn} shown={polygonShown} loading={roadRouteLoading} onClick={onShowPolygon} />
        </section>
    );
}

function CompareResults({ data, showPolygonBtn, polygonShown, roadRouteLoading, onShowPolygon }: { data: SolveResult; showPolygonBtn: boolean; polygonShown: boolean; roadRouteLoading: boolean; onShowPolygon: () => void }) {
    const hk = data.heldKarp;
    const nn = data.nearestNeighbor;
    if (!nn) return null;

    const hkDist = hk?.skipped ? 'N/A' : ((hk?.distance ?? 0) / 1000).toFixed(2);
    const nnDist = (nn.distance / 1000).toFixed(2);

    const maxDist = Math.max(hk?.skipped ? nn.distance : (hk?.distance ?? 0), nn.distance);
    const hkPct = hk?.skipped ? 0 : ((hk?.distance ?? 0) / maxDist) * 100;
    const nnPct = (nn.distance / maxDist) * 100;

    return (
        <section id="results-panel" className="panel results-panel">
            <div className="panel-header">
                <h2><i className="fas fa-chart-line"></i> Results</h2>
            </div>
            <div className="panel-body" id="results-body">
                <div className="result-grid">
                    <div className="result-card">
                        <div className="result-label">Held-Karp (Exact)</div>
                        <div className="result-value">{hkDist}{hk?.skipped ? '' : ' km'}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Nearest Neighbor</div>
                        <div className="result-value warning">{nnDist} km</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Suboptimality Gap</div>
                        <div className={`result-value${data.gapPercent !== 'N/A' ? ' warning' : ''}`}>{data.gapPercent}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Total Time</div>
                        <div className="result-value small success">{data.metadata.totalTimeMs} ms</div>
                    </div>
                </div>

                <div className="compare-section">
                    <div className="compare-label"><i className="fas fa-chart-bar"></i> Distance Comparison</div>
                    {!hk?.skipped && (
                        <>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                                Held-Karp: {hkDist} km · {hk?.timeMs} ms
                            </div>
                            <div className="compare-bar">
                                <div className="compare-bar-fill hk" style={{ width: `${hkPct}%` }}></div>
                            </div>
                        </>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                        Nearest Neighbor: {nnDist} km · {nn.timeMs} ms
                    </div>
                    <div className="compare-bar">
                        <div className="compare-bar-fill nn" style={{ width: `${nnPct}%` }}></div>
                    </div>
                </div>

                {/* Route orders */}
                {!hk?.skipped && hk?.tour?.length > 0 && (
                    <div className="result-card full-width" style={{ marginTop: '8px' }}>
                        <div className="result-label">Held-Karp Route</div>
                        <div className="route-order">
                            {hk.tour.map((n: number, i: number) => (
                                <span key={i}>
                                    {i > 0 && <span className="route-arrow"><i className="fas fa-arrow-right"></i></span>}
                                    <span className={`route-node${n === 0 ? ' depot' : ''}`}>{n === 0 ? '★' : n}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                )}
                <div className="result-card full-width" style={{ marginTop: '4px' }}>
                    <div className="result-label">Nearest Neighbor Route</div>
                    <div className="route-order">
                        {nn.tour.map((n: number, i: number) => (
                            <span key={i}>
                                {i > 0 && <span className="route-arrow"><i className="fas fa-arrow-right"></i></span>}
                                <span className={`route-node${n === 0 ? ' depot' : ''}`}>{n === 0 ? '★' : n}</span>
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <PolygonRouteButton show={showPolygonBtn} shown={polygonShown} loading={roadRouteLoading} onClick={onShowPolygon} />
        </section>
    );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
