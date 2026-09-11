/**
 * What the feed would send right now, and — the part that matters — what it
 * would not, and why.
 *
 * A vehicle silently missing from a placement is the single most common
 * complaint about every vendor in this category (`claude/meta-marketplace.md`
 * §3). The whole value of this module is that it turns that into a sentence a
 * dealer can act on: not "34 of 41 synced", but "six units need a second photo
 * before Marketplace will take them, and here are three of them."
 *
 * It runs the **same builder** the live endpoint runs — not a reimplementation.
 * That is the reason `feed-spec.ts` is a pure module with no database and no
 * `next/*` imports: a preview that can disagree with the file Meta actually
 * fetches is worse than no preview, because it is trusted.
 *
 * Not a `'use server'` module on purpose. Nothing here is invoked from a form;
 * the Ad Desk calls it directly while rendering. Marking it `'use server'` would
 * publish it as a callable endpoint for no benefit.
 */

import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { buildFeed, fullWindow, type FeedPhoto, type FeedRow, type FeedVehicle } from './feed-spec';
import { CAMPAIGN_BUCKETS, type BucketKey } from './buckets';

export type FeedReasonGroup = {
  code: string;
  scope: 'FEED' | 'MARKETPLACE';
  reason: string;
  fix: string;
  count: number;
  /** Up to three stock numbers, so the dealer can go and fix a real car. */
  examples: string[];
};

export type FeedPreview = {
  rooftopName: string;
  /** Units considered — live inventory plus anything sold inside the grace window. */
  total: number;
  /** Rows Meta will receive. */
  included: number;
  /** In the catalog, but not eligible for the Marketplace surface. */
  marketplaceHeld: number;
  /** Not sent at all. */
  excluded: number;
  reasons: FeedReasonGroup[];
  /**
   * How many cars each shelf holds right now.
   *
   * Counted off the rows Meta will actually receive, with the same two clauses
   * `bucketFilter()` puts in the product set — available, and Marketplace-clean
   * — so the number on the group editor is the number the ad set will target.
   * A count computed off `vehicles` instead would be a different, friendlier,
   * wrong number, and the dealer would find out which one was true by spending
   * money.
   */
  shelfCounts: Record<BucketKey, number>;
};

/** The shelf counts, from built feed rows. Mirrors `bucketFilter()` exactly. */
function countShelves(rows: FeedRow[]): Record<BucketKey, number> {
  const targetable = rows.filter(
    (r) => r.availability === 'available' && r.custom_label_1 === 'mkt_ok',
  );
  const out = {} as Record<BucketKey, number>;
  for (const b of CAMPAIGN_BUCKETS) {
    out[b.key] = targetable.filter((r) => {
      const days = Number(r.days_on_lot);
      if (!Number.isFinite(days)) return false;
      if (b.min != null && days < b.min) return false;
      if (b.max != null && days > b.max) return false;
      return true;
    }).length;
  }
  return out;
}

/**
 * The dealer's own preview, scoped to their session.
 *
 * Rooftop staff reach the same numbers for somebody else's lot through
 * `previewFeedFor` below, under `requireStaff()` instead. The split exists so
 * that the scope check is a visible line in exactly one of them rather than a
 * flag threaded through both.
 */
export async function previewFeed(rooftopId: string): Promise<FeedPreview | null> {
  await requireGroupId();
  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return null;
  return previewFeedFor(rooftop);
}

/**
 * The same counts, for a rooftop row the caller has ALREADY authorized.
 *
 * Takes a row rather than an id for the reason spelled out in
 * `src/lib/meta/campaign-build.ts`: a row can only have come from a query the
 * caller ran through its own guard, whereas an id is a string off a form. This
 * reads inventory and nothing else — no Meta call, no token — so it is cheap
 * enough to run for every lot on an operator screen.
 */
export async function previewFeedFor(
  rooftop: typeof t.rooftops.$inferSelect,
): Promise<FeedPreview | null> {
  const rooftopId = rooftop.id;

  const [assetRow] = await db
    .select({ pageId: t.metaRooftopAssets.pageId })
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftopId))
    .limit(1);

  const vehicleRows = await db.select().from(t.vehicles).where(eq(t.vehicles.rooftopId, rooftopId));
  const ids = vehicleRows.map((v) => v.id);
  const photoRows = ids.length
    ? await db.select().from(t.vehiclePhotos).where(inArray(t.vehiclePhotos.vehicleId, ids))
    : [];

  const photosBy = new Map<string, FeedPhoto[]>();
  for (const p of photoRows) {
    const list = photosBy.get(p.vehicleId) ?? [];
    list.push({ url: p.url, tag: p.tag, sortOrder: p.sortOrder, isPrimary: p.isPrimary });
    photosBy.set(p.vehicleId, list);
  }

  const vehicles: FeedVehicle[] = vehicleRows.map((v) => ({
    ...v,
    photos: photosBy.get(v.id) ?? [],
  }));

  const built = buildFeed(
    fullWindow(vehicles),
    {
      id: rooftop.id,
      name: rooftop.name,
      addressLine1: rooftop.addressLine1,
      city: rooftop.city,
      state: rooftop.state,
      postalCode: rooftop.postalCode,
      phone: rooftop.phone,
      latitude: rooftop.latitude,
      longitude: rooftop.longitude,
      pageId: assetRow?.pageId ?? null,
    },
    // The preview only counts and explains; no URL it produces is ever fetched,
    // so the storefront lookup the live route does would be a query for nothing.
    { siteBase: 'https://example.invalid' },
  );

  const groups = new Map<string, FeedReasonGroup>();
  for (const v of built.vehicles) {
    for (const issue of v.issues) {
      const g = groups.get(issue.code);
      if (g) {
        g.count += 1;
        if (g.examples.length < 3) g.examples.push(v.stockNumber);
      } else {
        groups.set(issue.code, { ...issue, count: 1, examples: [v.stockNumber] });
      }
    }
  }

  return {
    rooftopName: rooftop.name,
    total: built.vehicles.length,
    included: built.rows.length,
    marketplaceHeld: built.vehicles.filter((v) => v.row !== null && v.issues.length > 0).length,
    shelfCounts: countShelves(built.rows),
    excluded: built.vehicles.filter((v) => v.row === null).length,
    // Feed-blocking problems first — those are cars that are not being
    // advertised at all, which is the more urgent sentence.
    reasons: [...groups.values()].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'FEED' ? -1 : 1;
      return b.count - a.count;
    }),
  };
}
