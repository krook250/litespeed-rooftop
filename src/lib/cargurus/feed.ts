import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { appOrigin } from '@/lib/meta/connect';
import { dealerSiteBase } from '@/lib/storefront-url';
import {
  buildCarGurusFeed,
  CARGURUS_FILE_STATUSES,
  combineFeeds,
  liveWindow,
  toCsv,
  type CgBatch,
  type CgBatchPart,
  type CgBuildResult,
  type CgPhoto,
  type CgVehicle,
} from './feed-spec';

/**
 * Rooftop Auto — loading a CarGurus upload out of the database.
 *
 * The split between this file and `feed-spec.ts` is the same one the Meta feed
 * uses and exists for the same reason: the builder is pure so it can be tested
 * without a database and so a preview screen and the real file cannot drift
 * apart. Everything that touches Postgres is here.
 */

export const CARGURUS_CHANNEL_KEY = 'cargurus';

/**
 * Where CarGurus should send leads for this rooftop when nothing else is set.
 *
 * Per-connection `leadEmail` wins when it is populated. This fallback exists so
 * that a rooftop whose connection row predates the column still emits a working
 * address rather than an empty required field — CarGurus lists Dealer CRM Email
 * as required, and a blank one is a rejected file for the sake of a default we
 * could have computed.
 */
export function defaultLeadEmail(rooftopId: string): string {
  return `leads-${rooftopId}@inbound.rooftopauto.com`;
}

export type CarGurusFeed = {
  rooftopId: string;
  rooftopName: string;
  slug: string;
  built: CgBuildResult;
  csv: string;
  counts: {
    /** Units considered — live inventory for this lot. */
    considered: number;
    /** Rows actually written. */
    sent: number;
    /** Held out, with reasons on `built.vehicles`. */
    excluded: number;
  };
  /** Null when this rooftop has no CarGurus connection row at all. */
  connectionStatus: string | null;
};

/**
 * Build the file for one rooftop.
 *
 * NOTHING INTERNAL LEAVES THE BUILDING. `cost`, `pack`, `reconCost` and
 * `marketValue` sit on these same rows and are none of CarGurus' business, so
 * the projection below is explicit — a bare `select()` here would syndicate the
 * lot's margin to a public marketplace. Same rule, same reason, as the Meta
 * feed route.
 *
 * Returns null when the rooftop does not exist. Callers are responsible for
 * having checked tenant scope first; this function does not do it, exactly like
 * the other feed builders, and every caller must.
 */
export async function loadCarGurusFeed(rooftopId: string): Promise<CarGurusFeed | null> {
  const lotRows = await db.select().from(t.rooftops).where(eq(t.rooftops.id, rooftopId)).limit(1);
  const lot = lotRows[0];
  if (!lot) return null;

  // The connection carries the two things that are per-channel rather than
  // per-lot: which dealer id CarGurus expects, and where leads go back to.
  const conn = (
    await db
      .select({
        status: t.channelConnections.status,
        leadEmail: t.channelConnections.leadEmail,
        providerDealerId: t.channelConnections.providerDealerId,
      })
      .from(t.channelConnections)
      .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
      .where(
        and(
          eq(t.channelConnections.rooftopId, rooftopId),
          eq(t.channels.key, CARGURUS_CHANNEL_KEY),
        ),
      )
      .limit(1)
  )[0];

  const cols = {
    id: t.vehicles.id,
    vin: t.vehicles.vin,
    stockNumber: t.vehicles.stockNumber,
    year: t.vehicles.year,
    make: t.vehicles.make,
    model: t.vehicles.model,
    trim: t.vehicles.trim,
    transmission: t.vehicles.transmission,
    engine: t.vehicles.engine,
    exteriorColor: t.vehicles.exteriorColor,
    interiorColor: t.vehicles.interiorColor,
    mileage: t.vehicles.mileage,
    price: t.vehicles.price,
    salePrice: t.vehicles.salePrice,
    msrp: t.vehicles.msrp,
    status: t.vehicles.status,
    isCertified: t.vehicles.isCertified,
    description: t.vehicles.description,
    options: t.vehicles.options,
    features: t.vehicles.features,
  };

  const rows = await db
    .select(cols)
    .from(t.vehicles)
    .where(eq(t.vehicles.rooftopId, rooftopId))
    .orderBy(desc(t.vehicles.acquiredDate));

  const ids = rows.map((r) => r.id);
  const photoRows = ids.length
    ? await db
        .select({
          vehicleId: t.vehiclePhotos.vehicleId,
          url: t.vehiclePhotos.url,
          sortOrder: t.vehiclePhotos.sortOrder,
          isPrimary: t.vehiclePhotos.isPrimary,
        })
        .from(t.vehiclePhotos)
        .where(inArray(t.vehiclePhotos.vehicleId, ids))
    : [];

  const photosBy = new Map<string, CgPhoto[]>();
  for (const p of photoRows) {
    const list = photosBy.get(p.vehicleId) ?? [];
    list.push({ url: p.url, sortOrder: p.sortOrder, isPrimary: p.isPrimary });
    photosBy.set(p.vehicleId, list);
  }

  const vehicles: CgVehicle[] = rows.map((r) => ({ ...r, photos: photosBy.get(r.id) ?? [] }));

  // Sold units leave the file entirely — see `liveWindow`. This is the whole
  // removal mechanism until CarGurus tells us what `Operation` means.
  const scoped = liveWindow(vehicles);

  const built = buildCarGurusFeed(
    scoped,
    {
      id: lot.id,
      dealerId: conn?.providerDealerId || lot.id,
      name: lot.name,
      addressLine1: lot.addressLine1,
      city: lot.city,
      state: lot.state,
      postalCode: lot.postalCode,
      phone: lot.phone,
      latitude: lot.latitude,
      longitude: lot.longitude,
      leadEmail: conn?.leadEmail || defaultLeadEmail(lot.id),
    },
    {
      // photoBase is the app origin, not the storefront. The two diverge the
      // moment a dealer is on their own domain: the storefront lives at
      // cascademotorswa.com while photos are only ever served by the app.
      photoBase: appOrigin().replace(/\/$/, ''),
      siteBase: await dealerSiteBase(rooftopId),
    },
  );

  return {
    rooftopId: lot.id,
    rooftopName: lot.name,
    slug: lot.slug,
    built,
    csv: toCsv(built.columns, built.rows),
    counts: {
      considered: scoped.length,
      sent: built.rows.length,
      excluded: built.vehicles.filter((v) => v.row === null).length,
    },
    connectionStatus: conn?.status ?? null,
  };
}

