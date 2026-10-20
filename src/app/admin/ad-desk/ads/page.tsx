/**
 * Ad Desk › Ads — what is running, and nothing else.
 *
 * THE RULE THIS SCREEN EXISTS TO KEEP: the list never contains a form. The
 * screen it replaces had a running group, an "Add a group" form, three ad
 * editors, a build button and an "Add another ad" button stacked inside one
 * card, and there was no way to tell from looking at it what was live, what was
 * a draft, and which button spent money. Every editor moved to
 * `ads/[rooftopId]/[bucket]`; what is left here is a row per group.
 */

import Link from 'next/link';
import { Badge, Card, CardHeader, EmptyState, cn } from '@/components/ui';
import { LineArea, NEUTRAL_INK, NEUTRAL_INK_SOFT } from '@/components/charts';
import { GroupRow } from '@/components/ad-desk/group-row';
import { VideoGroups } from '@/components/ad-desk/video-groups';
import { videoGroupsForRooftop } from '@/lib/meta/video-groups';
import { LinkButton } from '@/components/link-pending';
import { dollars, money } from '@/components/ad-desk/format';
import {
  RANGES,
  RANGE_LABEL,
  facebookSiteReport,
  parseRange,
  rangeWindow,
  type FacebookSiteReport,
  type Range,
} from '@/lib/meta/ad-report';
import { requireSection } from '@/lib/auth-guard';
import { CAMPAIGN_BUCKETS } from '@/lib/meta/buckets';
import { allAdCopyForRooftop } from '@/lib/meta/ad-copy';
import { adGroupsForRooftop } from '@/lib/meta/ad-groups';
import { describeFilters } from '@/lib/meta/group-filter';
import { previewFeed } from '@/lib/meta/feed-preview';
import { blockerFor, loadAdDesk, loadLotGroups } from '../shared';

