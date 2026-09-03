import 'server-only';
import { asc, count, desc, eq, notExists, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireStaff } from './guard';

/**
 * Cross-tenant reads for the operator surface.
 *
 * EVERY EXPORTED FUNCTION IN THIS FILE CALLS `requireStaff()` FIRST. That is the
 * rule the module exists to make checkable: these queries take no `Scope` and
 * filter by no `rooftopId`, so the staff check is the only thing standing between
 * a caller and every dealer's data. Keeping them together means an audit reads
 * one file rather than grepping for unscoped selects.
 *
 * If you need a new cross-tenant read, add it here. Do not widen `Scope`, and do
 * not put an unscoped select anywhere else.
 */

export type OpsConnection = Awaited<ReturnType<typeof opsConnections>>[number];

/**
 * Every rooftop, every channel, and which pairs already have a connection row.
 *
 * Signup provisions a dealer group, a rooftop and a storefront — and no channel
 * connections at all. Only `seed.ts` ever created those, so a real dealer who
 * signed up landed on an empty `/admin/syndication` with no way to ask for
 * anything. This is what the provisioning card on `/ops` reads.
 *
 * DEALER GROUPS CONTAINING A STAFF USER ARE EXCLUDED. Signing up is the only way
 * to create an account, and it always provisions a tenant — so every Rooftop
 * operator necessarily owns a dealer group that is not a dealership. Left in,
 * `Rooftop Ops` would sit at the top of this card forever asking to be given
 * nine channels, and a list whose first row is permanently ignorable stops being
 * read at all.
 *
 * Filtering on staff membership rather than on a name or a flag means it stays
 * true for the next operator without anybody remembering to maintain it.
 *
 * The trap, stated so nobody has to rediscover it: a staff member who genuinely
 * wanted a demo lot of their own could not provision its channels from this
 * screen. That is a fair trade at one operator, and the escape hatch is a row in
 * `channel_connections` — but if Rooftop staff ever run a real lot, this filter
 * is the reason it looks broken.
 */
export async function opsRooftopChannels() {
  await requireStaff();

  const [rooftops, existing, channels] = await Promise.all([
    db
      .select({
        rooftopId: t.rooftops.id,
        rooftopName: t.rooftops.name,
        rooftopSlug: t.rooftops.slug,
        groupName: t.dealerGroups.name,
        addressLine1: t.rooftops.addressLine1,
        city: t.rooftops.city,
        state: t.rooftops.state,
        postalCode: t.rooftops.postalCode,
        phone: t.rooftops.phone,
        latitude: t.rooftops.latitude,
        longitude: t.rooftops.longitude,
      })
      .from(t.rooftops)
      .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
      .where(
        notExists(
          db
            .select({ one: sql`1` })
            .from(t.users)
            .innerJoin(t.staff, eq(t.staff.userId, t.users.id))
            .where(eq(t.users.groupId, t.rooftops.groupId)),
        ),
      )
      .orderBy(asc(t.dealerGroups.name), asc(t.rooftops.name)),
    db
      .select({ rooftopId: t.channelConnections.rooftopId, channelId: t.channelConnections.channelId })
      .from(t.channelConnections),
    db.select().from(t.channels).orderBy(asc(t.channels.sortOrder)),
  ]);

  const have = new Set(existing.map((e) => `${e.rooftopId}:${e.channelId}`));

  return rooftops.map((r) => ({
    ...r,
    missing: channels.filter((c) => !have.has(`${r.rooftopId}:${c.id}`)),
    /** What the feed builders need and signup does not collect. */
    incomplete: [
      !r.addressLine1 && 'street',
      !r.city && 'city',
      !r.state && 'state',
      !r.postalCode && 'ZIP',
      !r.phone && 'phone',
      r.latitude == null && 'latitude',
      r.longitude == null && 'longitude',
    ].filter(Boolean) as string[],
  }));
}

