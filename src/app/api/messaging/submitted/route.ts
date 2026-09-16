/**
 * The dealer finished the compliance form.
 *
 * Fired from the embed's `onInquirySubmitted`. It carries no payload and is not
 * trusted for one — the group comes from the session and every id involved was
 * already ours. All this endpoint decides is *when*, and even that only moves
 * the status forward, never back.
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { markSubmitted } from '@/lib/messaging/setup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await requireSession();
  await markSubmitted(user.groupId);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
