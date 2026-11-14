/**
 * One thread in the chat bubble. Opening it marks their replies read.
 * GET for the same reason as ../inbox/route.ts.
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { markRead, threadView } from '@/lib/messaging/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me || !can(me.role, 'leads')) return NextResponse.json(null, { status: 403 });
  const leadId = new URL(req.url).searchParams.get('lead') ?? '';
  const view = leadId ? await threadView(me.groupId, leadId) : null;
  if (!view) return NextResponse.json(null, { status: 404 });
  await markRead(me.groupId, leadId);
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } });
}