export async function opsConnections() {
  await requireStaff();

  return db
    .select({
      connectionId: t.channelConnections.id,
      status: t.channelConnections.status,
      providerDealerId: t.channelConnections.providerDealerId,
      leadEmail: t.channelConnections.leadEmail,
      internalNote: t.channelConnections.internalNote,
      requestedAt: t.channelConnections.requestedAt,
      dealerConfirmedAt: t.channelConnections.dealerConfirmedAt,
      submittedAt: t.channelConnections.submittedAt,
      liveAt: t.channelConnections.liveAt,
      errorMessage: t.channelConnections.errorMessage,
      channelKey: t.channels.key,
      channelName: t.channels.name,
      channelShortName: t.channels.shortName,
      rooftopId: t.rooftops.id,
      rooftopName: t.rooftops.name,
      rooftopSlug: t.rooftops.slug,
      groupName: t.dealerGroups.name,
      isDemo: t.dealerGroups.isDemo,
    })
    .from(t.channelConnections)
    .innerJoin(t.channels, eq(t.channelConnections.channelId, t.channels.id))
    .innerJoin(t.rooftops, eq(t.channelConnections.rooftopId, t.rooftops.id))
    .innerJoin(t.dealerGroups, eq(t.rooftops.groupId, t.dealerGroups.id))
    .orderBy(asc(t.dealerGroups.name), asc(t.rooftops.name), asc(t.channels.sortOrder));
}

export type OpsFeedUpload = Awaited<ReturnType<typeof opsFeedUploads>>[number];

/**
 * The recent history of vendor-level feed pushes.
 *
 * Not tenant-scoped and not tenant-scopable — one CarGurus file carries every
 * dealer we send, so there is no rooftop this belongs to. That is exactly why it
 * lives behind `requireStaff()` here rather than anywhere a dealer can reach.
 *
 * The reason this is a screen at all: the short-file guard's whole value is that
 * somebody sees it fire. A run that refused to upload because a dealer would have
 * been delisted is the single most important thing this system can tell a human,
 * and until now it only existed in a Vercel function log.
 */
export async function opsFeedUploads(limit = 12) {
  await requireStaff();
  return db
    .select()
    .from(t.feedUploads)
    .orderBy(desc(t.feedUploads.startedAt))
    .limit(limit);
}

/* ------------------------------------------------------------- accounts */

/**
 * Every dealer group and where it sits commercially.
 *
 * The trial queue. Cross-tenant by design, so it calls `requireStaff()` first
 * like every other export here — the page guard is not the guard, because a
 * query module is importable from anywhere. Deliberately does NOT take a
 * `Scope`: `Scope` exists to make cross-tenant reads impossible by accident, and
 * this read is on purpose, which is exactly the distinction `guard.ts` documents.
 *
 * Ordered by trial deadline soonest first, nulls last, so the group about to run
 * out is the one at the top of the screen. Groups with no clock — ACTIVE, or the
 * pre-launch rows the 0022 migration marked ACTIVE — sort to the bottom, which
 * is where an account that needs nothing belongs.
 */
export type OpsAccount = {
  id: string;
  name: string;
  slug: string;
  plan: (typeof t.dealerGroups.plan.enumValues)[number];
  trialEndsAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
  isDemo: boolean;
  vehicles: number;
  users: number;
  /**
   * Every storefront this group owns, so the screen can link the real one.
   *
   * `slug` above is the GROUP slug and `/s/[slug]` resolves `storefronts.slug` —
   * different columns, different values. Naming this field for the thing it
   * actually is stops the next person reaching for `a.slug` again.
   */
  storefronts: { slug: string; domain: string | null; name: string }[];
};

