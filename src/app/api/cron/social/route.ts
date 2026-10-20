/**
 * Scheduled social posts go out, and Instagram containers that were still
 * processing get published. Every 5 minutes; a post scheduled for 9:00 goes
 * out by 9:05.
 */

import { NextResponse } from 'next/server';
import { runSocial } from '@/lib/social/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }
  const touched = await runSocial();
  if (touched) console.log(`[social] ${touched} post(s) moved`);
  return NextResponse.json({ touched });
}
