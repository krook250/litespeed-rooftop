'use client';

/**
 * The operator's view of a dealer's ad setup.
 *
 * NOT a copy of `ad-desk-demo.tsx` with different labels. The dealer's panel
 * answers "get my cars into Facebook ads"; this one answers "which of my
 * dealers needs me today, and can I fix it from here". So it leads with what is
 * broken, names the dealer on every row, and shows live campaign state — which
 * the dealer's own screen does not, because a dealer with one lot already knows.
 *
 * The chrome stays dark and amber for the reason `src/app/ops/layout.tsx` gives:
 * every number here is somebody else's business, and the surest way to edit the
 * wrong dealer is to build a screen that looks like your own.
 */

import { useActionState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import { opsBuildCampaignAction } from '@/lib/ops/ad-desk-actions';
import type { OpsAdDeskLot } from '@/lib/ops/ad-desk-queries';
import type { LotCampaign } from '@/lib/meta/campaigns';
import { CAMPAIGN_BUCKETS, DEFAULT_BUCKET } from '@/lib/meta/buckets';

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/* ------------------------------------------------------------- roll-up row */

export function OpsLotRow({ lot }: { lot: OpsAdDeskLot }) {
  const error = lot.connectionError ?? lot.assetError;

  return (
    <details className="group rounded-lg border border-ink-200 bg-white">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <span className="text-sm font-medium text-ink-900">{lot.groupName}</span>
        <span className="text-sm text-ink-600">{lot.rooftopName}</span>
        {lot.city ? (
          <span className="text-xs text-ink-500">
            {lot.city}
            {lot.state ? `, ${lot.state}` : ''}
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-2">
          {error ? (
            <Badge tone="red">Error</Badge>
          ) : !lot.connectionStatus ? (
            <Badge tone="slate">Not connected</Badge>
          ) : lot.blocker ? (
            <Badge tone="amber">Setup unfinished</Badge>
          ) : (
            <Badge tone="green">Ready</Badge>
          )}
          {lot.feed ? (
            <span className="text-xs tabular-nums text-ink-500">
              {lot.feed.included} of {lot.feed.total}
            </span>
          ) : null}
        </span>
      </summary>

      <div className="space-y-3 border-t border-ink-200 px-4 py-3">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
        {!error && lot.blocker ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{lot.blocker}</p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <Kv k="Business" v={lot.connectionBusinessName} />
          <Kv k="Page" v={lot.pageName} />
          <Kv k="Ad account" v={lot.adAccountName ?? lot.adAccountId} />
          <Kv k="Catalog" v={lot.catalogName} />
          <Kv k="Feed" v={lot.feedOk ? 'connected' : 'not connected'} />
          <Kv k="Pixel" v={lot.pixelId ?? 'none'} />
          <Kv k="Coordinates" v={lot.hasCoordinates ? 'set' : 'missing'} />
        </dl>

        {lot.feed && lot.feed.reasons.length ? (
          <ul className="space-y-1">
            {lot.feed.reasons.map((r) => (
              <li
                key={r.code}
                className={`rounded px-2.5 py-1.5 text-[11px] ${
                  r.scope === 'FEED' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
                }`}
              >
                <span className="font-medium">{r.reason}</span>{' '}
                <span className="opacity-70">
                  — {r.count} {r.count === 1 ? 'unit' : 'units'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <a
          href={`/ops/accounts/${lot.groupId}`}
          className="inline-block text-xs font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900"
        >
          Open this account
        </a>
      </div>
    </details>
  );
}

function Kv({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-ink-500">{k}</dt>
      <dd className="truncate text-ink-900">{v || <span className="text-ink-400">—</span>}</dd>
    </div>
  );
}

/* --------------------------------------------------- per-lot, with control */

export type OpsLotPanelProps = {
  lot: OpsAdDeskLot;
  campaigns: LotCampaign[];
  campaignsError: string | null;
};

export function OpsLotPanel({ lot, campaigns, campaignsError }: OpsLotPanelProps) {
  const [state, action, busy] = useActionState(opsBuildCampaignAction, null);
  const error = lot.connectionError ?? lot.assetError;

  return (
    <Card>
      <CardHeader
        title={lot.rooftopName}
        subtitle={
          lot.adAccountName
            ? `Billed to ${lot.adAccountName}`
            : 'No ad account picked for this lot yet.'
        }
        action={
          error ? (
            <Badge tone="red">Error</Badge>
          ) : lot.blocker ? (
            <Badge tone="amber">Setup unfinished</Badge>
          ) : (
            <Badge tone="green">Ready</Badge>
          )
        }
      />

      <div className="space-y-4 px-5 py-4">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}

        {/* ------------------------------------------------ live campaigns */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-700">At Facebook right now</p>
          {campaignsError ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Could not read campaigns: {campaignsError}
            </p>
          ) : campaigns.length === 0 ? (
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
              No Rooftop-built campaigns on this ad account. Anything this dealer runs by hand
              under a different name will not appear here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {campaigns.map((c) => (
                <li key={c.id} className="rounded-lg bg-ink-50 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-medium text-ink-900">{c.name}</span>
                    <Badge tone={c.effectiveStatus === 'ACTIVE' ? 'green' : 'slate'}>
                      {c.effectiveStatus}
                    </Badge>
                    {c.dailyBudgetUsd !== null ? (
                      <span className="text-[11px] text-ink-600">
                        {money(c.dailyBudgetUsd)}/day
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-ink-600">
                    <span>{money(c.spend)} spent</span>
                    <span>{c.impressions.toLocaleString()} impressions</span>
                    <span>{c.clicks.toLocaleString()} clicks</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ----------------------------------------------------- the build */}
        <div className="space-y-3 border-t border-ink-200 pt-3">
          <p className="text-xs font-medium text-ink-700">Build or update</p>

          {lot.blocker ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{lot.blocker}</p>
          ) : (
            <form action={action} className="space-y-3">
              <input type="hidden" name="groupId" value={lot.groupId} />
              <input type="hidden" name="rooftopId" value={lot.rooftopId} />

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-medium text-ink-700">Shelf</span>
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
                </label>

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
                </label>
              </div>

              <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] text-ink-600">
                Builds in <strong>{lot.groupName}</strong>&rsquo;s own ad account and lands paused.
                Building again updates the existing campaign rather than making a second one.
                Turning it on is done in Ads Manager, not here.
              </p>

              <Button type="submit" disabled={busy}>
                {busy ? 'Building…' : `Build for ${lot.rooftopName}`}
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
                <Row k="campaign" v={state.data.campaignId} />
                <Row k="vehicle set" v={state.data.productSet.id} />
                <Row k="ad set" v={state.data.adSetId} />
                <Row k="creative" v={state.data.creativeId} />
                <Row k="status" v={state.data.status} />
              </dl>
              <p className="text-[11px]">Reload to see it in the list above.</p>
            </div>
          ) : null}
        </div>
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
