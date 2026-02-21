'use client';

interface QuantumOverlayProps {
    isVisible: boolean;
    statusText: string;
}

export default function QuantumOverlay({ isVisible, statusText }: QuantumOverlayProps) {
    return (
        <div id="quantum-overlay" className={`quantum-overlay${isVisible ? '' : ' hidden'}`}>
            <div className="quantum-loader">
                <div className="quantum-circuit">
                    <div className="qubit-line" style={{ '--delay': 0 } as React.CSSProperties}></div>
                    <div className="qubit-line" style={{ '--delay': 1 } as React.CSSProperties}></div>
                    <div className="qubit-line" style={{ '--delay': 2 } as React.CSSProperties}></div>
                    <div className="qubit-line" style={{ '--delay': 3 } as React.CSSProperties}></div>
                    <div className="qubit-line" style={{ '--delay': 4 } as React.CSSProperties}></div>
                </div>
                <div className="quantum-text">
                    <span className="qt-label">Exploring State Space</span>
                    <span className="qt-sub" id="quantum-status">{statusText}</span>
                </div>
            </div>
        </div>
    );
}
