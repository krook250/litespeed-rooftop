/**
 * The chat bubble's list, polled while the app is open.
 *
 * A GET route and not a server action on purpose: the bubble mounts on every
 * admin screen, including /admin, which redirects the instant it loads. A
 * server action fired during that redirect crashed Next's router (React #310)
 * and flashed "This page couldn't load" on every app open. A plain fetch never
 * touches the router.
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { inbox } from '@/lib/messaging/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await getSessionUser();
  if (!me || !can(me.role, 'leads')) return NextResponse.json({ enabled: false, unread: 0, conversations: [] });
  return NextResponse.json(await inbox(me.groupId), { headers: { 'Cache-Control': 'no-store' } });
}
