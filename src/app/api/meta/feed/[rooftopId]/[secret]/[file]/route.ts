/**
 * The vehicle feed Meta fetches.
 *
 * `provisionRooftop` hands Meta two URLs and Meta pulls them on a schedule:
 *
 *   /api/meta/feed/{rooftopId}/{secret}/vehicles.tsv        daily, full replace
 *   /api/meta/feed/{rooftopId}/{secret}/vehicles-delta.tsv  hourly, upsert only
 *
 * FOUR THINGS THIS HANDLER EXISTS TO GET RIGHT
 *
 * 1. **The secret is the authorisation, and it is compared in constant time.**
 *    Meta fetches this unauthenticated from a URL we gave it, so there is no
 *    session and no tenant scope to lean on — which is why this is the one
 *    route in the app that reads vehicles without going through
 *    `src/lib/scoped-db.ts`. The rooftop id in the path is not trusted on its
 *    own; it is only ever paired with the secret stored on that exact row, so a
 *    guessed rooftop id gets a 404 like anything else. `safeEqual` is from
 *    `src/lib/meta/tokens.ts`, and the miss path does a decoy compare so a
 *    wrong id and a wrong secret take the same time.
 *
 * 2. **Full and delta are genuinely different files, not the same file twice.**
 *    The daily `schedule` is a full replace: items absent from it are deleted,
 *    and Meta is explicit that deletion destroys a vehicle's accumulated
 *    delivery history. So the full file carries live inventory *plus* recently
 *    sold units marked `not_available`, and the delta carries only what moved.
 *
 * 3. **Nothing internal leaves the building.** `cost`, `pack`, `reconCost` and
 *    `marketValue` are on the same rows and are none of Meta's business. The
 *    projection below is explicit for that reason — a `select()` with no
 *    argument here would syndicate the lot's margin.
 *
 * 4. **Ineligible units are counted, not silently dropped.** The reasons live
 *    in `feed-spec.ts` and are surfaced to the dealer in the Ad Desk; this
 *    handler additionally reports the tally in response headers so a support
 *    question — "why does Facebook show 34 cars when I have 41?" — is
 *    answerable from a `curl -I` rather than a database session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { safeEqual } from '@/lib/meta/tokens';
import { appOrigin } from '@/lib/meta/connect';
import {
  blocksFeed,
  buildFeed,
  fullWindow,
  toTsv,
  type FeedPhoto,
  type FeedVehicle,
} from '@/lib/meta/feed-spec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How far back a delta reaches.
 *
 * The hourly schedule wants an hour, but an hour exactly is wrong: a fetch that
 * runs three minutes late, or a scheduled run Meta skips, would drop every
 * change in the gap and it would never be noticed — the next full replace six
 * hours later would quietly fix it and nobody would learn anything. Three hours
 * of overlap costs a few extra rows per fetch and makes a missed run a
 * non-event. The delta is an upsert; re-sending an unchanged row is free.
 */
const DELTA_WINDOW_MS = 3 * 60 * 60 * 1000;

const FILES = {
  'vehicles.tsv': 'full',
  'vehicles-delta.tsv': 'delta',
} as const;

