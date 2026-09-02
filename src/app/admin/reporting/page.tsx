import Link from 'next/link';
import {
  AGING_BUCKETS,
  DAY,
  RECON_TARGET_DAYS,
  TURN_BENCHMARK,
  bucketFor,
  daysInStock,
  daysSupply,
  isAtRisk,
  isWaterUnit,
  num,
  totalCost,
  turnRate,
  usd,
  vehicleTitle,
} from '@/lib/domain';
import {
  getLiveInventory,
  getRooftops,
  getSalesSince,
  getTrafficDailyByChannel,
  getTrafficPerVehicleInWindow,
  getVehicleLifecycle,
  agingCounts,
  type LiveVehicle,
  type VehicleLifecycle,
} from '@/lib/queries';
import { AGING_DOT, AgeBadge, AgingBar, Card, CardHeader, EmptyState, Stat, cn } from '@/components/ui';
import { BarRow, ColumnChart, LineArea, NEUTRAL_INK, NEUTRAL_INK_SOFT } from '@/components/charts';
import { requireSection } from '@/lib/auth-guard';

const WINDOWS = [30, 60, 90] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ------------------------------------------------------------- small math */

function mean(xs: number[]) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;

/**
 * Average inventory carried over the window, rebuilt day by day: a unit counts
 * on day D if it was acquired on or before D and had not been sold yet. This is
 * the denominator turn rate needs — the count on the lot right now would
 * overstate the turn of a store that has been selling down.
 */
function averageInventory(rows: VehicleLifecycle[], days: number, now: number) {
  const spans = rows.map((r) => ({
    from: new Date(r.acquiredDate).getTime(),
    to: r.soldDate ? new Date(r.soldDate).getTime() : Infinity,
  }));
  let sum = 0;
  for (let d = 0; d < days; d++) {
    const at = now - d * DAY;
    let count = 0;
    for (const s of spans) if (s.from <= at && s.to > at) count++;
    sum += count;
  }
  return sum / days;
}

/** Request-time clock, read once per render and threaded through every
 *  age calculation so the tiles, the aging table and the attention list can
 *  never disagree about what "today" is. */
function requestNow() {
  return Date.now();
}

