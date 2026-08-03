'use client';

/**
 * Ad Desk — the per-lot connect panel.
 *
 * The dealer-facing job of this component is to make a catalog a non-event.
 * They pick the Facebook Page for the lot and the ad account that pays, hit a
 * button, and the catalog, the feed and the pixel wiring happen behind it. The
 * word "catalog" appears exactly once, in the past tense, after it already
 * exists — see `claude/meta-ad-desk-build.md` §2 for why that is the design and
 * not a simplification.
 */

import { useActionState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import { provisionRooftopAction } from '@/lib/meta/actions';

export type AssetOption = { id: string; label: string; sub?: string };

export type RooftopRow = {
  rooftopId: string;
  name: string;
  city: string;
  state: string;
  pageId: string | null;
  pageName: string | null;
  adAccountId: string | null;
  adAccountName: string | null;
  catalogId: string | null;
  catalogName: string | null;
  catalogSource: 'ADOPTED' | 'CREATED' | null;
  feedOk: boolean;
  pixelId: string | null;
  errorMessage: string | null;
};

function Select({
  name,
  label,
  hint,
  options,
  defaultValue,
  emptyLabel,
}: {
  name: string;
  label: string;
  hint?: string;
  options: AssetOption[];
  defaultValue?: string | null;
  emptyLabel: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-700">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        disabled={options.length === 0}
        className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900 disabled:bg-ink-50 disabled:text-ink-400"
      >
        <option value="">{options.length === 0 ? emptyLabel : '— none —'}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.sub ? ` · ${o.sub}` : ''}
          </option>
        ))}
      </select>
      {hint ? <span className="mt-1 block text-[11px] text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function RooftopPanel({
  row,
  pages,
  adAccounts,
  pixels,
}: {
  row: RooftopRow;
  pages: AssetOption[];
  adAccounts: AssetOption[];
  pixels: AssetOption[];
}) {
  const [state, action, busy] = useActionState(provisionRooftopAction, null);

  const live = Boolean(row.catalogId) && row.feedOk;

  return (
    <Card>
      <CardHeader
        title={row.name}
        subtitle={`${row.city}, ${row.state}`}
        action={
          live ? (
            <Badge tone="green">Catalog live</Badge>
          ) : row.catalogId ? (
            <Badge tone="amber">Feed not set</Badge>
          ) : (
            <Badge tone="neutral">Not set up</Badge>
          )
        }
      />

      <form action={action} className="space-y-4 px-5 py-4">
        <input type="hidden" name="rooftopId" value={row.rooftopId} />
        {/* Names ride along so the stored row is readable without a second Meta
            call every time we render a status screen. */}
        <input type="hidden" name="pageName" value={row.pageName ?? ''} />
        <input type="hidden" name="adAccountName" value={row.adAccountName ?? ''} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            name="pageId"
            label="Facebook Page"
            defaultValue={row.pageId}
            options={pages}
            emptyLabel="No Pages found on this business"
            hint="The Page the ads run from."
          />
          <Select
            name="adAccountId"
            label="Ad account"
            defaultValue={row.adAccountId}
            options={adAccounts}
            emptyLabel="No ad account found"
            hint="Where the spend is billed. Stays in the dealer's name."
          />
          <Select
            name="pixelId"
            label="Pixel"
            defaultValue={row.pixelId}
            options={pixels}
            emptyLabel="No pixel found"
            hint="Optional, but retargeting needs it to match shoppers to vehicles."
          />

          <div className="rounded-lg bg-ink-50 px-3 py-2.5">
            <div className="text-xs font-medium text-ink-700">Vehicle catalog</div>
            {row.catalogId ? (
              <p className="mt-1 text-[11px] text-ink-600">
                {row.catalogSource === 'CREATED' ? 'Created by Rooftop' : 'Already in your business'} ·{' '}
                {row.catalogName}
                {row.feedOk ? ' · inventory feed connected' : ' · feed not connected yet'}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-ink-600">
                You don&apos;t need one. If this lot has a vehicle catalog we&apos;ll use it, and if it
                doesn&apos;t we&apos;ll make one and keep it fed from your inventory.
              </p>
            )}
          </div>
        </div>

        {row.errorMessage ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{row.errorMessage}</p>
        ) : null}
        {state && !state.ok ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
        ) : null}
        {state && state.ok && state.message ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
        ) : null}

        <Button type="submit" disabled={busy}>
          {busy ? 'Setting up…' : row.catalogId ? 'Update this lot' : 'Set up catalog ads'}
        </Button>
      </form>
    </Card>
  );
}

export function DisconnectButton({ action }: { action: () => Promise<unknown> }) {
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <Button variant="secondary" size="sm" type="submit">
        Disconnect
      </Button>
    </form>
  );
}
