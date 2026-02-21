import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy to OSRM public router.
 * Supports two modes:
 *   ?from=lng,lat&to=lng,lat          — two-point route (legacy)
 *   ?waypoints=lng,lat;lng,lat;...    — multi-waypoint route
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  let coords: string;
  const waypoints = searchParams.get('waypoints');
  if (waypoints) {
    coords = waypoints;                       // already semicolon-separated
  } else {
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (!from || !to) {
      return NextResponse.json({ error: 'Missing coordinates' }, { status: 400 });
    }
    coords = `${from};${to}`;
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[OSRM proxy] fetch failed:', err);
    return NextResponse.json({ error: 'OSRM fetch failed' }, { status: 500 });
  }
}