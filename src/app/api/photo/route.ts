import { NextRequest } from 'next/server';
import { vehicleSvg, type PhotoBody, type PhotoScene } from '@/lib/photo-svg';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const svg = vehicleSvg({
    scene: (q.get('s') ?? 'EXTERIOR_SIDE') as PhotoScene,
    body: (q.get('b') ?? 'SEDAN') as PhotoBody,
    hex: `#${(q.get('c') ?? '9ca3af').replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || '9ca3af'}`,
    label: (q.get('l') ?? 'Rooftop Auto').slice(0, 48),
    sublabel: (q.get('k') ?? '').slice(0, 48),
    mileage: q.get('m') ? Number(q.get('m')) : undefined,
  });

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
