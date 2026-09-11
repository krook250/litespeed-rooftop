import 'server-only';

/**
 * Building a campaign for one lot, with the authorization decision left to the
 * caller.
 *
 * THIS MODULE DELIBERATELY DOES NOT CHECK WHO YOU ARE.
 *
 * There are two callers and they answer "may this person touch this lot?"
 * differently, which is the whole reason this is not a server action:
 *
 *   - `src/lib/meta/demo-actions.ts` — the dealer, scoped by `sessionScope()`.
 *   - `src/lib/ops/ad-desk-actions.ts` — Rooftop staff, scoped by `requireStaff()`
 *     plus an explicit check that the rooftop belongs to the group named on the
 *     form.
 *
 * So this takes an **already-resolved rooftop row**, not an id. Passing a row
 * means the caller has necessarily already loaded it through whichever guard
 * applies to it, and there is no id-shaped string here that could arrive off a
 * form and be trusted. A `'use server'` module cannot express that: everything
 * it exports becomes a POST endpoint reachable by anyone who can guess the id.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { MetaApiError, graph } from './graph';
import { noteFailure, tokenFor } from './connect';
import {
  campaignNamePrefix,
  createDemoCampaign,
  listLotCampaigns,
  setCampaignRunning,
  type DemoCampaignResult,
  type RunOutcome,
} from './campaigns';
import { bucketByKey, isBucketKey, type BucketKey } from './buckets';
import { adCopyForRooftop } from './ad-copy';

export type BuildCampaignOutcome =
  | { ok: true; data: DemoCampaignResult; message: string }
  | { ok: false; error: string };

export type BuildCampaignInput = {
  groupId: string;
  /** Already loaded through the caller's own guard. Never resolved from a form id here. */
  rooftop: typeof t.rooftops.$inferSelect;
  bucket: BucketKey;
  dailyBudgetUsd: number;
  radiusMiles: number;
};

/** Shared by both callers so the dealer and the operator cannot drift apart. */
export function validateCampaignInput(
  bucket: string,
  dailyBudgetUsd: number,
  radiusMiles: number,
): string | null {
  if (!isBucketKey(bucket)) return 'Pick one of the shelves.';
  if (!Number.isFinite(dailyBudgetUsd) || dailyBudgetUsd < 10) return 'Daily budget has to be at least $10.';
  if (!Number.isFinite(radiusMiles) || radiusMiles < 5 || radiusMiles > 50) {
    return 'Radius has to be between 5 and 50 miles. That is Facebook’s range, not ours.';
  }
  return null;
}

