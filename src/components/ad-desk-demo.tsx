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
 * `CampaignDemoPanel` was scaffolding for App Review and is now the thing a
 * dealer builds a campaign with. The ad account is theirs and it can spend, so
 * the two claims this panel used to make on screen — unfunded account, cannot
 * deliver — are gone. What replaces them is the truth: it lands PAUSED and they
 * turn it on themselves in Ads Manager.
 *
 * It is still not a campaign manager. Budget, radius and which shelf are the
 * three decisions worth making here; everything else belongs in Ads Manager and
 * pretending otherwise would mean reimplementing it badly.
 */

import { useActionState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import { createDemoCampaignAction, readCampaignInsightsAction } from '@/lib/meta/demo-actions';
import type { FeedPreview } from '@/lib/meta/feed-preview';
import { CAMPAIGN_BUCKETS, DEFAULT_BUCKET } from '@/lib/meta/buckets';

/* ------------------------------------------------------------ feed health */

export function FeedHealthPanel({
  preview,
  metaProductCount,
}: {
  preview: FeedPreview;
  /**
   * What Facebook has ACCEPTED, against this panel's count of what we are
   * SENDING. Null when we could not ask.
   *
   * These two numbers side by side are the entire point of the addition. This
   * panel has always reported intent — `claude/meta-catalog-creation-blocker.md`
   * says so outright: "'What Facebook is getting' reports intent, not
   * acceptance. It counted 7 of 13 while Meta held zero." A dealer reading
   * "22 of 23" reasonably concluded 22 cars were on Facebook. Nobody could see
   * otherwise without leaving the product.
   */
  metaProductCount: number | null;
}) {
  const { total, included, excluded, marketplaceHeld, reasons } = preview;
  const mismatch = metaProductCount !== null && metaProductCount !== included;

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

        {metaProductCount !== null ? (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              metaProductCount === 0
                ? 'bg-amber-50 text-amber-900'
                : mismatch
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            Rooftop is sending <strong>{included}</strong> · Facebook has accepted{' '}
            <strong>{metaProductCount}</strong>
            {metaProductCount === 0
              ? '. Nothing can run until that second number moves.'
              : mismatch
                ? '. Facebook rejected the difference — contact us and we will read the reason back from them.'
                : '.'}
          </p>
        ) : null}

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
  const color =
    tone === 'red' && n > 0
      ? 'text-red-700'
      : tone === 'amber' && n > 0
        ? 'text-amber-700'
        : 'text-ink-900';
  return (
    <div className="rounded-lg bg-ink-50 px-2 py-2.5">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{n}</div>
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

export function CampaignDemoPanel({ row }: { row: CampaignDemoRow }) {
  const [state, action, busy] = useActionState(createDemoCampaignAction, null);
  const [insights, readAction, reading] = useActionState(readCampaignInsightsAction, null);

  const campaignId = state?.ok ? state.data?.campaignId : undefined;

  return (
    <Card>
      <CardHeader
        title="Build a campaign"
        subtitle="One catalog campaign off the Lot Walk aging buckets, aimed at the cars that have sat longest."
        action={<Badge tone="neutral">Paused on build</Badge>}
      />

      <div className="space-y-4 px-5 py-4">
        <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-600">
          This builds the campaign, ad set and creative in your own ad account and points them at
          your catalog. <strong>Everything lands paused</strong> — nothing runs and nothing spends
          until you turn it on in Ads Manager. Build it again with different numbers and it updates
          what is there rather than making a second one.
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
                defaultValue={DEFAULT_BUCKET}
                className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
              >
                {CAMPAIGN_BUCKETS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-ink-500">
                Start with all of them. The day ranges are the same buckets the Lot Walk uses, for
                when you want to push only the cars that have been sitting.
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-ink-700">Daily budget</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-sm text-ink-500">$</span>
                  <input
                    type="number"
                    name="dailyBudget"
                    defaultValue={25}
                    min={10}
                    max={1000}
                    step={5}
                    className="w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
                  />
                </div>
                <span className="mt-1 block text-[11px] text-ink-500">Per day, on the ad set.</span>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-ink-700">Radius</span>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="number"
                    name="radiusMiles"
                    defaultValue={25}
                    min={5}
                    max={50}
                    step={5}
                    className="w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
                  />
                  <span className="text-sm text-ink-500">mi</span>
                </div>
                <span className="mt-1 block text-[11px] text-ink-500">Around the lot. 5–50.</span>
              </label>
            </div>

            <Button type="submit" disabled={busy}>
              {busy ? 'Building…' : 'Build the campaign'}
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
            <p className="text-[11px] text-emerald-800">
              Open it in Ads Manager to review the targeting and turn it on. Until you do, it is
              paused.
            </p>
            {state.data.adopted.campaign || state.data.adopted.adSet ? (
              <p className="text-[11px] text-emerald-800">
                Updated what was already there rather than duplicating it:{' '}
                {[
                  state.data.adopted.campaign && 'campaign',
                  state.data.adopted.adSet && 'ad set',
                ]
                  .filter(Boolean)
                  .join(', ')}
                . Budget and radius were applied to it.
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
