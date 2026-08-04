/**
 * Rooftop Auto — the smallest honest catalog campaign.
 *
 * WHAT THIS IS FOR, PLAINLY
 *
 * Three of the eight permissions we are asking Meta to review — `ads_management`,
 * `ads_read` and `pages_manage_ads` — cannot be demonstrated by the connect flow,
 * because the connect flow never creates an ad. App Review requires a screen
 * recording per permission showing the consent dialog, the action that uses the
 * permission, and the resulting state change; and it requires at least one
 * successful API call per permission before the request button un-greys. Neither
 * is satisfiable by code that does not exist.
 *
 * So this file builds one campaign, one ad set, one creative and one ad, and
 * then reads the result back. It is the *minimum* that is true, not a product.
 * The Lot Walk aging buckets pick the inventory, the dealer's Page carries the
 * creative, and everything lands PAUSED.
 *
 * THINGS LEARNED THE HARD WAY, PRESERVED HERE
 *
 * **`special_ad_categories: ['CREDIT']` will fail the call.** Meta replaced
 * CREDIT with FINANCIAL_PRODUCTS_SERVICES on 14 Jan 2025 and is explicit that
 * "if an ad is created with the CREDIT category after January 14, the API call
 * will fail, and will be blocked with an error message." `claude/meta-ad-desk-build.md`
 * §6 and the App Review runbook both still say CREDIT — they predate the check
 * and are wrong. The two cannot be set together, and setting either one requires
 * `special_ad_category_country`, which is easy to miss because the error does
 * not name it.
 *
 * **A plain inventory listing is not a financial-products ad.** The category
 * attaches to what the creative *says*, not to the vertical. An ad that shows a
 * price is a listing; an ad that shows a monthly payment, a lease offer or a
 * trade-in value is credit-adjacent and must declare it. Declaring it costs
 * real targeting range — no age or gender, no ZIP-level geography, minimum
 * 15-mile radius, no lookalikes — so declaring it defensively "to be safe" is
 * not free and is not safe. This module defaults to NONE and takes the category
 * as an argument.
 *
 * **The objective name is contested and we try both.** `PRODUCT_CATALOG_SALES`
 * is still in the v25.0 enum and is still what Meta's own automotive guides use
 * in their examples, but it was deprecated in v17.0 in favour of the ODAX
 * `OUTCOME_SALES`, and Meta's vertical docs have not been migrated. Rather than
 * bet the demo on which one the API accepts today, we send the modern value and
 * fall back once. Which one worked is reported back and is worth knowing.
 *
 * **Everything is PAUSED and the ad account is a sandbox.** A sandbox ad
 * account takes no payment method and never delivers, so this costs nothing and
 * cannot accidentally spend a dealer's money. The cost of that is that Insights
 * returns no rows — Meta's own 2023 note says "no spend, clicks or impressions
 * are generated and there are no insights to be evaluated." A demo that depends
 * on a non-zero number would therefore be a demo that lies; `readInsights`
 * below reports an empty result as an empty result.
 */

import 'server-only';
import { MetaApiError, graph, graphEdge } from './graph';

/* -------------------------------------------------------------- objective */

/**
 * Modern first, legacy second. Meta's enum still lists the legacy value and its
 * automotive guides still use it, so one retry resolves a documented ambiguity
 * far more cheaply than guessing.
 */
const OBJECTIVES = ['OUTCOME_SALES', 'PRODUCT_CATALOG_SALES'] as const;
export type CampaignObjective = (typeof OBJECTIVES)[number];

export type SpecialAdCategory = 'NONE' | 'FINANCIAL_PRODUCTS_SERVICES';

/* ---------------------------------------------------------- product sets */

/**
 * The aging buckets, as catalog filters.
 *
 * These are the same boundaries `AGING_BUCKETS` in `src/lib/domain.ts` uses, and
 * that is the whole point of the exercise: the lot already argues about the
 * 46–60 shelf every Monday, so the ad set that spends money on it should be
 * defined by the same number rather than by a marketer's guess.
 *
 * Filtering on `days_on_lot` rather than on `custom_label_0` is deliberate.
 * Both are in the feed and both are filterable, but `days_on_lot` is numeric,
 * so `gte`/`lte` work on it and a bucket boundary can move without a full feed
 * re-ingest. `custom_label_0` carries the same information as a readable label
 * for the human looking at Commerce Manager.
 */
export const CAMPAIGN_BUCKETS = [
  { key: 'age_31_45', label: '31–45 days', min: 31, max: 45 },
  { key: 'age_46_60', label: '46–60 days', min: 46, max: 60 },
  { key: 'age_61_plus', label: '61+ days', min: 61, max: null },
] as const;

export type BucketKey = (typeof CAMPAIGN_BUCKETS)[number]['key'];