export async function buildCampaignForRooftop(input: BuildCampaignInput): Promise<BuildCampaignOutcome> {
  const { groupId, rooftop, bucket, dailyBudgetUsd, radiusMiles } = input;

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected for this dealer.' };

  const rows = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftop.id))
    .limit(1);
  const asset = rows[0];

  // Each of these is a distinct thing somebody has to go and do, so each gets
  // its own sentence rather than one "setup incomplete".
  if (!asset?.catalogId) {
    return { ok: false, error: 'This lot has no vehicles catalog yet. Run Set up this lot first.' };
  }
  if (!asset.adAccountId) {
    return { ok: false, error: 'This lot has no ad account picked — a campaign has to live in one.' };
  }
  if (!asset.pageId) {
    return { ok: false, error: 'This lot has no Facebook Page picked — the ad runs from it.' };
  }
  /*
   * No coordinates, no campaign.
   *
   * `createDemoCampaign` falls back to `countries: ['US']` when the lot has no
   * lat/long, which was harmless against an ad account that could not spend and
   * is not harmless now. A nationwide used-car campaign is a mistake the dealer
   * discovers on an invoice, so it is refused here rather than built and
   * explained afterwards. Coordinates arrived as NULL columns in
   * `0007_odd_big_bertha` and there is still no screen for them.
   */
  if (rooftop.latitude === null || rooftop.longitude === null) {
    return {
      ok: false,
      error:
        'This lot has no map coordinates, and without them the ad would target the whole country. ' +
        'Set latitude and longitude on the lot first.',
    };
  }

  try {
    const result = await createDemoCampaign({
      token: conn.token,
      adAccountId: asset.adAccountId,
      catalogId: asset.catalogId,
      pageId: asset.pageId,
      dealerName: rooftop.name,
      bucket,
      lat: rooftop.latitude,
      lng: rooftop.longitude,
      radiusMiles,
      dailyBudgetUsd,
      // One ad per active variant, all inside the one ad set. Falls back to the
      // hardcoded default when the dealer has never opened the copy editor.
      adCopies: await adCopyForRooftop(rooftop.id, rooftop.name),
      landingUrl: await inventoryUrlFor(rooftop.id),
    });

    return {
      ok: true,
      data: result,
      message:
        `Built a paused campaign for ${rooftop.name} targeting the ` +
        `${bucketByKey(bucket).label} shelf — ` +
        `$${dailyBudgetUsd} a day, ${radiusMiles} miles around the lot. ` +
        'It is paused — nothing is running and nothing will spend until it is started.',
    };
  } catch (err) {
    await noteFailure(groupId, err);
    if (err instanceof MetaApiError) {
      // The transport logs Meta's words; this logs which objects we were
      // pointing at. A campaign build touches four ids and the failure never
      // says which one Meta objected to.
      console.error(
        '[meta] buildCampaignForRooftop failed ' +
          JSON.stringify({
            groupId,
            rooftopId: rooftop.id,
            bucket,
            dailyBudgetUsd,
            radiusMiles,
            adAccountId: asset.adAccountId,
            catalogId: asset.catalogId,
            pageId: asset.pageId,
            kind: err.kind,
            status: err.status,
            code: err.code,
            subcode: err.subcode,
            message: err.message,
            trace: err.traceId,
          }),
      );
      return { ok: false, error: err.dealerMessage };
    }
    console.error('[meta] buildCampaignForRooftop threw a non-Graph error', err);
    throw err;
  }
}

/* --------------------------------------------------------- start and stop */

export type RunCampaignInput = {
  groupId: string;
  /** Already loaded through the caller's own guard, exactly as above. */
  rooftop: typeof t.rooftops.$inferSelect;
  campaignId: string;
  running: boolean;
};

/**
 * Start or stop one campaign, for a caller that has already established who is
 * asking.
 *
 * THE CAMPAIGN ID ARRIVES OFF A FORM, so unlike everything else here it cannot
 * be trusted as given. Two checks before anything is written, and both matter:
 *
 *   1. The campaign must live in THIS LOT'S ad account. Without it, a signed-in
 *      dealer could post any campaign id in the world and toggle somebody
 *      else's ads. `account_id` comes back bare, so it is compared against the
 *      stored `act_` id with the prefix stripped from both.
 *   2. Its name must carry this lot's Rooftop prefix. That keeps us off
 *      campaigns the dealer built by hand in Ads Manager, which are theirs and
 *      which we have no business starting or stopping from here.
 *
 * A campaign failing either check is reported as not found rather than as
 * forbidden, because the two are the same fact from the caller's side and the
 * difference is only useful to somebody probing.
 */
export async function runCampaignForRooftop(input: RunCampaignInput): Promise<RunOutcome> {
  const { groupId, rooftop, campaignId, running } = input;

  if (!/^\d+$/.test(campaignId)) return { ok: false, error: 'That campaign was not found.' };

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected for this dealer.' };

  const rows = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftop.id))
    .limit(1);
  const asset = rows[0];
  if (!asset?.adAccountId) return { ok: false, error: 'This lot has no ad account.' };

  let campaign: { id: string; name?: string; account_id?: string };
  try {
    campaign = await graph<{ id: string; name?: string; account_id?: string }>(`/${campaignId}`, {
      token: conn.token,
      params: { fields: 'id,name,account_id' },
    });
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }

  const storedAccount = asset.adAccountId.replace(/^act_/, '');
  if ((campaign.account_id ?? '') !== storedAccount) {
    return { ok: false, error: 'That campaign was not found on this lot.' };
  }
  if (!(campaign.name ?? '').startsWith(campaignNamePrefix(rooftop.name))) {
    return {
      ok: false,
      error: 'That campaign was not built by Rooftop, so it is not ours to start or stop.',
    };
  }

  return setCampaignRunning(conn.token, campaignId, running);
}