export async function opsAccounts(): Promise<OpsAccount[]> {
  await requireStaff();

  const rows = await db
    .select({
      id: t.dealerGroups.id,
      name: t.dealerGroups.name,
      slug: t.dealerGroups.slug,
      plan: t.dealerGroups.plan,
      trialEndsAt: t.dealerGroups.trialEndsAt,
      activatedAt: t.dealerGroups.activatedAt,
      createdAt: t.dealerGroups.createdAt,
      isDemo: t.dealerGroups.isDemo,
      /*
       * Correlated subqueries rather than joins with a group-by. Two counts over
       * two different tables in one grouped join multiplies the rows against each
       * other and silently inflates both — the classic fan-out. At this row count
       * the cost is irrelevant and the correctness is not.
       */
      /*
       * COLUMNS ARE WRITTEN OUT, NOT INTERPOLATED, AND THAT IS THE FIX.
       * Interpolating a column into a `sql` fragment (`${t.rooftops.id}`) emits
       * the bare name — `"id"` — with no table qualifier, because drizzle only
       * qualifies inside a builder context it owns. Three tables in one
       * subquery then all contribute an `id` and a `groupId`, and Postgres
       * refused the whole statement with 42702 `column reference "id" is
       * ambiguous`. This page 500'd from the day it shipped until 3 Sep 2026.
       * Table names still come from `t.*`; the aliases and column names are
       * literal so the qualification is ours and cannot be dropped.
       */
      vehicles: sql<number>`(
        select count(*)::int
        from ${t.vehicles} v
        join ${t.rooftops} r on r."id" = v."rooftopId"
        where r."groupId" = ${t.dealerGroups}."id"
      )`,
      users: sql<number>`(
        select count(*)::int from ${t.users} u where u."groupId" = ${t.dealerGroups}."id"
      )`,
    })
    .from(t.dealerGroups)
    /*
     * STAFF-OWNED GROUPS ARE EXCLUDED, same rule and same reason as
     * `opsRooftopChannels`. Signing up is the only way to create an account and
     * it always provisions a tenant, so every Rooftop operator necessarily owns
     * a dealer group that is not a dealership. Left in, "Rooftop Ops" sits in
     * the Paid list forever at 0 units, and a list whose rows are partly
     * furniture gets skimmed instead of read.
     *
     * Filtering on staff membership rather than a name or a flag means it stays
     * true for the next operator without anybody maintaining it — and it keeps
     * this screen's answer to "how many dealers do we have" honest, which is the
     * number that will end up on a slide.
     */
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(t.users)
          .innerJoin(t.staff, eq(t.staff.userId, t.users.id))
          .where(eq(t.users.groupId, t.dealerGroups.id)),
      ),
    )
    .orderBy(sql`${t.dealerGroups.trialEndsAt} asc nulls last`, desc(t.dealerGroups.createdAt));

  /*
   * Storefronts, attached rather than joined.
   *
   * A group can own more than one — the demo group owns two — so a join here
   * would duplicate every account row per storefront, and picking "the first
   * one" would silently hide the others.
   *
   * This exists because the link on that screen used to be `/s/{group.slug}`,
   * and a storefront is resolved by `storefronts.slug`, which is a different
   * column with a different value: the group `malabar-truck-and-trade` owns the
   * storefront `malabar-truck-and-trade-store`. Every one of those links 404'd,
   * which read as "the storefronts are down" rather than "that link is wrong".
   */
  const fronts = await db
    .select({
      groupId: t.storefronts.groupId,
      slug: t.storefronts.slug,
      domain: t.storefronts.domain,
      name: t.storefronts.name,
    })
    .from(t.storefronts)
    .orderBy(asc(t.storefronts.name));

  const byGroup = new Map<string, typeof fronts>();
  for (const f of fronts) {
    const list = byGroup.get(f.groupId) ?? [];
    list.push(f);
    byGroup.set(f.groupId, list);
  }

  return rows.map((r) => ({ ...r, storefronts: byGroup.get(r.id) ?? [] }));
}

/* ------------------------------------------------------- one account, in full */

/**
 * Everything we hold about one dealer group, for the operator detail screen.
 *
 * WHAT IS NOT HERE, AND WHY: **payments.** There is no payment processor wired
 * in — `dealer_groups.plan` is set by a human pressing "Mark paid", so
 * `activatedAt` is the date somebody said they had paid, not a receipt. The page
 * says exactly that rather than rendering a Payments panel that would be read as
 * a ledger. When Authorize.net lands (`claude/billing-and-domain-economics.md`)
 * this is where the real history hangs.
 *
 * Twilio numbers and ad-desk spend are the other two panels David wants and
 * neither has a source yet.
 *
 * Everything below is scoped by `groupId`, not by `Scope` — this is the
 * sanctioned cross-tenant module and `requireStaff()` is the gate.
 */
