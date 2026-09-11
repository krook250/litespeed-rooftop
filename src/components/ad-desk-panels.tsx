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
 *
 * TWO BUTTONS, ONE FORM. "Save this lot" records the dealer's Page and ad
 * account choice and stops there; "Set up catalog ads" does that *and* creates
 * the catalog and the feed. They were one button until 5 Aug 2026, which meant
 * changing a lot's Page re-ran catalog provisioning against the dealer's
 * business as a side effect. See `saveRooftopAssets` in `lib/meta/actions.ts`.
 */

import { useActionState, useState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import {
  provisionRooftopAction,
  saveRooftopAssetsForm,
  startCatalogProvision,
} from '@/lib/meta/actions';

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
  /**
   * How many vehicles FACEBOOK is holding in this catalog, as opposed to how
   * many we are sending. Null means we could not ask — discovery failed, or the
   * catalog id we have stored is not in what came back.
   *
   * Free: `discoverAssets()` already requests `product_count` on every Ad Desk
   * render and the page used to throw it away.
   */
  metaProductCount: number | null;
  /** Whether the stored catalog id appeared in discovery at all. False = Rooftop cannot see it. */
  metaSawCatalog: boolean;
  /** False when the discovery call itself failed, so "we don't know" can be said as that. */
  discoveryOk: boolean;
};