/**
 * The lot's public inventory page — where a catalog ad's click lands.
 *
 * Deliberately not shared with `siteBaseFor` in the feed route, which does the
 * same lookup. That one runs unauthenticated, driven by a URL secret; this one
 * runs behind a guard. Merging them would mean one caller reaching for a helper
 * written under the other's trust assumptions, and the feed route is not a place
 * to be casual about that.
 */
async function inventoryUrlFor(rooftopId: string): Promise<string> {
  const rows = await db
    .select({
      slug: t.storefronts.slug,
      domain: t.storefronts.domain,
      status: t.storefronts.domainStatus,
    })
    .from(t.storefrontRooftops)
    .innerJoin(t.storefronts, eq(t.storefrontRooftops.storefrontId, t.storefronts.id))
    .where(eq(t.storefrontRooftops.rooftopId, rooftopId));

  const origin = `https://${process.env.NEXT_PUBLIC_APP_HOST ?? 'app.rooftopauto.com'}`;
  if (!rows.length) return origin;

  const live = rows.find((r) => r.domain && r.status === 'LIVE');
  if (live?.domain) return `https://${live.domain}`;
  return `${origin}/s/${rows[0]!.slug}`;
}

/* ------------------------------------------------------- pushing an edit */

export type RefreshOutcome =
  | { ok: true; updated: number; message: string }
  | { ok: false; error: string };

/**
 * Put the lot's current ad copy onto every campaign it already has.
 *
 * WHY THIS EXISTS RATHER THAN "PRESS BUILD AGAIN". Build already does the right
 * thing — it adopts the campaign, updates the ad set, and repoints the ads at
 * fresh creatives — but it lives in a different panel, under a word that means
 * "make something new", and asks for a shelf, a budget and a radius the dealer
 * already chose. Somebody who just rewrote a headline should not have to
 * re-answer three questions to see it go live, and will not connect "Build" with
 * "apply my edit".
 *
 * So this reads each existing campaign's shelf, budget and radius back FROM
 * META and rebuilds with exactly those, changing only what the copy changed.
 * Nothing is stored on our side to drift out of sync, and a campaign whose name
 * no longer matches our convention — one the dealer renamed and took over in Ads
 * Manager — is skipped rather than rewritten.
 *
 * **It does not start or stop anything.** A running campaign keeps running with
 * new words; a stopped one stays stopped. Editing text must never be the thing
 * that changes what is spending.
 */
export async function refreshAdsForRooftop(input: {
  groupId: string;
  rooftop: typeof t.rooftops.$inferSelect;
}): Promise<RefreshOutcome> {
  const { groupId, rooftop } = input;

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected for this dealer.' };

  const rows = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftop.id))
    .limit(1);
  const asset = rows[0];
  if (!asset?.adAccountId) return { ok: false, error: 'This lot has no ad account.' };

  let campaigns;
  try {
    campaigns = await listLotCampaigns(conn.token, asset.adAccountId, rooftop.name);
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }

  const rebuildable = campaigns.filter((c) => c.bucketKey);
  if (!rebuildable.length) {
    return {
      ok: false,
      error:
        'There is no campaign to update yet. Build one below and it will use what you just wrote.',
    };
  }

  let updated = 0;
  let lastError: string | null = null;

  for (const c of rebuildable) {
    const outcome = await buildCampaignForRooftop({
      groupId,
      rooftop,
      bucket: c.bucketKey!,
      // Read back rather than defaulted: a dealer who set $75 a day does not
      // want an edit to their headline quietly resetting it to $25.
      dailyBudgetUsd: c.dailyBudgetUsd ?? 25,
      radiusMiles: c.radiusMiles ?? 25,
    });
    if (outcome.ok) updated += 1;
    else lastError = outcome.error;
  }

  if (!updated) return { ok: false, error: lastError ?? 'Facebook would not accept the update.' };

  return {
    ok: true,
    updated,
    message:
      updated === 1
        ? 'Your ad is updated. Check it under See the ad.'
        : `${updated} campaigns updated. Check them under See the ad.`,
  };
}
