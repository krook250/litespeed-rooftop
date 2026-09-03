import 'server-only';
import { and, asc, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireGroupId } from '@/lib/auth';
import { AGING_BUCKETS, bucketFor, daysInStock, type DisMode } from '@/lib/domain';

/** Presentation of the feed, not a query — but callers want one import. */
export { resolveFeedStyle } from '@/lib/feed';
import { scopeForGroup, type Scope } from '@/lib/scoped-db';

/**
 * The vehicle-keyed helpers now live in `scoped-db.ts` and take a `Scope` they
 * cannot be called without. Re-exported here so callers keep one import.
 */
export {
  assertVehicleInScope,
  getOverrides,
  getPriceHistory,
  getSyncMatrix,
  getSyncStatesForVehicle,
  assertFeedEventInScope,
  assertRooftopInScope,
  assertTransferInScope,
  getOpenTransfer,
  getOpenTransfers,
  getTransferHistory,
  publicScope,
  type Scope,
} from '@/lib/scoped-db';

/** The admin path: the tenant behind the current request. */
export async function sessionScope(): Promise<Scope> {
  return scopeForGroup(await requireGroupId());
}

/**
 * Tenant scoping
 * --------------
 * Every query below that can return more than one dealer's data takes an
 * optional `rooftopIds`. Passing it explicitly is the *public* path — the
 * storefront resolves its own rooftops from the slug and has no session.
 * Omitting it is the *admin* path, and it falls back to the rooftops owned by
 * the signed-in tenant, which throws a redirect if nobody is signed in.
 *
 * That is deliberate: forgetting to scope an admin query fails closed (no
 * session, no data) rather than leaking the next dealer's inventory.
 */

export type LiveVehicle = typeof t.vehicles.$inferSelect & {
  photos: (typeof t.vehiclePhotos.$inferSelect)[];
  rooftop: typeof t.rooftops.$inferSelect;
};

const LIVE_STATUSES = ['ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'] as const;

/** Rooftop ids owned by the signed-in tenant. The admin scoping fallback. */
async function sessionRooftopIds() {
  const groupId = await requireGroupId();
  const rows = await db
    .select({ id: t.rooftops.id })
    .from(t.rooftops)
    .where(eq(t.rooftops.groupId, groupId));
  return rows.map((r) => r.id);
}

/** Resolve the rooftop filter for an admin-or-public query. */
async function scopeRooftops(rooftopIds?: string[]) {
  return rooftopIds ?? (await sessionRooftopIds());
}

export async function getGroup() {
  const groupId = await requireGroupId();
  const rows = await db
    .select()
    .from(t.dealerGroups)
    .where(eq(t.dealerGroups.id, groupId))
    .limit(1);
  return rows[0]!;
}

export async function getRooftops() {
  const groupId = await requireGroupId();
  return db
    .select()
    .from(t.rooftops)
    .where(eq(t.rooftops.groupId, groupId))
    .orderBy(asc(t.rooftops.name));
}

export async function getStorefronts() {
  const groupId = await requireGroupId();
  return db
    .select()
    .from(t.storefronts)
    .where(eq(t.storefronts.groupId, groupId))
    .orderBy(asc(t.storefronts.name));
}

/**
 * Resolve a storefront by **either** its slug or its custom domain.
 *
 * One lookup handles both because the two key spaces are disjoint by
 * construction: a slug never contains a dot, a domain always does. That is what
 * lets `proxy.ts` rewrite an incoming host straight into `/s/[slug]` without a
 * database call on the request path — the host arrives here as the key and
 * matches on `domain`.
 *
 * `storefronts.domain` is unique, so at most one storefront can ever answer for
 * a given hostname.
 *
 * Deliberately unscoped: the storefront is public and has no session. It
 * resolves its own rooftops from the key and hands them to `publicScope()`.
 */
