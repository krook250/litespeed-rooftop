import 'server-only';
import { and, asc, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { AGING_BUCKETS, bucketFor, daysInStock, type DisMode } from '@/lib/domain';

export type LiveVehicle = typeof t.vehicles.$inferSelect & {
  photos: (typeof t.vehiclePhotos.$inferSelect)[];
  rooftop: typeof t.rooftops.$inferSelect;
};

const LIVE_STATUSES = ['ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'] as const;

export async function getGroup() {
  const rows = await db.select().from(t.dealerGroups).limit(1);
  return rows[0]!;
}

export async function getRooftops() {
  return db.select().from(t.rooftops).orderBy(asc(t.rooftops.name));
}

export async function getStorefronts() {
  return db.select().from(t.storefronts).orderBy(asc(t.storefronts.name));
}

export async function getStorefrontBySlug(slug: string) {
  const rows = await db
    .select()
    .from(t.storefronts)
    .where(eq(t.storefronts.slug, slug))
    .limit(1);
  const sf = rows[0];
  if (!sf) return null;
  const links = await db
    .select()
    .from(t.storefrontRooftops)
    .where(eq(t.storefrontRooftops.storefrontId, sf.id));
  const rooftopIds = links.map((l) => l.rooftopId);
  const tops = rooftopIds.length
    ? await db.select().from(t.rooftops).where(inArray(t.rooftops.id, rooftopIds))
    : [];
  return { ...sf, rooftopIds, rooftops: tops };
}

/** Live inventory with photos. Sold units never come back from here. */
export async function getLiveInventory(opts: { rooftopIds?: string[] } = {}) {
  const where = opts.rooftopIds?.length
    ? and(inArray(t.vehicles.status, LIVE_STATUSES), inArray(t.vehicles.rooftopId, opts.rooftopIds))
    : inArray(t.vehicles.status, LIVE_STATUSES);

  const rows = await db
    .select()
    .from(t.vehicles)
    .innerJoin(t.rooftops, eq(t.vehicles.rooftopId, t.rooftops.id))
    .where(where)
    .orderBy(asc(t.vehicles.acquiredDate));

  const ids = rows.map((r) => r.vehicles.id);
  const photos = ids.length
    ? await db
        .select()
        .from(t.vehiclePhotos)
        .where(inArray(t.vehiclePhotos.vehicleId, ids))
        .orderBy(asc(t.vehiclePhotos.sortOrder))
    : [];

  const byVehicle = new Map<string, (typeof t.vehiclePhotos.$inferSelect)[]>();
  for (const p of photos) {
    const list = byVehicle.get(p.vehicleId) ?? [];
    list.push(p);
    byVehicle.set(p.vehicleId, list);
  }

  return rows.map((r) => ({
    ...r.vehicles,
    rooftop: r.rooftops,
    photos: byVehicle.get(r.vehicles.id) ?? [],
  })) as LiveVehicle[];
}

export async function getVehicleById(id: string) {
  const rows = await db
    .select()
    .from(t.vehicles)
    .innerJoin(t.rooftops, eq(t.vehicles.rooftopId, t.rooftops.id))
    .where(eq(t.vehicles.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const photos = await db
    .select()
    .from(t.vehiclePhotos)
    .where(eq(t.vehiclePhotos.vehicleId, id))
    .orderBy(asc(t.vehiclePhotos.sortOrder));
  return { ...rows[0].vehicles, rooftop: rows[0].rooftops, photos } as LiveVehicle;
}

export async function getVehicleByStock(stock: string) {
  const rows = await db
    .select({ id: t.vehicles.id })
    .from(t.vehicles)
    .where(eq(t.vehicles.stockNumber, stock))
    .limit(1);
  if (!rows[0]) return null;
  return getVehicleById(rows[0].id);
}

export async function getChannels() {
  return db.select().from(t.channels).orderBy(asc(t.channels.sortOrder));
}

export async function getConnections() {
  return db
    .select()
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .orderBy(asc(t.channels.sortOrder));
}

export async function getSyncMatrix(vehicleIds: string[]) {
  if (!vehicleIds.length) return [];
  return db
    .select()
    .from(t.vehicleSyncStates)
    .innerJoin(
      t.channelConnections,
      eq(t.vehicleSyncStates.connectionId, t.channelConnections.id),
    )
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .where(inArray(t.vehicleSyncStates.vehicleId, vehicleIds));
}

export async function getSyncStatesForVehicle(vehicleId: string) {
  return db
    .select()
    .from(t.vehicleSyncStates)
    .innerJoin(t.channelConnections, eq(t.vehicleSyncStates.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .where(eq(t.vehicleSyncStates.vehicleId, vehicleId))
    .orderBy(asc(t.channels.sortOrder));
}

export async function getRecentEvents(limit = 40) {
  return db
    .select()
    .from(t.syncEvents)
    .innerJoin(t.vehicles, eq(t.syncEvents.vehicleId, t.vehicles.id))
    .innerJoin(t.channelConnections, eq(t.syncEvents.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .orderBy(desc(t.syncEvents.createdAt))
    .limit(limit);
}

export async function getOverrides(vehicleId: string) {
  return db
    .select()
    .from(t.vehicleChannelOverrides)
    .where(eq(t.vehicleChannelOverrides.vehicleId, vehicleId));
}

export async function getPriceHistory(vehicleId: string) {
  return db
    .select()
    .from(t.priceChanges)
    .where(eq(t.priceChanges.vehicleId, vehicleId))
    .orderBy(desc(t.priceChanges.changedAt));
}

/* -------------------------------------------------------------- reporting */

export async function getSalesSince(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  return db.select().from(t.sales).where(gte(t.sales.soldDate, since));
}

export async function getTrafficByChannel(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select({
      channelId: t.vehicleDailyStats.channelId,
      channelName: t.channels.name,
      shortName: t.channels.shortName,
      brandHex: t.channels.brandHex,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      srpImpressions: sql<number>`sum(${t.vehicleDailyStats.srpImpressions})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
      saves: sql<number>`sum(${t.vehicleDailyStats.saves})::int`,
    })
    .from(t.vehicleDailyStats)
    .innerJoin(t.channels, eq(t.vehicleDailyStats.channelId, t.channels.id))
    .where(gte(t.vehicleDailyStats.date, since))
    .groupBy(t.vehicleDailyStats.channelId, t.channels.name, t.channels.shortName, t.channels.brandHex)
    .orderBy(desc(sql`sum(${t.vehicleDailyStats.vdpViews})`));
}

export async function getTrafficByDay(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select({
      date: t.vehicleDailyStats.date,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
    })
    .from(t.vehicleDailyStats)
    .where(gte(t.vehicleDailyStats.date, since))
    .groupBy(t.vehicleDailyStats.date)
    .orderBy(asc(t.vehicleDailyStats.date));
}

export async function getVehicleTraffic(vehicleId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
      saves: sql<number>`sum(${t.vehicleDailyStats.saves})::int`,
    })
    .from(t.vehicleDailyStats)
    .where(
      and(eq(t.vehicleDailyStats.vehicleId, vehicleId), gte(t.vehicleDailyStats.date, since)),
    );
  return rows[0] ?? { vdpViews: 0, leads: 0, saves: 0 };
}

export async function getTrafficPerVehicle(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      vehicleId: t.vehicleDailyStats.vehicleId,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
    })
    .from(t.vehicleDailyStats)
    .where(gte(t.vehicleDailyStats.date, since))
    .groupBy(t.vehicleDailyStats.vehicleId);
  return new Map(rows.map((r) => [r.vehicleId, r]));
}

/** Aging distribution over live inventory, using whichever clock is selected. */
export function agingCounts(vehicles: LiveVehicle[], mode: DisMode = 'dateIn') {
  const counts: Record<string, number> = {};
  for (const b of AGING_BUCKETS) counts[b.key] = 0;
  for (const v of vehicles) {
    const b = bucketFor(daysInStock(v, mode))!;
    counts[b.key] = (counts[b.key] ?? 0) + 1;
  }
  return counts;
}

/* ------------------------------------------- reporting: windows + rooftops */
/* Appended for /admin/reporting. The reporting screen needs two things the
 * helpers above do not offer: a rooftop filter (groups run several rooftops)
 * and a window that can be offset backwards so the current window can be
 * compared with the previous one of equal length. */

/** Half-open day window `(from, to]` as ISO dates, offset days into the past. */
function statWindow(days: number, offsetDays = 0) {
  const to = new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - (offsetDays + days) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export type StatWindowOpts = { days: number; offsetDays?: number; rooftopIds?: string[] };

/**
 * Daily VDP views / SRP impressions / leads / saves, split by channel, for one
 * window and optionally one rooftop. Roll it up by date for the trend or by
 * channel for the channel table — same rows, one query.
 */
export async function getTrafficDailyByChannel(opts: StatWindowOpts) {
  const { from, to } = statWindow(opts.days, opts.offsetDays ?? 0);
  const filters = [
    sql`${t.vehicleDailyStats.date} > ${from}`,
    sql`${t.vehicleDailyStats.date} <= ${to}`,
  ];
  if (opts.rooftopIds?.length) filters.push(inArray(t.vehicles.rooftopId, opts.rooftopIds));

  return db
    .select({
      date: t.vehicleDailyStats.date,
      channelId: t.channels.id,
      channelName: t.channels.name,
      shortName: t.channels.shortName,
      brandHex: t.channels.brandHex,
      sortOrder: t.channels.sortOrder,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      srpImpressions: sql<number>`sum(${t.vehicleDailyStats.srpImpressions})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
      saves: sql<number>`sum(${t.vehicleDailyStats.saves})::int`,
    })
    .from(t.vehicleDailyStats)
    .innerJoin(t.vehicles, eq(t.vehicleDailyStats.vehicleId, t.vehicles.id))
    .innerJoin(t.channels, eq(t.vehicleDailyStats.channelId, t.channels.id))
    .where(and(...filters))
    .groupBy(
      t.vehicleDailyStats.date,
      t.channels.id,
      t.channels.name,
      t.channels.shortName,
      t.channels.brandHex,
      t.channels.sortOrder,
    )
    .orderBy(asc(t.vehicleDailyStats.date));
}

/** Per-VIN views and leads over the same window definition as the charts. */
export async function getTrafficPerVehicleInWindow(opts: StatWindowOpts) {
  const { from, to } = statWindow(opts.days, opts.offsetDays ?? 0);
  const filters = [
    sql`${t.vehicleDailyStats.date} > ${from}`,
    sql`${t.vehicleDailyStats.date} <= ${to}`,
  ];
  if (opts.rooftopIds?.length) filters.push(inArray(t.vehicles.rooftopId, opts.rooftopIds));

  const rows = await db
    .select({
      vehicleId: t.vehicleDailyStats.vehicleId,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
      saves: sql<number>`sum(${t.vehicleDailyStats.saves})::int`,
    })
    .from(t.vehicleDailyStats)
    .innerJoin(t.vehicles, eq(t.vehicleDailyStats.vehicleId, t.vehicles.id))
    .where(and(...filters))
    .groupBy(t.vehicleDailyStats.vehicleId);

  return new Map(rows.map((r) => [r.vehicleId, r]));
}

export type VehicleLifecycle = {
  id: string;
  rooftopId: string;
  status: (typeof t.vehicles.$inferSelect)['status'];
  acquiredDate: Date;
  frontLineDate: Date | null;
  soldDate: Date | null;
};

/**
 * The three clocks on every unit the store has touched, live and sold. Two
 * reporting numbers come out of this and nowhere else: average inventory
 * carried (a unit was in stock on day D if it was acquired on or before D and
 * not yet sold), which turn rate divides by, and recon time (acquired →
 * front line).
 */
export async function getVehicleLifecycle(opts: { rooftopIds?: string[] } = {}) {
  return db
    .select({
      id: t.vehicles.id,
      rooftopId: t.vehicles.rooftopId,
      status: t.vehicles.status,
      acquiredDate: t.vehicles.acquiredDate,
      frontLineDate: t.vehicles.frontLineDate,
      soldDate: t.vehicles.soldDate,
    })
    .from(t.vehicles)
    .where(opts.rooftopIds?.length ? inArray(t.vehicles.rooftopId, opts.rooftopIds) : undefined)
    .orderBy(asc(t.vehicles.acquiredDate)) as Promise<VehicleLifecycle[]>;
}

/* ------------------------------------------------------------- storefront */

/** Storefront "check availability" capture. Insert only — the CRM is not this product. */
export async function createLead(input: {
  vehicleId: string;
  storefrontId: string;
  rooftopId: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
}) {
  const rows = await db
    .insert(t.leads)
    .values({
      vehicleId: input.vehicleId,
      storefrontId: input.storefrontId,
      rooftopId: input.rooftopId,
      name: input.name,
      email: input.email,
      phone: input.phone ?? '',
      message: input.message ?? '',
    })
    .returning();
  return rows[0]!;
}
