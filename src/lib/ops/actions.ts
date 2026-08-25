'use server';

/**
 * The operator half of the connection lifecycle.
 *
 * `src/lib/connection-actions.ts` holds the dealer's two moves. These are ours:
 * the transitions only Rooftop can honestly claim, because they describe work
 * Rooftop did. `SUBMITTED` means we put the rooftop in the outbound file;
 * `CONNECTED` means the destination confirmed it is carrying the inventory.
 * Neither is something a dealer can assert about us.
 *
 * Every action re-checks staff. The page guard is not enough — a server action
 * is a POST endpoint, and it is reachable by anyone who can guess its id whether
 * or not they could render the page that normally submits it.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireStaff } from '@/lib/ops/guard';

function refresh(rooftopId: string) {
  revalidatePath('/ops');
  revalidatePath('/admin/syndication', 'layout');
  revalidatePath(`/admin/syndication/${rooftopId}`);
}

async function loadConnection(connectionId: string) {
  const rows = await db
    .select()
    .from(t.channelConnections)
    .where(eq(t.channelConnections.id, connectionId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * We have put this rooftop in the outbound file. Now it is the channel's move.
 *
 * Only from `AWAITING_DEALER`, and only once the dealer has actually confirmed.
 * Submitting a rooftop whose dealer has not yet named us to their rep is the
 * failure this whole lifecycle exists to prevent: the file goes out, nothing
 * happens at the far end, and three weeks later nobody can say whose turn it
 * was. If you genuinely need to override that, do it in SQL and write why in
 * the note.
 */
export async function markSubmitted(formData: FormData) {
  const connectionId = String(formData.get('connectionId') ?? '');
  await requireStaff();
  const conn = await loadConnection(connectionId);
  if (!conn) return;
  if (conn.status !== 'AWAITING_DEALER') return;
  if (!conn.dealerConfirmedAt) return;

  await db
    .update(t.channelConnections)
    .set({ status: 'SUBMITTED', submittedAt: new Date() })
    .where(eq(t.channelConnections.id, connectionId));

  refresh(conn.rooftopId);
}

/**
 * The destination confirmed it is carrying the inventory.
 *
 * `liveAt` closes the loop on the four timestamps the runbook wants reported on,
 * so this is the click that makes "how long does onboarding actually take"
 * answerable with a number.
 */
export async function markLive(formData: FormData) {
  const connectionId = String(formData.get('connectionId') ?? '');
  await requireStaff();
  const conn = await loadConnection(connectionId);
  if (!conn) return;
  if (conn.status !== 'SUBMITTED' && conn.status !== 'ERROR') return;

  await db
    .update(t.channelConnections)
    .set({ status: 'CONNECTED', liveAt: conn.liveAt ?? new Date(), errorMessage: null })
    .where(eq(t.channelConnections.id, connectionId));

  refresh(conn.rooftopId);
}

/** Something is wrong at the destination. `errorMessage` is shown to the dealer. */
export async function markError(formData: FormData) {
  const connectionId = String(formData.get('connectionId') ?? '');
  const message = String(formData.get('errorMessage') ?? '').trim();
  await requireStaff();
  const conn = await loadConnection(connectionId);
  if (!conn) return;

  await db
    .update(t.channelConnections)
    .set({ status: 'ERROR', errorMessage: message || 'We are looking into it.' })
    .where(eq(t.channelConnections.id, connectionId));

  refresh(conn.rooftopId);
}

/**
 * The two per-connection fields only we set.
 *
 * `providerDealerId` is blanked back to null rather than stored as an empty
 * string, because null is what means "use `rooftopId`" everywhere that reads it.
 * An empty string would sail through the `||` fallback in the CarGurus loader
 * today and break the moment somebody wrote `?? rooftopId` instead.
 */
export async function saveOpsFields(formData: FormData) {
  const connectionId = String(formData.get('connectionId') ?? '');
  const providerDealerId = String(formData.get('providerDealerId') ?? '').trim();
  const internalNote = String(formData.get('internalNote') ?? '').trim();
  await requireStaff();
  const conn = await loadConnection(connectionId);
  if (!conn) return;

  await db
    .update(t.channelConnections)
    .set({ providerDealerId: providerDealerId || null, internalNote })
    .where(eq(t.channelConnections.id, connectionId));

  refresh(conn.rooftopId);
}
