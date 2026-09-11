/**
 * Rooftop Auto — the smallest honest catalog campaign.
 *
 * WHAT THIS IS FOR, PLAINLY
 *
 * Written as an App Review harness: three of the eight permissions —
 * `ads_management`, `ads_read` and `pages_manage_ads` — cannot be demonstrated
 * by a connect flow that never creates an ad. That job is done; the permissions
 * are live at `advanced`.
 *
 * **It is now the dealer-facing campaign builder**, which changes two of the
 * assumptions the rest of this file was written under, and both of them are the
 * kind that cost money rather than a re-record:
 *
 *   1. **The ad account is real and funded.** "It cannot spend" is no longer a
 *      property of the account, only of the PAUSED status. Every object still
 *      lands paused and the dealer turns it on in Ads Manager — that is the
 *      whole safety story now, so do not weaken it.
 *   2. **Targeting is a radius around the lot**, not `countries: ['US']`. A
 *      dealer who unpauses a nationwide used-car campaign finds out by invoice.
 *
 * THE SHAPE, SINCE SEP 2026: **one campaign per lot, one ad set per shelf, one
 * ad per saved copy row.** On screen the ad set is called a *group* — "campaign"
 * and "ad set" are Meta's words and a dealer does not need either; what they
 * pick is a shelf, a budget, a radius and the words on each ad. The campaign
 * itself is invisible to them and exists because Meta needs a parent.
 *
 * Before this the code built one campaign per shelf, each with a single ad set,
 * and copy was stored per lot so every shelf ran identical ads. Campaigns from
 * that era carry a `— <shelf> inventory` suffix and are listed as *legacy* by
 * `listLotGroups` so an operator can stop them; nothing here builds one.
 *
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
 * **Everything is PAUSED.** That is the only thing standing between this code
 * and a dealer's money now that the ad account is a real one — the unfunded
 * account this was built against is gone. Nothing here may create an object in
 * any other status, and nothing here may unpause one.
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
import {
  CAMPAIGN_BUCKETS,
  DEFAULT_BUCKET,
  bucketByKey,
  bucketFilter,
  type BucketKey,
  type CampaignBucket,
} from './buckets';
import type { PreviewFormat } from './buckets-preview';
import type { AdCopy } from './ad-copy';
import { defaultAdCopy as defaultAdCopyFor } from './ad-copy-spec';

/* -------------------------------------------------------------- objective */

/**
 * Modern first, legacy second. Meta's enum still lists the legacy value and its
 * automotive guides still use it, so one retry resolves a documented ambiguity
 * far more cheaply than guessing.
 */
const OBJECTIVES = ['OUTCOME_SALES', 'PRODUCT_CATALOG_SALES'] as const;

/** "Update payment method." The only reason an Ad create fails on an otherwise good setup. */
const AD_NEEDS_PAYMENT = 1359188;

/** "Select an Instagram account or a Facebook Page to represent your business on Instagram." */
const AD_NO_INSTAGRAM = 1772103;

/**
 * The Instagram identity to run this Page's ads under, creating one if needed.
 *
 * THE PROBLEM. An ad set may ask for Instagram placements and create happily;
 * the **Ad** is where Meta checks there is an identity to run them under, and
 * refuses three creates later with
 *
 *     code 100 / subcode 1772103 / "Invalid parameter"
 *     "Select an Instagram account or a Facebook Page to represent your
 *      business on Instagram."
 *
 * Same shape as every other trap in this file: the object that names the
 * problem is downstream of the object that caused it. Most independent used-car
 * lots have no Instagram, so this is the common case, not the edge one.
 *
 * THE ANSWER IS THE ONE IN THE ERROR TEXT — "or a Facebook Page". Meta's
 * mechanism for it is a **Page-Backed Instagram Account**: a shadow Instagram
 * identity that takes the Page's name and profile picture and exists only to
 * carry ads. It cannot post, comment or like. It is what the "Use Facebook
 * Page" option in Ads Manager creates, and it means a dealer with no Instagram
 * still gets the Instagram placement, under their own name.
 *
 * The first version of this function dropped Instagram from the placement list
 * instead. That was a worse product decision dressed up as a safe default, and
 * it would have quietly cost every Instagram-less dealer half their reach.
 *
 * Order matters:
 *
 *   1. A real Instagram account linked to the Page wins. It is their actual
 *      brand with their actual followers, and ads should run from it.
 *   2. An existing PBIA next — never create a second.
 *   3. Create a PBIA.
 *   4. Null, and the caller drops Instagram rather than losing the ad entirely.
 *
 * Every step falls through on failure. The worst outcome is a Facebook-only
 * campaign, which for a used-car lot still includes Marketplace — the placement
 * that actually matters here.
 */
