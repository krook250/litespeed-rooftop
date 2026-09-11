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
export const PREVIEW_FORMATS = [
  { key: 'MOBILE_FEED_STANDARD', label: 'Facebook feed' },
  { key: 'INSTAGRAM_STANDARD', label: 'Instagram' },
  { key: 'FACEBOOK_STORY_MOBILE', label: 'Story' },
] as const;

export type PreviewFormat = (typeof PREVIEW_FORMATS)[number]['key'];
