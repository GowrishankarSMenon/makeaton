'use client';

import { MapLocation } from '@/hooks/useLocations';
import { LogisticsParams } from '@/hooks/useParams';
import { SolveResult } from '@/hooks/useSolver';
import { RoadBlock, CongestionZone } from '@/hooks/useRestrictions';

interface SidebarProps {
    locations: MapLocation[];
    algorithm: string;
    onOpenAlgorithmPicker: () => void;

    params: LogisticsParams;
    onParamChange: <K extends keyof LogisticsParams>(key: K, value: LogisticsParams[K]) => void;
    onResetParams: () => void;
    onRemoveLocation: (index: number) => void;
    onClearAll: () => void;
    onSolve: () => void;
    solveResult: SolveResult | null;
    isLoading: boolean;
    showPolygonBtn: boolean;
    polygonShown: boolean;
    roadRouteLoading: boolean;
    onShowPolygon: () => void;

    // Sidebar collapse
    collapsed: boolean;
    onToggleCollapse: () => void;

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

const ALGO_LOOKUP: Record<string, { name: string; icon: string; category: string }> = {
    'held-karp': { name: 'Held-Karp', icon: 'fas fa-brain', category: 'Classical' },
    'nearest-neighbor': { name: 'Nearest Neighbor', icon: 'fas fa-route', category: 'Classical' },
    'qaoa': { name: 'Quantum QAOA', icon: 'fas fa-atom', category: 'Quantum' },
    'hybrid-qhk': { name: 'Hybrid QHK', icon: 'fas fa-layer-group', category: 'Quantum' },
    'prewarm-hk': { name: 'Pre-Warm HK', icon: 'fas fa-fire', category: 'Quantum' },
    'compare': { name: 'Compare Mode', icon: 'fas fa-chart-bar', category: 'Utility' },
};

export default function Sidebar({
    locations,
    algorithm,
    onOpenAlgorithmPicker,

    params,
    onParamChange,
    onResetParams,
    onRemoveLocation,
    onClearAll,
    onSolve,
    solveResult,
    isLoading,
    showPolygonBtn,
    polygonShown,
    roadRouteLoading,
    onShowPolygon,

    // Sidebar collapse
    collapsed,
    onToggleCollapse,

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
    const algoInfo = ALGO_LOOKUP[algorithm] || { name: algorithm, icon: 'fas fa-cog', category: 'Unknown' };

    return (
        <aside id="sidebar" className={`sidebar${collapsed ? ' collapsed' : ''}`}>
            <SidebarHeader collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
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
                                    onRemove={onRemoveLocation}
                                />
                            ))}
                        </ul>
                        <button
                            id="btn-clear-all"
                            className="btn btn-ghost btn-sm"
                            disabled={locations.length === 0}
                            onClick={onClearAll}
                            suppressHydrationWarning
                        >
                            <i className="fas fa-trash-alt"></i> Clear All
                        </button>
                    </div>
                </section>

                {/* Algorithm Selector — opens center picker */}
                <section className="panel algo-summary-panel">
                    <div className="panel-header">
                        <h2><i className="fas fa-microchip"></i> Algorithm</h2>
                    </div>
                    <div className="panel-body">
                        <button className="algo-summary-btn" onClick={onOpenAlgorithmPicker} suppressHydrationWarning>
                            <div className="algo-summary-left">
                                <div className={`algo-summary-icon${algoInfo.category === 'Quantum' ? ' quantum' : ''}`}>
                                    <i className={algoInfo.icon}></i>
                                </div>
                                <div className="algo-summary-info">
                                    <span className="algo-summary-name">{algoInfo.name}</span>
                                    <span className={`algo-summary-cat${algoInfo.category === 'Quantum' ? ' quantum' : ''}`}>{algoInfo.category}</span>
                                </div>
                            </div>
                            <div className="algo-summary-right">
                                <span>Change</span>
                                <i className="fas fa-chevron-right"></i>
                            </div>
                        </button>
                    </div>
                </section>

