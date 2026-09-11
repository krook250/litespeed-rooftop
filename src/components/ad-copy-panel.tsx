'use client';

/**
 * The words on the ad, and the only screen in the product where a dealer writes
 * something a stranger will read.
 *
 * WHY IT IS A LIST AND NOT A FORM. Meta optimises at the ad set: several ads
 * inside one share a learning phase and delivery moves toward whichever wins.
 * So "write your ad" is really "write your ads", and the panel is shaped like
 * the thing it produces.
 *
 * THE WORD IS "AD", NOT "VERSION". Each row here becomes one real Ad object in
 * the dealer's account, carrying that row's name — so a dealer looking at Ads
 * Manager sees "All front-line vehicles — Default" and has to be able to trace
 * it back to the box they typed it in. "Version" described our data model;
 * "ad" describes the thing that exists at Facebook.
 *
 * SAVING DOES NOT TOUCH A RUNNING AD, and the panel says so rather than leaving
 * it to be discovered. Editing text should never be the action that changes what
 * a live campaign is spending on.
 */

import { useActionState, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader } from './ui';
import { saveAdCopyAction, retireAdCopyAction, refreshAdsAction } from '@/lib/meta/ad-copy-actions';
import { AD_EMOJI, CALL_TO_ACTIONS, COPY_LIMITS, VEHICLE_TOKENS } from '@/lib/meta/ad-copy-spec';

export type AdCopyRow = {
  id: string;
  name: string;
  message: string;
  headline: string;
  description: string;
  callToAction: string;
  active: boolean;
};

export function AdCopyPanel({
  rooftopId,
  rows,
  fallback,
  hasCampaigns,
}: {
  rooftopId: string;
  rows: AdCopyRow[];
  /** What the ads say today when nothing is saved yet. Pre-fills the first editor. */
  fallback: Omit<AdCopyRow, 'id' | 'active'>;
  /** Whether there is anything on Facebook to push an edit to. */
  hasCampaigns: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [pushState, pushAction, pushing] = useActionState(refreshAdsAction, null);
  const live = rows.filter((r) => r.active);
  const retired = rows.filter((r) => !r.active);

  return (
    <Card>
      <CardHeader
        title="What your ads say"
        subtitle="Facebook fills in each car. You write the rest."
        action={
          live.length > 1 ? (
            <Badge tone="neutral">{live.length} ads</Badge>
          ) : null
        }
      />

      <div className="space-y-3 px-5 py-4">
        {rows.length === 0 ? (
          <>
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
              This is what your ads say now. Change it and save, or leave it be.
            </p>
            <CopyForm rooftopId={rooftopId} initial={{ ...fallback, id: '', active: true }} />
          </>
        ) : (
          live.map((r) => (
            <CopyForm key={r.id} rooftopId={rooftopId} initial={r} canRetire={live.length > 1} />
          ))
        )}

        {adding ? (
          <CopyForm
            rooftopId={rooftopId}
            initial={{ ...fallback, id: '', active: true, name: '' }}
            onCancel={() => setAdding(false)}
          />
        ) : rows.length > 0 ? (
          <div>
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              Add another ad
            </Button>
            <p className="mt-1.5 text-[11px] text-ink-500">
              Facebook runs them against each other and shows the one people respond to more. Two
              or three is plenty.
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
          THE STEP THAT USED TO BE MISSING. Saving writes to our database and
          nothing else; until this button existed the only way to get an edit
          onto Facebook was to scroll past two panels and press something called
          "Build the campaign", which no dealer would read as "apply what I just
          wrote". Kept as a separate press rather than folded into Save because
          it talks to Facebook and takes a few seconds per campaign.
        */}
        <div className="space-y-2 border-t border-ink-200 pt-3">
          {hasCampaigns ? (
            <>
              <form action={pushAction}>
                <input type="hidden" name="rooftopId" value={rooftopId} />
                <Button type="submit" disabled={pushing}>
                  {pushing ? 'Updating on Facebook…' : 'Update my ads'}
                </Button>
              </form>
              <p className="text-[11px] text-ink-500">
                Save first, then this puts the new words on the ads you already have. It won&apos;t
                start or stop anything — running stays running, stopped stays stopped.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-ink-500">
              Nothing to update yet. Build a campaign below and it will use what you&apos;ve written
              here.
            </p>
          )}

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
    </Card>
  );
}

function CopyForm({
  rooftopId,
  initial,
  canRetire,
  onCancel,
}: {
  rooftopId: string;
  initial: Omit<AdCopyRow, 'id'> & { id: string };
  canRetire?: boolean;
  onCancel?: () => void;
}) {
  const [state, action, busy] = useActionState(saveAdCopyAction, null);
  const [retireState, retireAction, retiring] = useActionState(retireAdCopyAction, null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

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
    <form action={action} className="space-y-2.5 rounded-lg border border-ink-200 p-3">
      <input type="hidden" name="rooftopId" value={rooftopId} />
      <input type="hidden" name="copyId" value={initial.id} />

      <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-xs font-medium text-ink-700">Name this ad</span>
          <input
            name="name"
            defaultValue={initial.name}
            maxLength={COPY_LIMITS.name}
            placeholder="Default"
            className="mt-1 w-full rounded-lg border border-ink-300 px-2.5 py-2 text-sm text-ink-900"
          />
          <span className="mt-1 block text-[11px] text-ink-500">Only you see this.</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-700">Button</span>
          <select
            name="callToAction"
            defaultValue={initial.callToAction}
            className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
          >
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
          name="message"
          defaultValue={initial.message}
          maxLength={COPY_LIMITS.message}
          rows={2}
          className="mt-1 w-full rounded-lg border border-ink-300 px-2.5 py-2 text-sm text-ink-900"
        />
        <span className="mt-1 block text-[11px] text-ink-500">
          The line above the car. Say something a neighbour would say.
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

      {/*
        Same insert-at-cursor mechanism as the tokens, and a short curated list
        rather than a picker — see the note on AD_EMOJI. `aria-label` because a
        row of bare emoji buttons is unreadable to a screen reader.
      */}
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
            name="headline"
            defaultValue={initial.headline}
            maxLength={COPY_LIMITS.headline}
            className="mt-1 w-full rounded-lg border border-ink-300 px-2.5 py-2 font-mono text-xs text-ink-900"
          />
          <span className="mt-1 block text-[11px] text-ink-500">Bold line on the card.</span>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-ink-700">Under the headline</span>
          <input
            name="description"
            defaultValue={initial.description}
            maxLength={COPY_LIMITS.description}
            className="mt-1 w-full rounded-lg border border-ink-300 px-2.5 py-2 font-mono text-xs text-ink-900"
          />
          <span className="mt-1 block text-[11px] text-ink-500">Usually the price.</span>
        </label>
      </div>

      {state && !state.ok ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {state.message}
        </p>
      ) : null}
      {retireState && !retireState.ok ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{retireState.error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {canRetire && initial.id ? (
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
