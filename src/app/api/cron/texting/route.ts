/**
 * Daily: move every dealer's texting registration on as far as it goes.
 *
 * Brand and campaign approval happen at the carriers' pace, and nobody is
 * watching the Settings page when they land. This is what notices. Settings
 * also looks when it's opened, so the daily run is the floor, not the speed.
 *
 * AUTH: `CRON_SECRET` in the Authorization header, same gate as the other crons.
 */

import { NextResponse } from 'next/server';
import { advanceAll } from '@/lib/messaging/registration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }
  const checked = await advanceAll();
  return NextResponse.json({ checked });
}
