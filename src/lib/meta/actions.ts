'use server';

/**
 * Server actions for the Meta Ad Desk.
 *
 * TENANT SCOPING: the group comes from the session via `requireGroupId()` and is
 * never read off a form. The rooftop id *does* arrive off a form and is
 * therefore attacker-controlled, so it goes through
 * `assertRooftopInScope(await sessionScope(), id)` before anything is
 * provisioned against it — same rule as the vehicle and storefront write paths.
 * Without it, a crafted POST could point another dealer's lot at our feed.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { getSessionUser, requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import {
  STATE_COOKIE,
  adDeskConfigured,
  authorizeUrl,
  buildState,
  disconnect as tearDown,
  provisionRooftop,
} from './connect';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

/**
 * Start the connect flow.
 *
 * Mints the signed `state`, parks the matching nonce in an httpOnly cookie, and
 * bounces to Facebook. Ten minutes is plenty for a dealer to click through the
 * dialog and short enough that an abandoned attempt cannot be picked up later
 * from a shared machine at the dealership — which is the realistic threat here,
 * not a sophisticated attacker.
 */
export async function startMetaConnect(): Promise<void> {
  await requireGroupId(); // redirects to /login if signed out
  const groupId = await requireGroupId();

  if (!adDeskConfigured()) {
    redirect('/admin/ad-desk?err=' + encodeURIComponent('The Meta connection is not configured on this deployment yet.'));
  }

  const { state, nonce } = buildState(groupId);
  const url = authorizeUrl(state);
  if (!url) redirect('/admin/ad-desk?err=' + encodeURIComponent('Missing Meta login configuration.'));

  (await cookies()).set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // must survive the round trip back from facebook.com
    path: '/',
    maxAge: 600,
  });

  redirect(url!);
}

/**
 * Provision one lot: catalog, feed, pixel association.
 *
 * The Page and ad account are chosen by the dealer from what discovery found;
 * everything downstream of that is ours to arrange. A dealer who has never
 * heard the word "catalog" completes this by picking their lot's Facebook Page
 * from a dropdown.
 */
export async function provisionRooftopAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ catalogSource: string; feedOk: boolean }>> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  const str = (k: string) => {
    const v = formData.get(k);
    const s = v === null ? '' : String(v).trim();
    return s === '' ? null : s;
  };

  const result = await provisionRooftop({
    groupId,
    rooftopId,
    pageId: str('pageId'),
    pageName: str('pageName'),
    adAccountId: str('adAccountId'),
    adAccountName: str('adAccountName'),
    pixelId: str('pixelId'),
    dealerName: rooftop.name,
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath('/admin/ad-desk');
  return {
    ok: true,
    data: { catalogSource: result.catalogSource, feedOk: result.feedId !== null },
    message:
      result.catalogSource === 'CREATED'
        ? `Created a vehicles catalog for ${rooftop.name} and pointed it at your inventory.`
        : `Connected ${rooftop.name} to the vehicles catalog already in your Facebook business.`,
  };
}

/**
 * Disconnect. Revokes at Meta, keeps every asset in the dealer's business
 * intact, and clears our per-lot mapping so a later reconnect starts clean
 * rather than half-remembering a catalog that may have moved.
 */
export async function disconnectMeta(): Promise<ActionResult> {
  const groupId = await requireGroupId();
  const { revokedAtMeta } = await tearDown(groupId);

  const conn = await db
    .select({ id: t.metaConnections.id })
    .from(t.metaConnections)
    .where(eq(t.metaConnections.groupId, groupId))
    .limit(1);
  if (conn[0]) {
    await db.delete(t.metaRooftopAssets).where(eq(t.metaRooftopAssets.connectionId, conn[0].id));
  }

  revalidatePath('/admin/ad-desk');
  return {
    ok: true,
    message: revokedAtMeta
      ? 'Disconnected from Facebook. Your catalog, pixel and ad account are untouched and still yours.'
      : 'Disconnected on our side. Facebook did not confirm the revoke — you can also remove Rooftop under Business settings → Connected apps.',
  };
}

/**
 * Form-shaped wrapper around `disconnectMeta`.
 *
 * A `<form action={...}>` must resolve to void — React has nowhere to put a
 * return value on a plain form post. `disconnectMeta` returns an `ActionResult`
 * because it is also worth calling from a `useActionState` client component, so
 * this adapter swallows the shape and carries the outcome back through the URL
 * instead. Same result on screen, no client component required for one button.
 */
export async function disconnectMetaForm(): Promise<void> {
  const res = await disconnectMeta();
  const q = new URLSearchParams(
    res.ok ? { msg: res.message ?? 'Disconnected from Facebook.' } : { err: res.error },
  );
  redirect(`/admin/ad-desk?${q.toString()}`);
}

/** Used by the connect screen to show who did it, without a second query. */
export async function currentUserId(): Promise<string | null> {
  return (await getSessionUser())?.id ?? null;
}
