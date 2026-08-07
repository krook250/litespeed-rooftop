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
 * **Everything is PAUSED and the ad account has no payment method.** A paused
 * campaign in an unfunded account cannot deliver, so this costs nothing and
 * cannot accidentally spend a dealer's money.
 *
 * We deliberately do NOT use a Marketing API sandbox account, despite it being
 * the obvious choice: Meta's 2023 note on the re-enabled sandbox says Insights
 * "is currently not supported… there are no insights to be evaluated", which
 * would break `readInsights` and the `ads_read` demo outright. Sandbox accounts
 * are also invisible in Ads Manager, and a reviewer following our test
 * instructions connects their own real ad account anyway.
 *
 * Insights on a paused campaign still returns nothing, and that is correct. A
 * demo that depends on a non-zero number would be a demo that lies;
 * `readInsights` below reports an empty result as an empty result.
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

/* --------------------------------------------------- ad set budget sharing */

/**
 * `is_adset_budget_sharing_enabled` — required on campaign create since v24.0,
 * and the thing that blocked the demo on 6 Aug 2026.
 *
 * WHERE IT GOES: the campaign, and only the campaign. Meta documents it on
 * `POST /act_<id>/campaigns` (create) and on `POST /<campaign_id>` (to turn it
 * off midflight). It is **not** a field on `POST /act_<id>/adsets` — the ad set
 * inherits the behaviour from its parent, and sending it there would be an
 * unknown parameter. Nothing below this line changes in the ad set create.
 *
 * WHY IT IS REQUIRED HERE: from v24.0 the field is conditionally mandatory —
 * you must send an explicit true or false whenever the campaign does not carry
 * its own budget. This one does not; the budget is on the ad set (`daily_budget`
 * further down). Omitting it is a hard 400:
 *
 *     code 100 / subcode 4834011 / OAuthException / "Invalid parameter"
 *     "You must specify True or False in the field
 *      is_adset_budget_sharing_enabled if you are not using campaign budget."
 *
 * Note that `false` is also Meta's documented *semantic* default, and that this
 * is irrelevant: from v24.0 the field is required to be **present**, and absent
 * is not the same as false. That distinction is the whole bug.
 *
 * WHY `false` AND NOT `true` — three independent reasons, any one sufficient:
 *
 *   1. Budget sharing lets ad sets lend one another up to 20% of their budget.
 *      This campaign must remain incapable of spending. Turning on a budget
 *      optimisation on a demo that must never spend is the wrong default even
 *      though the account is unfunded and every object is PAUSED.
 *   2. `true` requires a bid strategy on the campaign — error 4834005, "You
 *      cannot enable ad set budget sharing without bid strategy." We do not set
 *      one, so `true` would trade this 400 for a different 400.
 *   3. `true` requires a uniform spec across the campaign's ad sets — error
 *      4834009 — which is a constraint with no upside on a campaign that has
 *      exactly one ad set.
 *
 * WHY THE STRING AND NOT THE BOOLEAN: `graph.ts` form-encodes params through
 * `String(v)`, so a boolean `false` would arrive as `"false"` and work today.
 * The string is deliberate anyway — it survives any future `clean()` that
 * filters falsy values instead of only null and undefined, which would silently
 * drop the field and reintroduce exactly this 400. Meta's boolean parser accepts
 * `false` (its own v25.0 reference example sends `0`).
 */
