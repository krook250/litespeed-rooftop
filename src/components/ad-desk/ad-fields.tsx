'use client';

/**
 * The pieces both group screens share: the fields of one ad, the budget and
 * radius pair, and the real Meta-rendered preview.
 *
 * Lifted out of the old `ad-groups-panel.tsx` unchanged. That file mixed a
 * list, a form and three editors in one card and was rejected on sight; these
 * three components were never the problem, and rewriting working form markup
 * while rearranging a screen is how a layout change turns into a copy bug.
 */

import { useRef, useState } from 'react';
import {
  AD_EMOJI,
  CALL_TO_ACTIONS,
  COPY_LIMITS,
  VEHICLE_TOKENS,
  adFieldName,
  type AdCopyFields,
} from '@/lib/meta/ad-copy-spec';
import { PREVIEW_FORMATS } from '@/lib/meta/buckets-preview';
import { money } from './format';

/** A saved ad, as the screens carry it: the copy plus its row identity. */
export type AdCopyRow = AdCopyFields & {
  id: string;
  bucket: string;
  active: boolean;
};

export const inputCls =
  'mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900';

/**
 * The fields of one ad. `prefix` is what lets three of these live on the
 * new-group form at once — see `readAdFields` in `ad-copy-spec.ts`.
 */
export function AdFields({ prefix, initial }: { prefix: string; initial: AdCopyFields }) {
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
          /*
           * Five rows, not two. Two showed one line of a three-line ad and made
           * the dealer drag the corner before they could read what they wrote —
           * on the field whose whole job is the sentence a shopper sees first.
           */
          rows={5}
          className={inputCls}
        />
        <span className="mt-1 block text-[11px] text-ink-500">
          The line above the car. Say something a neighbor would say.
        </span>
      </label>

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

export function BudgetRadiusFields({
  budget,
  radius,
  city,
}: {
  budget: number;
  radius: number;
  city?: string | null;
}) {
  const [b, setB] = useState(budget);
  const [r, setR] = useState(radius);

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-700">Daily budget</span>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-sm text-ink-500">$</span>
            <input
              type="number"
              name="dailyBudget"
              value={b}
              onChange={(e) => setB(Number(e.target.value))}
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
              value={r}
              onChange={(e) => setR(Number(e.target.value))}
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

      {/*
        The same two numbers in the words a dealer thinks in. $25/day is not a
        quantity anybody has an instinct for; "about $760 a month" is.
      */}
      <div className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
        <p className="text-sm font-medium text-ink-900">
          About {money(Math.round((Number.isFinite(b) ? b : 0) * 30.4))} a month
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
          Shown to people within {Number.isFinite(r) ? r : 0} miles
          {city ? ` of ${city}` : ' of the lot'}. Either number can be changed later without
          rebuilding anything.
        </p>
      </div>
    </div>
  );
}

/**
 * What the ad looks like, in the placements it runs in.
 *
 * The `src` is OUR route, never Meta's. See the note in
 * `src/app/api/meta/ad-preview/.../route.ts` — Meta's preview URL carries a
 * non-expiring system-user token and has no business being in a page.
 */
export function AdPreview({ rooftopId, creativeId }: { rooftopId: string; creativeId: string }) {
  const [format, setFormat] = useState<string>(PREVIEW_FORMATS[0].key);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs font-medium text-ink-700">Preview</span>
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
        className="h-[520px] w-full rounded-lg border border-ink-200 bg-white"
      />

      <p className="text-[11px] text-ink-500">
        Facebook builds this from your live inventory, so the car shown changes as your lot does.
      </p>
    </div>
  );
}
