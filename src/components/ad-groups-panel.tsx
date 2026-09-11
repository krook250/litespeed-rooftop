'use client';

/**
 * A dealer's ad groups — the one panel where campaigns get built, run, and
 * given words.
 *
 * THE WORDS. What a dealer builds is a *group*: one shelf of cars, a daily
 * budget, a radius, and one to three ads. At Meta that is an ad set under the
 * lot's single campaign. "Campaign" and "ad set" never appear on this screen;
 * the campaign exists because Meta needs a parent and the dealer never needs to
 * know it is there.
 *
 * COPY IS PER AD, THE WAY ADS MANAGER DOES IT. Each ad has its own editor and
 * its own Save. There is no lot-wide text and no group-wide text: two groups on
 * the same lot say whatever their own ads say.
 *
 * THE ADS ARE WRITTEN BEFORE THE BUILD. The first version of this screen kept
 * the copy editor in a separate panel above the build button, nothing connected
 * them, and the first campaign went out saying words the dealer had never seen.
 * So the new-group form carries its ads, with a line saying they can be changed
 * later — which they can, from the group's own card.
 *
 * SAVE IS LOCAL; UPDATE ON FACEBOOK IS THE PUSH. Two presses on purpose: the
 * push talks to Facebook and takes a few seconds, and editing text should never
 * be the thing that silently rewrites a live ad. Neither starts or stops
 * anything — that is the switch on the group's row, and only that.
 */

