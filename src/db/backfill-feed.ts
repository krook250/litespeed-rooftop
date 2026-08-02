/**
 * Feed backfill.
 *
 * The Lot Walk emitters only fire on writes from here on. That leaves a
 * dealer's first login staring at an empty feed, which is the one thing
 * section 2 of the data-model doc says must never happen — "the feed can never
 * be empty." So on day one we replay the history the database already holds.
 *
 * Nothing here is invented. Every card comes from a row that already existed:
 *
 *   vehicles.acquiredDate   → acquired
 *   vehicles.frontLineDate  → recon_out + front_line
 *   price_changes           → price_change
 *   sales                   → sold
 *   sync_events(ERROR)      → sync_error
 *   derived thresholds      → at_risk / aged / water / vdp_milestone
 *
 * Every event is written with its **historical** createdAt, so the feed reads
 * as a timeline rather than as a wall of things that all happened at once.
 * Every emitter carries a dedupeKey, so running this twice is a no-op — which
 * is what makes it safe to offer as `npm run db:backfill` on a live database.
 */

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import {
  emitFeedEvent,
  feedAcquired,
  feedFrontLine,
  feedReconIn,
  feedReconOut,
  feedSold,
  sweepDerivedFeedEvents,
} from '@/lib/feed';
import { daysInStock, shortTitle, totalCost, usd } from '@/lib/domain';

const DAY = 86_400_000;

export type BackfillOptions = {
  rooftopIds: string[];
  /** How far back to replay. Older history stays in its own tables. */
  sinceDays?: number;
};

