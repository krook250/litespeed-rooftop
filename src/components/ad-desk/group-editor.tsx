'use client';

/**
 * One group, on its own page.
 *
 * THE THREE THINGS ARE SEPARATE AND STAY SEPARATE. Save writes to our database.
 * Update on Facebook puts what you saved onto the live ads. Start and Stop are
 * the only things that move money. The bar at the bottom of each block names
 * the one it is about to do, because the screen this replaces had all three in
 * one card and no way to tell them apart.
 *
 * ADS ARE TABS. Two or three ads in a group exist so the same shelf can be sold
 * with different words and Facebook can pick the winner. They were previously a
 * stack of open editors, which made three ads look like three groups. One open
 * at a time, with its own numbers and its own on/off, is what Ads Manager does
 * and what the words "Ad 1, Ad 2" already mean to anyone who has seen it.
 */

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Badge, Button, Card, CardHeader } from '../ui';
import { AdFields, AdPreview, BudgetRadiusFields, type AdCopyRow } from './ad-fields';
import { money } from './format';
import { buildGroupAction, setGroupRunningAction } from '@/lib/meta/demo-actions';
import {
  retireAdCopyAction,
  saveAdCopyAction,
  updateGroupAdsAction,
} from '@/lib/meta/ad-copy-actions';
import type { AdCopyFields } from '@/lib/meta/ad-copy-spec';
import type { BucketKey } from '@/lib/meta/buckets';
import type { LotGroup } from '@/lib/meta/campaigns';

const MAX_ADS = 3;

export type Shelf = { key: BucketKey; label: string; count: number | null; taken: boolean };

/* ------------------------------------------------------------------ shell */

function Back() {
  return (
    <Link
      href="/admin/ad-desk/ads"
      className="text-xs text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
    >
      ‹ Ads
    </Link>
  );
}

function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-[11px] font-bold text-white">
        {n}
      </span>
      <span className="text-sm font-semibold text-ink-900">{title}</span>
      {hint ? <span className="text-[11px] text-ink-500">{hint}</span> : null}
    </div>
  );
}

