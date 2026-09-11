/**
 * Preview placements, as labels.
 *
 * Split out of `campaigns.ts` for the same reason `buckets.ts` was: that file is
 * `server-only` because it holds tokens, and a client component cannot import a
 * value from it. The alternative is a second hardcoded copy of this list in the
 * panel, which is precisely the drift that put two different shelf lists in the
 * codebase — see the note at the top of `buckets.ts`.
 *
 * `campaigns.ts` re-exports `PREVIEW_FORMATS` from here, so server callers can
 * keep importing it from where the preview function lives.
 */
/**
 * THE TABS MUST MATCH THE PLACEMENTS THE AD SET ACTUALLY TARGETS.
 *
 * `createDemoCampaign` sends `facebook_positions: ['feed', 'marketplace',
 * 'search']` and `instagram_positions: ['stream']`. The first version of this
 * list offered a Story tab, which no campaign this product builds will ever run
 * in — showing a dealer an ad they cannot get is worse than showing them
 * nothing — and omitted Marketplace, which for a used-car lot is the placement
 * that matters most: open to everyone, no allowlist, and where car shoppers
 * actually look (`claude/meta-marketplace.md` §2).
 *
 * If the placement list in `campaigns.ts` changes, this changes with it. They
 * are two halves of one claim about where the money goes.
 *
 * `search` has no preview format of its own; Meta renders it as the feed unit.
 */
export const PREVIEW_FORMATS = [
  { key: 'MOBILE_FEED_STANDARD', label: 'Facebook feed' },
  { key: 'MARKETPLACE_MOBILE', label: 'Marketplace' },
  { key: 'INSTAGRAM_STANDARD', label: 'Instagram' },
] as const;

export type PreviewFormat = (typeof PREVIEW_FORMATS)[number]['key'];
