import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { localDate } from '@/lib/analytics/record';
import type { ReportWindow } from './campaigns';

/**
 * What the Facebook ads did ON THE DEALER'S SITE — the half of the Ads screen
 * Meta cannot see. Read from our own `page_views` and `leads`.
 *
 * TWO LEVELS OF CREDIT, ON PURPOSE.
 *
 *  - The lot: every visit and lead whose source bucket is `facebook`. That
 *    includes a shared post or a Marketplace link, not only paid ads, and the
 *    screen says "from Facebook", not "from your ads".
 *  - A group or an ad: only visits that landed on a link carrying Rooftop's
 *    tag (`utm_campaign` = ad set id, `utm_content` = ad id — see
 *    `AD_URL_TAGS`). Ads built before the tag existed count toward the lot and
 *    toward no group, which the screen says rather than guessing.
 *
 * A visitor's later pages carry no tag, so a group's cars are every car page
 * looked at by a visitor who arrived through that group inside the window.
 *
 * Raw SQL with literal aliases, for the reason in `analytics/queries.ts`.
 */

export const RANGES = ['7', '30', 'all'] as const;
export type Range = (typeof RANGES)[number];
export const RANGE_LABEL: Record<Range, string> = { '7': '7 days', '30': '30 days', all: 'Since start' };

export function parseRange(v: unknown): Range {
  return typeof v === 'string' && (RANGES as readonly string[]).includes(v) ? (v as Range) : '7';
}

/**
 * The range as the lot's calendar days, today included. Meta's own presets
 * (`last_7d`) stop at yesterday, which reads as "the ads did nothing today".
 */
export function rangeWindow(range: Range, timeZone: string): {
  window: ReportWindow;
  /** ISO instant for our own tables; null for since-start. */
  since: string | null;
  /** Every day in the range, oldest first, for the chart. Empty for since-start. */
  days: string[];
} {
  if (range === 'all') return { window: null, since: null, days: [] };
  const n = Number(range);
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(localDate(timeZone, new Date(Date.now() - i * 86_400_000)));
  return {
    window: { since: days[0]!, until: days[days.length - 1]! },
    // A day early, then trimmed by local date in SQL — no hand-rolled offsets.
    since: new Date(Date.now() - (n + 1) * 86_400_000).toISOString(),
    days,
  };
}

export type SiteCar = { vehicleId: string; title: string; stockNumber: string; status: string; visitors: number; leads: number };
export type SiteCounts = { visitors: number; leads: number };
export type SiteReport = SiteCounts & { cars: SiteCar[] };

export type FacebookSiteReport = {
  lot: SiteReport;
  /** Keyed by ad set id. A group with nothing tagged is absent. */
  groups: Map<string, SiteReport>;
  /** Keyed by ad id. */
  ads: Map<string, SiteCounts>;
};

const TOP = 5;

