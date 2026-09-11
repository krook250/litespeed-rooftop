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
import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { GroupRow } from '@/components/ad-desk/group-row';
import { money } from '@/components/ad-desk/format';
import { requireSection } from '@/lib/auth-guard';
import { CAMPAIGN_BUCKETS } from '@/lib/meta/buckets';
import { allAdCopyForRooftop } from '@/lib/meta/ad-copy';
import { previewFeed } from '@/lib/meta/feed-preview';
import { blockerFor, loadAdDesk, loadLotGroups } from '../shared';

export const dynamic = 'force-dynamic';

export default async function AdsPage() {
  await requireSection('ad-desk');
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
        <Header />
        <Card>
          <EmptyState
            title="Facebook is not connected yet"
            body="The ads read your inventory out of a Facebook catalog, so the account has to be connected before there is anything to run."
          />
          <div className="flex justify-center pb-8">
            <Link href="/admin/ad-desk/connect">
              <Button type="button">Go to Connect</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const { groups: byRooftop, failed } = await loadLotGroups(data);

  const provisioned = data.rooftops.filter((r) => data.assets.get(r.id)?.catalogId);
  const copyByRooftop = new Map(
    await Promise.all(
      provisioned.map(async (r) => [r.id, await allAdCopyForRooftop(r.id)] as const),
    ),
  );
  const previews = new Map(
    await Promise.all(provisioned.map(async (r) => [r.id, await previewFeed(r.id)] as const)),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Header />

      {data.rooftops.map((r) => {
        const lot = byRooftop.get(r.id);
        const groups = lot?.groups ?? [];
        const copy = copyByRooftop.get(r.id) ?? [];
        const shelfCounts = previews.get(r.id)?.shelfCounts ?? null;
        const blocker = blockerFor(data, r.id);

        const built = new Set(groups.map((g) => g.bucketKey).filter(Boolean));
        const unbuilt = CAMPAIGN_BUCKETS.filter((b) => !built.has(b.key));
        const running = groups.filter((g) => g.effectiveStatus === 'ACTIVE');
        const perDay = running.reduce((n, g) => n + (g.dailyBudgetUsd ?? 0), 0);
        const spend = groups.reduce((n, g) => n + g.spend, 0);
        const clicks = groups.reduce((n, g) => n + g.clicks, 0);

        return (
          <section key={r.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">{r.name}</h2>
                <p className="text-xs text-ink-500">
                  {[r.city, r.state].filter(Boolean).join(', ')}
                </p>
              </div>
              {unbuilt.length && !blocker ? (
                <Link href={`/admin/ad-desk/ads/${r.id}/new`}>
                  <Button type="button" size="sm">
                    + New group
                  </Button>
                </Link>
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
              <div className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${running.length ? 'bg-emerald-500' : 'bg-ink-300'}`}
                  />
                  <span className="text-sm font-medium text-ink-900">
                    {running.length ? 'Running' : 'All stopped'}
                  </span>
                </div>
                <Figure value={money(perDay)} label={`a day, across ${running.length} ${running.length === 1 ? 'group' : 'groups'}`} />
                {shelfCounts ? (
                  <Figure value={String(shelfCounts.all)} label="cars front-line and advertisable" />
                ) : null}
                <Figure value={money(spend)} label="spent" />
                <Figure value={clicks.toLocaleString()} label="clicks" />
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
                    />
                  ))}
              </div>
            ) : !blocker && !failed.has(r.id) ? (
              <Card>
                <EmptyState
                  title="No ads running for this lot yet"
                  body="A group is one shelf of cars with its own budget, radius and ads. Build the first one and nothing spends until you start it."
                />
                <div className="flex justify-center pb-8">
                  <Link href={`/admin/ad-desk/ads/${r.id}/new`}>
                    <Button type="button">Build the first group</Button>
                  </Link>
                </div>
              </Card>
            ) : null}

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
                      <Link href={`/admin/ad-desk/ads/${r.id}/${b.key}`}>
                        <Button type="button" size="sm">
                          Finish setup ›
                        </Button>
                      </Link>
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

function Header() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink-900">Ads</h1>
      <p className="mt-1 text-sm text-ink-600">
        A group is one shelf of cars with its own budget, radius and ads.
      </p>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums text-ink-900">{value}</div>
      <div className="text-[11px] text-ink-500">{label}</div>
    </div>
  );
}