export async function getStorefrontByKey(key: string) {
  const needle = key.trim().toLowerCase().replace(/^www\./, '');
  const rows = await db
    .select()
    .from(t.storefronts)
    .where(or(eq(t.storefronts.slug, needle), eq(t.storefronts.domain, needle)))
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

/** Kept as the name every existing caller already uses. */
export const getStorefrontBySlug = getStorefrontByKey;

/**
 * Where this storefront's own links should point.
 *
 * On a dealer's custom domain the storefront is the whole site, so links are
 * root-relative and `/s/` never appears in the address bar. On the shared app
 * host it stays under `/s/<slug>`. Passing the request host in keeps this a pure
 * function — the caller reads `headers()`, which only server components may do.
 */
export function storefrontBasePath(
  sf: { slug: string; domain: string | null },
  host: string | null,
): string {
  if (!sf.domain || !host) return `/s/${sf.slug}`;
  const bare = host.split(':')[0]!.toLowerCase().replace(/^www\./, '');
  return bare === sf.domain ? '' : `/s/${sf.slug}`;
}

/** Live inventory with photos. Sold units never come back from here. */
export async function getLiveInventory(opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [];
  const where = and(
    inArray(t.vehicles.status, LIVE_STATUSES),
    inArray(t.vehicles.rooftopId, rooftopIds),
  );

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

export async function getVehicleById(id: string, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return null;
  const rows = await db
    .select()
    .from(t.vehicles)
    .innerJoin(t.rooftops, eq(t.vehicles.rooftopId, t.rooftops.id))
    .where(and(eq(t.vehicles.id, id), inArray(t.vehicles.rooftopId, rooftopIds)))
    .limit(1);
  if (!rows[0]) return null;
  const photos = await db
    .select()
    .from(t.vehiclePhotos)
    .where(eq(t.vehiclePhotos.vehicleId, id))
    .orderBy(asc(t.vehiclePhotos.sortOrder));
  return { ...rows[0].vehicles, rooftop: rows[0].rooftops, photos } as LiveVehicle;
}

/**
 * Stock numbers are only unique within a tenant, so this must always be scoped.
 * The storefront passes its own rooftops; admin screens fall back to session.
 */
export async function getVehicleByStock(stock: string, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return null;
  const rows = await db
    .select({ id: t.vehicles.id })
    .from(t.vehicles)
    .where(and(eq(t.vehicles.stockNumber, stock), inArray(t.vehicles.rooftopId, rooftopIds)))
    .limit(1);
  if (!rows[0]) return null;
  return getVehicleById(rows[0].id, { rooftopIds });
}

/** Channels are a shared catalogue, not tenant data. Intentionally unscoped. */
export async function getChannels() {
  return db.select().from(t.channels).orderBy(asc(t.channels.sortOrder));
}

export async function getConnections(opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [];
  return db
    .select()
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .where(inArray(t.channelConnections.rooftopId, rooftopIds))
    .orderBy(asc(t.channels.sortOrder));
}

export async function getRecentEvents(limit = 40, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [];
  return db
    .select()
    .from(t.syncEvents)
    .innerJoin(t.vehicles, eq(t.syncEvents.vehicleId, t.vehicles.id))
    .innerJoin(t.channelConnections, eq(t.syncEvents.connectionId, t.channelConnections.id))
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .where(inArray(t.vehicles.rooftopId, rooftopIds))
    .orderBy(desc(t.syncEvents.createdAt))
    .limit(limit);
}

/* -------------------------------------------------------------- reporting */

export async function getSalesSince(days: number, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [];
  const since = new Date(Date.now() - days * 86_400_000);
  return db
    .select()
    .from(t.sales)
    .where(and(gte(t.sales.soldDate, since), inArray(t.sales.rooftopId, rooftopIds)));
}

export async function getTrafficByChannel(days = 30, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [];
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
    .innerJoin(t.vehicles, eq(t.vehicleDailyStats.vehicleId, t.vehicles.id))
    .innerJoin(t.channels, eq(t.vehicleDailyStats.channelId, t.channels.id))
    .where(
      and(gte(t.vehicleDailyStats.date, since), inArray(t.vehicles.rooftopId, rooftopIds)),
    )
    .groupBy(t.vehicleDailyStats.channelId, t.channels.name, t.channels.shortName, t.channels.brandHex)
    .orderBy(desc(sql`sum(${t.vehicleDailyStats.vdpViews})`));
}

export async function getTrafficByDay(days = 30, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [];
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select({
      date: t.vehicleDailyStats.date,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
    })
    .from(t.vehicleDailyStats)
    .innerJoin(t.vehicles, eq(t.vehicleDailyStats.vehicleId, t.vehicles.id))
    .where(
      and(gte(t.vehicleDailyStats.date, since), inArray(t.vehicles.rooftopId, rooftopIds)),
    )
    .groupBy(t.vehicleDailyStats.date)
    .orderBy(asc(t.vehicleDailyStats.date));
}

/** Vehicle-keyed, so it takes a Scope for the same reason the others do. */
export async function getVehicleTraffic(scope: Scope, vehicleId: string, days = 30) {
  const empty = { vdpViews: 0, leads: 0, saves: 0 };
  if (!scope.rooftopIds.length) return empty;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      vdpViews: sql<number>`coalesce(sum(${t.vehicleDailyStats.vdpViews}), 0)::int`,
      leads: sql<number>`coalesce(sum(${t.vehicleDailyStats.leads}), 0)::int`,
      saves: sql<number>`coalesce(sum(${t.vehicleDailyStats.saves}), 0)::int`,
    })
    .from(t.vehicleDailyStats)
    .innerJoin(t.vehicles, eq(t.vehicleDailyStats.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.vehicleDailyStats.vehicleId, vehicleId),
        gte(t.vehicleDailyStats.date, since),
        inArray(t.vehicles.rooftopId, scope.rooftopIds),
      ),
    );
  return rows[0] ?? empty;
}

export async function getTrafficPerVehicle(days = 30, opts: { rooftopIds?: string[] } = {}) {
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return new Map<string, { vehicleId: string; vdpViews: number; leads: number }>();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      vehicleId: t.vehicleDailyStats.vehicleId,
      vdpViews: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
    })
    .from(t.vehicleDailyStats)
    .innerJoin(t.vehicles, eq(t.vehicleDailyStats.vehicleId, t.vehicles.id))
    .where(
      and(gte(t.vehicleDailyStats.date, since), inArray(t.vehicles.rooftopId, rooftopIds)),
    )
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
  filters.push(inArray(t.vehicles.rooftopId, await scopeRooftops(opts.rooftopIds)));

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
  filters.push(inArray(t.vehicles.rooftopId, await scopeRooftops(opts.rooftopIds)));

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
  const rooftopIds = await scopeRooftops(opts.rooftopIds);
  if (!rooftopIds.length) return [] as VehicleLifecycle[];
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
    .where(inArray(t.vehicles.rooftopId, rooftopIds))
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
  /** The exact disclosure the visitor ticked, or null. See `@/lib/store/sms-consent`. */
  smsConsentText?: string | null;
}) {
  /*
   * Consent is only recorded when there is a number to consent about. A ticked
   * box with an empty phone field is not consent to anything, and a row with a
   * consent timestamp and no number is the kind of thing that reads as sloppy
   * record-keeping in exactly the audit this column exists for.
   */
  const consented = Boolean(input.smsConsentText && (input.phone ?? '').trim());

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
      smsConsentAt: consented ? new Date() : null,
      smsConsentText: consented ? input.smsConsentText! : null,
    })
    .returning();
  return rows[0]!;
}
