'use server';

/**
 * Lot Walk — the human half of the interaction grammar.
 *
 * Facebook's grammar, none of its chrome: react, comment, post. Every action
 * here resolves the event through the tenant scope first, so a crafted event
 * id from another dealer's feed is a no-op rather than a comment on their
 * inventory.
 */

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { assertFeedEventInScope, sessionScope } from '@/lib/queries';
import { emitFeedEvent } from '@/lib/feed';
import { isAtRisk, daysInStock, totalCost, usd } from '@/lib/domain';

function refreshFeed() {
  revalidatePath('/admin', 'layout');
}

/** 👍 / 🔥 on, or off again. The unique index is the toggle. */
export async function toggleReaction(formData: FormData) {
  const eventId = String(formData.get('eventId') ?? '');
  const kind = String(formData.get('kind') ?? '') as t.FeedReactionKind;
  if (kind !== 'THUMB' && kind !== 'FIRE') return;

  const me = await requireSession();
  const scope = await sessionScope();
  if (!(await assertFeedEventInScope(scope, eventId))) return;

  const existing = await db
    .select({ id: t.feedReactions.id })
    .from(t.feedReactions)
    .where(
      and(
        eq(t.feedReactions.eventId, eventId),
        eq(t.feedReactions.userId, me.id),
        eq(t.feedReactions.kind, kind),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db.delete(t.feedReactions).where(eq(t.feedReactions.id, existing[0].id));
  } else {
    await db
      .insert(t.feedReactions)
      .values({ eventId, userId: me.id, kind })
      .onConflictDoNothing();
  }

  refreshFeed();
}

export async function addComment(formData: FormData) {
  const eventId = String(formData.get('eventId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (!body) return;

  const me = await requireSession();
  const scope = await sessionScope();
  if (!(await assertFeedEventInScope(scope, eventId))) return;

  await db.insert(t.feedComments).values({ eventId, userId: me.id, body: body.slice(0, 2000) });
  refreshFeed();
}

/**
 * A human post to the lot.
 *
 * Even here the card carries a number — the composer does not ask the user for
 * one, the system attaches the state of the lot at the moment it was written.
 * That is the rule from section 2 held to honestly: a card without a number is
 * activity theater, and a human typing "detail bay is down" is still a fact
 * about a lot with money sitting on it.
 */
export async function postNote(formData: FormData) {
  const body = String(formData.get('body') ?? '').trim();
  const rooftopId = String(formData.get('rooftopId') ?? '');
  if (!body) return;

  const me = await requireSession();
  const scope = await sessionScope();
  const target = scope.rooftopIds.includes(rooftopId) ? rooftopId : scope.rooftopIds[0];
  if (!target) return;

  const LIVE = ['ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'] as const;
  const inventory = await db
    .select()
    .from(t.vehicles)
    .where(and(eq(t.vehicles.rooftopId, target), inArray(t.vehicles.status, LIVE)));

  const atRisk = inventory.filter((v) => isAtRisk(daysInStock(v))).length;
  const tiedUp = inventory.reduce((s, v) => s + totalCost(v), 0);

  // First line is the headline, the rest is the body — the same shape a system
  // card has, so a human post does not look like a different species.
  const [firstLine, ...rest] = body.split('\n');

  await emitFeedEvent({
    rooftopId: target,
    kind: 'note',
    actorId: me.id,
    title: (firstLine ?? body).slice(0, 200),
    body: rest.join('\n').trim(),
    stats: [
      { k: 'On the lot', v: String(inventory.length) },
      { k: 'At risk', v: String(atRisk), bad: atRisk > 0 },
      { k: 'Tied up', v: usd(tiedUp) },
    ],
  });

  refreshFeed();
}

/** Which screen this user lands on. Per-user, not per-tenant. */
export async function setHomeView(formData: FormData) {
  const view = String(formData.get('view') ?? '') as t.HomeView;
  if (view !== 'FEED' && view !== 'DASHBOARD') return;
  const me = await requireSession();
  await db.update(t.users).set({ homeView: view }).where(eq(t.users.id, me.id));
  revalidatePath('/admin', 'layout');
}