export const dynamic = 'force-dynamic';

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSection('ad-desk');
  const range = parseRange((await searchParams).range);
  const data = await loadAdDesk();

  if (!data.configured) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card>
          <CardHeader title="Ads" subtitle="Facebook and Instagram catalog ads" />
          <EmptyState
            title="Not configured on this deployment"
            body="META_APP_ID, META_APP_SECRET, META_LOGIN_CONFIG_ID and META_TOKEN_KEY need to be set before the Facebook connection can be offered."
          />
        </Card>
      </div>
    );
  }

  if (!data.connected) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 p-6">
        <Header range={range} />
        <Card>
          <EmptyState
            title="Facebook is not connected yet"
            body="The ads read your inventory out of a Facebook catalog, so the account has to be connected before there is anything to run."
          />
          <div className="flex justify-center pb-8">
            <LinkButton href="/admin/ad-desk/connect" variant="primary">
              Go to Connect
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  const tzOf = (id: string) => data.rooftops.find((r) => r.id === id)?.timezone ?? 'America/New_York';
  const { groups: byRooftop, failed } = await loadLotGroups(
    data,
    undefined,
    (id) => rangeWindow(range, tzOf(id)).window,
  );

  const provisioned = data.rooftops.filter((r) => data.assets.get(r.id)?.catalogId);
  const videoCounts = new Map(
    await Promise.all(data.rooftops.map(async (r) => [r.id, (await videoGroupsForRooftop(r.id)).length] as const)),
  );
  const copyByRooftop = new Map(
    await Promise.all(
      provisioned.map(async (r) => [r.id, await allAdCopyForRooftop(r.id)] as const),
    ),
  );
  const previews = new Map(
    await Promise.all(provisioned.map(async (r) => [r.id, await previewFeed(r.id)] as const)),
  );
  const localByRooftop = new Map(
    await Promise.all(
      provisioned.map(async (r) => [r.id, await adGroupsForRooftop(r.id)] as const),
    ),
  );
  /*
   * Our own half: visits and leads on the dealer's site. A failure here must
   * not take the Facebook numbers down with it, so it degrades to "not shown".
   */
  const siteByRooftop = new Map<string, FacebookSiteReport | null>(
    await Promise.all(
      data.rooftops.map(async (r) => {
        const lot = byRooftop.get(r.id);
        if (!lot?.groups.length) return [r.id, null] as const;
        const report = await facebookSiteReport({
          rooftopId: r.id,
          timeZone: r.timezone,
          range,
          adSetIds: lot.groups.map((g) => g.id),
        }).catch((err) => {
          console.error('[ad-desk] site report failed', err);
          return null;
        });
        return [r.id, report] as const;
      }),
    ),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Header range={range} />

      {data.rooftops.map((r) => {
        const lot = byRooftop.get(r.id);
        const groups = lot?.groups ?? [];
        const copy = copyByRooftop.get(r.id) ?? [];
        const shelfCounts = previews.get(r.id)?.shelfCounts ?? null;
        const blocker = blockerFor(data, r.id);
        const local = new Map((localByRooftop.get(r.id) ?? []).map((g) => [g.bucket, g]));

        const built = new Set(groups.map((g) => g.bucketKey).filter(Boolean));
        const unbuilt = CAMPAIGN_BUCKETS.filter((b) => !built.has(b.key));
        const running = groups.filter((g) => g.effectiveStatus === 'ACTIVE');
        const perDay = running.reduce((n, g) => n + (g.dailyBudgetUsd ?? 0), 0);
        const spend = groups.reduce((n, g) => n + g.spend, 0);
        const clicks = groups.reduce((n, g) => n + g.linkClicks, 0);
        const site = siteByRooftop.get(r.id) ?? null;
        const perClick = clicks ? spend / clicks : null;
        const perLead = site?.lot.leads ? spend / site.lot.leads : null;

        // Every group's days added together, with the empty days filled in so a
        // dark day reads as a dip rather than vanishing off the x-axis.
        const byDay = new Map<string, { spend: number; clicks: number }>();
        for (const day of rangeWindow(range, r.timezone).days) byDay.set(day, { spend: 0, clicks: 0 });
        for (const g of groups) {
          for (const d of g.daily) {
            const cur = byDay.get(d.date) ?? { spend: 0, clicks: 0 };
            byDay.set(d.date, { spend: cur.spend + d.spend, clicks: cur.clicks + d.linkClicks });
          }
        }
        const trend = [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([label, v]) => ({ label, value: v.clicks, secondary: Math.round(v.spend) }));

        return (
          <section key={r.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">{r.name}</h2>
                <p className="text-xs text-ink-500">
                  {[r.city, r.state].filter(Boolean).join(', ')}
                </p>
              </div>
              {!blocker ? (
                <LinkButton href={`/admin/ad-desk/ads/${r.id}/choose`} variant="primary" size="sm">
                  + New group
                </LinkButton>
              ) : null}
            </div>

            {blocker ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-900">{blocker}</p>
            ) : null}

            {failed.has(r.id) ? (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-900">
                Facebook could not be reached just now, so what is running is not shown. Reload in a
                minute.
              </p>
            ) : null}

            {/* ------------------------------------------------- the strip */}
            {groups.length ? (
              <div className="rounded-xl border border-ink-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-ink-100 px-4 py-2.5 text-xs text-ink-600">
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${running.length ? 'bg-emerald-500' : 'bg-ink-300'}`}
                    />
                    <span className="text-sm font-medium text-ink-900">
                      {running.length ? 'Running' : 'All stopped'}
                    </span>
                  </span>
                  <span className="tabular-nums">
                    {money(perDay)} a day across {running.length}{' '}
                    {running.length === 1 ? 'group' : 'groups'}
                  </span>
                  {shelfCounts ? (
                    <span className="tabular-nums">{shelfCounts.all} cars front-line and advertisable</span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-4 lg:grid-cols-7">
                  <Figure value={money(spend)} label="spent" />
                  <Figure value={lot?.reach == null ? '—' : lot.reach.toLocaleString()} label="people reached" />
                  <Figure value={clicks.toLocaleString()} label="clicks to a car" />
                  <Figure value={perClick === null ? '—' : dollars(perClick)} label="per click" />
                  <Figure value={site ? site.lot.visitors.toLocaleString() : '—'} label="site visitors from Facebook" />
                  <Figure value={site ? site.lot.leads.toLocaleString() : '—'} label="leads from Facebook" />
                  <Figure value={perLead === null ? '—' : money(perLead)} label="per lead" />
                </div>

                {trend.length > 1 ? (
                  <div className="border-t border-ink-100 px-4 pb-3 pt-3">
                    <LineArea
                      id={`ads-trend-${r.id}`}
                      points={trend}
                      title={`Clicks and spend by day, ${RANGE_LABEL[range].toLowerCase()}`}
                      seriesName="Clicks"
                      secondaryName="Spend"
                      color={NEUTRAL_INK}
                      secondaryColor={NEUTRAL_INK_SOFT}
                      height={170}
                      formatX={(label) => dayLabel(label)}
                    />
                    <p className="mt-1.5 text-[11px] text-ink-500">
                      Line: clicks to a car each day. Bars: what was spent that day.
                    </p>
                  </div>
                ) : null}

                <p className="border-t border-ink-100 px-4 py-2 text-[11px] text-ink-500">
                  {range === 'all' ? 'Since the first group started.' : `Last ${RANGE_LABEL[range]}, today included.`}{' '}
                  Site visitors and leads from Facebook include shares and posts, not only these ads.
                </p>
              </div>
            ) : null}

            {/* -------------------------------------------------- the list */}
            {groups.length ? (
              <div className="space-y-2.5">
                {[...groups]
                  .sort(
                    (a, b) =>
                      CAMPAIGN_BUCKETS.findIndex((x) => x.key === a.bucketKey) -
                      CAMPAIGN_BUCKETS.findIndex((x) => x.key === b.bucketKey),
                  )
                  .map((g) => (
                    <GroupRow
                      key={g.id}
                      rooftopId={r.id}
                      group={g}
                      adCount={copy.filter((c) => c.bucket === g.bucketKey && c.active).length}
                      shelfCount={
                        shelfCounts && g.bucketKey ? shelfCounts[g.bucketKey] : null
                      }
                      adoptable={unbuilt.map((b) => ({ key: b.key, label: b.label }))}
                      displayName={g.bucketKey ? local.get(g.bucketKey)?.name : undefined}
                      rule={
                        g.bucketKey
                          ? describeFilters(local.get(g.bucketKey)?.filters ?? {})
                          : ''
                      }
                      rangeLabel={range === 'all' ? 'Since this group started' : `Last ${RANGE_LABEL[range]}`}
                      site={site?.groups.get(g.id) ?? null}
                      adSite={Object.fromEntries(
                        g.ads.map((a) => [a.id, site?.ads.get(a.id) ?? { visitors: 0, leads: 0 }]),
                      )}
                    />
                  ))}
              </div>
            ) : !blocker && !failed.has(r.id) && !videoCounts.get(r.id) ? (
              <Card>
                <EmptyState
                  title="No ads running for this lot yet"
                  body="A group is one shelf of cars with its own budget, radius and ads. Build the first one and nothing spends until you start it."
                />
                <div className="flex justify-center pb-8">
                  <LinkButton href={`/admin/ad-desk/ads/${r.id}/choose`} variant="primary">
                    Build the first group
                  </LinkButton>
                </div>
              </Card>
            ) : null}

            <VideoGroups
              rooftopId={r.id}
              dealerGroupId={data.groupId}
              window={rangeWindow(range, r.timezone).window}
              rangeLabel={range === 'all' ? 'Since it started' : `Last ${RANGE_LABEL[range]}`}
            />

            {/*
              Groups saved here but never built, and campaigns from the
              one-per-shelf era. Both are real states a dealer can be in and
              neither belongs in the list above, where every row is a thing at
              Facebook.
            */}
            {unbuilt.some((b) => copy.some((c) => c.bucket === b.key && c.active)) ? (
              <div className="space-y-2.5">
                {unbuilt
                  .filter((b) => copy.some((c) => c.bucket === b.key && c.active))
                  .map((b) => (
                    <div
                      key={b.key}
                      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed border-ink-300 px-4 py-3.5"
                    >
                      <div className="min-w-[12rem] flex-1">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="text-sm font-semibold text-ink-700">{b.label}</span>
                          <Badge tone="blue">Not built yet</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-ink-500">
                          Saved here only. Nothing is at Facebook and nothing is spending.
                        </p>
                      </div>
                      <LinkButton href={`/admin/ad-desk/ads/${r.id}/${b.key}`} variant="primary" size="sm">
                        Finish setup ›
                      </LinkButton>
                    </div>
                  ))}
              </div>
            ) : null}

            {lot?.legacy.length ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                <p className="text-xs font-semibold text-amber-900">
                  {lot.legacy.length === 1
                    ? 'One campaign here was not built by Rooftop'
                    : `${lot.legacy.length} campaigns here were not built by Rooftop`}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {lot.legacy.map((c) => (
                    <li key={c.id} className="text-[11px] text-amber-900">
                      {c.name} — {money(c.spend)} spent
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-amber-900/80">
                  These are from the older one-campaign-per-shelf setup. Rooftop lists them so they
                  can be stopped, but manages them in Ads Manager only.
                </p>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Header({ range }: { range: Range }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold text-ink-900">Ads</h1>
        <p className="mt-1 text-sm text-ink-600">
          A group is one shelf of cars with its own budget, radius and ads.
        </p>
      </div>
      <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5">
        {RANGES.map((x) => (
          <Link
            key={x}
            href={x === '7' ? '/admin/ad-desk/ads' : `/admin/ad-desk/ads?range=${x}`}
            aria-current={x === range ? 'page' : undefined}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              x === range ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100',
            )}
          >
            {RANGE_LABEL[x]}
          </Link>
        ))}
      </div>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-16" → "Oct 16". */
function dayLabel(iso: string) {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${Number(d)}`;
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums text-ink-900">{value}</div>
      <div className="text-[11px] text-ink-500">{label}</div>
    </div>
  );
}