/** The five shelves, and how many cars each is holding right now. */
function ShelfPicker({
  shelves,
  value,
  onChange,
  locked,
}: {
  shelves: Shelf[];
  value: BucketKey;
  onChange?: (k: BucketKey) => void;
  locked: boolean;
}) {
  const current = shelves.find((s) => s.key === value);
  const count = current?.count ?? null;

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div>
        <span className="text-xs font-medium text-ink-700">Days on the lot</span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shelves.map((s) => {
            const on = s.key === value;
            const disabled = locked ? !on : s.taken && !on;
            return (
              <button
                key={s.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange?.(s.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                  on
                    ? 'bg-ink-900 text-white ring-ink-900'
                    : disabled
                      ? 'bg-ink-50 text-ink-400 ring-ink-200'
                      : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50'
                }`}
              >
                {s.label}
                {s.count !== null && !disabled ? (
                  <span className={on ? 'ml-1.5 text-white/70' : 'ml-1.5 text-ink-400'}>
                    {s.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {locked ? null : (
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            Greyed-out shelves already have a group. One group per shelf.
          </p>
        )}
      </div>

      {/*
        The count, and the sentence that answers the question every dealer asks
        about a shelf: what happens when these sell? Nothing — the shelf is a
        rule, not a list of cars, and Facebook re-reads it from the catalog.
      */}
      <div className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
        {count !== null ? (
          <>
            <p className="text-sm font-medium text-ink-900">
              <span className="text-2xl font-bold tabular-nums">{count}</span>{' '}
              {count === 1 ? 'car matches' : 'cars match'} right now
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
              Cars join this shelf when you take them in and drop out the day they sell — the group
              keeps running either way. Only cars that are front-line ready and Marketplace-clean
              are counted.
            </p>
            {count === 0 ? (
              <p className="mt-2 rounded bg-amber-100 px-2 py-1.5 text-[11px] font-medium text-amber-900">
                Nothing on this shelf today. Facebook refuses an empty shelf, so building it will
                fail until a car lands in it.
              </p>
            ) : count < 5 ? (
              <p className="mt-2 rounded bg-amber-100 px-2 py-1.5 text-[11px] font-medium text-amber-900">
                Thin. Facebook does better with more to pick from — a wider shelf usually costs less
                per click.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[11px] text-ink-600">
            Inventory could not be read just now, so the car count is not shown.
          </p>
        )}
      </div>
    </div>
  );
}

/** The tab strip above the ads. */
function Tabs({
  tabs,
  active,
  onPick,
  onAdd,
  canAdd,
}: {
  tabs: { label: string; tone: 'live' | 'idle' | 'draft' }[];
  active: number;
  onPick: (i: number) => void;
  onAdd?: () => void;
  canAdd: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-1 border-b border-ink-200">
      {tabs.map((t, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onPick(i)}
          className={`-mb-px flex items-center gap-2 rounded-t-lg px-4 py-2 text-xs ${
            i === active
              ? 'border border-b-white border-ink-200 bg-white font-semibold text-ink-900'
              : 'text-ink-600 hover:text-ink-900'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              t.tone === 'live' ? 'bg-emerald-500' : t.tone === 'draft' ? 'bg-amber-400' : 'bg-ink-300'
            }`}
          />
          {t.label}
        </button>
      ))}
      {canAdd && onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="-mb-px rounded-t-lg px-3 py-2 text-xs text-ink-600 hover:text-ink-900"
        >
          + Add an ad
        </button>
      ) : null}
    </div>
  );
}

function Note({ tone, children }: { tone: 'ok' | 'bad'; children: React.ReactNode }) {
  return (
    <p
      className={`rounded-lg px-3 py-2 text-xs ${
        tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
      }`}
    >
      {children}
    </p>
  );
}

/* --------------------------------------------------------------- new group */

export function NewGroupEditor({
  rooftopId,
  rooftopName,
  city,
  shelves,
  initialBucket,
  saved,
  fallback,
  blocker,
}: {
  rooftopId: string;
  rooftopName: string;
  city: string | null;
  shelves: Shelf[];
  initialBucket: BucketKey;
  /** Ads already saved per shelf, so a half-finished group reopens where it was. */
  saved: AdCopyRow[];
  fallback: AdCopyFields;
  blocker: string | null;
}) {
  const [state, action, busy] = useActionState(buildGroupAction, null);
  const [bucket, setBucket] = useState<BucketKey>(initialBucket);

  const seedFor = (b: BucketKey) => {
    const rows = saved.filter((c) => c.bucket === b && c.active).slice(0, MAX_ADS);
    return rows.length ? rows.map((c) => ({ copyId: c.id, fields: c as AdCopyFields })) : [
      { copyId: '', fields: fallback },
    ];
  };
  const seed = seedFor(bucket);
  const [adCount, setAdCount] = useState(seed.length);
  const [active, setActive] = useState(0);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="space-y-2">
        <Back />
        <h1 className="text-lg font-semibold text-ink-900">New group</h1>
        <p className="text-sm text-ink-600">{rooftopName}</p>
      </div>

      {blocker ? <Note tone="bad">{blocker}</Note> : null}

      <form action={action} className="space-y-4">
        <input type="hidden" name="rooftopId" value={rooftopId} />
        <input type="hidden" name="bucket" value={bucket} />
        <input type="hidden" name="adCount" value={adCount} />

        <Card>
          <div className="space-y-4 px-5 py-4">
            <Step n={1} title="Which cars" hint="A shelf, not a list — it keeps itself up to date." />
            <ShelfPicker
              shelves={shelves}
              value={bucket}
              locked={false}
              onChange={(k) => {
                setBucket(k);
                setAdCount(seedFor(k).length);
                setActive(0);
              }}
            />
          </div>
        </Card>

        <Card>
          <div className="space-y-4 px-5 py-4">
            <Step n={2} title="Budget and reach" />
            <BudgetRadiusFields budget={25} radius={25} city={city} />
          </div>
        </Card>

        <Card>
          <div className="space-y-4 px-5 py-4">
            <Step
              n={3}
              title="What the ads say"
              hint="Facebook runs them against each other and shows the one people respond to. Two or three is plenty."
            />

            {/* Keyed by shelf so switching shelves reloads that shelf's saved ads. */}
            <div key={bucket} className="space-y-3">
              <Tabs
                tabs={Array.from({ length: adCount }, (_, i) => ({
                  label: `Ad ${i + 1}`,
                  tone: 'draft' as const,
                }))}
                active={active}
                onPick={setActive}
                canAdd={adCount < MAX_ADS}
                onAdd={() => {
                  setAdCount((c) => c + 1);
                  setActive(adCount);
                }}
              />

              {/*
                Every ad stays mounted and hidden rather than unmounting. They
                are all fields of this one form — unmounting an ad would drop it
                from the submission, which is the quiet way to build a group
                missing the ad somebody just wrote.
              */}
              {Array.from({ length: adCount }, (_, i) => {
                const s = seed[i] ?? { copyId: '', fields: { ...fallback, name: '' } };
                return (
                  <div key={i} className={i === active ? '' : 'hidden'}>
                    <input type="hidden" name={`ad${i}.copyId`} value={s.copyId} />
                    <AdFields prefix={`ad${i}`} initial={s.fields} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 px-5 py-3.5">
            <p className="text-xs text-ink-500">
              Nothing spends until you start it. Everything here can be changed later.
            </p>
            <div className="ml-auto">
              <Button type="submit" disabled={busy || Boolean(blocker)}>
                {busy ? 'Building…' : 'Build the group'}
              </Button>
            </div>
          </div>
        </Card>
      </form>

      {state && !state.ok ? <Note tone="bad">{state.error}</Note> : null}
      {state?.ok && state.data ? (
        <div className="space-y-1.5 rounded-lg bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          <p className="font-medium">{state.message}</p>
          {state.data.adCannotRun ? (
            <p className="rounded bg-amber-100 px-2 py-1.5 text-[11px] font-medium text-amber-900">
              {state.data.adCannotRun}
            </p>
          ) : (
            <Link
              href={`/admin/ad-desk/ads/${rooftopId}/${bucket}`}
              className="font-medium underline underline-offset-2"
            >
              Open the group ›
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ built group */

export function GroupEditor({
  rooftopId,
  rooftopName,
  city,
  bucket,
  shelves,
  group,
  rows,
  fallback,
}: {
  rooftopId: string;
  rooftopName: string;
  city: string | null;
  bucket: BucketKey;
  shelves: Shelf[];
  group: LotGroup;
  rows: AdCopyRow[];
  fallback: AdCopyFields;
}) {
  const [runState, runAction, switching] = useActionState(setGroupRunningAction, null);
  const [budgetState, budgetAction, saving] = useActionState(buildGroupAction, null);
  const [pushState, pushAction, pushing] = useActionState(updateGroupAdsAction, null);
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState(0);

  const running = group.effectiveStatus === 'ACTIVE';
  const live = rows.filter((r) => r.active);
  const retired = rows.filter((r) => !r.active);

  /*
   * Ads at Facebook with no saved row: built from the default before anybody
   * wrote copy (the ops screen does this). Given an editor pre-filled from the
   * same default, so saving creates the row and the next push adopts the ad by
   * name.
   */
  const unsaved = group.ads.filter((a) => !rows.some((r) => r.name === a.name));

  const panes = [
    ...live.map((r) => ({ row: r, copyId: r.id })),
    ...unsaved.map((a) => ({
      row: { ...fallback, name: a.name, id: '', bucket, active: true } as AdCopyRow,
      copyId: '',
    })),
    ...Array.from({ length: extra }, () => ({
      row: { ...fallback, name: '', id: '', bucket, active: true } as AdCopyRow,
      copyId: '',
    })),
  ];

  const toneFor = (name: string, copyId: string): 'live' | 'idle' | 'draft' => {
    if (!copyId) return 'draft';
    const at = group.ads.find((a) => a.name === name);
    if (!at) return 'draft';
    return at.effectiveStatus === 'ACTIVE' ? 'live' : 'idle';
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="space-y-2">
        <Back />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-lg font-semibold text-ink-900">{group.name}</h1>
          {running ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
          <form action={runAction} className="ml-auto">
            <input type="hidden" name="rooftopId" value={rooftopId} />
            <input type="hidden" name="adSetId" value={group.id} />
            <input type="hidden" name="running" value={running ? 'false' : 'true'} />
            <Button
              type="submit"
              variant={running ? 'secondary' : 'primary'}
              size="sm"
              disabled={switching || group.ads.length === 0}
            >
              {switching ? '…' : running ? 'Stop this group' : 'Start this group'}
            </Button>
          </form>
        </div>
        <p className="text-sm text-ink-600">{rooftopName}</p>
      </div>

      {runState && !runState.ok ? <Note tone="bad">{runState.error}</Note> : null}
      {runState?.ok && runState.message ? <Note tone="ok">{runState.message}</Note> : null}

      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-xl border border-ink-200 bg-white px-4 py-3 shadow-sm">
        <Figure value={money(group.spend)} label="spent" />
        <Figure value={group.clicks.toLocaleString()} label="clicks" />
        <Figure
          value={group.clicks ? money(group.spend / group.clicks) : '—'}
          label="a click"
        />
        <Figure value={group.impressions.toLocaleString()} label="times shown" />
      </div>

      {/* ------------------------------------------------------- 1 · shelf */}
      <Card>
        <div className="space-y-4 px-5 py-4">
          <Step n={1} title="Which cars" hint="A shelf, not a list — it keeps itself up to date." />
          <ShelfPicker shelves={shelves} value={bucket} locked />
        </div>
      </Card>

      {/* ------------------------------------------------------ 2 · budget */}
      <Card>
        <form action={budgetAction}>
          <input type="hidden" name="rooftopId" value={rooftopId} />
          <input type="hidden" name="bucket" value={bucket} />
          <div className="space-y-4 px-5 py-4">
            <Step n={2} title="Budget and reach" />
            <BudgetRadiusFields
              budget={group.dailyBudgetUsd ?? 25}
              radius={group.radiusMiles ?? 25}
              city={city}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-200 px-5 py-3.5">
            <div className="ml-auto">
              <Button type="submit" size="sm" variant="secondary" disabled={saving}>
                {saving ? 'Updating…' : 'Update budget and radius'}
              </Button>
            </div>
          </div>
          {budgetState && !budgetState.ok ? (
            <p className="border-t border-ink-200 bg-red-50 px-5 py-2.5 text-xs text-red-700">
              {budgetState.error}
            </p>
          ) : null}
          {budgetState?.ok ? (
            <p className="border-t border-ink-200 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-800">
              {budgetState.message}
            </p>
          ) : null}
        </form>
      </Card>

      {/* --------------------------------------------------------- 3 · ads */}
      <Card>
        <CardHeader
          title="What the ads say"
          subtitle="Facebook runs them against each other and shows the one people respond to. Two or three is plenty."
        />
        <div className="space-y-3 px-5 py-4">
          <Tabs
            tabs={panes.map((p, i) => ({
              label: p.row.name ? `Ad ${i + 1} · ${p.row.name}` : `Ad ${i + 1}`,
              tone: toneFor(p.row.name, p.copyId),
            }))}
            active={active}
            onPick={setActive}
            canAdd={panes.length < MAX_ADS}
            onAdd={() => {
              setExtra((e) => e + 1);
              setActive(panes.length);
            }}
          />

          {panes.map((p, i) => (
            <div key={`${p.copyId}-${i}`} className={i === active ? '' : 'hidden'}>
              <AdPane
                rooftopId={rooftopId}
                bucket={bucket}
                row={p.row}
                copyId={p.copyId}
                metaAd={group.ads.find((a) => a.name === p.row.name) ?? null}
                canRetire={live.length > 1 && Boolean(p.copyId)}
              />
            </div>
          ))}

          {retired.length ? (
            <details>
              <summary className="cursor-pointer text-[11px] text-ink-500">
                {retired.length} turned off
              </summary>
              <ul className="mt-1.5 space-y-1">
                {retired.map((r) => (
                  <li key={r.id} className="rounded bg-ink-50 px-2.5 py-1.5 text-[11px] text-ink-600">
                    <span className="font-medium">{r.name}</span> — {r.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {/*
          THE PUSH. Save writes to our database and nothing else; this is what
          puts the words on Facebook. Its own press because it talks to Facebook
          and takes a few seconds, and because editing text should never be the
          thing that silently rewrites a live ad.
        */}
        <form action={pushAction} className="flex flex-wrap items-center gap-3 border-t border-ink-200 px-5 py-3.5">
          <input type="hidden" name="rooftopId" value={rooftopId} />
          <input type="hidden" name="bucket" value={bucket} />
          <p className="text-xs text-ink-500">
            Saved ads live here until you push them. This does not start or stop anything.
          </p>
          <div className="ml-auto">
            <Button type="submit" size="sm" disabled={pushing}>
              {pushing ? 'Updating on Facebook…' : 'Update on Facebook'}
            </Button>
          </div>
        </form>
        {pushState && !pushState.ok ? (
          <p className="border-t border-ink-200 bg-red-50 px-5 py-2.5 text-xs text-red-700">
            {pushState.error}
          </p>
        ) : null}
        {pushState?.ok ? (
          <p className="border-t border-ink-200 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-800">
            {pushState.message}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

/** One ad: its fields, its own Save, and what it looks like on Facebook. */
function AdPane({
  rooftopId,
  bucket,
  row,
  copyId,
  metaAd,
  canRetire,
}: {
  rooftopId: string;
  bucket: BucketKey;
  row: AdCopyRow;
  copyId: string;
  metaAd: LotGroup['ads'][number] | null;
  canRetire: boolean;
}) {
  const [state, action, busy] = useActionState(saveAdCopyAction, null);
  const [retireState, retireAction, retiring] = useActionState(retireAdCopyAction, null);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <form action={action} className="space-y-3">
        <input type="hidden" name="rooftopId" value={rooftopId} />
        <input type="hidden" name="bucket" value={bucket} />
        <input type="hidden" name="copyId" value={copyId} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {!copyId ? (
            <span className="text-amber-700">Not saved yet.</span>
          ) : !metaAd ? (
            <span className="text-amber-700">Saved, but not on Facebook yet — press Update.</span>
          ) : metaAd.effectiveStatus === 'ACTIVE' ? (
            <span className="font-medium text-emerald-700">Running</span>
          ) : (
            <span className="text-ink-500">On Facebook, not running</span>
          )}
        </div>

        <AdFields prefix="" initial={row} />

        {state && !state.ok ? <Note tone="bad">{state.error}</Note> : null}
        {state?.ok ? <Note tone="ok">{state.message}</Note> : null}
        {retireState && !retireState.ok ? <Note tone="bad">{retireState.error}</Note> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="secondary" disabled={busy}>
            {busy ? 'Saving…' : 'Save this ad'}
          </Button>
          {canRetire ? (
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              formAction={retireAction}
              disabled={retiring}
            >
              {retiring ? '…' : 'Turn this ad off'}
            </Button>
          ) : null}
        </div>
      </form>

      <div>
        {metaAd?.creativeId ? (
          <AdPreview rooftopId={rooftopId} creativeId={metaAd.creativeId} />
        ) : (
          <div className="rounded-lg border border-dashed border-ink-300 px-4 py-6 text-center">
            <p className="text-xs font-medium text-ink-700">No preview yet</p>
            <p className="mx-auto mt-1 max-w-xs text-[11px] text-ink-500">
              Facebook renders the preview from the live ad, so it appears once this one has been
              pushed.
            </p>
          </div>
        )}
      </div>
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