async function instagramIdForPage(token: string, pageId: string): Promise<string | null> {
  // 1. Their real account, if the Page has one.
  try {
    const page = await graph<{
      instagram_business_account?: { id?: string };
      connected_instagram_account?: { id?: string };
    }>(`/${pageId}`, {
      token,
      params: { fields: 'instagram_business_account{id},connected_instagram_account{id}' },
    });
    const real = page.instagram_business_account?.id ?? page.connected_instagram_account?.id;
    if (real) return real;
  } catch {
    // Reading the link can need `instagram_basic`, which we do not hold. Not
    // knowing is the same as not having one here — fall through.
  }

  // 2. A PBIA that already exists. Adopt before creating, as everywhere else in
  //    this file: a duplicate identity is not an error Meta reports, it is just
  //    two things nobody can tell apart six months later.
  try {
    const existing = await graphEdge<{ id: string }>(`/${pageId}/page_backed_instagram_accounts`, {
      token,
      fields: 'id',
      maxPages: 1,
    });
    if (existing.length) return existing[0]!.id;
  } catch {
    // fall through to the create
  }

  // 3. Make one. No parameters beyond the token — the Page supplies the name
  //    and the picture.
  try {
    const created = await graph<{ id: string }>(`/${pageId}/page_backed_instagram_accounts`, {
      method: 'POST',
      token,
    });
    return created.id ?? null;
  } catch (err) {
    console.warn(
      '[meta] no instagram identity for page ' +
        JSON.stringify({
          pageId,
          code: err instanceof MetaApiError ? err.code : null,
          subcode: err instanceof MetaApiError ? err.subcode : null,
          trace: err instanceof MetaApiError ? err.traceId : null,
        }),
    );
    return null;
  }
}

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
 *      4834009 — and the groups in one lot's campaign deliberately differ in
 *      budget and radius.
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
 * The shelves, as catalog filters. Defined in `./buckets.ts` and re-exported
 * here so every existing import site keeps working.
 *
 * That file is pure and not `server-only` precisely so the dealer panel and the
 * ops panel can import the list instead of each keeping a hardcoded copy, which
 * is what they did until Sep 2026 — and those copies had already drifted from
 * the filter they were supposed to describe.
 *
 * The aging boundaries match `AGING_BUCKETS` in `src/lib/domain.ts`, which is
 * the point: the lot already argues about the 46–60 shelf every Monday, so the
 * ad set that spends money on it should be defined by the same number rather
 * than by a marketer's guess. What changed is that aging is no longer the only
 * way to choose — see the note in `buckets.ts` on why `all` is the default.
 *
 * Filtering on `days_on_lot` rather than on `custom_label_0` is deliberate.
 * Both are in the feed and both are filterable, but `days_on_lot` is numeric,
 * so `gte`/`lte` work on it and a bucket boundary can move without a full feed
 * re-ingest. `custom_label_0` carries the same information as a readable label
 * for the human looking at Commerce Manager.
 */
export {
  CAMPAIGN_BUCKETS,
  DEFAULT_BUCKET,
  bucketByKey,
  bucketFilter,
  isBucketKey,
  type BucketKey,
  type CampaignBucket,
} from './buckets';

export type ProductSetResult = { id: string; name: string; adopted: boolean };

/* -------------------------------------------------------- adopt-or-create */

/**
 * Statuses that mean "this object is gone", even though Meta still hands it back.
 *
 * THIS SET IS THE WHOLE REASON ADOPTION IS SAFE. Meta soft-deletes: a campaign
 * deleted in Ads Manager keeps its id, keeps its name, and keeps appearing on
 * `/{ad_account}/campaigns` with `status: DELETED` (ARCHIVED behaves the same).
 * Adopting one looks like it works — you get an id back — and then the ad set
 * create fails against a dead parent, which reads as a brand-new Meta problem
 * rather than as our own bookkeeping.
 *
 * That is not hypothetical: the demo's operator deletes campaigns between takes,
 * so the account will routinely hold a deleted campaign with exactly the name we
 * are about to look for.
 */
const DEAD_STATUSES = new Set(['DELETED', 'ARCHIVED']);

/**
 * Find a live object on an edge by exact name, or null.
 *
 * Name matching rather than storing ids, for the same reason `ensureProductSet`
 * does it: the demo has no table of its own, and a dealer's account is the
 * source of truth. Names here are fully deterministic, so this is stable.
 */
async function findLiveByName<T extends { id: string; name?: string; status?: string }>(
  path: string,
  token: string,
  fields: string,
  name: string,
): Promise<T | null> {
  const rows = await graphEdge<T>(path, { token, fields });
  return rows.find((r) => r.name === name && !DEAD_STATUSES.has(r.status ?? '')) ?? null;
}

/**
 * Adopt-or-create, same as every other provisioning step in this codebase. A
 * demo run twice must not leave two identical product sets behind — the dealer
 * has to live in that Commerce Manager afterwards.
 */