export function bucketFilter(bucket: (typeof CAMPAIGN_BUCKETS)[number]) {
  const clauses: Record<string, unknown>[] = [
    { availability: { eq: 'available' } },
    // Only units the feed marked Marketplace-clean. Without this the ad set
    // happily targets vehicles Meta will refuse to show on the surface the
    // dealer actually asked for, and the money goes somewhere they did not
    // choose. See `src/lib/meta/feed-spec.ts`.
    { custom_label_1: { eq: 'mkt_ok' } },
    { days_on_lot: { gte: bucket.min } },
  ];
  if (bucket.max != null) clauses.push({ days_on_lot: { lte: bucket.max } });
  return { and: clauses };
}

export type ProductSetResult = { id: string; name: string; adopted: boolean };

/**
 * Adopt-or-create, same as every other provisioning step in this codebase. A
 * demo run twice must not leave two identical product sets behind — the dealer
 * has to live in that Commerce Manager afterwards.
 */
export async function ensureProductSet(
  token: string,
  catalogId: string,
  bucket: (typeof CAMPAIGN_BUCKETS)[number],
  dealerName: string,
): Promise<ProductSetResult> {
  const name = `Rooftop — ${dealerName} — ${bucket.label}`.slice(0, 90);

  const existing = await graphEdge<{ id: string; name?: string }>(`/${catalogId}/product_sets`, {
    token,
    fields: 'id,name',
  });
  const mine = existing.find((s) => s.name === name);
  if (mine) return { id: mine.id, name, adopted: true };

  const created = await graph<{ id: string }>(`/${catalogId}/product_sets`, {
    method: 'POST',
    token,
    params: { name, filter: JSON.stringify(bucketFilter(bucket)) },
  });
  return { id: created.id, name, adopted: false };
}

/* ------------------------------------------------------------- the build */

export type DemoCampaignInput = {
  token: string;
  /** `act_<id>`. A sandbox account, created under Marketing API → Tools. */
  adAccountId: string;
  catalogId: string;
  /** The dealer's Page. This is the field that exercises `pages_manage_ads`. */
  pageId: string;
  dealerName: string;
  bucket?: BucketKey;
  specialAdCategory?: SpecialAdCategory;
  /** ISO-3166 alpha-2. Required by Meta whenever the category is not NONE. */
  specialAdCategoryCountry?: string;
  /** Where clicks land. The VDP list for the lot, from the storefront. */
  landingUrl: string;
};

export type DemoCampaignResult = {
  objectiveUsed: CampaignObjective;
  campaignId: string;
  productSet: ProductSetResult;
  adSetId: string;
  creativeId: string;
  adId: string;
  /** Every unit is PAUSED. Stated in the result so a screencast can show it. */
  status: 'PAUSED';
};

/**
 * Normalise `act_` prefixing. Meta returns ad account ids both ways depending on
 * the edge, and `act_act_123` is a 400 that reads like a permissions problem.
 */
function actPath(adAccountId: string): string {
  const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  return `/${id}`;
}

