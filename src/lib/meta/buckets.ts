/**
 * Which vehicles a campaign targets.
 *
 * PURE, AND NOT `server-only`, ON PURPOSE. `campaigns.ts` is server-only because
 * it holds tokens; the shelf list is just labels and numbers, and both the
 * dealer Ad Desk and the ops panel need to render it. Until this file existed
 * they each carried their own hardcoded copy of the list — three definitions of
 * the same thing, and the two in the components had already drifted (no `min`,
 * no `max`, so nothing stopped them offering a shelf the filter did not
 * implement). Import the list from here everywhere.
 *
 * WHY `all` IS FIRST AND IS THE DEFAULT
 *
 * The three aging shelves came from the Lot Walk buckets, and the App Review
 * screencast leaned on them — "the 46-to-60-day shelf is a real conversation at
 * a real Monday morning meeting" is the argument that justified
 * `ads_management`. Good feature, wrong default, and for a while the only
 * option: every shelf had `min >= 31`, so a car that had just been made
 * front-line ready could not be advertised by this product at all for its first
 * month, and a twenty-car lot had no way to say "run all twenty".
 *
 * A dealer onboarded with their whole inventory in one day has every unit at
 * the same age, so all three shelves were empty on a full catalog. Meta refuses
 * an empty product set with subcode 1798130, whose old copy blamed the feed.
 * That cost a real dealer most of a day. Aging targeting is the specialisation;
 * "advertise my cars" is the job.
 */

export const CAMPAIGN_BUCKETS = [
  { key: 'all', label: 'All front-line vehicles', min: null, max: null },
  /*
   * `min: 0`, not 1, despite the label. `days_on_lot` is whole days since
   * acquisition, so a unit that arrived this morning is 0 — and a dealer counts
   * that as day one. Starting this shelf at 1 would re-open, one day wide,
   * exactly the hole this file was written to close.
   */
  { key: 'age_1_30', label: '1–30 days', min: 0, max: 30 },
  { key: 'age_31_45', label: '31–45 days', min: 31, max: 45 },
  { key: 'age_46_60', label: '46–60 days', min: 46, max: 60 },
  { key: 'age_61_plus', label: '61+ days', min: 61, max: null },
] as const;

export type CampaignBucket = (typeof CAMPAIGN_BUCKETS)[number];
export type BucketKey = CampaignBucket['key'];

/** What a form posts when the dealer leaves the select alone. */
export const DEFAULT_BUCKET: BucketKey = 'all';

export function bucketByKey(key: string | null | undefined): CampaignBucket {
  return CAMPAIGN_BUCKETS.find((b) => b.key === key) ?? CAMPAIGN_BUCKETS[0];
}

export function isBucketKey(key: string): key is BucketKey {
  return CAMPAIGN_BUCKETS.some((b) => b.key === key);
}

/**
 * The product-set filter. Both day bounds are optional, which is what makes
 * `all` expressible — it is the same filter with neither clause, not a special
 * case threaded through the caller.
 */
export function bucketFilter(bucket: CampaignBucket) {
  const clauses: Record<string, unknown>[] = [
    { availability: { eq: 'available' } },
    // Only units the feed marked Marketplace-clean. Without this the ad set
    // happily targets vehicles Meta will refuse to show on the surface the
    // dealer actually asked for, and the money goes somewhere they did not
    // choose. See `src/lib/meta/feed-spec.ts`.
    { custom_label_1: { eq: 'mkt_ok' } },
  ];
  if (bucket.min != null) clauses.push({ days_on_lot: { gte: bucket.min } });
  if (bucket.max != null) clauses.push({ days_on_lot: { lte: bucket.max } });
  return { and: clauses };
}
