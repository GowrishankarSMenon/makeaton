'use client';

import { useEffect, useRef } from 'react';

interface AlgorithmPickerProps {
    isOpen: boolean;
    onClose: () => void;
    algorithm: string;
    onAlgorithmChange: (algo: string) => void;
    solverEngine: 'ts' | 'cpp';
    onSolverEngineChange: (engine: 'ts' | 'cpp') => void;
}

const CLASSICAL_ALGORITHMS = [
    { value: 'held-karp', name: 'Held-Karp', desc: 'Exact · TS≤18 · C++⚡ larger n', icon: 'fas fa-brain' },
    { value: 'nearest-neighbor', name: 'Nearest Neighbor', desc: 'Greedy · O(n²) · Any n', icon: 'fas fa-route' },
];

const QUANTUM_ALGORITHMS = [
    { value: 'qaoa', name: 'Quantum QAOA', desc: 'Hybrid · Qiskit · n≤8', icon: 'fas fa-atom' },
    { value: 'hybrid-qhk', name: 'Hybrid QHK', desc: 'Quantum×Held-Karp · Best of both', icon: 'fas fa-layer-group' },
    { value: 'prewarm-hk', name: 'Pre-Warm HK', desc: 'HK→QAOA warm-start · Optimal seed', icon: 'fas fa-fire' },
];

export default function AlgorithmPicker({
    isOpen,
    onClose,
    algorithm,
    onAlgorithmChange,
    solverEngine,
    onSolverEngineChange,
}: AlgorithmPickerProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === overlayRef.current) onClose();
    };

    const handleSelect = (algo: string) => {
        onAlgorithmChange(algo);
        // Don't auto-close — let user also pick engine if needed
    };

    const isClassical = CLASSICAL_ALGORITHMS.some((a) => a.value === algorithm);
    const isQuantum = QUANTUM_ALGORITHMS.some((a) => a.value === algorithm);

    return (
        <div
            ref={overlayRef}
            className={`algo-picker-overlay${isOpen ? ' open' : ''}`}
            onClick={handleOverlayClick}
        >
            <div className={`algo-picker-modal${isOpen ? ' open' : ''}`}>
                {/* Header */}
                <div className="algo-picker-header">
                    <div className="algo-picker-title">
                        <i className="fas fa-microchip"></i>
                        <span>Select Algorithm</span>
                    </div>
                    <button className="algo-picker-close" onClick={onClose}>
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Body — Two columns */}
                <div className="algo-picker-body">
                    {/* Classical Section */}
                    <div className={`algo-picker-section classical${isClassical ? ' section-active' : ''}`}>
                        <div className="algo-section-header">
                            <div className="algo-section-icon classical-icon">
                                <i className="fas fa-microchip"></i>
                            </div>
                            <div>
                                <h3 className="algo-section-title">Classical</h3>
                                <p className="algo-section-sub">Deterministic algorithms</p>
                            </div>
                        </div>
                        <div className="algo-section-cards">
                            {CLASSICAL_ALGORITHMS.map((algo) => (
                                <button
                                    key={algo.value}
                                    className={`algo-pick-card${algorithm === algo.value ? ' selected' : ''}`}
                                    onClick={() => handleSelect(algo.value)}
                                >
                                    <div className="algo-pick-icon">
                                        <i className={algo.icon}></i>
                                    </div>
                                    <div className="algo-pick-info">
                                        <span className="algo-pick-name">{algo.name}</span>
                                        <span className="algo-pick-desc">{algo.desc}</span>
                                    </div>
                                    {algorithm === algo.value && (
                                        <div className="algo-pick-check">
                                            <i className="fas fa-check-circle"></i>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Held-Karp Engine Toggle — shown when HK is selected */}
                        {algorithm === 'held-karp' && (
                            <div className="algo-engine-section">
                                <span className="algo-engine-label">Solver Engine</span>
                                <div className="algo-engine-toggle">
                                    <button
                                        className={`algo-engine-btn${solverEngine === 'ts' ? ' active' : ''}`}
                                        onClick={() => onSolverEngineChange('ts')}
                                    >
                                        <span className="algo-engine-btn-icon">TS</span>
                                        <span className="algo-engine-btn-text">TypeScript</span>
                                        <span className="algo-engine-btn-tag">≤18 nodes</span>
                                    </button>
                                    <button
                                        className={`algo-engine-btn cpp${solverEngine === 'cpp' ? ' active' : ''}`}
                                        onClick={() => onSolverEngineChange('cpp')}
                                    >
                                        <span className="algo-engine-btn-icon">⚡</span>
                                        <span className="algo-engine-btn-text">C++ Native</span>
                                        <span className="algo-engine-btn-tag">Faster</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Quantum Section */}
                    <div className={`algo-picker-section quantum${isQuantum ? ' section-active' : ''}`}>
                        <div className="algo-section-header">
                            <div className="algo-section-icon quantum-icon">
                                <i className="fas fa-atom"></i>
                            </div>
                            <div>
                                <h3 className="algo-section-title">Quantum</h3>
                                <p className="algo-section-sub">Quantum-enhanced solvers</p>
                            </div>
                        </div>
                        <div className="algo-section-cards">
                            {QUANTUM_ALGORITHMS.map((algo) => (
                                <button
                                    key={algo.value}
                                    className={`algo-pick-card quantum-card${algorithm === algo.value ? ' selected' : ''}`}
                                    onClick={() => handleSelect(algo.value)}
                                >
                                    <div className="algo-pick-icon quantum-pick-icon">
                                        <i className={algo.icon}></i>
                                    </div>
                                    <div className="algo-pick-info">
                                        <span className="algo-pick-name">{algo.name}</span>
                                        <span className="algo-pick-desc">{algo.desc}</span>
                                    </div>
                                    {algorithm === algo.value && (
                                        <div className="algo-pick-check quantum-check">
                                            <i className="fas fa-check-circle"></i>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="algo-picker-footer">
                    <div className="algo-picker-current">
                        <span className="algo-picker-current-label">Active:</span>
                        <span className={`algo-picker-current-badge${isQuantum ? ' quantum' : ''}`}>
                            {[...CLASSICAL_ALGORITHMS, ...QUANTUM_ALGORITHMS].find((a) => a.value === algorithm)?.name ?? algorithm}
                        </span>
                    </div>
                    <button className="algo-picker-confirm" onClick={onClose}>
                        <i className="fas fa-check"></i>
                        <span>Confirm</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
