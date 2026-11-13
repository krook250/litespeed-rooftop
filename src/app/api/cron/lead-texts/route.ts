/**
 * Every minute: auto-replies held for texting hours whose time has come.
 * See `sendDue` in `src/lib/messaging/lead-texts.ts`.
 *
 * AUTH: `CRON_SECRET` in the Authorization header, same gate as the other crons.
 */

import { NextResponse } from 'next/server';
import { sendDue } from '@/lib/messaging/lead-texts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }
  const sent = await sendDue();
  return NextResponse.json({ sent });
}