export async function opsAccountDetail(groupId: string) {
  await requireStaff();

  const [group] = await db
    .select()
    .from(t.dealerGroups)
    .where(eq(t.dealerGroups.id, groupId))
    .limit(1);
  if (!group) return null;

  const [people, tops, fronts, orders, byStatus, perRooftop, saleRows, leadRows] =
    await Promise.all([
      db
        .select({
          id: t.users.id,
          name: t.users.name,
          email: t.users.email,
          role: t.users.role,
          emailVerified: t.users.emailVerified,
          createdAt: t.users.createdAt,
        })
        .from(t.users)
        .where(eq(t.users.groupId, groupId))
        .orderBy(asc(t.users.createdAt)),

      db
        .select({
          id: t.rooftops.id,
          name: t.rooftops.name,
          slug: t.rooftops.slug,
          addressLine1: t.rooftops.addressLine1,
          city: t.rooftops.city,
          state: t.rooftops.state,
          postalCode: t.rooftops.postalCode,
          phone: t.rooftops.phone,
          email: t.rooftops.email,
          latitude: t.rooftops.latitude,
          longitude: t.rooftops.longitude,
          isActive: t.rooftops.isActive,
          createdAt: t.rooftops.createdAt,
        })
        .from(t.rooftops)
        .where(eq(t.rooftops.groupId, groupId))
        .orderBy(asc(t.rooftops.name)),

      db
        .select({
          id: t.storefronts.id,
          name: t.storefronts.name,
          slug: t.storefronts.slug,
          domain: t.storefronts.domain,
          domainSource: t.storefronts.domainSource,
          domainStatus: t.storefronts.domainStatus,
          domainError: t.storefronts.domainError,
        })
        .from(t.storefronts)
        .where(eq(t.storefronts.groupId, groupId))
        .orderBy(asc(t.storefronts.name)),

      db
        .select({
          id: t.domainOrders.id,
          domain: t.domainOrders.domain,
          status: t.domainOrders.status,
          priceUsd: t.domainOrders.priceUsd,
          renewalPriceUsd: t.domainOrders.renewalPriceUsd,
          years: t.domainOrders.years,
          autoRenew: t.domainOrders.autoRenew,
          error: t.domainOrders.error,
          createdAt: t.domainOrders.createdAt,
          completedAt: t.domainOrders.completedAt,
          orderedByEmail: t.users.email,
        })
        .from(t.domainOrders)
        .leftJoin(t.users, eq(t.users.id, t.domainOrders.orderedBy))
        .where(eq(t.domainOrders.groupId, groupId))
        .orderBy(desc(t.domainOrders.createdAt)),

      /* Units by status across every rooftop in the group. "Total ever" is the
         sum of these — a vehicle is never deleted when it sells, it moves to
         SOLD, which is what makes the lifetime number knowable at all. */
      db
        .select({ status: t.vehicles.status, n: count() })
        .from(t.vehicles)
        .innerJoin(t.rooftops, eq(t.rooftops.id, t.vehicles.rooftopId))
        .where(eq(t.rooftops.groupId, groupId))
        .groupBy(t.vehicles.status),

      db
        .select({ rooftopId: t.vehicles.rooftopId, n: count() })
        .from(t.vehicles)
        .innerJoin(t.rooftops, eq(t.rooftops.id, t.vehicles.rooftopId))
        .where(eq(t.rooftops.groupId, groupId))
        .groupBy(t.vehicles.rooftopId),

      /* Aggregates are written with literal, qualified column names on purpose.
         Interpolating a drizzle column into a `sql` fragment drops the table
         prefix — that is what 500'd this whole surface, see
         `claude/ops-surface.md`. Two joined tables here, so it matters. */
      db
        .select({
          n: count(),
          gross: sql<number>`coalesce(sum("sales"."frontGross"), 0)::int`,
          revenue: sql<number>`coalesce(sum("sales"."soldPrice"), 0)::int`,
          avgDays: sql<number>`coalesce(round(avg("sales"."daysToSell")), 0)::int`,
          lastSold: sql<Date | null>`max("sales"."soldDate")`,
        })
        .from(t.sales)
        .innerJoin(t.rooftops, eq(t.rooftops.id, t.sales.rooftopId))
        .where(eq(t.rooftops.groupId, groupId)),

      db
        .select({ n: count(), last: sql<Date | null>`max("leads"."createdAt")` })
        .from(t.leads)
        .innerJoin(t.rooftops, eq(t.rooftops.id, t.leads.rooftopId))
        .where(eq(t.rooftops.groupId, groupId)),
    ]);

  const counts = new Map(byStatus.map((r) => [r.status, r.n]));
  const unitsBy = new Map(perRooftop.map((r) => [r.rooftopId, r.n]));
  const pick = (...keys: string[]) => keys.reduce((sum, k) => sum + (counts.get(k as never) ?? 0), 0);

  return {
    group,
    people,
    rooftops: tops.map((r) => ({ ...r, units: unitsBy.get(r.id) ?? 0 })),
    storefronts: fronts,
    domainOrders: orders,
    inventory: {
      /** Every vehicle ever entered, sold ones included. */
      ever: byStatus.reduce((sum, r) => sum + r.n, 0),
      /** On the ground: anything not yet gone. */
      active: pick('ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'),
      /** Public on the storefront right now — the same three statuses the SRP shows. */
      retailReady: pick('PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'),
      sold: pick('SOLD'),
      wholesaled: pick('WHOLESALED'),
      byStatus,
    },
    sales: saleRows[0] ?? { n: 0, gross: 0, revenue: 0, avgDays: 0, lastSold: null },
    leads: leadRows[0] ?? { n: 0, last: null },
  };
}

export type OpsAccountDetail = NonNullable<Awaited<ReturnType<typeof opsAccountDetail>>>;