export async function facebookSiteReport(input: {
  rooftopId: string;
  timeZone: string;
  range: Range;
  adSetIds: string[];
}): Promise<FacebookSiteReport> {
  const { rooftopId, timeZone } = input;
  const { since, days } = rangeWindow(input.range, timeZone);
  const pv = t.pageViews;
  const ld = t.leads;
  const sr = t.storefrontRooftops;
  const vh = t.vehicles;
  const first = days[0] ?? null;

  // Window filters, written once. Since-start means no filter at all.
  const pvIn = (a: string) =>
    since
      ? sql`and ${sql.raw(a)}."createdAt" >= ${since}::timestamptz and (${sql.raw(a)}."createdAt" at time zone ${timeZone})::date >= ${first}::date`
      : sql``;
  const ldIn = pvIn('l');

  /* ------------------------------------------------------------ the lot */

  const [lotTotals] = (await db.execute(sql`
    select
      (select count(distinct p."visitorId")::int from ${pv} p
         where p."source" = 'facebook'
           and p."storefrontId" in (select s."storefrontId" from ${sr} s where s."rooftopId" = ${rooftopId})
           ${pvIn('p')}) as visitors,
      (select count(*)::int from ${ld} l
         where l."rooftopId" = ${rooftopId} and l."source" = 'facebook' ${ldIn}) as leads
  `)) as unknown as SiteCounts[];

  const lotCars = (await db.execute(sql`
    with seen as (
      select p."vehicleId", count(distinct p."visitorId")::int as n
      from ${pv} p
      where p."source" = 'facebook' and p."vehicleId" is not null ${pvIn('p')}
      group by 1
    ), asked as (
      select l."vehicleId", count(*)::int as n
      from ${ld} l
      where l."rooftopId" = ${rooftopId} and l."source" = 'facebook' and l."vehicleId" is not null ${ldIn}
      group by 1
    )
    select v."id" as "vehicleId",
           trim(v."year"::text || ' ' || v."make" || ' ' || v."model" || coalesce(' ' || nullif(v."trim", ''), '')) as title,
           v."stockNumber" as "stockNumber", v."status"::text as status,
           coalesce(seen.n, 0) as visitors, coalesce(asked.n, 0) as leads
    from ${vh} v
    left join seen on seen."vehicleId" = v."id"
    left join asked on asked."vehicleId" = v."id"
    where v."rooftopId" = ${rooftopId} and (seen.n is not null or asked.n is not null)
    order by visitors desc, leads desc
    limit ${TOP}
  `)) as unknown as SiteCar[];

  const groups = new Map<string, SiteReport>();
  const ads = new Map<string, SiteCounts>();
  const ids = input.adSetIds.filter((x) => /^\d+$/.test(x));
  if (!ids.length) return { lot: { ...(lotTotals ?? { visitors: 0, leads: 0 }), cars: lotCars }, groups, ads };

  const idList = sql.join(ids.map((x) => sql`${x}`), sql`, `);

  /* ------------------------------------------------- groups and ads */

  const groupVisitors = (await db.execute(sql`
    select p."utmCampaign" as id, count(distinct p."visitorId")::int as n
    from ${pv} p where p."utmCampaign" in (${idList}) ${pvIn('p')}
    group by 1
  `)) as unknown as { id: string; n: number }[];

  const groupLeads = (await db.execute(sql`
    select l."utmCampaign" as id, count(*)::int as n
    from ${ld} l where l."rooftopId" = ${rooftopId} and l."utmCampaign" in (${idList}) ${ldIn}
    group by 1
  `)) as unknown as { id: string; n: number }[];

  const adVisitors = (await db.execute(sql`
    select p."utmContent" as id, count(distinct p."visitorId")::int as n
    from ${pv} p where p."utmCampaign" in (${idList}) and p."utmContent" is not null ${pvIn('p')}
    group by 1
  `)) as unknown as { id: string; n: number }[];

  const adLeads = (await db.execute(sql`
    select l."utmContent" as id, count(*)::int as n
    from ${ld} l where l."rooftopId" = ${rooftopId} and l."utmCampaign" in (${idList}) and l."utmContent" is not null ${ldIn}
    group by 1
  `)) as unknown as { id: string; n: number }[];

  const groupCars = (await db.execute(sql`
    with arrived as (
      select distinct p."utmCampaign" as gid, p."visitorId"
      from ${pv} p where p."utmCampaign" in (${idList}) ${pvIn('p')}
    ), seen as (
      select a.gid, p."vehicleId", count(distinct p."visitorId")::int as n
      from arrived a join ${pv} p on p."visitorId" = a."visitorId"
      where p."vehicleId" is not null ${pvIn('p')}
      group by 1, 2
    ), asked as (
      select l."utmCampaign" as gid, l."vehicleId", count(*)::int as n
      from ${ld} l
      where l."rooftopId" = ${rooftopId} and l."utmCampaign" in (${idList}) and l."vehicleId" is not null ${ldIn}
      group by 1, 2
    ), both_ as (
      select coalesce(seen.gid, asked.gid) as gid, coalesce(seen."vehicleId", asked."vehicleId") as "vehicleId",
             coalesce(seen.n, 0) as visitors, coalesce(asked.n, 0) as leads
      from seen full outer join asked on asked.gid = seen.gid and asked."vehicleId" = seen."vehicleId"
    ), ranked as (
      select b.*, row_number() over (partition by b.gid order by b.visitors desc, b.leads desc) as rk from both_ b
    )
    select r.gid, v."id" as "vehicleId",
           trim(v."year"::text || ' ' || v."make" || ' ' || v."model" || coalesce(' ' || nullif(v."trim", ''), '')) as title,
           v."stockNumber" as "stockNumber", v."status"::text as status,
           r.visitors, r.leads
    from ranked r join ${vh} v on v."id" = r."vehicleId"
    where r.rk <= ${TOP} and v."rooftopId" = ${rooftopId}
    order by r.gid, r.rk
  `)) as unknown as (SiteCar & { gid: string })[];

  const gl = new Map(groupLeads.map((r) => [r.id, r.n]));
  for (const id of ids) {
    const visitors = groupVisitors.find((r) => r.id === id)?.n ?? 0;
    const leads = gl.get(id) ?? 0;
    if (!visitors && !leads) continue;
    groups.set(id, {
      visitors,
      leads,
      cars: groupCars
        .filter((c) => c.gid === id)
        .map((c) => ({
          vehicleId: c.vehicleId,
          title: c.title,
          stockNumber: c.stockNumber,
          status: c.status,
          visitors: c.visitors,
          leads: c.leads,
        })),
    });
  }
  const al = new Map(adLeads.map((r) => [r.id, r.n]));
  for (const r of adVisitors) ads.set(r.id, { visitors: r.n, leads: al.get(r.id) ?? 0 });
  for (const [id, n] of al) if (!ads.has(id)) ads.set(id, { visitors: 0, leads: n });

  return { lot: { ...(lotTotals ?? { visitors: 0, leads: 0 }), cars: lotCars }, groups, ads };
}
