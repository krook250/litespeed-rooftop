'use client';

/**
 * Ad Desk — inventory health, and the campaign that proves the permissions.
 *
 * TWO PANELS, TWO DIFFERENT JOBS.
 *
 * `FeedHealthPanel` is product. It answers the question every dealer eventually
 * asks their vendor — "why does Facebook show 34 cars when I have 41?" — before
 * they have to ask it, and with a fix attached to each reason. Every competitor
 * in this category drops those seven units silently; that is the complaint
 * `claude/meta-marketplace.md` §3 is about, and this panel is the answer to it.
 *
 * `CampaignDemoPanel` is scaffolding, and is labelled as such on screen. It
 * exists because three of the permissions under App Review — `ads_management`,
 * `ads_read`, `pages_manage_ads` — cannot be shown working by a connect flow
 * that never creates an ad. It builds one paused campaign against an ad account
 * with no payment method and reads the result back. It is deliberately not dressed up as a
 * campaign manager, because it isn't one, and a reviewer who feels oversold is
 * a reviewer looking harder.
 */

import { useActionState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import { createDemoCampaignAction, readCampaignInsightsAction } from '@/lib/meta/demo-actions';
import type { FeedPreview } from '@/lib/meta/feed-preview';

/* ------------------------------------------------------------ feed health */

export function FeedHealthPanel({ preview }: { preview: FeedPreview }) {
  const { total, included, excluded, marketplaceHeld, reasons } = preview;

  return (
    <Card>
      <CardHeader
        title="What Facebook is getting"
        subtitle={`${preview.rooftopName} — the inventory feed, unit by unit`}
        action={
          excluded === 0 && marketplaceHeld === 0 ? (
            <Badge tone="green">All {total} units</Badge>
          ) : (
            <Badge tone="amber">
              {included} of {total}
            </Badge>
          )
        }
      />

      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tally n={included} label="in the catalog" tone="ink" />
          <Tally n={marketplaceHeld} label="held off Marketplace" tone="amber" />
          <Tally n={excluded} label="not advertised" tone="red" />
        </div>

        {reasons.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Every unit on this lot is eligible for every placement, including Marketplace.
          </p>
        ) : (
          <ul className="space-y-2">
            {reasons.map((r) => (
              <li
                key={r.code}
                className={`rounded-lg px-3 py-2.5 text-xs ${
                  r.scope === 'FEED' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{r.reason}</span>
                  <span className="shrink-0 tabular-nums opacity-70">
                    {r.count} {r.count === 1 ? 'unit' : 'units'}
                  </span>
                </div>
                {r.fix ? <p className="mt-1 opacity-80">{r.fix}</p> : null}
                {r.examples.length ? (
                  <p className="mt-1 font-mono text-[10px] opacity-60">
                    e.g. {r.examples.join(', ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-ink-500">
          &ldquo;Held off Marketplace&rdquo; means the unit still runs in Facebook and Instagram feeds
          — it just can&apos;t appear in the Marketplace surface until the reason above is cleared.
          These are Facebook&apos;s rules, not ours.
        </p>
      </div>
    </Card>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: 'ink' | 'amber' | 'red' }) {
  const colour =
    tone === 'red' && n > 0
      ? 'text-red-700'
      : tone === 'amber' && n > 0
        ? 'text-amber-700'
        : 'text-ink-900';
  return (
    <div className="rounded-lg bg-ink-50 px-2 py-2.5">
      <div className={`text-lg font-semibold tabular-nums ${colour}`}>{n}</div>
      <div className="text-[11px] text-ink-600">{label}</div>
    </div>
  );
}

/* --------------------------------------------------------- campaign demo */

export type CampaignDemoRow = {
  rooftopId: string;
  name: string;
  ready: boolean;
  /** Why it isn't ready, when it isn't. */
  blocker: string | null;
};

const BUCKETS = [
  { key: 'age_31_45', label: '31–45 days' },
  { key: 'age_46_60', label: '46–60 days' },
  { key: 'age_61_plus', label: '61+ days' },
];

export function CampaignDemoPanel({ row }: { row: CampaignDemoRow }) {
  const [state, action, busy] = useActionState(createDemoCampaignAction, null);
  const [insights, readAction, reading] = useActionState(readCampaignInsightsAction, null);

  const campaignId = state?.ok ? state.data?.campaignId : undefined;

  return (
    <Card>
      <CardHeader
        title="Campaign demo"
        subtitle="One paused campaign off the Lot Walk aging buckets, in an unfunded ad account."
        action={<Badge tone="neutral">Demo</Badge>}
      />

      <div className="space-y-4 px-5 py-4">
        <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-600">
          This builds a real campaign, ad set and creative through the Marketing API and then reads
          the result back — against an ad account with <strong>no payment method</strong>, so it
          cannot deliver. Everything lands paused. It costs nothing and cannot spend.
        </p>

        {!row.ready ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{row.blocker}</p>
        ) : (
          <form action={action} className="space-y-3">
            <input type="hidden" name="rooftopId" value={row.rooftopId} />
            <label className="block">
              <span className="text-xs font-medium text-ink-700">Which shelf</span>
              <select
                name="bucket"
                defaultValue="age_46_60"
                className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
              >
                {BUCKETS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-ink-500">
                The same buckets the Lot Walk uses. The vehicle set is built from days on lot, so the
                ad targets exactly the units the Monday meeting is about.
              </span>
            </label>

            <Button type="submit" disabled={busy}>
              {busy ? 'Building…' : 'Build the demo campaign'}
            </Button>
          </form>
        )}

        {state && !state.ok ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
        ) : null}

        {state?.ok && state.data ? (
          <div className="space-y-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
            <p className="font-medium">{state.message}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px]">
              <Row k="objective" v={state.data.objectiveUsed} />
              <Row k="campaign" v={state.data.campaignId} />
              <Row k="vehicle set" v={`${state.data.productSet.id} (${state.data.productSet.name})`} />
              <Row k="ad set" v={state.data.adSetId} />
              <Row k="creative" v={state.data.creativeId} />
              <Row k="status" v={state.data.status} />
            </dl>
            {state.data.adopted.campaign || state.data.adopted.adSet ? (
              <p className="text-[11px] text-emerald-800">
                Reused what was already there rather than duplicating it:{' '}
                {[
                  state.data.adopted.campaign && 'campaign',
                  state.data.adopted.adSet && 'ad set',
                ]
                  .filter(Boolean)
                  .join(', ')}
                . Delete them in Ads Manager if you want this built fresh.
              </p>
            ) : null}
          </div>
        ) : null}

        {campaignId ? (
          <form action={readAction} className="space-y-2 border-t border-ink-200 pt-3">
            <input type="hidden" name="campaignId" value={campaignId} />
            <Button variant="secondary" size="sm" type="submit" disabled={reading}>
              {reading ? 'Reading…' : 'Read spend and delivery back'}
            </Button>
            {insights && !insights.ok ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{insights.error}</p>
            ) : null}
            {insights?.ok ? (
              <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-700">{insights.message}</p>
            ) : null}
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="opacity-60">{k}</dt>
      <dd className="break-all">{v}</dd>
    </>
  );
}