export async function ensureProductSet(
  token: string,
  catalogId: string,
  bucket: CampaignBucket,
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
  /** `act_<id>`. The dealer's real ad account — assume it can spend. */
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
  /**
   * The lot's coordinates. When present the ad set targets a radius around the
   * lot instead of the whole country — which is the difference between a
   * demonstration and a campaign a dealer can actually turn on.
   *
   * Nullable because `rooftops.latitude` / `longitude` arrived in migration
   * `0007_odd_big_bertha` as NULL columns and there is still no UI to fill
   * them. A lot without coordinates falls back to country targeting and the
   * caller is expected to say so on screen rather than let it pass quietly.
   */
  lat?: number | null;
  lng?: number | null;
  /** Radius in miles around the lot. Clamped to Meta's 1–50 for custom locations. */
  radiusMiles?: number;
  /**
   * One ad per entry, all inside the single ad set.
   *
   * Several ads in one ad set share a learning phase and Meta shifts delivery
   * toward whichever wins. Several campaigns would each learn from nothing and
   * split the budget — which is why creative testing lives here and not in more
   * shelves. Empty falls back to the hardcoded default, so a lot that has never
   * opened the copy editor keeps running exactly what it ran before.
   */
  adCopies?: AdCopy[];
  /** Daily budget in whole dollars, on the ad set. */
  dailyBudgetUsd?: number;
};

