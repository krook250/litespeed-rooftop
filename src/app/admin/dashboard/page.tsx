import Link from 'next/link';
import { AgeBadge, AgingBar, Badge, Card, CardHeader, EmptyState, Stat, cn } from '@/components/ui';
import { SyncTicker } from '@/components/sync-bits';
import { HomePreference } from '@/components/feed/home-preference';
import { requireSession } from '@/lib/auth';
import {
  agingCounts,
  getGroup,
  getLiveInventory,
  getRooftops,
  getRecentEvents,
  getSalesSince,
  getStorefronts,
  getSyncMatrix,
  sessionScope,
  getTrafficPerVehicle,
} from '@/lib/queries';
import {
  RECON_TARGET_DAYS,
  TURN_BENCHMARK,
  activePrice,
  daysInStock,
  daysSupply,
  isAtRisk,
  isWaterUnit,
  num,
  relativeTime,
  shortTitle,
  totalCost,
  turnRate,
  usd,
  VEHICLE_STATUS_LABEL,
} from '@/lib/domain';
import { requireSection } from '@/lib/auth-guard';
import { onboardingFrom } from '@/lib/onboarding';
import { isDefaultPalette } from '@/lib/branding/palette';
import { OnboardingCard } from '@/components/onboarding-card';

export const dynamic = 'force-dynamic';

/**
 * The traditional dashboard.
 *
 * Moved here from /admin when Lot Walk landed. /admin is now a router that
 * sends each user to whichever of the two they chose — see
 * src/app/admin/page.tsx. Nothing on this screen changed; the bet is that the
 * feed is a better home, not that the dashboard was wrong.
 */

