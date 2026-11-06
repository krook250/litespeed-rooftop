/**
 * Lands queued channel syncs whose ETA has passed (QUEUED/SYNCING -> LIVE).
 * Every minute. The inventory and syndication pages also do this on load, so
 * what's on screen is current; this covers the hours nobody has a page open.
 */

import { NextResponse } from 'next/server';
import { advanceDueSyncs } from '@/lib/sync-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }
  const r = await advanceDueSyncs();
  return NextResponse.json(r);
}