const ADSET_BUDGET_SHARING = 'false';

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
  /** `act_<id>`. An ad account with no payment method, so it cannot deliver. */
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
          is_adset_budget_sharing_enabled: ADSET_BUDGET_SHARING,
          ...categoryParams,
        },
      });
      campaignId = created.id;
      objectiveUsed = objective;
      break;
    } catch (err) {
      lastError = err;
      // Only a rejection *of the objective value* is worth retrying. A
      // permissions failure, a rate limit, or a fault in some other parameter
      // means the second attempt fails identically, and we would just have
      // doubled the error rate on an app whose Marketing API tier upgrade
      // depends on staying under 15%.
      const fault = classifyCampaignCreateFault(err);
      if (fault !== 'objective') {
        // Say out loud that the objective was not the problem. `graph.ts` logs
        // Meta's code, subcode and wording one frame below this; what it cannot
        // record is the decision taken on top of them. Without this line,
        // "there is exactly one campaign attempt in the External APIs list" is
        // a fact the next reader has to reverse-engineer.
        console.error(
          '[meta] campaign create not retried ' +
            JSON.stringify({
              objective,
              fault,
              code: err instanceof MetaApiError ? err.code : null,
              subcode: err instanceof MetaApiError ? err.subcode : null,
            }),
        );
        throw err;
      }
      console.warn(`[meta] objective ${objective} rejected; falling back to the next one.`);
    }
  }
  if (!campaignId) throw lastError ?? new Error('Campaign creation failed.');

  /* ---------------------------------------------------------- 2. ad set */

  /*
   * `LINK_CLICKS` rather than `OFFSITE_CONVERSIONS`, on purpose.
   *
   * Conversion optimisation needs a pixel with signal behind it. On an account
   * that never delivers there is none, and the ad set either fails
   * validation or enters a learning phase that will never leave. Link clicks is
   * the honest optimisation goal for a demo, and it is the one the resulting
   * screencast can describe without overstating what was built.
   *
   * `marketplace` is in `facebook_positions` because it is open to everyone —
   * no allowlist, no partnership, no spend threshold (see
   * `claude/meta-marketplace.md` §2). This is the line that makes "your
   * inventory in Facebook Marketplace" a true sentence.
   */
  /*
   * PLACEMENTS ARE DEPRECATED AT RUNTIME, NOT IN THE DOCS. Read this before
   * adding one back.
   *
   * `instagram_positions` used to include `explore`. On v25.0 that fails the
   * ad set create outright:
   *
   *     code 100 / subcode 2490589 / OAuthException / "Invalid parameter"
   *     "IG Explore placement is deprecated for this API version and cannot
   *      be selected, please remove it from your targeting."
   *
   * The trap worth remembering: **Meta's own Placement Targeting reference
   * still lists `explore` as a valid value**, alongside stream, story,
   * explore_home, reels, profile_feed, ig_search and profile_reels. The v25.0
   * changelog does not mention it either. Neither page is wrong about older
   * versions — they are simply not tracking what v25.0 enforces. So for
   * placements the API is the source of truth and the documentation is not,
   * which is the reverse of every other field in this file.
   *
   * Consequences for whoever edits this list next:
   *
   *   - Do not add a placement because the reference says it exists. The only
   *     evidence that counts is a successful create on the pinned version.
   *   - Meta names one offending placement per refusal, so a list with two
   *     dead entries costs two deploys. Add placements one at a time.
   *   - `marketplace` is deliberate and load-bearing: it is what makes "your
   *     inventory in Facebook Marketplace" a true sentence, and it is open to
   *     everyone with no allowlist (`claude/meta-marketplace.md` §2). If it
   *     ever starts refusing, that is a product problem, not a tidy-up.
   *
   * `feed`, `marketplace` and `search` are kept because nothing refused them —
   * the 2490589 above named Instagram Explore and only Instagram Explore. That
   * is not proof they are safe, but removing them on suspicion would be
   * guessing, and guessing is what this project keeps paying for.
   */
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: ['US'] },
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'marketplace', 'search'],
    instagram_positions: ['stream'],
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
      /*
       * Automatic bidding, stated explicitly because THE DEFAULT IS NOT WHAT
       * YOU WOULD GUESS.
       *
       * Omitting `bid_strategy` does not mean "let Meta decide". Meta's own
       * reference says of LOWEST_COST_WITH_BID_CAP: "during creation this is
       * the default bid strategy if you don't specify" — manual maximum-cost
       * bidding. That strategy requires a bid cap, so leaving this field out
       * fails the ad set create outright:
       *
       *     code 100 / subcode 2490487 / OAuthException / "Invalid parameter"
       *     "Bid amount or bid constraints required: For bid cap you must
       *      provide bid amount field to set a bid cap. For ROAS goal, you
       *      must provide roas average floor in bid constraints and 'VALUE'
       *      as optimization goal."
       *
       * `bid_amount` is required only for LOWEST_COST_WITH_BID_CAP and
       * COST_CAP. LOWEST_COST_WITHOUT_CAP needs none, which is why it is the
       * right answer here rather than inventing a cap: a demo that must never
       * spend should not carry a made-up monetary figure, and "Meta bids
       * automatically" is a sentence the screencast can say without
       * qualification. LINK_CLICKS is in this strategy's compatible-objective
       * list, so the pairing below is supported.
       *
       * ON THE AD SET, NOT THE CAMPAIGN. Meta: "If you do not enable campaign
       * budget optimization, you should set bid_strategy at ad set level."
       * Our budget is the `daily_budget` on this ad set, not on the campaign,
       * so this is the level that owns it. Setting it on the campaign instead
       * would be asserting a campaign-budget arrangement we do not have.
       *
       * No interaction with `is_adset_budget_sharing_enabled`: 4834005 ("cannot
       * enable ad set budget sharing without bid strategy") only binds when
       * sharing is on, and we send it false.
       */
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
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
 * Why the campaign create failed, narrowed to the only question the retry loop
 * asks: is the *objective value* what Meta refused?
 *
 * `objective` — Meta rejected the enum value itself. Try the next one.
 * `parameter` — Meta named a different field. A retry fails identically, and
 *               the second failure would bury the first.
 * `fatal`     — permissions, rate limit, revoked token, transport. Stop.
 *
 * THIS FUNCTION IS THE FIX FOR A SECOND-ORDER HAZARD, so the reasoning is worth
 * keeping. The previous version asked only whether `err.message` contained the
 * substring "objective". `MetaApiError.message` is `error_user_msg || message`,
 * i.e. Meta's *prose*, so that test made the retry decision on wording Meta
 * controls and can change without notice.
 *
 * On 6 Aug 2026 it happened not to fire: the 4834011 refusal reads "You must
 * specify True or False in the field is_adset_budget_sharing_enabled…", which
 * contains no "objective", so the loop threw on the first attempt and Vercel's
 * External APIs list shows exactly one `POST /campaigns`. That was luck, not a
 * guard. Had Meta's sentence mentioned the objective anywhere — and plenty of
 * its campaign-level prose does — the loop would have retried, failed
 * identically against `PRODUCT_CATALOG_SALES`, and surfaced the *second*
 * failure. A reader would then have gone hunting through the objective enum
 * while the actual answer, a field Meta named explicitly, scrolled past twice.
 *
 * The new rule leans on structure instead of prose. A bare enum rejection
 * arrives as `code: 100` with **no** subcode and a message that names the
 * parameter ("Param objective must be one of {…}"). A subcode is Meta pointing
 * at one specific documented fault — 4834011 here — which by definition is not
 * the objective enum. So a subcode means some other field is wrong and the
 * objective is a bystander.
 *
 * Deliberately strict: if a genuine objective rejection ever does arrive
 * carrying a subcode, this classifies it `parameter` and we stop and surface
 * Meta's own wording, which names the objective. That costs one deploy. The
 * opposite error — retrying something that was never about the objective —
 * costs a debugging session pointed at the wrong field, which is the failure
 * mode this project has already paid for twice.
 */
type CampaignCreateFault = 'objective' | 'parameter' | 'fatal';

function classifyCampaignCreateFault(err: unknown): CampaignCreateFault {
  if (!(err instanceof MetaApiError)) return 'fatal';
  // Only the bad-request family is ever an enum problem. 10, 190, 200 and 4 are
  // permissions, revocation and rate limits, and none of them improve on retry.
  if (err.code !== 100) return 'fatal';
  if (err.subcode !== null) return 'parameter';
  return `${err.message}`.toLowerCase().includes('objective') ? 'objective' : 'parameter';
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
   * True when the read succeeded and returned nothing, which for a paused
   * campaign in an unfunded account is the *expected* outcome rather than a
   * failure. The distinction matters: "we read your spend and it is zero
   * because these ads have never run" and "we could not read your spend" are
   * different sentences, and only one of them is honest.
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