                {/* Logistics Parameters */}
                <section className="panel">
                    <div className="panel-header">
                        <h2><i className="fas fa-sliders-h"></i> Logistics Parameters</h2>
                        <button id="btn-reset-params" className="btn-icon" title="Reset to defaults" onClick={onResetParams} suppressHydrationWarning>
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
                                        suppressHydrationWarning
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
                                                suppressHydrationWarning
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
                                        suppressHydrationWarning
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
                                                suppressHydrationWarning
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
                                suppressHydrationWarning
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
                        suppressHydrationWarning
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
                        fuelEfficiency={params.fuelEfficiency ?? 1.0}
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

function SidebarHeader({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse: () => void }) {
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
            <button
                id="sidebar-toggle"
                className="sidebar-toggle"
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={onToggleCollapse}
                suppressHydrationWarning
            >
                <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'}`}></i>
            </button>
        </div>
    );
}

function LocationItem({
    location,
    index,
    onRemove,
}: {
    location: MapLocation;
    index: number;
    onRemove: (i: number) => void;
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
            <button
                className="location-remove"
                title="Remove"
                onClick={(e) => {
                    e.stopPropagation();
                    onRemove(index);
                }}
                suppressHydrationWarning
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
                suppressHydrationWarning
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
    fuelEfficiency,
    showPolygonBtn,
    polygonShown,
    roadRouteLoading,
    onShowPolygon,
}: {
    data: SolveResult;
    fuelEfficiency: number;
    showPolygonBtn: boolean;
    polygonShown: boolean;
    roadRouteLoading: boolean;
    onShowPolygon: () => void;
}) {
    if (data.algorithm === 'compare') {
        return <CompareResults data={data} fuelEfficiency={fuelEfficiency} showPolygonBtn={showPolygonBtn} polygonShown={polygonShown} roadRouteLoading={roadRouteLoading} onShowPolygon={onShowPolygon} />;
    }
    return <SingleResults data={data} fuelEfficiency={fuelEfficiency} showPolygonBtn={showPolygonBtn} polygonShown={polygonShown} roadRouteLoading={roadRouteLoading} onShowPolygon={onShowPolygon} />;
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
            suppressHydrationWarning
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

// Base fuel rate: ₹6 per km at efficiency 1.0×
const BASE_FUEL_RATE_PER_KM = 6;

function SingleResults({ data, fuelEfficiency, showPolygonBtn, polygonShown, roadRouteLoading, onShowPolygon }: { data: SolveResult; fuelEfficiency: number; showPolygonBtn: boolean; polygonShown: boolean; roadRouteLoading: boolean; onShowPolygon: () => void }) {
    const solution = data.solution;
    if (!solution) return null;

    const distKm = (solution.distance / 1000).toFixed(2);
    const fuelCost = (parseFloat(distKm) * BASE_FUEL_RATE_PER_KM * fuelEfficiency).toFixed(2);
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
                        <div className="result-label"><i className="fas fa-gas-pump" style={{ marginRight: 4 }}></i>Fuel Cost</div>
                        <div className="result-value warning">₹{fuelCost}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Solver</div>
                        <div className="result-value small">{solution.solverName}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">Solve Time</div>
                        <div className="result-value small success">{data.metadata.solveTimeMs} ms</div>
                    </div>
                </div>

                {/* Fuel cost breakdown */}
                <div className="result-card full-width" style={{ marginTop: '6px' }}>
                    <div className="result-label"><i className="fas fa-receipt" style={{ marginRight: 4 }}></i>Fuel Cost Breakdown</div>
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Distance</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{distKm} km</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Base Rate</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{BASE_FUEL_RATE_PER_KM}/km</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Efficiency Multiplier</span>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: fuelEfficiency > 1.0 ? '#ff1744' : fuelEfficiency < 1.0 ? '#00c853' : 'inherit' }}>{fuelEfficiency.toFixed(1)}×</span>
                        </div>
                        <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '2px 0' }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--text-primary)' }}>
                            <span>Estimated Fuel Cost</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-1)' }}>₹{fuelCost}</span>
                        </div>
                    </div>
                </div>

                {qm && (
                    <div className="result-card full-width" style={{ marginTop: '8px' }}>
                        <div className="result-label"><i className="fas fa-atom"></i> Quantum Metrics</div>

                        {/* IBM Backend badge */}
                        {qm.backend && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', marginBottom: '4px' }}>
                                <span style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                    textTransform: 'uppercase' as const,
                                    letterSpacing: '0.5px',
                                    background:
                                        qm.executionMode === 'real_hardware' ? 'rgba(34,197,94,0.15)' :
                                        qm.executionMode === 'ibm_simulator' ? 'rgba(59,130,246,0.15)' :
                                        qm.executionMode === 'local_fallback' ? 'rgba(245,158,11,0.15)' :
                                        'rgba(148,163,184,0.15)',
                                    color:
                                        qm.executionMode === 'real_hardware' ? '#22c55e' :
                                        qm.executionMode === 'ibm_simulator' ? '#3b82f6' :
                                        qm.executionMode === 'local_fallback' ? '#f59e0b' :
                                        '#94a3b8',
                                    border: `1px solid ${
                                        qm.executionMode === 'real_hardware' ? 'rgba(34,197,94,0.3)' :
                                        qm.executionMode === 'ibm_simulator' ? 'rgba(59,130,246,0.3)' :
                                        qm.executionMode === 'local_fallback' ? 'rgba(245,158,11,0.3)' :
                                        'rgba(148,163,184,0.3)'
                                    }`,
                                }}>
                                    <i className={`fas fa-${
                                        qm.executionMode === 'real_hardware' ? 'microchip' :
                                        qm.executionMode === 'ibm_simulator' ? 'cloud' :
                                        qm.executionMode === 'local_fallback' ? 'exclamation-triangle' :
                                        'desktop'
                                    }`}></i>
                                    {qm.executionMode === 'real_hardware' ? 'Real Hardware' :
                                     qm.executionMode === 'ibm_simulator' ? 'IBM Cloud Sim' :
                                     qm.executionMode === 'local_fallback' ? 'Local Fallback' :
                                     'Local Simulator'}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                    {qm.backend}
                                </span>
                            </div>
                        )}
                        {qm.fallbackReason && (
                            <div style={{
                                fontSize: '10px',
                                color: '#f59e0b',
                                marginBottom: '4px',
                                padding: '4px 6px',
                                background: 'rgba(245,158,11,0.08)',
                                borderRadius: '4px',
                            }}>
                                <i className="fas fa-info-circle"></i> Fallback: {qm.fallbackReason}
                            </div>
                        )}

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

                {/* Hybrid QHK Phase Breakdown */}
                {solution.phases && (
                    <div className="result-card full-width" style={{ marginTop: '8px' }}>
                        <div className="result-label"><i className="fas fa-layer-group"></i> Hybrid Pipeline Phases</div>
                        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {/* Phase 0: Pre-Warm (HK or NN) */}
                            {solution.phases.prewarm && (
                                <div style={{
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    background: 'rgba(251,191,36,0.08)',
                                    border: '1px solid rgba(251,191,36,0.2)',
                                }}>
                                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#f59e0b', marginBottom: '3px' }}>
                                        <i className="fas fa-fire"></i> Phase 0 — {solution.phases.prewarm.method} Pre-Warm
                                    </div>
                                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                        <span>{solution.phases.prewarm.timeMs} ms</span>
                                        <span>{(solution.phases.prewarm.distance / 1000).toFixed(1)} km</span>
                                        <span style={{ color: '#f59e0b' }}>seed for QAOA</span>
                                    </div>
                                </div>
                            )}
                            {/* Phase 1: Quantum */}
                            <div style={{
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'rgba(139,92,246,0.08)',
                                border: '1px solid rgba(139,92,246,0.2)',
                            }}>
                                <div style={{ fontSize: '10px', fontWeight: 600, color: '#8b5cf6', marginBottom: '3px' }}>
                                    <i className="fas fa-atom"></i> Phase 1 — Quantum Exploration (QAOA)
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <span>{solution.phases.quantum.qubits} qubits</span>
                                    <span>depth {solution.phases.quantum.circuitDepth}</span>
                                    <span>{solution.phases.quantum.timeMs} ms</span>
                                    <span>{(solution.phases.quantum.distance / 1000).toFixed(1)} km</span>
                                </div>
                            </div>
                            {/* Phase 2: Held-Karp Refinement */}
                            <div style={{
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'rgba(99,102,241,0.08)',
                                border: '1px solid rgba(99,102,241,0.2)',
                            }}>
                                <div style={{ fontSize: '10px', fontWeight: 600, color: '#6366f1', marginBottom: '3px' }}>
                                    <i className="fas fa-brain"></i> Phase 2 — Held-Karp Window Refinement
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <span>window={solution.phases.refinement.windowSize}</span>
                                    <span>{solution.phases.refinement.windowsApplied} passes</span>
                                    <span>{solution.phases.refinement.timeMs} ms</span>
                                    <span style={{ color: solution.phases.refinement.improvement > 0 ? '#22c55e' : 'inherit' }}>
                                        {solution.phases.refinement.improvement > 0 ? `↓${solution.phases.refinement.improvement}%` : 'no change'}
                                    </span>
                                </div>
                            </div>
                            {/* Phase 3: 2-opt */}
                            <div style={{
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: 'rgba(34,197,94,0.08)',
                                border: '1px solid rgba(34,197,94,0.2)',
                            }}>
                                <div style={{ fontSize: '10px', fontWeight: 600, color: '#22c55e', marginBottom: '3px' }}>
                                    <i className="fas fa-exchange-alt"></i> Phase 3 — 2-opt Local Search
                                </div>
                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <span>{solution.phases.twoOpt.swaps} swaps</span>
                                    <span>{solution.phases.twoOpt.timeMs} ms</span>
                                    <span style={{ color: solution.phases.twoOpt.improvement > 0 ? '#22c55e' : 'inherit' }}>
                                        {solution.phases.twoOpt.improvement > 0 ? `↓${solution.phases.twoOpt.improvement}%` : 'no change'}
                                    </span>
                                </div>
                            </div>
                        </div>
                        {qm?.totalQuantumTimeMs != null && qm?.totalClassicalTimeMs != null && (
                            <div style={{ marginTop: '6px', fontSize: '10px', color: 'var(--text-secondary)' }}>
                                ⚛ Quantum: {qm.totalQuantumTimeMs} ms &nbsp;|&nbsp; 🖥 Classical: {qm.totalClassicalTimeMs} ms
                            </div>
                        )}
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

function CompareResults({ data, fuelEfficiency, showPolygonBtn, polygonShown, roadRouteLoading, onShowPolygon }: { data: SolveResult; fuelEfficiency: number; showPolygonBtn: boolean; polygonShown: boolean; roadRouteLoading: boolean; onShowPolygon: () => void }) {
    const hk = data.heldKarp;
    const nn = data.nearestNeighbor;
    if (!nn) return null;

    const hkDist = hk?.skipped ? 'N/A' : ((hk?.distance ?? 0) / 1000).toFixed(2);
    const nnDist = (nn.distance / 1000).toFixed(2);
    const hkFuelCost = hk?.skipped ? 'N/A' : (parseFloat(hkDist as string) * BASE_FUEL_RATE_PER_KM * fuelEfficiency).toFixed(2);
    const nnFuelCost = (parseFloat(nnDist) * BASE_FUEL_RATE_PER_KM * fuelEfficiency).toFixed(2);

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
                        <div className="result-label"><i className="fas fa-gas-pump" style={{ marginRight: 4 }}></i>HK Fuel Cost</div>
                        <div className="result-value small">{hk?.skipped ? 'N/A' : `₹${hkFuelCost}`}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label"><i className="fas fa-gas-pump" style={{ marginRight: 4 }}></i>NN Fuel Cost</div>
                        <div className="result-value small warning">₹{nnFuelCost}</div>
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

                {/* Fuel cost note */}
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <i className="fas fa-info-circle"></i>
                    Base rate ₹{BASE_FUEL_RATE_PER_KM}/km × efficiency {fuelEfficiency.toFixed(1)}×
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