export type DemoCampaignResult = {
  /**
   * The objective this campaign actually carries. Widened from
   * `CampaignObjective` because an adopted campaign reports whatever it was
   * created with, and reporting our preferred value instead would be a guess
   * dressed as a result.
   */
  objectiveUsed: string;
  campaignId: string;
  productSet: ProductSetResult;
  adSetId: string;
  creativeId: string;
  /**
   * Every unit is created PAUSED. Stated in the result because it is the safety
   * guarantee, not a detail: building never spends, starting does, and those
   * are two separate clicks by design.
   */
  status: 'PAUSED';
  /**
   * The Ad object. Null when Meta refused to create it — which in practice means
   * one thing, `adCannotRun` below.
   *
   * This used to be absent on purpose and the whole tree stopped at the
   * creative, because the demo ran against an ad account with no payment method
   * and the Ad is the first object Meta refuses without one. That made a
   * stronger honesty claim for App Review than "paused" did. It is also why
   * nothing built by this code could ever have run: **a campaign with an ad set
   * and a creative but no Ad delivers nothing, whatever its status.** Adding a
   * start button without this would have shipped a switch wired to nothing.
   */
  adId: string | null;
  /** Every ad in the set, one per copy variant. `adId` is the first of these. */
  ads: { id: string; name: string }[];
  /**
   * Set when an Ad could not be created and why, in the dealer's words. Today
   * there is exactly one cause worth naming — see `AD_NEEDS_PAYMENT`.
   */
  adCannotRun: string | null;
  /**
   * Which objects already existed and were reused rather than created again.
   *
   * Surfaced rather than hidden because it is the fastest way to notice, on
   * camera, that a previous take was not cleaned up — "created" and "reused"
   * look identical in the id list otherwise.
   *
   * No `creative` key: the creative is never adopted, so it is always created.
   * See the note at its call site for why it is the exception.
   */
  adopted: { campaign: boolean; adSet: boolean };
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
    lat = null,
    lng = null,
  } = input;

  /*
   * Clamps, not validation errors. Both numbers arrive off a form the dealer
   * typed into, and the failure mode we are avoiding is a Meta 400 three calls
   * later that names neither field. Meta's custom-location radius is 1–50
   * miles; the floor here is 5 because a 1-mile radius around a car lot is not
   * a campaign, it is a typo.
   */
  const radiusMiles = Math.min(50, Math.max(5, Math.round(input.radiusMiles ?? 25)));
  const dailyBudgetUsd = Math.min(1000, Math.max(10, Math.round(input.dailyBudgetUsd ?? 25)));
  const dailyBudgetMinor = String(dailyBudgetUsd * 100);

  const act = actPath(input.adAccountId);
  const bucket = bucketByKey(input.bucket ?? DEFAULT_BUCKET);

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

  // One per lot, shared by every group. See `lotCampaignName`.
  const campaignName = lotCampaignName(dealerName);

  let campaignId = '';
  let objectiveUsed: string = OBJECTIVES[0];
  let lastError: unknown = null;

  /*
   * Adopt before creating, exactly as `ensureProductSet` does, and for the same
   * stated reason: a demo run twice must not leave two identical objects behind,
   * because the dealer has to live in that Ads Manager afterwards.
   *
   * This matters more than it looks. Recording the App Review screencast means
   * pressing this button repeatedly across takes, and without this guard every
   * take duplicates the whole tree. `DEAD_STATUSES` is what makes it safe to
   * delete campaigns between takes and press again — a deleted campaign keeps
   * its name on the edge and would otherwise be adopted as a dead parent.
   */
  const priorCampaign = await findLiveByName<{ id: string; name?: string; status?: string; objective?: string }>(
    `${act}/campaigns`,
    token,
    'id,name,status,objective',
    campaignName,
  );

  if (priorCampaign) {
    campaignId = priorCampaign.id;
    // Report what the adopted campaign actually is, not what we would have sent.
    // `claude/meta-app-review-runbook.md` §3.5 asks for the real answer here.
    objectiveUsed = priorCampaign.objective ?? objectiveUsed;
  }

  for (const objective of campaignId ? [] : OBJECTIVES) {
    try {
      const created = await graph<{ id: string }>(`${act}/campaigns`, {
        method: 'POST',
        token,
        params: {
          name: campaignName,
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
  /*
   * A radius around the lot when we know where the lot is, and the whole
   * country when we do not.
   *
   * The fallback is deliberately loud rather than clever: `countries: ['US']`
   * on a used-car lot is a mistake a dealer would notice only after paying for
   * it, so `buildCampaignForRooftop` refuses to build until the coordinates
   * exist. This branch stays because the type allows null and a silent
   * nationwide campaign is the one outcome worth being paranoid about.
   */
  /*
   * Resolved before targeting is built, because it decides whether Instagram is
   * in the placement list at all. See `instagramIdForPage`.
   */
  const instagramId = await instagramIdForPage(token, pageId);

  const targeting: Record<string, unknown> = {
    geo_locations:
      lat !== null && lng !== null
        ? {
            custom_locations: [
              { latitude: lat, longitude: lng, radius: radiusMiles, distance_unit: 'mile' },
            ],
          }
        : { countries: ['US'] },
    /*
     * Instagram only when there is an identity to run it under — which, with
     * the Page-Backed Instagram Account above, is nearly always. Reaching the
     * Facebook-only branch means even the PBIA create failed, and the warning
     * logged there says why.
     */
    publisher_platforms: instagramId ? ['facebook', 'instagram'] : ['facebook'],
    facebook_positions: ['feed', 'marketplace', 'search'],
    ...(instagramId ? { instagram_positions: ['stream'] } : {}),
  };

  /*
   * THE AD SET IS THE GROUP, AND ITS NAME IS THE SHELF. `listLotGroups` maps
   * it back to a `BucketKey` by matching the label exactly, so this string is
   * a contract, not a display choice — change it and every existing group
   * stops being recognised as ours.
   */
  const adSetName = groupNameFor(bucket);

  // Scoped to this campaign's own edge rather than the account's, so the name
  // only has to be unique within the campaign — which it is by construction.
  const priorAdSet = await findLiveByName<{ id: string; name?: string; status?: string }>(
    `/${campaignId}/adsets`,
    token,
    'id,name,status',
    adSetName,
  );

  /*
   * An adopted ad set is NOT left as it was found.
   *
   * Adoption-by-name was written for screencast takes, where pressing the
   * button twice must not duplicate the tree. The moment budget and radius
   * became fields the dealer types, that same guard turned into a silent
   * no-op: change the budget, press Build again, watch it report success and
   * keep the old number. So the update below is what makes the form mean
   * anything on the second press.
   */
  if (priorAdSet) {
    await graph<{ success?: boolean }>(`/${priorAdSet.id}`, {
      method: 'POST',
      token,
      params: {
        daily_budget: dailyBudgetMinor,
        targeting: JSON.stringify(targeting),
      },
    });
  }

  const adSet = priorAdSet ?? await graph<{ id: string }>(`${act}/adsets`, {
    method: 'POST',
    token,
    params: {
      name: adSetName,
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
      daily_budget: dailyBudgetMinor, // Account currency minor units.
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
  /*
   * THE CREATIVE IS NEVER ADOPTED — always created fresh. This is the one place
   * that breaks the adopt-or-create pattern used everywhere else in this file,
   * and the asymmetry is deliberate.
   *
   * THE RULE: only adopt what the operator can delete.
   *
   * A campaign and an ad set are visible in Ads Manager and can be removed there
   * in two clicks, so adopting them is safe — someone who wants a clean build
   * can get one. An ad creative cannot. Because this demo deliberately stops
   * before creating an Ad (see below), the creative is an orphan attached to
   * nothing, and orphan creatives appear in no Ads Manager surface at all. The
   * only way to remove one is `DELETE /{creative_id}` against the Graph API.
   *
   * Adopting it therefore created a state the operator could not reset: delete
   * the campaign, press the button again, and the result block would report the
   * creative as reused rather than created — with no way to make it say
   * "created" again short of hand-rolling an API call.
   *
   * That is not cosmetic. The creative id is the *entire* evidence for
   * `pages_manage_ads`, and the App Review description for that permission says
   * the creative is created. A recording that shows it being reused contradicts
   * the description it is submitted with, which is an ordinary way for a
   * submission to be rejected.
   *
   * The cost of not adopting is a few duplicate creatives on the ad account.
   * They are invisible, unattached, and cannot deliver. That is a much cheaper
   * problem than an unresettable demo.
   */
  /*
   * ONE CREATIVE AND ONE AD PER COPY ROW, ALL IN THIS ONE AD SET.
   *
   * Meta's optimisation and its learning phase live at the AD SET. Several ads
   * inside one share that learning and delivery moves toward whichever is
   * winning; several ad sets each start from nothing and split the budget.
   * Creative testing therefore goes inside the group, and each row of
   * `metaAdCopy` for this shelf is one ad here — edited one at a time, the way
   * Ads Manager does it.
   *
   * A group with no saved copy gets one entry — the hardcoded default — so a
   * build from the ops screen, where nobody wrote copy, still produces an ad.
   */
  const copies = input.adCopies?.length
    ? input.adCopies
    : [{ id: null, ...defaultAdCopyFor(dealerName) }];

  const ads: { id: string; name: string }[] = [];
  let adCannotRun: string | null = null;
  let lastCreativeId = '';

  /*
   * Read once, up front. Every ad in the set, live or not, so the loop can
   * adopt by name and the sweep afterwards can see what it did NOT build.
   */
  const existingAds = await graphEdge<{ id: string; name?: string; status?: string }>(
    `/${adSet.id}/ads`,
    { token, fields: 'id,name,status', maxPages: 2 },
  );

  for (const copy of copies) {
    const creativeName = `Rooftop — ${dealerName} — ${bucket.label} — ${copy.name}`.slice(0, 100);

    const creative = await graph<{ id: string }>(`${act}/adcreatives`, {
      method: 'POST',
      token,
      params: {
        name: creativeName,
        product_set_id: productSet.id,
        object_story_spec: JSON.stringify({
          page_id: pageId,
          /*
           * The field 1772103 asks for. Omitted entirely when there is no
           * identity — sending null is not the same as sending nothing.
           *
           * `instagram_user_id` is the current name. Meta's own announcement of
           * PBIAs calls it `instagram_actor_id`; that spelling is deprecated and
           * still all over older docs and forum answers.
           */
          ...(instagramId ? { instagram_user_id: instagramId } : {}),
          template_data: {
            link: landingUrl,
            message: copy.message,
            name: copy.headline,
            description: copy.description,
            call_to_action: { type: copy.callToAction },
          },
        }),
        template_url_spec: JSON.stringify({
          web: { url: `${landingUrl}?utm_source=meta&utm_medium=aia&stock={{vehicle.stock_number}}` },
        }),
      },
    });

    /*
     * The ad carries the dealer's own name for it, nothing else — the ad set
     * already says which shelf, and Ads Manager shows both columns. It is also
     * the adoption key: rename a row on screen and the next build makes a new
     * ad under the new name, and the sweep below pauses the one under the old
     * name so a renamed ad does not keep running its old words.
     */
    const adName = copy.name.slice(0, 100);
    const priorAd = existingAds.find((a) => a.name === adName && !DEAD_STATUSES.has(a.status ?? '')) ?? null;

    try {
      if (priorAd) {
        /*
         * Point the existing ad at the new creative rather than making a second
         * ad with the same name. The old creative is orphaned — invisible in Ads
         * Manager, unable to deliver, removable only by a direct DELETE — which
         * the long note above accepts as the cheaper problem. What matters is
         * that the AD id survives an edit, because its delivery history is
         * attached to it: recreating it would throw away the learning the
         * dealer is paying for every time they fix a typo.
         */
        await graph<{ success?: boolean }>(`/${priorAd.id}`, {
          method: 'POST',
          token,
          params: { creative: JSON.stringify({ creative_id: creative.id }) },
        });
        ads.push({ id: priorAd.id, name: adName });
      } else {
        const ad = await graph<{ id: string }>(`${act}/ads`, {
          method: 'POST',
          token,
          params: {
            name: adName,
            adset_id: adSet.id,
            creative: JSON.stringify({ creative_id: creative.id }),
            /*
             * PAUSED — with one exception. An ad added to a group that is
             * already running joins it running: the dealer pressed Start on
             * the group, and "add another ad" should not silently produce one
             * that never delivers. A new group is always PAUSED, so the
             * never-spends-on-build guarantee holds where it matters.
             */
            status: priorAdSet?.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
          },
        });
        ads.push({ id: ad.id, name: adName });
      }
    } catch (err) {
      /*
       * Not fatal, and the loop continues. Everything above this line is real
       * and correct, and a dealer who adds a card gets working ads by pressing
       * Build again — no re-setup, no reconnect. One variant failing should not
       * cost the others, and throwing here would discard a campaign, ad set,
       * product set and every creative over a billing detail.
       */
      if (err instanceof MetaApiError && err.subcode === AD_NO_INSTAGRAM) {
        // Should be unreachable now a PBIA is created on demand. If it fires,
        // the PBIA create is failing — look for the "no instagram identity for
        // page" warning logged just above it.
        adCannotRun =
          'Facebook would not create the ad because this Page has no Instagram identity yet. ' +
          'Contact us — we can run Facebook and Marketplace in the meantime.';
      } else if (err instanceof MetaApiError && err.subcode === AD_NEEDS_PAYMENT) {
        adCannotRun =
          'This ad account has no payment method on file, so Facebook will not let the ad be ' +
          'created. Add a card in Facebook\u2019s billing settings, then press Build again.';
      } else if (err instanceof MetaApiError) {
        adCannotRun = err.dealerMessage;
      } else {
        throw err;
      }
      console.error(
        '[meta] ad create refused ' +
          JSON.stringify({
            adSetId: adSet.id,
            creativeId: creative.id,
            copyName: copy.name,
            code: err instanceof MetaApiError ? err.code : null,
            subcode: err instanceof MetaApiError ? err.subcode : null,
            trace: err instanceof MetaApiError ? err.traceId : null,
          }),
      );
    }

    lastCreativeId = creative.id;
  }

  /*
   * THE SWEEP. Anything live in this ad set that this build did not just touch
   * is an ad whose row was renamed or turned off on screen. It is paused, not
   * deleted: the row keeps its numbers, and Meta keeps reporting against the
   * ad. Without this, "Turn off" would change the database and nothing else,
   * and a renamed ad would run twice under two names.
   */
  const built = new Set(ads.map((a) => a.id));
  for (const stray of existingAds) {
    if (built.has(stray.id) || DEAD_STATUSES.has(stray.status ?? '') || stray.status === 'PAUSED') continue;
    try {
      await graph<{ success?: boolean }>(`/${stray.id}`, {
        method: 'POST',
        token,
        params: { status: 'PAUSED' },
      });
    } catch (err) {
      console.warn(
        '[meta] could not pause stray ad ' +
          JSON.stringify({ adId: stray.id, name: stray.name, code: err instanceof MetaApiError ? err.code : null }),
      );
    }
  }

  return {
    objectiveUsed,
    campaignId,
    productSet,
    adSetId: adSet.id,
    creativeId: lastCreativeId,
    status: 'PAUSED',
    adId: ads[0]?.id ?? null,
    ads,
    adCannotRun,
    adopted: {
      campaign: Boolean(priorCampaign),
      adSet: Boolean(priorAdSet),
    },
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

/* ---------------------------------------------------- names, as contracts */

/**
 * The one campaign a lot gets. Everything Rooftop runs for the lot lives under
 * it, one ad set per shelf. Matched by EXACT name, so a campaign the dealer
 * renamed in Ads Manager is one they have taken over and we leave alone.
 */
export function lotCampaignName(dealerName: string): string {
  return `Rooftop — ${dealerName}`.slice(0, 100);
}

/**
 * Pre-Sep-2026 campaigns: one per shelf, `Rooftop — <dealer> — <shelf> inventory`.
 * Nothing builds these any more; `listLotGroups` reports them so they can be
 * stopped and deleted, and `setCampaignRunning` can still stop one.
 */
export function legacyCampaignPrefix(dealerName: string): string {
  return `Rooftop — ${dealerName} — `;
}

/** The ad set's name is the shelf label, and `listLotGroups` maps it back by equality. */
export function groupNameFor(bucket: CampaignBucket): string {
  return bucket.label;
}

/* ------------------------------------------------- reading the lot's ads */

/** One ad inside a group, as Meta holds it. */
export type GroupAd = {
  id: string;
  name: string;
  status: string;
  effectiveStatus: string;
  creativeId: string | null;
};

/**
 * A group: one ad set under the lot's campaign, with its live status, spend,
 * and the ads inside it.
 *
 * Nothing here is stored on our side. Budget, radius and shelf are read back
 * from what Meta holds, which is both simpler and immune to our copy drifting
 * from the live object. `bucketKey` comes from the ad set NAME, the same
 * convention `groupNameFor` writes; null means somebody renamed it by hand and
 * it is no longer a shelf we can rebuild.
 */
export type LotGroup = {
  /** The ad set id. This is what start/stop and rebuild are keyed on. */
  id: string;
  campaignId: string;
  name: string;
  bucketKey: BucketKey | null;
  status: string;
  /** What Meta says is actually happening, which is not always `status`. */
  effectiveStatus: string;
  createdTime: string | null;
  dailyBudgetUsd: number | null;
  radiusMiles: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  ads: GroupAd[];
};

/** A campaign from the one-per-shelf era. Listed so it can be stopped; never rebuilt. */
export type LegacyCampaign = {
  id: string;
  name: string;
  effectiveStatus: string;
  spend: number;
};

export type LotGroups = {
  /** Null until the first group is built. */
  campaignId: string | null;
  groups: LotGroup[];
  legacy: LegacyCampaign[];
};

/**
 * Everything Rooftop runs for one lot.
 *
 * Cost is 2 + 2N calls (campaign list, ad set list, then insights and ads per
 * group), so it is capped. An operator screen listing every dealer must NOT
 * call this per row — see `claude/meta-onboarding-matrix.md` §4 on app-level
 * rate limits, which are billed app-wide rather than per account. One dealer
 * at a time is what this is for.
 */
export async function listLotGroups(
  token: string,
  adAccountId: string,
  dealerName: string,
  max = 8,
): Promise<LotGroups> {
  const act = actPath(adAccountId);
  const wanted = lotCampaignName(dealerName);
  const legacyPrefix = legacyCampaignPrefix(dealerName);

  const campaigns = await graphEdge<{
    id: string;
    name?: string;
    status?: string;
    effective_status?: string;
  }>(`${act}/campaigns`, {
    token,
    fields: 'id,name,status,effective_status',
    maxPages: 2,
  });

  const live = campaigns.filter((c) => !DEAD_STATUSES.has(c.status ?? ''));
  const mine = live.find((c) => c.name === wanted) ?? null;

  /*
   * Legacy campaigns get one insights call each and nothing more. They are on
   * the way out; the number that matters is whether one is still spending.
   */
  const legacy: LegacyCampaign[] = await Promise.all(
    live
      .filter((c) => (c.name ?? '').startsWith(legacyPrefix))
      .slice(0, max)
      .map(async (c) => {
        const rows = await graphEdge<InsightsRow>(`/${c.id}/insights`, {
          token,
          fields: 'spend',
          params: { date_preset: 'maximum' },
          maxPages: 1,
        }).catch(() => [] as InsightsRow[]);
        return {
          id: c.id,
          name: c.name ?? c.id,
          effectiveStatus: c.effective_status ?? c.status ?? 'UNKNOWN',
          spend: Number(rows[0]?.spend ?? 0),
        };
      }),
  );

  if (!mine) return { campaignId: null, groups: [], legacy };

  type AdSetRow = {
    id: string;
    name?: string;
    status?: string;
    effective_status?: string;
    created_time?: string;
    daily_budget?: string;
    targeting?: { geo_locations?: { custom_locations?: { radius?: number }[] } };
  };

  const adSets = await graphEdge<AdSetRow>(`/${mine.id}/adsets`, {
    token,
    fields: 'id,name,status,effective_status,created_time,daily_budget,targeting',
    maxPages: 1,
  });

  const groups = await Promise.all(
    adSets
      .filter((s) => !DEAD_STATUSES.has(s.status ?? ''))
      .slice(0, max)
      .map(async (s): Promise<LotGroup> => {
        const [insights, ads] = await Promise.all([
          graphEdge<InsightsRow>(`/${s.id}/insights`, {
            token,
            fields: 'spend,impressions,clicks',
            params: { date_preset: 'maximum' },
            maxPages: 1,
          }).catch(() => [] as InsightsRow[]),
          graphEdge<{
            id: string;
            name?: string;
            status?: string;
            effective_status?: string;
            creative?: { id?: string };
          }>(`/${s.id}/ads`, {
            token,
            fields: 'id,name,status,effective_status,creative{id}',
            maxPages: 1,
          }).catch(() => []),
        ]);

        const row = insights[0];
        const bucket = CAMPAIGN_BUCKETS.find((b) => groupNameFor(b) === s.name);

        return {
          id: s.id,
          campaignId: mine.id,
          name: s.name ?? s.id,
          bucketKey: bucket?.key ?? null,
          status: s.status ?? 'UNKNOWN',
          effectiveStatus: s.effective_status ?? s.status ?? 'UNKNOWN',
          createdTime: s.created_time ?? null,
          dailyBudgetUsd: s.daily_budget ? Number(s.daily_budget) / 100 : null,
          radiusMiles: s.targeting?.geo_locations?.custom_locations?.[0]?.radius ?? null,
          spend: Number(row?.spend ?? 0),
          impressions: Number(row?.impressions ?? 0),
          clicks: Number(row?.clicks ?? 0),
          ads: ads
            .filter((a) => !DEAD_STATUSES.has(a.status ?? ''))
            .map((a) => ({
              id: a.id,
              name: a.name ?? a.id,
              status: a.status ?? 'UNKNOWN',
              effectiveStatus: a.effective_status ?? a.status ?? 'UNKNOWN',
              creativeId: a.creative?.id ?? null,
            })),
        };
      }),
  );

  return { campaignId: mine.id, groups, legacy };
}

/* --------------------------------------------------------- start and stop */

/**
 * Turn one group on or off.
 *
 * WALKS ITS OWN SUBTREE, AND THE PARENT ON THE WAY UP.
 *
 * Meta's effective status is the *least* permissive status in the chain, so an
 * ACTIVE ad set under a PAUSED campaign, or over PAUSED ads, delivers nothing —
 * and every object this file builds is created PAUSED, so that is the state of
 * every group the first time somebody presses Start. Setting only the ad set
 * would report success and change nothing a dealer could see.
 *
 * Starting: ads, then the ad set, then the campaign — so nothing goes ACTIVE
 * over a child that is still paused. Stopping: the ad set first, so delivery
 * halts on the first call, then its ads. **The campaign is left alone on
 * stop**: it is shared by every group on the lot, and pausing it would stop
 * groups the dealer did not touch. A campaign that is ACTIVE with every ad set
 * paused spends nothing.
 */
export type RunOutcome =
  | { ok: true; running: boolean; adsTouched: number }
  | { ok: false; error: string; needsPayment?: boolean; missingAd?: boolean };

export async function setGroupRunning(
  token: string,
  campaignId: string,
  adSetId: string,
  running: boolean,
): Promise<RunOutcome> {
  const status = running ? 'ACTIVE' : 'PAUSED';

  try {
    const found = await graphEdge<{ id: string; status?: string }>(`/${adSetId}/ads`, {
      token,
      fields: 'id,status',
      maxPages: 2,
    });
    const ads = found.filter((a) => !DEAD_STATUSES.has(a.status ?? ''));

    if (running && ads.length === 0) {
      return {
        ok: false,
        missingAd: true,
        error: 'This group has no ad in it yet, so it cannot run. Save an ad and press Update on Facebook, then start it.',
      };
    }

    const setStatus = (path: string) =>
      graph<{ success?: boolean }>(path, { method: 'POST', token, params: { status } });

    if (running) {
      for (const ad of ads) await setStatus(`/${ad.id}`);
      await setStatus(`/${adSetId}`);
      await setStatus(`/${campaignId}`);
    } else {
      await setStatus(`/${adSetId}`);
      for (const ad of ads) await setStatus(`/${ad.id}`);
    }

    return { ok: true, running, adsTouched: ads.length };
  } catch (err) {
    if (err instanceof MetaApiError) {
      return {
        ok: false,
        needsPayment: err.subcode === AD_NEEDS_PAYMENT,
        error:
          err.subcode === AD_NEEDS_PAYMENT
            ? 'Facebook needs a payment method on this ad account before ads can run. Add a card ' +
              'in their billing settings and try again.'
            : err.dealerMessage,
      };
    }
    throw err;
  }
}

/**
 * Turn a whole campaign on or off. Kept for LEGACY campaigns only — the
 * one-per-shelf kind — so an operator can stop one from the ops screen while
 * it is being replaced by a group. Nothing on the dealer's screen calls this.
 */
export async function setCampaignRunning(
  token: string,
  campaignId: string,
  running: boolean,
): Promise<RunOutcome> {
  const status = running ? 'ACTIVE' : 'PAUSED';

  try {
    const adSets = await graphEdge<{ id: string; status?: string }>(`/${campaignId}/adsets`, {
      token,
      fields: 'id,status',
      maxPages: 2,
    });

    const ads: { id: string }[] = [];
    for (const set of adSets) {
      const found = await graphEdge<{ id: string; status?: string }>(`/${set.id}/ads`, {
        token,
        fields: 'id,status',
        maxPages: 2,
      });
      ads.push(...found.filter((a) => !DEAD_STATUSES.has(a.status ?? '')));
    }

    if (running && ads.length === 0) {
      return { ok: false, missingAd: true, error: 'This campaign has no ad in it, so it cannot run.' };
    }

    const setStatus = (path: string) =>
      graph<{ success?: boolean }>(path, { method: 'POST', token, params: { status } });

    if (running) {
      for (const ad of ads) await setStatus(`/${ad.id}`);
      for (const set of adSets) await setStatus(`/${set.id}`);
      await setStatus(`/${campaignId}`);
    } else {
      await setStatus(`/${campaignId}`);
      for (const set of adSets) await setStatus(`/${set.id}`);
      for (const ad of ads) await setStatus(`/${ad.id}`);
    }

    return { ok: true, running, adsTouched: ads.length };
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }
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
   * True when the read succeeded and returned nothing, which for a campaign
   * that has never been unpaused is the *expected* outcome rather than a
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

/* ---------------------------------------------------------------- preview */

/**
 * What the ad actually looks like, per placement.
 *
 * `GET /{creative_id}/previews?ad_format=...` returns a chunk of HTML holding
 * an `<iframe>` whose `src` renders the ad as Facebook will show it. One call
 * per format; Meta has no multi-format endpoint.
 *
 * THE SRC CARRIES AN ACCESS TOKEN, AND OURS IS THE ONE THAT NEVER EXPIRES.
 * That is the whole reason this returns URLs to the server rather than markup
 * to the browser. Embedding Meta's iframe directly — which is what most ad
 * tools do — would put a non-expiring Business Integration System User token
 * into the dealer's page source, where any employee with devtools has Rooftop's
 * API access to that business until somebody notices and revokes it. The route
 * that consumes this fetches the src server-side and serves the result from our
 * own origin, so the token never leaves the server.
 *
 * Formats are the ones this product actually runs (see the ad set's
 * `publisher_platforms`). Asking for a placement the ad set does not target
 * returns a preview of something the dealer will never see.
 */
export { PREVIEW_FORMATS, type PreviewFormat } from './buckets-preview';

/**
 * The preview URL for one creative in one format, or null.
 *
 * Null rather than throwing: a placement Meta declines to render is a missing
 * tab, not a broken screen, and `INSTAGRAM_STANDARD` legitimately fails on an
 * ad set with no Instagram placement.
 */
export async function previewUrlForCreative(
  token: string,
  creativeId: string,
  format: PreviewFormat,
): Promise<string | null> {
  try {
    const res = await graphEdge<{ body?: string }>(`/${creativeId}/previews`, {
      token,
      params: { ad_format: format },
      maxPages: 1,
    });

    const body = res[0]?.body;
    if (!body) return null;

    /*
     * Meta returns markup, not a URL, so the src has to come out of it. A
     * regex over an HTML fragment is ordinarily a bad idea; here the fragment
     * is a single iframe generated by a template and the alternative is an HTML
     * parser in a server module for one attribute. The `&amp;` unescape matters
     * — the body is HTML-escaped and the raw src would 400 on the second param.
     */
    const match = body.match(/src="([^"]+)"/);
    if (!match?.[1]) return null;
    return match[1].replace(/&amp;/g, '&');
  } catch (err) {
    console.warn(
      '[meta] preview unavailable ' +
        JSON.stringify({
          creativeId,
          format,
          code: err instanceof MetaApiError ? err.code : null,
          subcode: err instanceof MetaApiError ? err.subcode : null,
        }),
    );
    return null;
  }
}
