import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { appOrigin } from '@/lib/meta/connect';
import {
  buildDealerCenterFeed,
  dcFilename,
  DEALERCENTER_FILE_STATUSES,
  dealerCenterBlocker,
  liveWindow,
  toCsv,
  type DcBuildResult,
  type DcPhoto,
  type DcVehicle,
} from './feed-spec';

/**
 * Rooftop Auto — loading a DealerCenter file out of the database.
 *
 * Same split as the CarGurus and Meta loaders: `feed-spec.ts` is pure so the
 * preview screen and the pushed file cannot drift, and everything that touches
 * Postgres is here.
 *
 * TWO THINGS ARE STRUCTURALLY DIFFERENT FROM EVERY OTHER FEED IN THIS CODEBASE.
 *
 * 1. **One file per dealer, named after his DCID.** There is no combined batch
 *    and no `combineFeeds` equivalent — DealerCenter identifies the account from
 *    the first column and the filename, so a merged file has nowhere to go.
 *
 * 2. **Cost goes out.** Every other feed spec in here treats `cost`, `pack` and
 *    `reconCost` as internal and the projections are written to keep them in the
 *    building. This destination is the dealer's own DMS — the system he desks
 *    deals and books gross in — so withholding his own cost from it would be
 *    withholding his data from himself. `cost` is therefore selected on purpose
 *    below, and that line is the one thing in this file that must never be
 *    copy-pasted into a marketplace loader.
 */

export const DEALERCENTER_CHANNEL_KEY = 'dealercenter';

export type DealerCenterFeed = {
  rooftopId: string;
  rooftopName: string;
  slug: string;
  /** The DCID this file is addressed to. Empty when the connection has none. */
  dcid: string;
  /** `DCID_YYYYMMDD.csv`. Empty when there is no DCID to name it after. */
  filename: string;
  built: DcBuildResult;
  csv: string;
  counts: {
    /** Units considered — live inventory for this lot. */
    considered: number;
    /** Rows actually written. */
    sent: number;
    /** Held out, with reasons on `built.vehicles`. */
    excluded: number;
  };
  /** Null when this rooftop has no DealerCenter connection row at all. */
  connectionStatus: string | null;
  /**
   * Why this file must not be sent, or null when it is sendable.
   *
   * A returned feed is always inspectable — an operator can read the CSV and the
   * per-vehicle reasons on screen even when this is set. It is the transport's
   * job to refuse on it, and the transport must.
   */
  blocker: string | null;
};

/**
 * Build the file for one rooftop.
 *
 * Returns null when the rooftop does not exist. Callers are responsible for
 * having checked tenant scope first; this function does not do it, exactly like
 * the other feed loaders, and every caller must.
 */