import { useActionState, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import { buildGroupAction, setGroupRunningAction } from '@/lib/meta/demo-actions';
import {
  retireAdCopyAction,
  saveAdCopyAction,
  updateGroupAdsAction,
} from '@/lib/meta/ad-copy-actions';
import {
  AD_EMOJI,
  CALL_TO_ACTIONS,
  COPY_LIMITS,
  VEHICLE_TOKENS,
  adFieldName,
  type AdCopyFields,
} from '@/lib/meta/ad-copy-spec';
import { CAMPAIGN_BUCKETS, DEFAULT_BUCKET, bucketByKey, type BucketKey } from '@/lib/meta/buckets';
import type { LotGroup } from '@/lib/meta/campaigns';
import { PREVIEW_FORMATS } from '@/lib/meta/buckets-preview';

export type AdCopyRow = AdCopyFields & {
  id: string;
  bucket: string;
  active: boolean;
};

const MAX_ADS = 3;

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const inputCls =
  'mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900';

/* ------------------------------------------------------------------ panel */

export function AdGroupsPanel({
  rooftopId,
  ready,
  blocker,
  groups,
  groupsUnavailable,
  copy,
  fallback,
}: {
  rooftopId: string;
  /** Whether a build can be attempted at all. */
  ready: boolean;
  blocker: string | null;
  /** What Facebook holds, one per shelf that has been built. */
  groups: LotGroup[];
  /** True when Facebook could not be read — the list is unknown, not empty. */
  groupsUnavailable: boolean;
  /** Every saved ad on the lot, every group, turned-off rows included. */
  copy: AdCopyRow[];
  /** What an ad says when nobody has written one. Pre-fills new editors. */
  fallback: AdCopyFields;
}) {
  const builtKeys = new Set(groups.map((g) => g.bucketKey).filter(Boolean));
  const unbuilt = CAMPAIGN_BUCKETS.filter((b) => !builtKeys.has(b.key));
  const ordered = [...groups].sort(
    (a, b) =>
      CAMPAIGN_BUCKETS.findIndex((x) => x.key === a.bucketKey) -
      CAMPAIGN_BUCKETS.findIndex((x) => x.key === b.bucketKey),
  );
  const anyRunning = groups.some((g) => g.effectiveStatus === 'ACTIVE');

  return (
    <Card>
      <CardHeader
        title="Your ad groups"
        subtitle="A group is one shelf of cars with its own budget, radius and ads."
        action={
          groups.length === 0 ? null : anyRunning ? (
            <Badge tone="green">Running</Badge>
          ) : (
            <Badge tone="neutral">All stopped</Badge>
          )
        }
      />

      <div className="space-y-4 px-5 py-4">
        {groupsUnavailable ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Facebook could not be reached just now, so what is running is not shown. Reload in a
            minute.
          </p>
        ) : null}

        {ordered.map((g) => (
          <GroupCard
            key={g.id}
            rooftopId={rooftopId}
            group={g}
            rows={copy.filter((c) => c.bucket === g.bucketKey)}
            fallback={fallback}
          />
        ))}

        {!ready ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{blocker}</p>
        ) : unbuilt.length ? (
          <NewGroupForm
            rooftopId={rooftopId}
            shelves={unbuilt.map((b) => b.key)}
            copy={copy}
            fallback={fallback}
            first={groups.length === 0}
          />
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- one group */

function GroupCard({
  rooftopId,
  group,
  rows,
  fallback,
}: {
  rooftopId: string;
  group: LotGroup;
  rows: AdCopyRow[];
  fallback: AdCopyFields;
}) {
  const [runState, runAction, switching] = useActionState(setGroupRunningAction, null);
  const [pushState, pushAction, pushing] = useActionState(updateGroupAdsAction, null);
  const [budgetState, budgetAction, saving] = useActionState(buildGroupAction, null);
  const [adding, setAdding] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);

  const running = group.effectiveStatus === 'ACTIVE';
  const bucket = group.bucketKey;
  const live = rows.filter((r) => r.active);
  const retired = rows.filter((r) => !r.active);
  const note =
    group.effectiveStatus === 'WITH_ISSUES' || group.effectiveStatus === 'CAMPAIGN_PAUSED'
      ? group.effectiveStatus.toLowerCase().replace(/_/g, ' ')
      : null;

  /*
   * Ads at Facebook with no saved row: built from the default before anybody
   * wrote copy (the ops screen does this). Shown with an editor pre-filled from
   * the same default, so saving creates the row and the next push adopts the
   * ad by name.
   */
  const unsavedAds = group.ads.filter((a) => !rows.some((r) => r.name === a.name));

  return (
    <div className="rounded-lg border border-ink-200">
      {/* -------------------------------------------------------- header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="min-w-[10rem] flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-ink-900">{group.name}</span>
            {running ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
            {note ? <span className="text-[11px] text-ink-500">{note}</span> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-ink-600">
            {group.dailyBudgetUsd !== null ? <span>{money(group.dailyBudgetUsd)}/day</span> : null}
            {group.radiusMiles !== null ? <span>{group.radiusMiles} mi</span> : null}
            <span>{money(group.spend)} spent</span>
            <span>{group.clicks.toLocaleString()} clicks</span>
            <button
              type="button"
              onClick={() => setEditingBudget((v) => !v)}
              className="text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
            >
              {editingBudget ? 'cancel' : 'change budget or radius'}
            </button>
          </div>
        </div>

        {bucket ? (
          <form action={runAction}>
            <input type="hidden" name="rooftopId" value={rooftopId} />
            <input type="hidden" name="adSetId" value={group.id} />
            <input type="hidden" name="running" value={running ? 'false' : 'true'} />
            <Button
              type="submit"
              variant={running ? 'secondary' : 'primary'}
              size="sm"
              disabled={switching || group.ads.length === 0}
            >
              {switching ? '…' : running ? 'Stop' : 'Start'}
            </Button>
          </form>
        ) : (
          <span className="text-[11px] text-amber-700">Renamed in Ads Manager — manage it there</span>
        )}
      </div>

      {runState && !runState.ok ? (
        <p className="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{runState.error}</p>
      ) : null}
      {runState?.ok && runState.message ? (
        <p className="mx-3 mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {runState.message}
        </p>
      ) : null}

      {/* ------------------------------------------------ budget / radius */}
      {editingBudget && bucket ? (
        <form action={budgetAction} className="mx-3 mb-3 space-y-2 rounded-lg bg-ink-50 p-3">
          <input type="hidden" name="rooftopId" value={rooftopId} />
          <input type="hidden" name="bucket" value={bucket} />
          <BudgetRadiusFields
            budget={group.dailyBudgetUsd ?? 25}
            radius={group.radiusMiles ?? 25}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Updating…' : 'Update'}
            </Button>
            <span className="text-[11px] text-ink-500">
              Running stays running, stopped stays stopped.
            </span>
          </div>
          {budgetState && !budgetState.ok ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{budgetState.error}</p>
          ) : null}
          {budgetState?.ok ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {budgetState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {/* ------------------------------------------------------- the ads */}
      {bucket ? (
        <div className="space-y-2 border-t border-ink-200 px-3 py-3">
          <p className="text-xs font-medium text-ink-700">
            {live.length + unsavedAds.length === 1 ? 'The ad' : 'The ads'}
          </p>

          {live.map((r) => (
            <AdRow
              key={r.id}
              rooftopId={rooftopId}
              bucket={bucket}
              row={r}
              metaAd={group.ads.find((a) => a.name === r.name) ?? null}
              canRetire={live.length > 1}
            />
          ))}

          {unsavedAds.map((a) => (
            <AdRow
              key={a.id}
              rooftopId={rooftopId}
              bucket={bucket}
              row={{ ...fallback, name: a.name, id: '', bucket, active: true }}
              metaAd={a}
              canRetire={false}
            />
          ))}

          {adding ? (
            <AdEditor
              rooftopId={rooftopId}
              bucket={bucket}
              initial={{ ...fallback, name: '' }}
              copyId=""
              onDone={() => setAdding(false)}
            />
          ) : live.length + unsavedAds.length < MAX_ADS ? (
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
                Add another ad
              </Button>
              <p className="mt-1.5 text-[11px] text-ink-500">
                Facebook runs them against each other and shows the one people respond to more.
                Two or three is plenty.
              </p>
            </div>
          ) : null}

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

          {/*
            THE PUSH. Save writes to our database and nothing else; this is
            what puts the words on Facebook. Kept as its own press because it
            talks to Facebook and takes a few seconds.
          */}
          <div className="space-y-2 border-t border-ink-200 pt-3">
            <form action={pushAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="rooftopId" value={rooftopId} />
              <input type="hidden" name="bucket" value={bucket} />
              <Button type="submit" size="sm" disabled={pushing}>
                {pushing ? 'Updating on Facebook…' : 'Update on Facebook'}
              </Button>
              <span className="text-[11px] text-ink-500">
                Puts what you saved onto these ads. Doesn&apos;t start or stop anything.
              </span>
            </form>
            {pushState && !pushState.ok ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{pushState.error}</p>
            ) : null}
            {pushState?.ok ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                {pushState.message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- one ad */

function AdRow({
  rooftopId,
  bucket,
  row,
  metaAd,
  canRetire,
}: {
  rooftopId: string;
  bucket: BucketKey;
  row: AdCopyRow;
  metaAd: LotGroup['ads'][number] | null;
  canRetire: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <AdEditor
        rooftopId={rooftopId}
        bucket={bucket}
        initial={row}
        copyId={row.id}
        canRetire={canRetire}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-lg bg-ink-50 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-medium text-ink-900">{row.name}</span>
        {!metaAd ? (
          <span className="text-[11px] text-amber-700">not on Facebook yet — press Update</span>
        ) : metaAd.effectiveStatus === 'ACTIVE' ? (
          <span className="text-[11px] text-emerald-700">running</span>
        ) : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-auto text-[11px] text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
        >
          Edit
        </button>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-900">{row.message}</p>
      <p className="text-[11px] leading-snug text-ink-500">
        {/* Rendered as written, tokens and all. Facebook fills these in per
            car, and showing a fake car here would teach the wrong thing. */}
        {row.headline}
        {row.description ? ` · ${row.description}` : ''}
      </p>
      {metaAd?.creativeId ? <AdPreview rooftopId={rooftopId} creativeId={metaAd.creativeId} /> : null}
    </div>
  );
}

/**
 * The per-ad editor, with its own Save. `copyId` empty means a new row.
 */
function AdEditor({
  rooftopId,
  bucket,
  initial,
  copyId,
  canRetire,
  onDone,
}: {
  rooftopId: string;
  bucket: BucketKey;
  initial: AdCopyFields;
  copyId: string;
  canRetire?: boolean;
  onDone: () => void;
}) {
  const [state, action, busy] = useActionState(saveAdCopyAction, null);
  const [retireState, retireAction, retiring] = useActionState(retireAdCopyAction, null);

  return (
    <form action={action} className="space-y-2.5 rounded-lg border border-ink-200 bg-white p-3">
      <input type="hidden" name="rooftopId" value={rooftopId} />
      <input type="hidden" name="bucket" value={bucket} />
      <input type="hidden" name="copyId" value={copyId} />

      <AdFields prefix="" initial={initial} />

      {state && !state.ok ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{state.message}</p>
      ) : null}
      {retireState && !retireState.ok ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{retireState.error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {state?.ok ? 'Done' : 'Cancel'}
        </Button>
        {canRetire && copyId ? (
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            formAction={retireAction}
            disabled={retiring}
          >
            {retiring ? '…' : 'Turn off'}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The fields of one ad. `prefix` is what lets three of these live on the
 * new-group form at once — see `readAdFields` in `ad-copy-spec.ts`.
 */
function AdFields({ prefix, initial }: { prefix: string; initial: AdCopyFields }) {
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const n = (f: keyof AdCopyFields) => adFieldName(prefix, f);

  /*
   * Tokens are inserted at the cursor rather than documented. `{{vehicle.year}}`
   * is not a thing anyone types correctly from memory, and a typo does not fail
   * — it ships, and real shoppers see the braces.
   */
  const insert = (token: string) => {
    const el = messageRef.current;
    if (!el) return;
    const at = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, at) + token + el.value.slice(el.selectionEnd ?? at);
    el.focus();
    el.selectionStart = el.selectionEnd = at + token.length;
  };

  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-xs font-medium text-ink-700">Name this ad</span>
          <input
            name={n('name')}
            defaultValue={initial.name}
            maxLength={COPY_LIMITS.name}
            placeholder="Default"
            className={inputCls}
          />
          <span className="mt-1 block text-[11px] text-ink-500">Only you see this.</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-700">Button</span>
          <select name={n('callToAction')} defaultValue={initial.callToAction} className={inputCls}>
            {CALL_TO_ACTIONS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-ink-700">Main text</span>
        <textarea
          ref={messageRef}
          name={n('message')}
          defaultValue={initial.message}
          maxLength={COPY_LIMITS.message}
          rows={2}
          className={inputCls}
        />
        <span className="mt-1 block text-[11px] text-ink-500">
          The line above the car. Say something a neighbor would say.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-ink-500">Insert:</span>
        {VEHICLE_TOKENS.map((t) => (
          <button
            key={t.token}
            type="button"
            onClick={() => insert(t.token)}
            className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-700 hover:bg-ink-200"
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-0.5">
        <span className="mr-1 text-[11px] text-ink-500">Emoji:</span>
        {AD_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => insert(e)}
            aria-label={`Insert ${e}`}
            className="rounded px-1 py-0.5 text-sm leading-none hover:bg-ink-100"
          >
            {e}
          </button>
        ))}
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-ink-700">Headline</span>
          <input
            name={n('headline')}
            defaultValue={initial.headline}
            maxLength={COPY_LIMITS.headline}
            className={`${inputCls} font-mono text-xs`}
          />
          <span className="mt-1 block text-[11px] text-ink-500">Bold line on the card.</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-700">Under the headline</span>
          <input
            name={n('description')}
            defaultValue={initial.description}
            maxLength={COPY_LIMITS.description}
            className={`${inputCls} font-mono text-xs`}
          />
          <span className="mt-1 block text-[11px] text-ink-500">Usually the price.</span>
        </label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- new group */

function NewGroupForm({
  rooftopId,
  shelves,
  copy,
  fallback,
  first,
}: {
  rooftopId: string;
  shelves: BucketKey[];
  copy: AdCopyRow[];
  fallback: AdCopyFields;
  first: boolean;
}) {
  const [state, action, busy] = useActionState(buildGroupAction, null);
  const [bucket, setBucket] = useState<BucketKey>(
    shelves.includes(DEFAULT_BUCKET) ? DEFAULT_BUCKET : shelves[0]!,
  );

  /*
   * A shelf can have saved ads without a group at Facebook — the build failed,
   * or the dealer saved and never pressed the button. Those pre-fill the form
   * with their ids so the build updates them rather than duplicating.
   */
  const saved = copy.filter((c) => c.bucket === bucket && c.active);
  const seed: { copyId: string; fields: AdCopyFields }[] = saved.length
    ? saved.slice(0, MAX_ADS).map((c) => ({ copyId: c.id, fields: c }))
    : [{ copyId: '', fields: fallback }];
  const [adCount, setAdCount] = useState(seed.length);

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-ink-300 p-3">
      <div>
        <p className="text-sm font-medium text-ink-900">{first ? 'Build your first group' : 'Add a group'}</p>
        <p className="text-[11px] text-ink-500">
          Nothing spends until you start it. Everything here can be changed later.
        </p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="rooftopId" value={rooftopId} />
        <input type="hidden" name="adCount" value={adCount} />

        <label className="block">
          <span className="text-xs font-medium text-ink-700">Which cars</span>
          <select
            name="bucket"
            value={bucket}
            onChange={(e) => {
              setBucket(e.target.value as BucketKey);
              const n = copy.filter((c) => c.bucket === e.target.value && c.active).length;
              setAdCount(n || 1);
            }}
            className={inputCls}
          >
            {shelves.map((k) => (
              <option key={k} value={k}>
                {bucketByKey(k).label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-ink-500">
            All of them, or just the ones that have been sitting a while.
          </span>
        </label>

        <BudgetRadiusFields budget={25} radius={25} />

        {/* The ads, keyed by shelf so switching shelves resets the editors. */}
        <div key={bucket} className="space-y-2">
          <p className="text-xs font-medium text-ink-700">
            {adCount === 1 ? 'What the ad says' : 'What the ads say'}
          </p>
          {Array.from({ length: adCount }, (_, i) => {
            const s = seed[i] ?? { copyId: '', fields: { ...fallback, name: '' } };
            return (
              <div key={i} className="rounded-lg border border-ink-200 bg-white p-3">
                <input type="hidden" name={`ad${i}.copyId`} value={s.copyId} />
                <AdFields prefix={`ad${i}`} initial={s.fields} />
              </div>
            );
          })}
          {adCount < MAX_ADS ? (
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setAdCount((c) => c + 1)}>
                Add another ad
              </Button>
              <p className="mt-1.5 text-[11px] text-ink-500">
                Facebook runs them against each other and shows the one people respond to more.
                Two or three is plenty.
              </p>
            </div>
          ) : null}
        </div>

        <Button type="submit" disabled={busy}>
          {busy ? 'Building…' : 'Build the group'}
        </Button>
      </form>

      {state && !state.ok ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      ) : null}
      {state?.ok && state.data ? (
        <div className="space-y-1.5 rounded-lg bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
          <p className="font-medium">{state.message}</p>
          {state.data.adCannotRun ? (
            <p className="rounded bg-amber-100 px-2 py-1.5 text-[11px] font-medium text-amber-900">
              {state.data.adCannotRun}
            </p>
          ) : (
            <p className="text-[11px] text-emerald-800">
              It&apos;s listed above — press Start when you&apos;re ready.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BudgetRadiusFields({ budget, radius }: { budget: number; radius: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className="text-xs font-medium text-ink-700">Daily budget</span>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-sm text-ink-500">$</span>
          <input
            type="number"
            name="dailyBudget"
            defaultValue={budget}
            min={10}
            max={1000}
            step={5}
            className="w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
          />
        </div>
        <span className="mt-1 block text-[11px] text-ink-500">Per day, for this group.</span>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-ink-700">Radius</span>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type="number"
            name="radiusMiles"
            defaultValue={radius}
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
  );
}

/* ---------------------------------------------------------------- preview */

/**
 * What the ad looks like, in the placements it runs in.
 *
 * Collapsed behind a disclosure because it is an iframe of somebody else's
 * HTML: opening one costs a Graph call and a fetch, and a dealer glancing at
 * "is it running and what has it cost" should not pay for that on every load.
 *
 * The `src` is OUR route, never Meta's. See the note in
 * `src/app/api/meta/ad-preview/.../route.ts` — Meta's preview URL carries a
 * non-expiring system-user token and has no business being in a page.
 */
function AdPreview({ rooftopId, creativeId }: { rooftopId: string; creativeId: string }) {
  const [format, setFormat] = useState<string>(PREVIEW_FORMATS[0].key);

  return (
    <details className="mt-1.5 w-full">
      <summary className="cursor-pointer text-[11px] font-medium text-ink-600 hover:text-ink-900">
        See the ad
      </summary>

      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1">
          {PREVIEW_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFormat(f.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                format === f.key ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <iframe
          key={format}
          title="Ad preview"
          src={`/api/meta/ad-preview/${rooftopId}/${creativeId}/${format}`}
          className="h-[520px] w-full max-w-[420px] rounded-lg border border-ink-200 bg-white"
        />

        <p className="text-[11px] text-ink-500">
          Facebook builds this from your live inventory, so the car shown changes as your lot does.
        </p>
      </div>
    </details>
  );
}