/** Same body for every rejection, so probing tells you nothing. */
function notFound() {
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ rooftopId: string; secret: string; file: string }> },
) {
  const { rooftopId, secret, file } = await ctx.params;

  const mode = FILES[file as keyof typeof FILES];
  if (!mode) return notFound();

  const assetRows = await db
    .select({
      feedSecret: t.metaRooftopAssets.feedSecret,
      pageId: t.metaRooftopAssets.pageId,
    })
    .from(t.metaRooftopAssets)
    .where(eq(t.metaRooftopAssets.rooftopId, rooftopId))
    .limit(1);

  const asset = assetRows[0];
  // Decoy compare on the miss path. Without it, an unprovisioned rooftop id
  // returns measurably faster than a provisioned one with a bad secret, which
  // hands an attacker a free oracle for which lots exist.
  if (!asset?.feedSecret) {
    safeEqual(secret, 'x'.repeat(secret.length));
    return notFound();
  }
  if (!safeEqual(secret, asset.feedSecret)) return notFound();

  const lotRows = await db
    .select()
    .from(t.rooftops)
    .where(eq(t.rooftops.id, rooftopId))
    .limit(1);
  const lot = lotRows[0];
  if (!lot) return notFound();

  const now = new Date();

  /*
   * Explicit projection. Everything the feed spec needs and nothing else —
   * see note 3 above.
   */
  const cols = {
    id: t.vehicles.id,
    vin: t.vehicles.vin,
    stockNumber: t.vehicles.stockNumber,
    year: t.vehicles.year,
    make: t.vehicles.make,
    model: t.vehicles.model,
    trim: t.vehicles.trim,
    bodyStyle: t.vehicles.bodyStyle,
    transmission: t.vehicles.transmission,
    drivetrain: t.vehicles.drivetrain,
    fuelType: t.vehicles.fuelType,
    exteriorColor: t.vehicles.exteriorColor,
    interiorColor: t.vehicles.interiorColor,
    mileage: t.vehicles.mileage,
    price: t.vehicles.price,
    salePrice: t.vehicles.salePrice,
    status: t.vehicles.status,
    isCertified: t.vehicles.isCertified,
    description: t.vehicles.description,
    acquiredDate: t.vehicles.acquiredDate,
    frontLineDate: t.vehicles.frontLineDate,
    soldDate: t.vehicles.soldDate,
  };

  const where =
    mode === 'delta'
      ? and(
          eq(t.vehicles.rooftopId, rooftopId),
          gte(t.vehicles.updatedAt, new Date(now.getTime() - DELTA_WINDOW_MS)),
        )
      : eq(t.vehicles.rooftopId, rooftopId);

  const rows = await db.select(cols).from(t.vehicles).where(where).orderBy(desc(t.vehicles.acquiredDate));

  const ids = rows.map((r) => r.id);
  const photoRows = ids.length
    ? await db
        .select({
          vehicleId: t.vehiclePhotos.vehicleId,
          url: t.vehiclePhotos.url,
          tag: t.vehiclePhotos.tag,
          sortOrder: t.vehiclePhotos.sortOrder,
          isPrimary: t.vehiclePhotos.isPrimary,
        })
        .from(t.vehiclePhotos)
        .where(inArray(t.vehiclePhotos.vehicleId, ids))
    : [];

  const photosBy = new Map<string, FeedPhoto[]>();
  for (const p of photoRows) {
    const list = photosBy.get(p.vehicleId) ?? [];
    list.push({ url: p.url, tag: p.tag, sortOrder: p.sortOrder, isPrimary: p.isPrimary });
    photosBy.set(p.vehicleId, list);
  }

  const vehicles: FeedVehicle[] = rows.map((r) => ({
    ...r,
    photos: photosBy.get(r.id) ?? [],
  }));

  // The full replace is the file that deletes; the delta never does, so a sold
  // unit in a delta belongs there as `not_available` regardless of its age.
  const scoped = mode === 'full' ? fullWindow(vehicles, now) : vehicles;

  const built = buildFeed(
    scoped,
    {
      id: lot.id,
      name: lot.name,
      addressLine1: lot.addressLine1,
      city: lot.city,
      state: lot.state,
      postalCode: lot.postalCode,
      phone: lot.phone,
      latitude: lot.latitude,
      longitude: lot.longitude,
      pageId: asset.pageId,
    },
    // `photoBase` is the app origin, not `siteBase`. They diverge the moment a
    // dealer is on their own domain: the storefront lives at
    // cascademotorswa.com while /api/photo is only ever served by the app.
    { siteBase: await siteBaseFor(rooftopId), photoBase: appOrigin().replace(/\/$/, ''), now, mode },
  );

  const tsv = toTsv(built.columns, built.rows);
  const excluded = built.vehicles.filter((v) => v.row === null).length;
  const held = built.vehicles.filter((v) => v.row !== null && v.issues.length > 0).length;

  // Best-effort bookkeeping. A failed write here must not fail the fetch —
  // Meta retries on a non-200 and a broken timestamp is not worth a retry.
  try {
    await db
      .update(t.metaRooftopAssets)
      .set({ lastFeedPushAt: now })
      .where(eq(t.metaRooftopAssets.rooftopId, rooftopId));
  } catch {
    /* ignore */
  }

  return new NextResponse(tsv, {
    status: 200,
    headers: {
      // The extension in the URL is what Meta actually keys the parser off, but
      // send the honest type anyway.
      'content-type': 'text/tab-separated-values; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      // Nothing here is a credential, and it turns "why 34 and not 41?" into a
      // one-line answer.
      'x-rooftop-feed-mode': mode,
      'x-rooftop-feed-rows': String(built.rows.length),
      'x-rooftop-feed-excluded': String(excluded),
      'x-rooftop-feed-marketplace-held': String(held),
      // A feed URL is unguessable, not secret-forever. Keep it out of indexes
      // and out of referrer headers on anything it ever links to.
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    },
  });
}

/**
 * Where this lot's vehicle detail pages live.
 *
 * A dealer on their own domain gets `https://theirdomain.com/{stock}`, because
 * `src/proxy.ts` rewrites the host into `/s/[slug]` and the dealer never sees
 * `/s/`. Everyone else gets the shared host. Falling back to the app origin
 * rather than erroring is deliberate: a lot with no storefront yet still has a
 * working feed, and a 404 on a VDP is a better failure than no listing at all.
 */
async function siteBaseFor(rooftopId: string): Promise<string> {
  const rows = await db
    .select({ slug: t.storefronts.slug, domain: t.storefronts.domain, status: t.storefronts.domainStatus })
    .from(t.storefrontRooftops)
    .innerJoin(t.storefronts, eq(t.storefrontRooftops.storefrontId, t.storefronts.id))
    .where(eq(t.storefrontRooftops.rooftopId, rooftopId));

  const origin = appOrigin().replace(/\/$/, '');
  if (!rows.length) return origin;

  // Prefer a domain that is actually serving. A domain mid-verification would
  // put every vehicle URL in the catalog on a hostname that does not resolve.
  const live = rows.find((r) => r.domain && r.status === 'LIVE');
  if (live?.domain) return `https://${live.domain}`;

  return `${origin}/s/${rows[0]!.slug}`;
}