export async function loadDealerCenterFeed(
  rooftopId: string,
  now: Date = new Date(),
): Promise<DealerCenterFeed | null> {
  const lotRows = await db.select().from(t.rooftops).where(eq(t.rooftops.id, rooftopId)).limit(1);
  const lot = lotRows[0];
  if (!lot) return null;

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
          eq(t.channels.key, DEALERCENTER_CHANNEL_KEY),
        ),
      )
      .limit(1)
  )[0];

  /**
   * THE DCID HAS NO FALLBACK, and this is the one place that differs sharply
   * from `loadCarGurusFeed`, which happily falls back to `rooftops.id`.
   *
   * CarGurus said in writing that any unique dealer id of ours is fine.
   * DealerCenter did the opposite and named the number. A file whose first
   * column is a cuid is a file DealerCenter cannot attach to an account, and
   * nothing about that failure is loud: the upload succeeds, their importer
   * finds no matching dealer, and the dealer is told by us that his inventory
   * is flowing. So a missing DCID produces a blocker rather than a guess.
   */
  const dcid = (conn?.providerDealerId ?? '').trim();

  const cols = {
    id: t.vehicles.id,
    vin: t.vehicles.vin,
    stockNumber: t.vehicles.stockNumber,
    vehicleType: t.vehicles.vehicleType,
    year: t.vehicles.year,
    make: t.vehicles.make,
    model: t.vehicles.model,
    trim: t.vehicles.trim,
    bodyStyle: t.vehicles.bodyStyle,
    doors: t.vehicles.doors,
    engine: t.vehicles.engine,
    cylinders: t.vehicles.cylinders,
    transmission: t.vehicles.transmission,
    drivetrain: t.vehicles.drivetrain,
    fuelType: t.vehicles.fuelType,
    mpgCity: t.vehicles.mpgCity,
    mpgHwy: t.vehicles.mpgHwy,
    exteriorColor: t.vehicles.exteriorColor,
    interiorColor: t.vehicles.interiorColor,
    mileage: t.vehicles.mileage,
    price: t.vehicles.price,
    salePrice: t.vehicles.salePrice,
    msrp: t.vehicles.msrp,
    /* His own cost, into his own DMS. See the header note — deliberate, and
     * deliberately absent from every marketplace projection. */
    cost: t.vehicles.cost,
    status: t.vehicles.status,
    isCertified: t.vehicles.isCertified,
    description: t.vehicles.description,
    options: t.vehicles.options,
    features: t.vehicles.features,
    acquiredDate: t.vehicles.acquiredDate,
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

  const photosBy = new Map<string, DcPhoto[]>();
  for (const p of photoRows) {
    const list = photosBy.get(p.vehicleId) ?? [];
    list.push({ url: p.url, sortOrder: p.sortOrder, isPrimary: p.isPrimary });
    photosBy.set(p.vehicleId, list);
  }

  const vehicles: DcVehicle[] = rows.map((r) => ({ ...r, photos: photosBy.get(r.id) ?? [] }));

  const scoped = liveWindow(vehicles);

  const built = buildDealerCenterFeed(
    scoped,
    {
      id: lot.id,
      dcid,
      name: lot.name,
      addressLine1: lot.addressLine1,
      city: lot.city,
      state: lot.state,
      postalCode: lot.postalCode,
      phone: lot.phone,
      leadEmail: conn?.leadEmail || `leads-${lot.id}@inbound.rooftopauto.com`,
    },
    {
      // The app origin, not the storefront. The two diverge the moment a dealer
      // is on their own domain: photos are only ever served by the app.
      photoBase: appOrigin().replace(/\/$/, ''),
    },
  );

  return {
    rooftopId: lot.id,
    rooftopName: lot.name,
    slug: lot.slug,
    dcid,
    filename: dcid ? dcFilename(dcid, now) : '',
    built,
    csv: toCsv(built.columns, built.rows),
    counts: {
      considered: scoped.length,
      sent: built.rows.length,
      excluded: built.vehicles.filter((v) => v.row === null).length,
    },
    connectionStatus: conn?.status ?? null,
    blocker: dealerCenterBlocker({
      dcid,
      status: conn?.status ?? null,
      sent: built.rows.length,
    }),
  };
}

/* ------------------------------------------------------- the nightly files */

/**
 * Every rooftop whose inventory belongs in tonight's DealerCenter run.
 *
 * CROSS-TENANT BY CONSTRUCTION, and not in `src/lib/ops/` for the same reason
 * `carGurusBatchRooftops` is not: `requireStaff()` reads request headers and the
 * only caller is a scheduled job with no request and no session. **The authority
 * here is `CRON_SECRET` on the route, not a signed-in user.** Nothing that takes
 * a session may call this.
 */
export async function dealerCenterBatchRooftops(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: t.rooftops.id, name: t.rooftops.name })
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
    .where(
      and(
        eq(t.channels.key, DEALERCENTER_CHANNEL_KEY),
        inArray(t.channelConnections.status, [...DEALERCENTER_FILE_STATUSES]),
        // The demo lot is not a dealership and its invented VINs must never
        // reach a real dealer's DMS. Same rule as the CarGurus batch.
        eq(t.dealerGroups.isDemo, false),
      ),
    )
    .orderBy(asc(t.rooftops.name));
}

export type DealerCenterRun = {
  /** Rooftops eligible by connection state, whether or not they produced a file. */
  considered: number;
  /** One entry per rooftop, sendable or not. The transport skips any blocker. */
  files: DealerCenterFeed[];
  warnings: string[];
};

/**
 * Build tonight's file for every eligible rooftop.
 *
 * Goes through `loadDealerCenterFeed` per rooftop rather than one wide query, so
 * that the file an operator previews for one dealer and the file we push are the
 * same code path and cannot drift. Rooftop counts are in the tens; when that
 * stops being true this is a query to widen, not an architecture to change.
 *
 * Does NOT decide whether to upload — every file carries its own `blocker` and
 * the transport is what refuses. Nothing here opens a connection.
 */
export async function loadDealerCenterRun(now: Date = new Date()): Promise<DealerCenterRun> {
  const lots = await dealerCenterBatchRooftops();
  const files: DealerCenterFeed[] = [];
  const warnings: string[] = [];

  for (const lot of lots) {
    const feed = await loadDealerCenterFeed(lot.id, now);
    if (!feed) {
      // Deleted between the two queries. Vanishingly rare, still worth a line
      // rather than a silently shorter run.
      warnings.push(`Rooftop ${lot.id} disappeared while the run was building.`);
      continue;
    }
    if (feed.blocker) warnings.push(`${feed.rooftopName}: ${feed.blocker}`);
    files.push(feed);
  }

  return { considered: lots.length, files, warnings };
}