export async function createDemoCampaign(input: DemoCampaignInput): Promise<DemoCampaignResult> {
  const {
    token,
    catalogId,
    pageId,
    dealerName,
    landingUrl,
    specialAdCategory = 'NONE',
    specialAdCategoryCountry = 'US',
  } = input;

  const act = actPath(input.adAccountId);
  const bucketKey = input.bucket ?? 'age_46_60';
  const bucket = CAMPAIGN_BUCKETS.find((b) => b.key === bucketKey) ?? CAMPAIGN_BUCKETS[1];

  const productSet = await ensureProductSet(token, catalogId, bucket, dealerName);

  /* --------------------------------------------------------- 1. campaign */

  const categoryParams =
    specialAdCategory === 'NONE'
      ? { special_ad_categories: JSON.stringify(['NONE']) }
      : {
          special_ad_categories: JSON.stringify([specialAdCategory]),
          // Meta rejects the category without this and the error does not say so.
          special_ad_category_country: JSON.stringify([specialAdCategoryCountry]),
        };

  let campaignId = '';
  let objectiveUsed: CampaignObjective = OBJECTIVES[0];
  let lastError: unknown = null;

  for (const objective of OBJECTIVES) {
    try {
      const created = await graph<{ id: string }>(`${act}/campaigns`, {
        method: 'POST',
        token,
        params: {
          name: `Rooftop — ${dealerName} — ${bucket.label} inventory`.slice(0, 100),
          objective,
          status: 'PAUSED',
          promoted_object: JSON.stringify({ product_catalog_id: catalogId }),
          ...categoryParams,
        },
      });
      campaignId = created.id;
      objectiveUsed = objective;
      break;
    } catch (err) {
      lastError = err;
      // Only an objective rejection is worth retrying. A permissions failure or
      // a rate limit means the second attempt fails identically and we would
      // just have doubled the error rate on an app whose Marketing API tier
      // upgrade depends on staying under 15%.
      if (!isObjectiveRejection(err)) throw err;
    }
  }
  if (!campaignId) throw lastError ?? new Error('Campaign creation failed.');

  /* ---------------------------------------------------------- 2. ad set */

  /*
   * `LINK_CLICKS` rather than `OFFSITE_CONVERSIONS`, on purpose.
   *
   * Conversion optimisation needs a pixel with signal behind it. On a sandbox
   * account with no delivery there is none, and the ad set either fails
   * validation or enters a learning phase that will never leave. Link clicks is
   * the honest optimisation goal for a demo, and it is the one the resulting
   * screencast can describe without overstating what was built.
   *
   * `marketplace` is in `facebook_positions` because it is open to everyone —
   * no allowlist, no partnership, no spend threshold (see
   * `claude/meta-marketplace.md` §2). This is the line that makes "your
   * inventory in Facebook Marketplace" a true sentence.
   */
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: ['US'] },
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'marketplace', 'search'],
    instagram_positions: ['stream', 'explore'],
  };

  const adSet = await graph<{ id: string }>(`${act}/adsets`, {
    method: 'POST',
    token,
    params: {
      name: `${bucket.label} — prospecting`,
      campaign_id: campaignId,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      destination_type: 'WEBSITE',
      daily_budget: '1000', // $10.00, in account currency minor units. Never spent.
      promoted_object: JSON.stringify({ product_set_id: productSet.id }),
      targeting: JSON.stringify(targeting),
      status: 'PAUSED',
    },
  });

  /* -------------------------------------------------------- 3. creative */

  /*
   * `template_data`, not `link_data` — that is the whole difference between a
   * dynamic catalog ad and a static one. The strings below are templates Meta
   * interpolates per vehicle at render time, so one creative covers the entire
   * product set rather than one car.
   *
   * `page_id` is the permission-bearing field: an ad cannot reference a Page
   * we have not been granted rights to run ads from, which is precisely what
   * `pages_manage_ads` grants and precisely what its screencast has to show.
   */
  const creative = await graph<{ id: string }>(`${act}/adcreatives`, {
    method: 'POST',
    token,
    params: {
      name: `Rooftop — ${dealerName} — dynamic vehicle creative`.slice(0, 100),
      product_set_id: productSet.id,
      object_story_spec: JSON.stringify({
        page_id: pageId,
        template_data: {
          link: landingUrl,
          message: `Now at ${dealerName}.`,
          name: '{{vehicle.year}} {{vehicle.make}} {{vehicle.model}}',
          description: '{{vehicle.price}}',
          call_to_action: { type: 'LEARN_MORE' },
        },
      }),
      template_url_spec: JSON.stringify({
        web: { url: `${landingUrl}?utm_source=meta&utm_medium=aia&stock={{vehicle.stock_number}}` },
      }),
    },
  });

  /* ------------------------------------------------------------- 4. ad */

  const ad = await graph<{ id: string }>(`${act}/ads`, {
    method: 'POST',
    token,
    params: {
      name: `${bucket.label} — dynamic`,
      adset_id: adSet.id,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: 'PAUSED',
    },
  });

  return {
    objectiveUsed,
    campaignId,
    productSet,
    adSetId: adSet.id,
    creativeId: creative.id,
    adId: ad.id,
    status: 'PAUSED',
  };
}

/**
 * Meta signals a bad enum value with error code 100 and a subcode that varies.
 * Matching on the message is unpleasant but the alternative is retrying every
 * failure, which is worse — see the note at the call site about error rates.
 */
function isObjectiveRejection(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  const text = `${err.message}`.toLowerCase();
  return text.includes('objective');
}

/* --------------------------------------------------------------- reading */

export type InsightsRow = {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  date_start?: string;
  date_stop?: string;
};

export type InsightsResult = {
  rows: InsightsRow[];
  /**
   * True when the read succeeded and returned nothing, which on a sandbox
   * account is the *expected* outcome rather than a failure. The distinction
   * matters: "we read your spend and it is zero because these ads have never
   * run" and "we could not read your spend" are different sentences, and only
   * one of them is honest about a sandbox.
   */
  emptyByDesign: boolean;
};

/**
 * The `ads_read` half. Separate from creation on purpose — App Review wants a
 * distinct recording of the permission being *used*, and reading spend back
 * into a report is the use.
 */
export async function readInsights(
  token: string,
  campaignId: string,
): Promise<InsightsResult> {
  const rows = await graphEdge<InsightsRow>(`/${campaignId}/insights`, {
    token,
    fields: 'spend,impressions,clicks,ctr,cpc,date_start,date_stop',
    params: { date_preset: 'maximum' },
  });
  return { rows, emptyByDesign: rows.length === 0 };
}