function isoLabel(iso: string) {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/* --------------------------------------------------------------- the page */

export default async function ReportingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSection('reporting');
  const sp = await searchParams;
  const raw = Array.isArray(sp.days) ? sp.days[0] : sp.days;
  const days = WINDOWS.includes(Number(raw) as (typeof WINDOWS)[number]) ? Number(raw) : 30;
  const rooftopParam = Array.isArray(sp.rooftop) ? sp.rooftop[0] : sp.rooftop;

  const rooftops = await getRooftops();
  const rooftop = rooftops.find((r) => r.slug === rooftopParam) ?? null;
  const rooftopIds = rooftop ? [rooftop.id] : undefined;

  const [inventory, allSales, trafficRows, priorTrafficRows, perVehicle, lifecycle] =
    await Promise.all([
      getLiveInventory({ rooftopIds }),
      getSalesSince(days),
      getTrafficDailyByChannel({ days, rooftopIds }),
      getTrafficDailyByChannel({ days, offsetDays: days, rooftopIds }),
      getTrafficPerVehicleInWindow({ days, rooftopIds }),
      getVehicleLifecycle({ rooftopIds }),
    ]);

  const now = requestNow();
  const sales = rooftop ? allSales.filter((s) => s.rooftopId === rooftop.id) : allSales;
  const href = (next: { days?: number; rooftop?: string | null }) => {
    const q = new URLSearchParams();
    q.set('days', String(next.days ?? days));
    const rt = next.rooftop === undefined ? rooftop?.slug ?? null : next.rooftop;
    if (rt) q.set('rooftop', rt);
    return `/admin/reporting?${q.toString()}`;
  };

  /* ------------------------------------------------------------ stat tiles */

  const unitsSold = sales.length;
  const supply = daysSupply(inventory.length, unitsSold, days);
  const supplyHealthy = supply != null && supply >= 45 && supply <= 60;

  const avgInventory = averageInventory(lifecycle, days, now);
  const turn = turnRate(unitsSold, days, avgInventory);
  const turnStrong = turn != null && turn >= TURN_BENCHMARK.strong;

  const avgDaysToSell = mean(sales.map((s) => s.daysToSell));
  const avgFrontGross = mean(sales.map((s) => s.frontGross));

  const vdpViews = trafficRows.reduce((a, r) => a + r.vdpViews, 0);
  const windowLeads = trafficRows.reduce((a, r) => a + r.leads, 0);
  const priorViews = priorTrafficRows.reduce((a, r) => a + r.vdpViews, 0);
  const priorDaysWithData = new Set(priorTrafficRows.map((r) => r.date)).size;
  const viewsDelta = priorViews > 0 ? ((vdpViews - priorViews) / priorViews) * 100 : null;

  // Recon time on the units that actually reached the front line inside the
  // window — acquired date to front-line date, the clock the shop owns.
  const reconWindowStart = now - days * DAY;
  const reconDaysList = lifecycle
    .filter((v) => v.frontLineDate && new Date(v.frontLineDate).getTime() >= reconWindowStart)
    .map((v) => (new Date(v.frontLineDate!).getTime() - new Date(v.acquiredDate).getTime()) / DAY)
    .filter((d) => d >= 0);
  const avgRecon = mean(reconDaysList);

  /* --------------------------------------------------------------- aging */

  const counts = agingCounts(inventory, 'dateIn');
  const withAge = inventory.map((v) => ({ v, dis: daysInStock(v, 'dateIn', new Date(now)) }));
  const lotMoney = withAge.reduce((a, r) => a + totalCost(r.v), 0);
  const bucketRows = AGING_BUCKETS.map((b) => {
    const inBucket = withAge.filter(({ dis }) => bucketFor(dis)!.key === b.key);
    return {
      bucket: b,
      units: inBucket.length,
      money: inBucket.reduce((a, r) => a + totalCost(r.v), 0),
      avgDays: mean(inBucket.map((r) => r.dis)),
    };
  });
  const past45 = withAge.filter(({ dis }) => dis > 45);
  const past45Money = past45.reduce((a, r) => a + totalCost(r.v), 0);
  const agedUnits = withAge.filter(({ dis }) => dis >= 61);

  /* ------------------------------------------------------------- channels */

  type ChannelAgg = {
    channelId: string;
    channelName: string;
    shortName: string;
    brandHex: string;
    sortOrder: number;
    vdpViews: number;
    srpImpressions: number;
    leads: number;
  };
  const channelMap = new Map<string, ChannelAgg>();
  for (const r of trafficRows) {
    const c = channelMap.get(r.channelId) ?? {
      channelId: r.channelId,
      channelName: r.channelName,
      shortName: r.shortName,
      brandHex: r.brandHex,
      sortOrder: r.sortOrder,
      vdpViews: 0,
      srpImpressions: 0,
      leads: 0,
    };
    c.vdpViews += r.vdpViews;
    c.srpImpressions += r.srpImpressions;
    c.leads += r.leads;
    channelMap.set(r.channelId, c);
  }
  const channelAgg = [...channelMap.values()].sort((a, b) => b.vdpViews - a.vdpViews);
  const topChannelViews = channelAgg.length ? channelAgg[0]!.vdpViews : 0;

  /* ---------------------------------------------------------------- trend */

  const byDate = new Map<string, { vdpViews: number; leads: number }>();
  for (const r of trafficRows) {
    const d = byDate.get(r.date) ?? { vdpViews: 0, leads: 0 };
    d.vdpViews += r.vdpViews;
    d.leads += r.leads;
    byDate.set(r.date, d);
  }
  const trend = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, d]) => ({ label: date, value: d.vdpViews, secondary: d.leads }));

  /* --------------------------------------------------- units that need work */

  const attention = buildAttentionList(inventory, perVehicle, days, now);

  /* -------------------------------------------------------- sales by month */

  const monthMap = new Map<string, { units: number; gross: number }>();
  for (const s of sales) {
    const d = new Date(s.soldDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m = monthMap.get(key) ?? { units: 0, gross: 0 };
    m.units += 1;
    m.gross += s.frontGross;
    monthMap.set(key, m);
  }
  const monthKeys = [...monthMap.keys()].sort();
  const spansYears = new Set(monthKeys.map((k) => k.slice(0, 4))).size > 1;
  const monthCols = monthKeys.map((k) => {
    const [y, m] = k.split('-');
    const value = monthMap.get(k)!;
    return {
      label: spansYears ? `${MONTHS[Number(m) - 1]} '${y!.slice(2)}` : MONTHS[Number(m) - 1]!,
      value: value.units,
      sublabel: `${usd(value.gross)} gross`,
    };
  });
  const windowGross = sales.reduce((a, s) => a + s.frontGross, 0);

  /* ----------------------------------------------------------------- view */

  const scopeLabel = rooftop ? rooftop.name : 'All rooftops';

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">Reporting</h1>
            <p className="mt-1 text-sm text-ink-500">
              {scopeLabel} · last {days} days · {num(inventory.length)} units live ·{' '}
              {num(unitsSold)} retailed in the window
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <FilterGroup label="Window">
              {WINDOWS.map((w) => (
                <FilterLink key={w} href={href({ days: w })} active={w === days}>
                  {w} days
                </FilterLink>
              ))}
            </FilterGroup>
            <FilterGroup label="Rooftop">
              <FilterLink href={href({ rooftop: null })} active={!rooftop}>
                All
              </FilterLink>
              {rooftops.map((r) => (
                <FilterLink key={r.id} href={href({ rooftop: r.slug })} active={rooftop?.id === r.id}>
                  {r.name}
                </FilterLink>
              ))}
            </FilterGroup>
          </div>
        </div>
      </header>

      <div className="space-y-5 px-6 py-6">
        {/* ------------------------------------------------------- stat row */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Stat
            label="Days supply"
            value={supply == null ? '—' : supply.toFixed(1)}
            tone={supplyHealthy ? 'good' : undefined}
            hint={`${num(inventory.length)} live ÷ ${(unitsSold / days).toFixed(2)} units retailed per day`}
            benchmark={
              supply == null
                ? 'Healthy range 45–60 days'
                : supplyHealthy
                  ? 'Healthy range 45–60 days · in range'
                  : `Healthy range 45–60 days · running ${supply < 45 ? 'lean' : 'long'}`
            }
          />
          <Stat
            label="Turn rate"
            value={
              turn == null ? (
                '—'
              ) : (
                <span className={turnStrong ? undefined : 'text-amber-700'}>{turn.toFixed(1)}x</span>
              )
            }
            tone={turnStrong ? 'good' : undefined}
            hint={`${num(unitsSold)} retailed ÷ ${avgInventory.toFixed(1)} average units carried, annualised`}
            benchmark={`${TURN_BENCHMARK.strong}–15x is strong · top operators run ${TURN_BENCHMARK.elite}`}
          />
          <Stat
            label="Avg days to sell"
            value={avgDaysToSell == null ? '—' : avgDaysToSell.toFixed(1)}
            hint={
              unitsSold
                ? `Across ${num(unitsSold)} retail units in the window`
                : 'No retail units in the window'
            }
            benchmark={
              avgDaysToSell == null
                ? undefined
                : `Fastest ${num(Math.min(...sales.map((s) => s.daysToSell)))}d · slowest ${num(Math.max(...sales.map((s) => s.daysToSell)))}d`
            }
          />
          <Stat
            label="VDP views"
            value={num(vdpViews)}
            hint={
              viewsDelta == null ? (
                'No traffic recorded in the prior window'
              ) : (
                <span className={viewsDelta >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
                  {viewsDelta >= 0 ? '+' : ''}
                  {pct(viewsDelta, 1)} vs prior {days} days
                </span>
              )
            }
            benchmark={
              priorViews > 0
                ? `Prior window ${num(priorViews)} views over ${num(priorDaysWithData)} days with recorded traffic`
                : `${num(trend.length)} of the last ${num(days)} days have recorded traffic`
            }
          />
          <Stat
            label="Avg front gross"
            value={usd(avgFrontGross)}
            hint="Front-end only. No F&I, no reserve — this is not a DMS."
            benchmark={
              unitsSold
                ? `${usd(windowGross)} total front gross on ${num(unitsSold)} units`
                : undefined
            }
          />
          <Stat
            label="Avg recon time"
            value={avgRecon == null ? '—' : `${avgRecon.toFixed(1)}d`}
            tone={avgRecon != null && avgRecon <= RECON_TARGET_DAYS ? 'good' : undefined}
            hint={
              reconDaysList.length
                ? `${num(reconDaysList.length)} units reached front-line ready in the window`
                : 'No units reached front-line ready in the window'
            }
            benchmark={`Target 5–${RECON_TARGET_DAYS} days, acquired to front line`}
          />
        </section>

        {/* --------------------------------------------------------- aging */}
        <Card>
          <CardHeader
            title="Aging distribution"
            subtitle={`${num(inventory.length)} live units · ${usd(lotMoney)} of cost, pack and recon on the ground`}
          />
          {inventory.length === 0 ? (
            <EmptyState title="No live inventory in this scope" />
          ) : (
            <div className="px-5 py-4">
              <AgingBar counts={counts} total={inventory.length} />

              <div className="mt-4 overflow-x-auto scroll-thin">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wider text-ink-500">
                      <th className="py-2 pr-4 font-semibold">Bucket</th>
                      <th className="py-2 pr-4 text-right font-semibold">Units</th>
                      <th className="py-2 pr-4 text-right font-semibold">Share</th>
                      <th className="py-2 pr-4 text-right font-semibold">Money tied up</th>
                      <th className="py-2 text-right font-semibold">Avg days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bucketRows.map((r) => (
                      <tr key={r.bucket.key} className="border-b border-ink-100 last:border-0">
                        <td className="py-2 pr-4">
                          <span className="inline-flex items-center gap-2 text-ink-800">
                            <span className={cn('h-2 w-2 rounded-full', AGING_DOT[r.bucket.tone])} />
                            {r.bucket.label} days
                          </span>
                        </td>
                        <td className="tnum py-2 pr-4 text-right font-medium text-ink-900">{num(r.units)}</td>
                        <td className="tnum py-2 pr-4 text-right text-ink-600">
                          {pct((r.units / Math.max(1, inventory.length)) * 100)}
                        </td>
                        <td className="tnum py-2 pr-4 text-right text-ink-900">{usd(r.money)}</td>
                        <td className="tnum py-2 text-right text-ink-600">
                          {r.avgDays == null ? '—' : r.avgDays.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-ink-200">
                      <td className="py-2 pr-4 font-semibold text-ink-900">Total</td>
                      <td className="tnum py-2 pr-4 text-right font-semibold text-ink-900">
                        {num(inventory.length)}
                      </td>
                      <td className="py-2 pr-4" />
                      <td className="tnum py-2 pr-4 text-right font-semibold text-ink-900">{usd(lotMoney)}</td>
                      <td className="tnum py-2 text-right text-ink-600">
                        {mean(withAge.map((r) => r.dis))?.toFixed(0) ?? '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3 border-t border-ink-100 pt-3 text-xs leading-relaxed text-ink-600">
                {past45.length === 0 ? (
                  <>Nothing on the lot is past 45 days. The whole {usd(lotMoney)} is inside the window where units still sell at a gross.</>
                ) : (
                  <>
                    {num(past45.length)} of {num(inventory.length)} units are past 45 days —{' '}
                    {usd(past45Money)} of the {usd(lotMoney)} on the ground (
                    {pct((past45Money / Math.max(1, lotMoney)) * 100)} of the money).{' '}
                    {agedUnits.length > 0
                      ? `${num(agedUnits.length)} of those are 61+ days and belong in a wholesale or price conversation this week.`
                      : 'None have crossed 61 days yet.'}
                  </>
                )}
              </p>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------ channels */}
        <Card>
          <CardHeader
            title="VDP views by channel"
            subtitle={`${num(vdpViews)} views and ${num(windowLeads)} leads across ${num(channelAgg.length)} channels in the last ${days} days`}
          />
          {channelAgg.length === 0 ? (
            <EmptyState
              title="No traffic recorded in this window"
              body="Daily channel stats have not landed for this scope yet."
            />
          ) : (
            <div className="px-5 py-4">
              <div className="flex items-center gap-3 border-b border-ink-200 pb-2 text-[11px] uppercase tracking-wider text-ink-500">
                <div className="w-44 shrink-0">Channel</div>
                <div className="min-w-0 flex-1">VDP views</div>
                <div className="w-20 shrink-0 text-right">Views</div>
                <div className="w-16 shrink-0 text-right">Share</div>
                <div className="w-16 shrink-0 text-right">Leads</div>
                <div className="w-28 shrink-0 text-right">Views per lead</div>
              </div>

              {channelAgg.map((c) => (
                <BarRow
                  key={c.channelId}
                  label={c.channelName}
                  sublabel={`${num(c.srpImpressions)} SRP impressions`}
                  value={c.vdpViews}
                  max={topChannelViews}
                  color={c.brandHex}
                  valueLabel={num(c.vdpViews)}
                  className="border-b border-ink-100 last:border-0"
                  trailing={
                    <>
                      <div className="tnum w-16 shrink-0 text-right text-sm text-ink-600">
                        {pct((c.vdpViews / Math.max(1, vdpViews)) * 100, 1)}
                      </div>
                      <div className="tnum w-16 shrink-0 text-right text-sm text-ink-900">
                        {num(c.leads)}
                      </div>
                      <div className="tnum w-28 shrink-0 text-right text-sm text-ink-600">
                        {c.leads > 0 ? num(Math.round(c.vdpViews / c.leads)) : '—'}
                      </div>
                    </>
                  }
                />
              ))}

              <p className="mt-3 text-xs leading-relaxed text-ink-600">
                Views per lead is the number to argue with a rep about: it is what a channel
                charges you for one conversation.{' '}
                {(() => {
                  const converting = channelAgg.filter((c) => c.leads > 0);
                  if (!converting.length) return 'No channel produced a lead in this window.';
                  const best = converting.reduce((a, b) =>
                    a.vdpViews / a.leads <= b.vdpViews / b.leads ? a : b,
                  );
                  const worst = converting.reduce((a, b) =>
                    a.vdpViews / a.leads >= b.vdpViews / b.leads ? a : b,
                  );
                  return `${best.channelName} converts hardest at ${num(Math.round(best.vdpViews / best.leads))} views per lead; ${worst.channelName} needs ${num(Math.round(worst.vdpViews / worst.leads))}.`;
                })()}
              </p>
            </div>
          )}
        </Card>

        {/* --------------------------------------------------------- trend */}
        <Card>
          <CardHeader
            title="Traffic trend"
            subtitle={`Daily VDP views and leads, all channels · ${num(trend.length)} days with recorded traffic in the last ${days}`}
          />
          {trend.length === 0 ? (
            <EmptyState title="No daily traffic in this window" />
          ) : (
            <div className="px-5 py-4">
              <LineArea
                id="vdp-trend"
                points={trend}
                title={`Daily VDP views and leads, last ${days} days`}
                seriesName="VDP views"
                secondaryName="Leads"
                color={NEUTRAL_INK}
                secondaryColor={NEUTRAL_INK_SOFT}
                formatX={(label) => isoLabel(label)}
              />
              <p className="mt-2 text-xs text-ink-600">
                Peak day {num(Math.max(...trend.map((p) => p.value)))} views ·{' '}
                {num(Math.round(vdpViews / Math.max(1, trend.length)))} views per day average ·{' '}
                {windowLeads > 0
                  ? `${num(Math.round(vdpViews / windowLeads))} views per lead across the window`
                  : 'no leads recorded in the window'}
                .
              </p>
            </div>
          )}
        </Card>

        {/* ----------------------------------------------------- attention */}
        <Card>
          <CardHeader
            title="Units that need attention"
            subtitle="Aged, water, at-risk and merchandising problems in one list — worst first, capped at 12"
          />
          {attention.length === 0 ? (
            <EmptyState
              title="Nothing flagged"
              body="No aged units, no water units, and every unit is pulling traffic in line with the lot."
            />
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[54rem] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-left text-[11px] uppercase tracking-wider text-ink-500">
                    <th className="py-2 pl-5 pr-4 font-semibold">Unit</th>
                    <th className="py-2 pr-4 font-semibold">Why it is here</th>
                    <th className="py-2 pr-4 text-right font-semibold">Days</th>
                    <th className="py-2 pr-4 text-right font-semibold">Price</th>
                    <th className="py-2 pr-4 text-right font-semibold">Total cost</th>
                    <th className="py-2 pr-5 text-right font-semibold">Views · leads</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((row) => (
                    <tr key={row.v.id} className="border-b border-ink-100 last:border-0 align-top">
                      <td className="py-2.5 pl-5 pr-4">
                        <Link
                          href={`/admin/inventory/${row.v.id}`}
                          className="font-medium text-ink-900 underline-offset-2 hover:underline"
                        >
                          {vehicleTitle(row.v)}
                        </Link>
                        <div className="tnum mt-0.5 text-[11px] text-ink-500">
                          Stock {row.v.stockNumber}
                          {rooftop ? '' : ` · ${row.v.rooftop.name}`}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-ink-700">
                        <div>{row.reasons[0]}</div>
                        {row.reasons.length > 1 ? (
                          <div className="mt-0.5 text-[11px] text-ink-500">
                            {row.reasons.slice(1).join(' · ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 text-right">
                        <AgeBadge days={row.dis} />
                      </td>
                      <td className="tnum py-2.5 pr-4 text-right text-ink-900">
                        {usd(row.v.salePrice ?? row.v.price)}
                      </td>
                      <td className="tnum py-2.5 pr-4 text-right text-ink-600">
                        {usd(totalCost(row.v))}
                      </td>
                      <td className="tnum py-2.5 pr-5 text-right text-ink-600">
                        {num(row.views)} · {num(row.leads)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------ sales by month */}
        <Card>
          <CardHeader
            title="Sales by month"
            subtitle={`Units retailed and front gross per month · ${num(unitsSold)} units and ${usd(windowGross)} in the last ${days} days. First and last month in the window are partial.`}
          />
          {monthCols.length === 0 ? (
            <EmptyState title="No units retailed in this window" />
          ) : (
            <div className="px-5 py-4">
              <ColumnChart
                data={monthCols}
                title={`Units retailed per month, last ${days} days`}
                color={NEUTRAL_INK}
                height={200}
                className="mx-auto"
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- attention builder */

type AttentionRow = {
  v: LiveVehicle;
  dis: number;
  views: number;
  leads: number;
  rank: number;
  reasons: string[];
};

/**
 * One row per vehicle, every reason it earned its place, ordered by how much it
 * is costing the store. Thresholds are read off this lot in this window — the
 * views a unit here actually gets — not off a number somebody made up. The
 * under-exposed test compares a unit only with the units in its own aging
 * bucket, because interest always decays with age and a 60-day unit should not
 * be measured against a car that landed on Tuesday.
 */
function buildAttentionList(
  inventory: LiveVehicle[],
  perVehicle: Map<string, { vdpViews: number; leads: number; saves: number }>,
  days: number,
  now: number,
): AttentionRow[] {
  const rows = inventory.map((v) => {
    const dis = daysInStock(v, 'dateIn', new Date(now));
    const stats = perVehicle.get(v.id);
    const views = stats?.vdpViews ?? 0;
    const leads = stats?.leads ?? 0;
    // days this unit was actually on the lot inside the window
    const exposure = Math.max(1, Math.min(days, dis));
    return { v, dis, views, leads, exposure, viewsPerDay: views / exposure };
  });

  const medianViews = median(rows.map((r) => r.views));

  // views per day, held against the other units of the same age
  const byBucket = new Map<string, number[]>();
  for (const r of rows) {
    const key = bucketFor(r.dis)!.key;
    byBucket.set(key, [...(byBucket.get(key) ?? []), r.viewsPerDay]);
  }
  const bucketMedian = new Map(
    [...byBucket.entries()].map(([key, xs]) => [key, { median: median(xs), n: xs.length }]),
  );

  const out: AttentionRow[] = [];
  for (const r of rows) {
    const reasons: { rank: number; text: string }[] = [];

    if (r.dis >= 61) {
      reasons.push({ rank: 0, text: `Aged — ${num(r.dis)} days in stock, past the 61-day bucket` });
    }
    if (isWaterUnit(r.v)) {
      reasons.push({
        rank: 1,
        text: `Water unit — ${usd(totalCost(r.v))} in it against ${usd(r.v.marketValue)} of market, ${usd(totalCost(r.v) - r.v.marketValue)} under water`,
      });
    }
    if (r.views > 0 && r.views >= medianViews && r.leads === 0) {
      reasons.push({
        rank: 2,
        text: `${num(r.views)} VDP views and no leads — at or above the lot median of ${num(Math.round(medianViews))}, so this is merchandising, not traffic`,
      });
    }
    const bucket = bucketFor(r.dis)!;
    const peers = bucketMedian.get(bucket.key);
    if (
      r.dis >= 15 &&
      peers &&
      peers.n >= 3 &&
      peers.median > 0 &&
      r.viewsPerDay < peers.median * 0.5
    ) {
      reasons.push({
        rank: 3,
        text: `${num(r.views)} VDP views over ${num(r.exposure)} days — ${r.viewsPerDay.toFixed(1)} a day where the rest of the ${bucket.label} day bucket runs ${peers.median.toFixed(1)}. Low for its age: price and exposure, not the clock`,
      });
    }
    if (isAtRisk(r.dis)) {
      reasons.push({ rank: 4, text: `At risk — ${num(r.dis)} days, inside the 30–45 window where gross goes` });
    }

    if (!reasons.length) continue;
    reasons.sort((a, b) => a.rank - b.rank);
    out.push({
      v: r.v,
      dis: r.dis,
      views: r.views,
      leads: r.leads,
      rank: reasons[0]!.rank,
      reasons: reasons.map((x) => x.text),
    });
  }

  return out
    .sort((a, b) => a.rank - b.rank || b.dis - a.dis || b.views - a.views)
    .slice(0, 12);
}

/* ------------------------------------------------------------ filter links */

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-400">
        {label}
      </div>
      <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">{children}</div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100',
      )}
    >
      {children}
    </Link>
  );
}