function Select({
  name,
  label,
  hint,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  name: string;
  label: string;
  hint?: string;
  options: AssetOption[];
  value: string;
  onChange: (v: string) => void;
  emptyLabel: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-700">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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

  /*
   * The selects are controlled so the hidden name fields can follow them.
   * They used to be uncontrolled, with the names posted from `row` — i.e. from
   * whatever was already stored, which on a first save was nothing. Every lot's
   * first provision therefore wrote `pageName: null`, and the stored row could
   * not be rendered by name without a second Meta call. Do not revert these to
   * `defaultValue`.
   */
  const [pageId, setPageId] = useState(row.pageId ?? '');
  const [adAccountId, setAdAccountId] = useState(row.adAccountId ?? '');
  const [pixelId, setPixelId] = useState(row.pixelId ?? '');

  const pageName = pages.find((p) => p.id === pageId)?.label ?? '';
  const adAccountName = adAccounts.find((a) => a.id === adAccountId)?.label ?? '';

  /*
   * THE BADGE NAMES THE READ THAT JUSTIFIES IT.
   *
   * It used to be `Boolean(row.catalogId) && row.feedOk` — both database flags,
   * meaning "we stored a catalog id and registered a feed". It said **Catalog
   * live** in green over a catalog Facebook was holding zero vehicles in, next
   * to a panel claiming 22 units were going out, next to an amber banner saying
   * Facebook had nothing. Three true statements, one green badge, and no way
   * for anyone to tell what was actually wrong.
   *
   * Now green requires Facebook to have confirmed a count. Everything else is
   * degrees of not-knowing, and each one says which.
   */
  const status = !row.catalogId
    ? ({ tone: 'neutral', label: 'Not set up' } as const)
    : !row.discoveryOk
      ? ({ tone: 'neutral', label: 'Last known — Facebook not reachable' } as const)
      : !row.metaSawCatalog
        ? ({ tone: 'red', label: 'Catalog not visible to Rooftop' } as const)
        : !row.feedOk
          ? ({ tone: 'amber', label: 'Feed not set' } as const)
          : row.metaProductCount === 0
            ? ({ tone: 'amber', label: 'Facebook holds 0 vehicles' } as const)
            : row.metaProductCount === null
              ? ({ tone: 'neutral', label: 'Catalog registered' } as const)
              : ({
                  tone: 'green',
                  label: `Catalog live · ${row.metaProductCount} at Facebook`,
                } as const);

  return (
    <Card>
      <CardHeader
        title={row.name}
        subtitle={`${row.city}, ${row.state}`}
        action={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      <form action={action} className="space-y-4 px-5 py-4">
        <input type="hidden" name="rooftopId" value={row.rooftopId} />
        {/* Names ride along so the stored row is readable without a second Meta
            call every time we render a status screen. */}
        <input type="hidden" name="pageName" value={pageName} />
        <input type="hidden" name="adAccountName" value={adAccountName} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            name="pageId"
            label="Facebook Page"
            value={pageId}
            onChange={setPageId}
            options={pages}
            emptyLabel="No Pages found on this business"
            hint="The Page the ads run from."
          />
          <Select
            name="adAccountId"
            label="Ad account"
            value={adAccountId}
            onChange={setAdAccountId}
            options={adAccounts}
            emptyLabel="No ad account found"
            hint="Where the spend is billed. Stays in the dealer's name."
          />
          <Select
            name="pixelId"
            label="Pixel"
            value={pixelId}
            onChange={setPixelId}
            options={pixels}
            emptyLabel="No pixel found"
            hint="Optional, but retargeting needs it to match shoppers to vehicles."
          />

          <div className="rounded-lg bg-ink-50 px-3 py-2.5">
            <div className="text-xs font-medium text-ink-700">Vehicle catalog</div>
            {/*
              ONE FACT, NOT THREE.
              This box used to state the catalog's provenance ("Created by
              Rooftop" / "Already in your business"), its name, and its feed
              status — then the badge said the same thing again, and the save
              confirmation said it a third time. None of it is a decision the
              dealer makes or a word they use. The number of their cars that
              reached Facebook is the only line here they can act on.
            */}
            {row.catalogId ? (
              !row.discoveryOk ? (
                <p className="mt-1 text-[11px] text-ink-600">
                  Set up. We couldn&apos;t reach Facebook just now for a current count.
                </p>
              ) : !row.metaSawCatalog ? (
                <p className="mt-1 text-[11px] font-medium text-red-700">
                  Rooftop can&apos;t read this catalog on Facebook. Contact us — nothing will run
                  until that&apos;s sorted.
                </p>
              ) : row.metaProductCount === 0 ? (
                <p className="mt-1 text-[11px] font-medium text-amber-800">
                  None of your vehicles have reached Facebook yet. Ads can&apos;t run until they do.
                </p>
              ) : row.metaProductCount !== null ? (
                <p className="mt-1 text-[11px] text-ink-600">
                  <strong>{row.metaProductCount}</strong> of your vehicles are on Facebook.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-600">Set up.</p>
              )
            ) : (
              <p className="mt-1 text-[11px] text-ink-600">
                You don&apos;t need one. If this lot has a vehicle catalog we&apos;ll use it, and if it
                doesn&apos;t we&apos;ll make one and keep it fed from your inventory.
              </p>
            )}
          </div>
        </div>

        {/*
          The "Saved · this lot advertises from X, billed to Y" echo is gone. It
          was written as App Review evidence — shot 20 of the screencast needed
          the stored values read back on screen — and review is long done. The
          two dropdowns three lines above it already show exactly those values,
          so on the dealer's screen it was the same sentence twice.
        */}

        {row.errorMessage ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{row.errorMessage}</p>
        ) : null}
        {state && !state.ok ? (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <p>{state.error}</p>
            {/*
              The one refusal that has a button rather than a shrug. Meta will
              not let a system user create a catalog in a business it does not
              administer, so we ask an admin to sign in once. The token that
              comes back is used for that single call and dropped.
            */}
            {state.needsAdminGrant ? (
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="mt-2"
                formAction={startCatalogProvision}
                disabled={busy}
              >
                Sign in as a Facebook admin to finish
              </Button>
            ) : null}
          </div>
        ) : null}
        {state && state.ok && state.message ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" formAction={saveRooftopAssetsForm} disabled={busy}>
            Save this lot
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Setting up…' : row.catalogId ? 'Update this lot' : 'Set up catalog ads'}
          </Button>
        </div>
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
