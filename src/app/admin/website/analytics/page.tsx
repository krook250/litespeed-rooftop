import Link from 'next/link';
import { requireSection } from '@/lib/auth-guard';
import { Card, CardHeader, EmptyState, Stat, cn } from '@/components/ui';
import { loadWebsite, WebsiteHeader } from '../shared';
import { storefrontAnalytics, type AnalyticsDay } from '@/lib/analytics/queries';
import { SOURCE_LABEL } from '@/lib/analytics/source';
import { pixelIdsForRooftops } from '@/lib/meta/pixel';
import { GaCard } from '@/components/website/ga-card';

export const dynamic = 'force-dynamic';

/**
 * Website / Analytics.
 *
 * Our own count, from the beacon in the storefront layout (`/api/t`). No third
 * party in the path: the dealer's GA and pixel are theirs and optional, and
 * this screen reads only `page_views` and `leads`.
 *
 * Counting began with migration 0032 (Oct 2026). There is no history before
 * that and the screen says so rather than drawing a flat line as if the site
 * had no visitors.
 */

const WINDOWS = [7, 30, 90] as const;

const num = (n: number) => n.toLocaleString('en-US');

export default async function WebsiteAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSection('website');
  const data = await loadWebsite();
  if (!data) {
    return <EmptyState title="No storefront yet" body="Add a rooftop and we'll create your website." />;
  }

  const { days: daysRaw } = await searchParams;
  const days = (WINDOWS as readonly number[]).includes(Number(daysRaw)) ? Number(daysRaw) : 30;
  const tz = data.rooftop?.timezone ?? 'America/New_York';

  const [a, pixelIds] = await Promise.all([
    storefrontAnalytics(data.sf.id, days, tz),
    pixelIdsForRooftops(data.rooftops.map((r) => r.id)),
  ]);

  const rate = a.visitors ? ((a.leads / a.visitors) * 100).toFixed(1) : null;
  const started = a.firstSeen
    ? a.firstSeen.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <WebsiteHeader
        name="Analytics"
        subtitle={`${data.sf.name} — who is on your site and what they looked at.`}
        previewUrl={data.previewUrl}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/admin/website/analytics?days=${w}`}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium',
                w === days ? 'bg-ink-900 text-white' : 'text-ink-600 hover:text-ink-900',
              )}
            >
              {w} days
            </Link>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          {started ? `Counting since ${started}.` : 'Counting starts with the first visit.'} Bots and
          repeat refreshes are left out.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Visitors" value={num(a.visitors)} />
        <Stat label="Vehicle page views" value={num(a.vdpViews)} />
        <Stat label="Leads" value={num(a.leads)} />
        <Stat label="Leads per 100 visitors" value={rate ?? '—'} />
      </div>

      <Card>
        <CardHeader title="Visitors by day" subtitle="Green dots underneath are days a lead came in." />
        <div className="px-5 py-4">
          {a.visitors || a.leads ? (
            <DailyChart series={a.series} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-500">
              No visits counted yet. They show up here within a minute of someone opening your site.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Where they came from" />
        {a.sources.length ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-[11px] uppercase tracking-wider text-ink-500">
                <th className="px-5 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 text-right font-semibold">Visitors</th>
                <th className="px-5 py-2 text-right font-semibold">Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {a.sources.map((s) => {
                const share = a.visitors ? Math.round((s.visitors / a.visitors) * 100) : 0;
                return (
                  <tr key={s.source}>
                    <td className="px-5 py-2.5">
                      <div className="font-medium text-ink-900">{SOURCE_LABEL[s.source]}</div>
                      <div className="mt-1 h-1.5 w-full max-w-[220px] rounded-full bg-ink-100">
                        <div className="h-1.5 rounded-full bg-emerald-600" style={{ width: `${share}%` }} />
                      </div>
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-800">
                      {num(s.visitors)} <span className="text-xs text-ink-400">{share}%</span>
                    </td>
                    <td className="tnum px-5 py-2.5 text-right text-ink-800">{num(s.leads)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nothing yet" body="Once people visit, this shows whether they came from Facebook, Google, a marketplace or typed your address." />
        )}
        {a.untrackedLeads ? (
          <p className="border-t border-ink-100 px-5 py-2.5 text-xs text-ink-500">
            {a.untrackedLeads} lead{a.untrackedLeads === 1 ? '' : 's'} in this window came in before
            tracking started, so there&apos;s no source for {a.untrackedLeads === 1 ? 'it' : 'them'}.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Most-viewed vehicles"
          subtitle="Lots of views and no leads usually means the price or the photos."
        />
        {a.vehicles.length ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-[11px] uppercase tracking-wider text-ink-500">
                <th className="px-5 py-2 font-semibold">Vehicle</th>
                <th className="px-3 py-2 text-right font-semibold">Views</th>
                <th className="px-3 py-2 text-right font-semibold">Leads</th>
                <th className="px-5 py-2 text-right font-semibold">Days on lot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {a.vehicles.map((v) => (
                <tr key={v.vehicleId}>
                  <td className="px-5 py-2.5">
                    <Link href={`/admin/inventory/${v.vehicleId}`} className="font-medium text-ink-900 hover:underline">
                      {v.title}
                    </Link>
                    <span className="ml-1.5 text-xs text-ink-500">
                      #{v.stockNumber}
                      {v.status === 'SOLD' || v.status === 'WHOLESALED' ? ' · sold' : ''}
                    </span>
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-ink-800">{num(v.views)}</td>
                  <td className={cn('tnum px-3 py-2.5 text-right', v.leads ? 'font-semibold text-emerald-700' : 'text-ink-400')}>
                    {num(v.leads)}
                  </td>
                  <td className="tnum px-5 py-2.5 text-right text-ink-800">{v.daysOnLot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="Nothing yet" body="The vehicles shoppers open most will list here." />
        )}
      </Card>

      <Card>
        <CardHeader title="Your tracking tags" subtitle="Optional. Everything above works without them." />
        <div className="space-y-5 px-5 py-4">
          <div>
            <div className="text-sm font-medium text-ink-800">Meta pixel</div>
            {pixelIds.length ? (
              <p className="mt-0.5 text-sm text-ink-600">
                On every page of your site: <span className="font-mono text-xs">{pixelIds.join(', ')}</span>.
                Added automatically when you connected Facebook in the Ad Desk.
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-ink-600">
                Not connected. It&apos;s added automatically when you connect Facebook in the{' '}
                <Link href="/admin/ad-desk/connect" className="underline">Ad Desk</Link>.
              </p>
            )}
          </div>
          <GaCard storefrontId={data.sf.id} current={data.sf.gaMeasurementId ?? null} />
        </div>
      </Card>
    </div>
  );
}

/**
 * Visitors as bars, one per day, with leads as dots on a strip beneath. Two
 * measures on two strips rather than two y-axes: 40 visitors and 2 leads on one
 * scale is a flat line with a bump.
 */
function DailyChart({ series }: { series: AnalyticsDay[] }) {
  const W = 720;
  const H = 150;
  const STRIP = 22;
  const max = Math.max(1, ...series.map((d) => d.visitors));
  const step = W / series.length;
  const bar = Math.max(2, Math.min(18, step - 2));
  const label = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const ticks = [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return (
    <div>
      <div className="mb-1 text-[11px] text-ink-500">Peak {max.toLocaleString('en-US')} visitors in a day</div>
      <svg viewBox={`0 0 ${W} ${H + STRIP + 18}`} className="w-full" role="img" aria-label="Visitors and leads by day">
        <line x1="0" x2={W} y1={H} y2={H} className="stroke-ink-200" strokeWidth="1" />
        {series.map((d, i) => {
          const h = (d.visitors / max) * (H - 6);
          const cx = i * step + step / 2;
          return (
            <g key={d.date}>
              <title>{`${label(d.date)}: ${d.visitors} visitor${d.visitors === 1 ? '' : 's'}, ${d.leads} lead${d.leads === 1 ? '' : 's'}`}</title>
              <rect x={i * step} y="0" width={step} height={H + STRIP} fill="transparent" />
              {d.visitors ? (
                <rect x={cx - bar / 2} y={H - h} width={bar} height={h} rx={Math.min(3, bar / 2)} className="fill-emerald-600" />
              ) : null}
              {d.leads ? (
                <>
                  <circle cx={cx} cy={H + STRIP / 2 + 1} r="5" className="fill-emerald-700" />
                  {d.leads > 1 ? (
                    <text x={cx} y={H + STRIP / 2 + 4.5} textAnchor="middle" className="fill-white text-[8px] font-bold">
                      {d.leads}
                    </text>
                  ) : null}
                </>
              ) : null}
            </g>
          );
        })}
        {ticks.map((i) => (
          <text
            key={i}
            x={i === 0 ? 0 : i === series.length - 1 ? W : i * step + step / 2}
            y={H + STRIP + 14}
            textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
            className="fill-ink-500 text-[11px]"
          >
            {label(series[i]!.date)}
          </text>
        ))}
      </svg>
    </div>
  );
}
