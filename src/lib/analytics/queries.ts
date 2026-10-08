import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { localDate } from './record';
import { SOURCES, type Source } from './source';

/**
 * Read side of the storefront analytics.
 *
 * Raw SQL with literal aliases throughout: drizzle does not qualify columns
 * inside a `sql` template, and every query here joins (see ops-surface notes,
 * the `42702 column reference "id" is ambiguous` incident).
 *
 * Days are bucketed in the lot's time zone. A visit at 9pm in Florida is
 * Tuesday, not Wednesday UTC.
 *
 * The caller has already proved the storefront belongs to the signed-in group.
 */

export type AnalyticsDay = { date: string; visitors: number; leads: number };
export type AnalyticsSource = { source: Source; visitors: number; leads: number };
export type AnalyticsVehicle = {
  vehicleId: string;
  title: string;
  stockNumber: string;
  views: number;
  leads: number;
  daysOnLot: number;
  status: string;
};

export async function storefrontAnalytics(storefrontId: string, days: number, timeZone: string) {
  const since = new Date(Date.now() - days * 86_400_000);
  const pv = t.pageViews;
  const ld = t.leads;

  const [totals] = (await db.execute(sql`
    select
      count(distinct p."visitorId")::int as visitors,
      count(*) filter (where p."vehicleId" is not null)::int as "vdpViews",
      (select count(*)::int from ${ld} l where l."storefrontId" = ${storefrontId} and l."createdAt" >= ${since}) as leads,
      (select min(p2."createdAt") from ${pv} p2 where p2."storefrontId" = ${storefrontId}) as "firstSeen"
    from ${pv} p
    where p."storefrontId" = ${storefrontId} and p."createdAt" >= ${since}
  `)) as unknown as { visitors: number; vdpViews: number; leads: number; firstSeen: string | null }[];

  const visitorDays = (await db.execute(sql`
    select to_char((p."createdAt" at time zone ${timeZone})::date, 'YYYY-MM-DD') as date,
           count(distinct p."visitorId")::int as n
    from ${pv} p
    where p."storefrontId" = ${storefrontId} and p."createdAt" >= ${since}
    group by 1
  `)) as unknown as { date: string; n: number }[];

  const leadDays = (await db.execute(sql`
    select to_char((l."createdAt" at time zone ${timeZone})::date, 'YYYY-MM-DD') as date, count(*)::int as n
    from ${ld} l
    where l."storefrontId" = ${storefrontId} and l."createdAt" >= ${since}
    group by 1
  `)) as unknown as { date: string; n: number }[];

  const vMap = new Map(visitorDays.map((r) => [r.date, r.n]));
  const lMap = new Map(leadDays.map((r) => [r.date, r.n]));
  const series: AnalyticsDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = localDate(timeZone, new Date(Date.now() - i * 86_400_000));
    series.push({ date, visitors: vMap.get(date) ?? 0, leads: lMap.get(date) ?? 0 });
  }

  /* A visitor counts toward the source of their first page in the window. */
  const srcVisitors = (await db.execute(sql`
    select first_src as source, count(*)::int as n from (
      select distinct on (p."visitorId") p."visitorId", p."source" as first_src
      from ${pv} p
      where p."storefrontId" = ${storefrontId} and p."createdAt" >= ${since}
      order by p."visitorId", p."createdAt"
    ) x group by 1
  `)) as unknown as { source: string; n: number }[];

  const srcLeads = (await db.execute(sql`
    select coalesce(l."source", 'unknown') as source, count(*)::int as n
    from ${ld} l
    where l."storefrontId" = ${storefrontId} and l."createdAt" >= ${since}
    group by 1
  `)) as unknown as { source: string; n: number }[];

  const sv = new Map(srcVisitors.map((r) => [r.source, r.n]));
  const sl = new Map(srcLeads.map((r) => [r.source, r.n]));
  const sources: AnalyticsSource[] = SOURCES.map((s) => ({
    source: s,
    visitors: sv.get(s) ?? 0,
    leads: sl.get(s) ?? 0,
  }))
    .filter((s) => s.visitors || s.leads)
    .sort((a, b) => b.visitors - a.visitors || b.leads - a.leads);
  const untrackedLeads = sl.get('unknown') ?? 0;

  const vehicles = (await db.execute(sql`
    select v."id" as "vehicleId",
           trim(v."year"::text || ' ' || v."make" || ' ' || v."model" || coalesce(' ' || nullif(v."trim", ''), '')) as title,
           v."stockNumber" as "stockNumber",
           v."status"::text as status,
           greatest(0, floor(extract(epoch from (coalesce(v."soldDate", now()) - v."acquiredDate")) / 86400))::int as "daysOnLot",
           count(p."id")::int as views,
           (select count(*)::int from ${ld} l
              where l."vehicleId" = v."id" and l."storefrontId" = ${storefrontId} and l."createdAt" >= ${since}) as leads
    from ${pv} p
    join ${t.vehicles} v on v."id" = p."vehicleId"
    where p."storefrontId" = ${storefrontId} and p."createdAt" >= ${since}
    group by v."id"
    order by views desc, v."stockNumber"
    limit 10
  `)) as unknown as AnalyticsVehicle[];

  return {
    visitors: totals?.visitors ?? 0,
    vdpViews: totals?.vdpViews ?? 0,
    leads: totals?.leads ?? 0,
    firstSeen: totals?.firstSeen ? new Date(totals.firstSeen) : null,
    series,
    sources,
    untrackedLeads,
    vehicles,
  };
}