export async function backfillFeed(opts: BackfillOptions) {
  const { rooftopIds } = opts;
  const sinceDays = opts.sinceDays ?? 60;
  if (!rooftopIds.length) return { created: 0 };

  const since = new Date(Date.now() - sinceDays * DAY);
  let created = 0;
  const bump = (row: unknown) => {
    if (row) created++;
  };

  const vehicles = await db
    .select()
    .from(t.vehicles)
    .where(inArray(t.vehicles.rooftopId, rooftopIds));
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  const photoCounts = new Map<string, number>();
  if (vehicles.length) {
    const rows = await db
      .select({ vehicleId: t.vehiclePhotos.vehicleId, c: sql<number>`count(*)::int` })
      .from(t.vehiclePhotos)
      .where(inArray(t.vehiclePhotos.vehicleId, vehicles.map((v) => v.id)))
      .groupBy(t.vehiclePhotos.vehicleId);
    for (const r of rows) photoCounts.set(r.vehicleId, r.c);
  }

  const channelCount = new Map<string, number>();
  {
    const rows = await db
      .select({ rooftopId: t.channelConnections.rooftopId, c: sql<number>`count(*)::int` })
      .from(t.channelConnections)
      .where(
        and(
          inArray(t.channelConnections.rooftopId, rooftopIds),
          eq(t.channelConnections.status, 'CONNECTED'),
        ),
      )
      .groupBy(t.channelConnections.rooftopId);
    for (const r of rows) channelCount.set(r.rooftopId, r.c);
  }

  /* ------------------------------------------------- lifecycle from dates */

  for (const v of vehicles) {
    if (v.status === 'SOLD' || v.status === 'WHOLESALED') continue;

    if (new Date(v.acquiredDate) >= since) {
      bump(await withCreatedAt(v.acquiredDate, () => feedAcquired(v)));
    }

    /*
     * There is no "went into recon" timestamp on the vehicle — only acquired
     * and front-line. So rather than invent a date, these two cards are only
     * written for units whose *current* state is the thing being described,
     * and dated from the timestamp we do have.
     */
    if (v.status === 'IN_RECON' || v.status === 'ARRIVED') {
      bump(await withCreatedAt(v.acquiredDate, () => feedReconIn(v)));
    }

    if (v.status === 'PHOTOS_PENDING') {
      const n = photoCounts.get(v.id) ?? 0;
      bump(
        await emitFeedEvent({
          rooftopId: v.rooftopId,
          kind: 'photos',
          vehicleId: v.id,
          title: `${shortTitle(v)} is waiting on photos — ${n} of 8 up`,
          body:
            'Out of recon and priced, but the marketplaces enforce photo minimums, so it is ' +
            'only on the dealer site. This is the cheapest day of aging to buy back.',
          stats: [
            { k: 'Photos', v: `${n} / 8`, bad: n < 8 },
            { k: 'Days in stock', v: `${daysInStock(v)}d`, bad: daysInStock(v) >= 16 },
            { k: 'Tied up', v: usd(totalCost(v)) },
          ],
          dedupeKey: `photos:pending:${v.id}`,
        }),
      );
    }

    if (v.frontLineDate && new Date(v.frontLineDate) >= since) {
      const reconDays = Math.max(
        0,
        Math.round((new Date(v.frontLineDate).getTime() - new Date(v.acquiredDate).getTime()) / DAY),
      );
      bump(await withCreatedAt(v.frontLineDate, () => feedReconOut(v, reconDays)));
      bump(
        await withCreatedAt(v.frontLineDate, () =>
          feedFrontLine(v, {
            reconDays,
            photoCount: photoCounts.get(v.id) ?? 0,
            channelCount: channelCount.get(v.rooftopId) ?? 0,
          }),
        ),
      );
    }
  }

  /* --------------------------------------------------- from price_changes */

  const prices = await db
    .select()
    .from(t.priceChanges)
    .innerJoin(t.vehicles, eq(t.priceChanges.vehicleId, t.vehicles.id))
    .where(and(inArray(t.vehicles.rooftopId, rooftopIds), gte(t.priceChanges.changedAt, since)))
    .orderBy(desc(t.priceChanges.changedAt));

  for (const row of prices) {
    const pc = row.price_changes;
    const v = byId.get(pc.vehicleId);
    if (!v) continue;
    // price_change is the one kind with no natural dedupe — a unit really can
    // be repriced twice. Key it on the row id so a replay stays idempotent.
    bump(
      await emitFeedEvent({
        rooftopId: v.rooftopId,
        kind: 'price_change',
        vehicleId: v.id,
        title: `${shortTitle(v)} ${pc.newPrice < pc.oldPrice ? 'cut' : 'raised'} ${usd(
          Math.abs(pc.newPrice - pc.oldPrice),
        )} to ${usd(pc.newPrice)}`,
        body: pc.reason?.trim() || `Was ${usd(pc.oldPrice)}.`,
        stats: [
          {
            k: pc.newPrice < pc.oldPrice ? 'Price cut' : 'Price raised',
            v: usd(Math.abs(pc.newPrice - pc.oldPrice)),
            bad: pc.newPrice < pc.oldPrice,
            good: pc.newPrice > pc.oldPrice,
          },
          { k: 'Now asking', v: usd(pc.newPrice) },
          {
            k: 'Gross at this price',
            v: usd(pc.newPrice - totalCost(v)),
            bad: pc.newPrice - totalCost(v) < 0,
          },
        ],
        dedupeKey: `price_change:${pc.id}`,
        createdAt: pc.changedAt,
      }),
    );
  }

  /* ----------------------------------------------------------- from sales */

  const sales = await db
    .select()
    .from(t.sales)
    .innerJoin(t.vehicles, eq(t.sales.vehicleId, t.vehicles.id))
    .where(and(inArray(t.sales.rooftopId, rooftopIds), gte(t.sales.soldDate, since)))
    .orderBy(desc(t.sales.soldDate));

  for (const row of sales) {
    const s = row.sales;
    const v = row.vehicles;
    bump(
      await withCreatedAt(s.soldDate, () =>
        feedSold(v, {
          soldPrice: s.soldPrice,
          frontGross: s.frontGross,
          daysToSell: s.daysToSell,
        }),
      ),
    );
  }

  /* ---------------------------------------------------- from sync_events */

  /*
   * Driven by current sync *state*, not by the age of the sync_event that
   * recorded it. A listing that has been dark since before the backfill window
   * is more urgent than one that broke yesterday, not less — windowing these
   * out is how a rejected unit stays rejected for a month.
   */
  const errors = await db
    .select()
    .from(t.vehicleSyncStates)
    .innerJoin(t.vehicles, eq(t.vehicleSyncStates.vehicleId, t.vehicles.id))
    .innerJoin(t.channelConnections, eq(t.vehicleSyncStates.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .where(
      and(inArray(t.vehicles.rooftopId, rooftopIds), eq(t.vehicleSyncStates.status, 'ERROR')),
    );

  const liveCounts = new Map<string, number>();
  const totalChannels = new Map<string, number>();
  {
    const rows = await db
      .select({
        vehicleId: t.vehicleSyncStates.vehicleId,
        status: t.vehicleSyncStates.status,
        c: sql<number>`count(*)::int`,
      })
      .from(t.vehicleSyncStates)
      .innerJoin(t.vehicles, eq(t.vehicleSyncStates.vehicleId, t.vehicles.id))
      .where(inArray(t.vehicles.rooftopId, rooftopIds))
      .groupBy(t.vehicleSyncStates.vehicleId, t.vehicleSyncStates.status);
    for (const r of rows) {
      totalChannels.set(r.vehicleId, (totalChannels.get(r.vehicleId) ?? 0) + r.c);
      if (r.status === 'LIVE') liveCounts.set(r.vehicleId, r.c);
    }
  }

  // One card per unit per channel, not one per retry.
  const seenError = new Set<string>();
  for (const row of errors) {
    const v = row.vehicles;
    const ch = row.channels;
    const state = row.vehicle_sync_states;
    const key = `${v.id}:${ch.shortName}`;
    if (seenError.has(key)) continue;
    seenError.add(key);

    const darkSince = state.lastAttemptAt ?? state.lastSyncedAt ?? v.acquiredDate;
    const daysDark = Math.max(0, Math.round((Date.now() - new Date(darkSince).getTime()) / DAY));

    bump(
      await emitFeedEvent({
        rooftopId: v.rooftopId,
        kind: 'sync_error',
        vehicleId: v.id,
        title: `${ch.name} rejected stock #${v.stockNumber}`,
        body:
          `${state.errorMessage ?? 'The channel refused the listing.'} ` +
          `The unit is live everywhere else — it is only dark on ${ch.shortName}.`,
        stats: [
          { k: 'Channel', v: ch.shortName, bad: true },
          { k: 'Live on', v: `${liveCounts.get(v.id) ?? 0} of ${totalChannels.get(v.id) ?? 0}` },
          { k: 'Days dark', v: `${daysDark}d`, bad: daysDark > 0 },
        ],
        dedupeKey: `sync_error:backfill:${v.id}:${ch.shortName}`,
        createdAt: new Date(darkSince),
      }),
    );
  }

  /* --------------------------------------------- derived threshold events */

  const swept = await sweepDerivedFeedEvents(rooftopIds);
  created += swept.created;

  return { created };
}

/**
 * The emitters take `createdAt` through `emitFeedEvent`, but the named helpers
 * (feedSold, feedAcquired…) do not expose it — they are written for the live
 * write path, where "now" is always right. Rather than thread an optional date
 * through nine signatures for the sake of one caller, the backfill stamps the
 * row afterwards. One extra UPDATE per backfilled card, once, on a code path
 * that runs at most once per database.
 */
async function withCreatedAt<T extends { id: string } | null>(
  when: Date,
  emit: () => Promise<T>,
): Promise<T> {
  const row = await emit();
  if (row) {
    await db.update(t.feedEvents).set({ createdAt: when }).where(eq(t.feedEvents.id, row.id));
  }
  return row;
}

/** Every rooftop in the database. The standalone entry point uses this. */
export async function allRooftopIds() {
  const rows = await db.select({ id: t.rooftops.id }).from(t.rooftops);
  return rows.map((r) => r.id);
}