/* ------------------------------------------------------- the nightly file */

/**
 * Every rooftop whose cars belong in the next upload, in file order.
 *
 * CROSS-TENANT BY CONSTRUCTION, AND DELIBERATELY NOT IN `src/lib/ops/`.
 *
 * The rule in this codebase is that cross-tenant reads live in
 * `src/lib/ops/queries.ts` behind `requireStaff()`, so an audit reads one file.
 * This query cannot go there: `requireStaff()` reads request headers, and the
 * only caller of this is a scheduled job with no request and no session. The
 * same is already true of the domain-nudge sweep, which reads storefronts for
 * every tenant on the platform.
 *
 * So the gate is different in kind, and it is worth naming: **the authority
 * here is `CRON_SECRET` on the route, not a signed-in user.** Nothing that
 * takes a session may call this. If a screen ever needs the batch, it goes
 * through `src/lib/ops/queries.ts` and calls this from behind `requireStaff()`.
 */
export async function carGurusBatchRooftops(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: t.rooftops.id, name: t.rooftops.name })
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .where(
      and(
        eq(t.channels.key, CARGURUS_CHANNEL_KEY),
        inArray(t.channelConnections.status, [...CARGURUS_FILE_STATUSES]),
      ),
    )
    .orderBy(asc(t.rooftops.name));
}

export type CarGurusBatch = CgBatch & {
  /** Rooftops eligible by connection state, whether or not they contributed rows. */
  considered: number;
};

/**
 * Build the combined file for every eligible rooftop.
 *
 * Goes through `loadCarGurusFeed` per rooftop rather than issuing one wide
 * query across all of them. That is more round trips, and it is the right
 * trade: it makes the file an operator downloads for one dealer and the file we
 * push to CarGurus *the same code path*, so they cannot drift. A bug found in
 * one is fixed in both. Rooftop counts here are in the tens for the foreseeable
 * future; when that stops being true this is a query to widen, not an
 * architecture to change.
 *
 * Note what this does NOT do: decide whether to upload. An empty or suspiciously
 * short file is a delisting event on a destination whose only removal mechanism
 * is absence, and that judgement belongs to the caller with the previous run in
 * hand — not to a builder that has only ever seen tonight.
 */
export async function loadCarGurusBatch(): Promise<CarGurusBatch> {
  const lots = await carGurusBatchRooftops();
  const parts: CgBatchPart[] = [];
  const missing: string[] = [];

  for (const lot of lots) {
    const feed = await loadCarGurusFeed(lot.id);
    if (!feed) {
      // The rooftop was deleted between the two queries. Vanishingly rare and
      // still worth a line rather than a silently shorter file.
      missing.push(lot.id);
      continue;
    }
    parts.push({ rooftopId: feed.rooftopId, rooftopName: feed.rooftopName, built: feed.built });
  }

  const batch = combineFeeds(parts);
  for (const id of missing) {
    batch.warnings.push(`Rooftop ${id} disappeared while the batch was building.`);
  }

  return { ...batch, considered: lots.length };
}
