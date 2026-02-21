'use client';

import { useState, useCallback } from 'react';

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
    removing?: boolean;
}

let toastId = 0;

export function useToast() {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
        const id = ++toastId;
        setToasts((prev) => [...prev, { id, message, type }]);

        setTimeout(() => {
            setToasts((prev) =>
                prev.map((t) => (t.id === id ? { ...t, removing: true } : t))
            );
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, 300);
        }, 3500);
    }, []);

    return { toasts, showToast };
}

const ICONS: Record<Toast['type'], string> = {
    success: 'fas fa-check-circle',
    error: 'fas fa-exclamation-circle',
    info: 'fas fa-info-circle',
    warning: 'fas fa-exclamation-triangle',
};

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
    return (
        <div id="toast-container" className="toast-container">
            {toasts.map((toast) => (
                <div key={toast.id} className={`toast ${toast.type}${toast.removing ? ' removing' : ''}`}>
                    <i className={ICONS[toast.type]}></i>
                    <span>{toast.message}</span>
                </div>
            ))}
        </div>
    );
}