export default async function DashboardPage() {
  await requireSection('dashboard');
  const [group, rooftops, inventory, sales, events, storefronts] = await Promise.all([
    getGroup(),
    getRooftops(),
    getLiveInventory(),
    getSalesSince(90),
    getRecentEvents(12),
    // Only the first-run checklist reads this, and it renders for almost nobody —
    // but it rides along in the existing Promise.all rather than earning a
    // waterfall, same reasoning as getTrafficByDay on the feed.
    getStorefronts(),
  ]);
  const onboarding = onboardingFrom({
    rooftops,
    storefront: storefronts[0],
    inventory,
    isDefaultPalette,
  });
  const rooftopCount = rooftops.length;
  const me = await requireSession();
  const traffic = await getTrafficPerVehicle(30);
  const matrix = await getSyncMatrix(await sessionScope(), inventory.map((v) => v.id));

  const withDays = inventory.map((v) => ({ ...v, dis: daysInStock(v, 'dateIn') }));
  const atRisk = withDays.filter((v) => isAtRisk(v.dis)).sort((a, b) => b.dis - a.dis);
  const aged = withDays.filter((v) => v.dis >= 61);
  const frontLine = inventory.filter((v) => v.status === 'FRONT_LINE_READY').length;
  const inRecon = withDays.filter((v) => v.status === 'IN_RECON' || v.status === 'ARRIVED' || v.status === 'PHOTOS_PENDING');
  const water = withDays.filter(isWaterUnit);

  const avgDis = Math.round(withDays.reduce((s, v) => s + v.dis, 0) / Math.max(1, withDays.length));
  const ds = daysSupply(inventory.length, sales.length, 90);
  const tr = turnRate(sales.length, 90, inventory.length);
  const vdp30 = [...traffic.values()].reduce((s, r) => s + r.vdpViews, 0);
  const inFlight = matrix.filter((m) =>
    ['QUEUED', 'SYNCING', 'PENDING'].includes(m.vehicle_sync_states.status),
  ).length;
  const listingErrors = matrix.filter((m) => m.vehicle_sync_states.status === 'ERROR').length;
  const moneyOut = withDays.reduce((s, v) => s + totalCost(v), 0);

  const reconDone = inventory.filter((v) => v.frontLineDate);
  const avgRecon =
    reconDone.length === 0
      ? null
      : Math.round(
          (reconDone.reduce(
            (s, v) =>
              s +
              (new Date(v.frontLineDate!).getTime() - new Date(v.acquiredDate).getTime()) /
                86_400_000,
            0,
          ) /
            reconDone.length) *
            10,
        ) / 10;

  return (
    <div className="px-6 py-6 lg:px-8">
      {onboarding.complete ? null : (
        <div className="mb-6">
          <OnboardingCard o={onboarding} />
        </div>
      )}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">{group.name}</h1>
          <p className="mt-1 text-sm text-ink-600">
            {rooftopCount === 1 ? 'One rooftop' : `${rooftopCount} rooftops`} ·{' '}
            {inventory.length} units in stock ·{' '}
            {usd(moneyOut)} of inventory money on the ground
          </p>
        </div>
        <div className="flex items-center gap-4">
          <HomePreference current={me.homeView} thisView="DASHBOARD" />
          <SyncTicker />
        </div>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Front-line ready"
          value={`${frontLine} / ${inventory.length}`}
          hint={`${inRecon.length} still in recon or photos`}
        />
        <Stat
          label="Average days in stock"
          value={`${avgDis}d`}
          hint={`${atRisk.length} at risk · ${aged.length} aged`}
          tone={avgDis > 45 ? 'bad' : undefined}
        />
        <Stat
          label="Days supply"
          value={ds ?? '—'}
          hint="90-day retail pace"
          benchmark="Healthy range 45–60"
        />
        <Stat
          label="Turn rate"
          value={tr ? `${tr}x` : '—'}
          hint="Annualised, trailing 90 days"
          benchmark={`${TURN_BENCHMARK.strong}–15x is strong · top operators run ${TURN_BENCHMARK.elite}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Aging"
              subtitle="Measured from date in. Switch the clock on the inventory screen."
              action={
                <Link
                  href="/admin/inventory"
                  className="text-xs font-medium text-ink-600 hover:text-ink-900 hover:underline"
                >
                  Open inventory →
                </Link>
              }
            />
            <div className="px-5 py-4">
              <AgingBar counts={agingCounts(inventory, 'dateIn')} total={inventory.length} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="At-risk list"
              subtitle="Units between 30 and 45 days. This is the window where a price move still works."
              action={<Badge tone={atRisk.length ? 'amber' : 'green'}>{atRisk.length} units</Badge>}
            />
            {atRisk.length === 0 ? (
              <EmptyState title="Nothing at risk" body="No unit is sitting in the 30–45 day window." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50/60 text-xs text-ink-600">
                    <th className="px-5 py-2 text-left font-semibold">Unit</th>
                    <th className="px-3 py-2 text-left font-semibold">Days</th>
                    <th className="px-3 py-2 text-right font-semibold">Price</th>
                    <th className="px-3 py-2 text-right font-semibold">In it</th>
                    <th className="px-3 py-2 text-right font-semibold">VDP 30d</th>
                    <th className="px-5 py-2 text-right font-semibold">Market</th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((v) => {
                    const tv = traffic.get(v.id);
                    const pct = v.marketValue
                      ? Math.round((activePrice(v) / v.marketValue) * 100)
                      : null;
                    return (
                      <tr key={v.id} className="border-b border-ink-100 hover:bg-ink-50/60">
                        <td className="px-5 py-2.5">
                          <Link
                            href={`/admin/inventory/${v.id}`}
                            className="text-xs font-semibold text-ink-900 hover:underline"
                          >
                            {shortTitle(v)}
                          </Link>
                          <div className="tnum text-[11px] text-ink-500">
                            {v.stockNumber} · {num(v.mileage)} mi
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <AgeBadge days={v.dis} />
                        </td>
                        <td className="tnum px-3 py-2.5 text-right font-semibold text-ink-900">
                          {usd(activePrice(v))}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-600">
                          {usd(totalCost(v))}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-600">
                          {num(tv?.vdpViews ?? 0)}
                        </td>
                        <td className="tnum px-5 py-2.5 text-right">
                          {pct == null ? (
                            '—'
                          ) : (
                            <span
                              className={cn(
                                'font-semibold',
                                pct <= 98 ? 'text-emerald-700' : pct >= 103 ? 'text-red-600' : 'text-ink-700',
                              )}
                            >
                              {pct}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recon board"
              subtitle={`Target is ${RECON_TARGET_DAYS} days from date in to front line. Running at ${avgRecon ?? '—'}d.`}
            />
            {inRecon.length === 0 ? (
              <EmptyState title="Nothing in recon" body="Every unit on the ground is front-line ready." />
            ) : (
              <ul className="divide-y divide-ink-100">
                {inRecon.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-5 py-3">
                    <img
                      src={v.photos[0]?.url ?? ''}
                      alt=""
                      width={64}
                      height={43}
                      className="h-11 w-16 shrink-0 rounded-md border border-ink-200 object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/inventory/${v.id}`}
                        className="text-xs font-semibold text-ink-900 hover:underline"
                      >
                        {shortTitle(v)}
                      </Link>
                      <div className="tnum text-[11px] text-ink-500">{v.stockNumber}</div>
                    </div>
                    <Badge tone={v.status === 'PHOTOS_PENDING' ? 'amber' : 'blue'}>
                      {VEHICLE_STATUS_LABEL[v.status]}
                    </Badge>
                    <AgeBadge days={v.dis} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Syndication
            </div>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Changes in flight</span>
                <span className="tnum font-semibold text-ink-900">{inFlight}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Listing errors</span>
                <span
                  className={cn(
                    'tnum font-semibold',
                    listingErrors ? 'text-red-600' : 'text-ink-900',
                  )}
                >
                  {listingErrors}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-600">VDP views · 30d</span>
                <span className="tnum font-semibold text-ink-900">{num(vdp30)}</span>
              </div>
            </div>
            <Link
              href="/admin/syndication"
              className="mt-3 block rounded-lg bg-ink-900 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-ink-800"
            >
              Open syndication
            </Link>
          </Card>

          {water.length ? (
            <Card>
              <CardHeader
                title="Water units"
                subtitle="Total cost is above what the market will pay."
                action={<Badge tone="red">{water.length}</Badge>}
              />
              <ul className="divide-y divide-ink-100">
                {water.map((v) => (
                  <li key={v.id} className="px-5 py-3">
                    <Link
                      href={`/admin/inventory/${v.id}`}
                      className="text-xs font-semibold text-ink-900 hover:underline"
                    >
                      {shortTitle(v)}
                    </Link>
                    <div className="tnum mt-1 flex items-center justify-between text-[11px] text-ink-500">
                      <span>In it {usd(totalCost(v))}</span>
                      <span className="font-semibold text-red-600">
                        {usd(totalCost(v) - v.marketValue)} under water
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Recent activity" />
            <ul className="divide-y divide-ink-100">
              {events.map((e) => (
                <li key={e.sync_events.id} className="px-5 py-2.5">
                  <div className="text-[11px] text-ink-900">
                    <span className="font-semibold">{e.channels.shortName}</span> ·{' '}
                    {e.vehicles.year} {e.vehicles.make} {e.vehicles.model}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-ink-500">
                    <span className="truncate">{e.sync_events.message}</span>
                    <span className="ml-2 shrink-0 text-ink-400">
                      {relativeTime(e.sync_events.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
