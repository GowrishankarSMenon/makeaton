import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'QuantumRoute — Hybrid Delivery Optimizer',
    description:
        'Quantum-hybrid delivery route optimizer using Held-Karp bitmask DP and Nearest Neighbor with Leaflet.js interactive map.',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <head>
                {/* Google Fonts */}
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
                    rel="stylesheet"
                />
                {/* Font Awesome */}
                <link
                    rel="stylesheet"
                    href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
                />
            </head>
            <body>{children}</body>
        </html>
    );
}
