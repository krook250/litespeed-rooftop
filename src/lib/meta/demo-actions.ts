'use server';

/**
 * Server actions for the two things App Review needs to *see*.
 *
 * Kept out of `actions.ts` deliberately. That file is the connect flow, which is
 * product; this file is a demonstration harness that exists because Meta
 * requires a working screencast of every permission it reviews. Mixing them
 * would make it hard to tell later which code a dealer actually depends on.
 *
 * Same tenant rule as everything else here: the group comes from the session,
 * the rooftop id arrives off a form and is therefore checked against
 * `sessionScope()` before it is used for anything.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { MetaApiError } from './graph';
import { noteFailure, tokenFor } from './connect';
import {
  CAMPAIGN_BUCKETS,
  createDemoCampaign,
  readInsights,
  type BucketKey,
  type DemoCampaignResult,
  type InsightsResult,
} from './campaigns';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

/* ---------------------------------------------------------- the campaign */

export async function createDemoCampaignAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<DemoCampaignResult>> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const bucket = String(formData.get('bucket') ?? 'age_46_60') as BucketKey;

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  if (!CAMPAIGN_BUCKETS.some((b) => b.key === bucket)) {
    return { ok: false, error: 'Pick one of the aging buckets.' };
  }

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected. Connect it first.' };

  const rows = await db
    .select()
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftopId))
    .limit(1);
  const asset = rows[0];

  // Each of these is a distinct thing the dealer has to go and do, so each gets
  // its own sentence rather than one "setup incomplete".
  if (!asset?.catalogId) {
    return { ok: false, error: 'This lot has no vehicles catalog yet. Run Set up this lot first.' };
  }
  if (!asset.adAccountId) {
    return { ok: false, error: 'Pick an ad account for this lot first — a campaign has to live in one.' };
  }
  if (!asset.pageId) {
    return { ok: false, error: 'Pick this lot’s Facebook Page first — the ad runs from it.' };
  }

  try {
    const result = await createDemoCampaign({
      token: conn.token,
      adAccountId: asset.adAccountId,
      catalogId: asset.catalogId,
      pageId: asset.pageId,
      dealerName: rooftop.name,
      bucket,
      landingUrl: await inventoryUrlFor(rooftopId),
    });

    revalidatePath('/admin/ad-desk');
    return {
      ok: true,
      data: result,
      message:
        `Created a paused campaign for ${rooftop.name} targeting the ` +
        `${CAMPAIGN_BUCKETS.find((b) => b.key === bucket)?.label} shelf. ` +
        'Nothing is running and nothing will spend until you turn it on in Ads Manager.',
    };
  } catch (err) {
    await noteFailure(groupId, err);
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }
}

/* ----------------------------------------------------------- the reading */

export async function readCampaignInsightsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<InsightsResult>> {
  const groupId = await requireGroupId();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  if (!campaignId) return { ok: false, error: 'No campaign to read.' };

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected.' };

  try {
    const result = await readInsights(conn.token, campaignId);
    return {
      ok: true,
      data: result,
      message: result.emptyByDesign
        ? 'Read back from Facebook: no spend, impressions or clicks. Expected — this campaign is paused and the ad account is a sandbox, so it has never delivered.'
        : `Read back ${result.rows.length} row(s) of delivery from Facebook.`,
    };
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }
}

/* ----------------------------------------------------------------- utils */

/**
 * The lot's public inventory page — where a catalog ad's click lands.
 *
 * Deliberately not shared with `siteBaseFor` in the feed route, which does the
 * same lookup. That one runs unauthenticated, driven by a URL secret; this one
 * runs inside a session. Merging them would mean one caller reaching for a
 * helper written under the other's trust assumptions, and the feed route is not
 * a place to be casual about that.
 *
 * Not exported: everything a `'use server'` module exports becomes a callable
 * endpoint, and this is a private helper.
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
