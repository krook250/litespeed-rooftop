'use server';

/**
 * The dealer's half of a channel connection.
 *
 * `claude/syndication-onboarding-runbook.md` splits the middle of the lifecycle
 * into two waits — one on the dealer, one on the destination — because they are
 * different sentences and different queues. This file holds the only two
 * transitions the dealer can drive. Everything else in the lifecycle is ours,
 * and none of it belongs on a dealer-facing screen.
 *
 * Neither action can be taken on behalf of another tenant: both resolve the
 * connection through `getConnectionInScope` first, so a crafted connection id
 * is a no-op rather than a state change on somebody else's account.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { getConnectionInScope } from '@/lib/scoped-db';

function refresh(connectionId: string) {
  revalidatePath('/admin/syndication');
  revalidatePath(`/admin/syndication/${connectionId}`);
}

/**
 * "Set this channel up for me."
 *
 * Moves PENDING_SETUP → AWAITING_DEALER and starts the clock. `requestedAt` is
 * the first of the four timestamps the runbook wants reported on, and it is the
 * one that makes "how long does onboarding actually take" answerable with a
 * number after ten dealers instead of a feeling.
 *
 * Only valid from PENDING_SETUP. Re-requesting a connection that is already
 * moving would reset the clock and erase exactly the measurement we are trying
 * to collect.
 */
export async function requestConnection(formData: FormData) {
  const connectionId = String(formData.get('connectionId') ?? '');
  await requireSession();
  const scope = await sessionScope();
  const row = await getConnectionInScope(scope, connectionId);
  if (!row) return;
  if (row.channel_connections.status !== 'PENDING_SETUP') return;

  await db
    .update(t.channelConnections)
    .set({ status: 'AWAITING_DEALER', requestedAt: new Date() })
    .where(eq(t.channelConnections.id, connectionId));

  refresh(connectionId);
}

/**
 * "I hold a paid account here, and I have emailed my rep."
 *
 * Stamps `dealerConfirmedAt` and deliberately leaves `status` alone.
 *
 * THE STATUS DOES NOT ADVANCE HERE, AND THAT IS THE POINT. `SUBMITTED` means
 * *we* have put this rooftop in the outbound file — it is our claim to make,
 * not the dealer's. So the dealer's completion is recorded as a timestamp and
 * the connection stays in AWAITING_DEALER until someone on our side actually
 * does the work. The screen reads the timestamp rather than the status to
 * decide what to tell them, so a dealer who has done their part is never still
 * being told "waiting on you".
 *
 * That also gives the onboarding queue its most useful filter for free:
 * AWAITING_DEALER *with* `dealerConfirmedAt` set is the ready-to-submit pile,
 * and without it is the chase-them pile.
 *
 * The paid-account confirmation is an attested fact, not a verified one. No API
 * in this category will tell us whether a dealer's CarGurus account is current,
 * so the button says what it is attesting to and the timestamp records who
 * clicked it and when.
 */
export async function confirmDealerAccount(formData: FormData) {
  const connectionId = String(formData.get('connectionId') ?? '');
  const me = await requireSession();
  const scope = await sessionScope();
  const row = await getConnectionInScope(scope, connectionId);
  if (!row) return;

  const conn = row.channel_connections;
  if (conn.status !== 'AWAITING_DEALER') return;
  // Idempotent. A second click must not move the timestamp, or the onboarding
  // duration we report gets quietly better every time someone refreshes.
  if (conn.dealerConfirmedAt) return;

  await db
    .update(t.channelConnections)
    .set({
      dealerConfirmedAt: new Date(),
      // internalNote is never rendered dealer-side. Recording who attested is
      // the whole reason this is worth writing down.
      internalNote: [conn.internalNote, `Confirmed by ${me.name} <${me.email}>`]
        .filter(Boolean)
        .join(' · '),
    })
    .where(eq(t.channelConnections.id, connectionId));

  refresh(connectionId);
}
