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
import { buildFeed, fullWindow, type FeedPhoto, type FeedVehicle } from './feed-spec';

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
};

export async function previewFeed(rooftopId: string): Promise<FeedPreview | null> {
  await requireGroupId();
  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return null;

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
    excluded: built.vehicles.filter((v) => v.row === null).length,
    // Feed-blocking problems first — those are cars that are not being
    // advertised at all, which is the more urgent sentence.
    reasons: [...groups.values()].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'FEED' ? -1 : 1;
      return b.count - a.count;
    }),
  };
}
