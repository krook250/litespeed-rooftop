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
import { MetaApiError } from './graph';
import { noteFailure, tokenFor } from './connect';
import { createDemoCampaign, type DemoCampaignResult } from './campaigns';
import { bucketByKey, isBucketKey, type BucketKey } from './buckets';

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
