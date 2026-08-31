'use client';

/**
 * The About writer: five questions, a draft, then the dealer's edit.
 *
 * WHY IT IS NOT A TEXTAREA
 * "Tell buyers about your dealership" in an empty box is the field every dealer
 * skips — not for lack of things to say, but because writing three paragraphs
 * about yourself cold is genuinely hard and it is sitting between them and a
 * finished website. Five questions they can answer without thinking carry the
 * same information.
 *
 * THE ORDER IS LOAD-BEARING: answer → draft → **edit** → publish. The draft is
 * never published on their behalf. A dealer who has hand-edited the text and
 * then ticks another box gets a new draft offered, not applied — their writing
 * is theirs, and silently replacing it is the fastest way to teach someone that
 * a product does not save.
 */

import { useActionState, useState } from 'react';
import { Button, cn } from '@/components/ui';
import { draftAboutCopy, saveAbout } from '@/lib/store/actions';
import {
  SELLING_POINTS,
  STOCK_KINDS,
  factsAreEmpty,
  type AboutFacts,
} from '@/lib/store/about';

export function AboutCard({
  storefrontId,
  dealerName,
  city,
  about,
  facts,
}: {
  storefrontId: string;
  dealerName: string;
  city: string;
  about: string | null;
  facts: AboutFacts;
}) {
  const [since, setSince] = useState(facts.since ? String(facts.since) : '');
  const [stock, setStock] = useState<string[]>([...facts.stock]);
  const [points, setPoints] = useState<string[]>([...facts.points]);
  const [serves, setServes] = useState(facts.serves.join(', ') || city);
  const [ownWords, setOwnWords] = useState(facts.ownWords);

  const [text, setText] = useState(about ?? '');
  /* Set once a draft comes back, so the "you have unpublished changes" line can
     tell the truth without diffing against the server on every keystroke. */
  const [drafted, setDrafted] = useState<string | null>(null);

  const [draft, runDraft, drafting] = useActionState(draftAboutCopy, null);
  const [saved, publish, publishing] = useActionState(saveAbout, null);

  /* `useActionState` hands back the draft on the next render; adopt it once. */
  if (draft?.ok && draft.text !== drafted) {
    setDrafted(draft.text);
    setText(draft.text);
  }

  const answered = !factsAreEmpty({
    since: since ? Number(since) : null,
    stock: stock as AboutFacts['stock'],
    points: points as AboutFacts['points'],
    serves: serves.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    ownWords,
  });

  const dirty = text.trim() !== (about ?? '').trim();

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  /* The interview fields are named identically in both forms so that whichever
     button the dealer presses, the answers are saved. Publishing without ever
     drafting still records what they told us. */
  const interviewFields = (
    <>
      <input type="hidden" name="storefrontId" value={storefrontId} />
      <input type="hidden" name="since" value={since} />
      {stock.map((v) => <input key={v} type="hidden" name="stock" value={v} />)}
      {points.map((v) => <input key={v} type="hidden" name="points" value={v} />)}
      <input type="hidden" name="serves" value={serves} />
      <input type="hidden" name="ownWords" value={ownWords} />
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-ink-900">About {dealerName}</h3>
        <p className="mt-0.5 text-sm text-ink-600">
          This goes under your inventory and on your hours page, and it is a large part of what
          Google reads to work out who you are. Answer what you can and we&apos;ll write the first
          version — you get the last word on every sentence.
        </p>
      </div>

      <form action={runDraft} className="space-y-5">
        {interviewFields}

        <label className="block">
          <span className="text-sm font-medium text-ink-800">How long have you been selling here?</span>
          <span className="mt-0.5 block text-xs text-ink-500">
            The year you started. Leave it blank if you would rather not say.
          </span>
          <input
            value={since}
            onChange={(e) => setSince(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            placeholder="2009"
            className="mt-2 w-28 rounded-md border border-ink-300 px-2 py-1.5 text-sm"
          />
        </label>

        <Chips
          label="What do you mostly stock?"
          hint="Pick as many as fit. This is what a buyer is trying to work out in their first five seconds."
          options={STOCK_KINDS}
          selected={stock}
          onToggle={(v) => toggle(stock, setStock, v)}
        />

        <Chips
          label="What should people know about buying from you?"
          hint="Only tick what is true — this ends up on your website with your name on it."
          options={SELLING_POINTS}
          selected={points}
          onToggle={(v) => toggle(points, setPoints, v)}
        />

        <label className="block">
          <span className="text-sm font-medium text-ink-800">Where do your buyers come from?</span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Towns and cities, separated by commas. Worth doing properly — this is most of how you
            show up for people searching nearby.
          </span>
          <input
            value={serves}
            onChange={(e) => setServes(e.target.value)}
            placeholder="Vancouver, Battle Ground, Camas, Portland"
            className="mt-2 w-full rounded-md border border-ink-300 px-2.5 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-ink-800">Anything in your own words?</span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Optional, and the best part if you do it. One or two sentences you would say to somebody
            standing on the lot — we keep your phrasing.
          </span>
          <textarea
            value={ownWords}
            onChange={(e) => setOwnWords(e.target.value)}
            rows={3}
            maxLength={1200}
            placeholder="My dad opened this lot and I still buy every unit myself."
            className="mt-2 w-full rounded-md border border-ink-300 px-2.5 py-2 text-sm"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={drafting || !answered}>
            {drafting ? 'Writing…' : text ? 'Write it again' : 'Write my About'}
          </Button>
          {!answered ? (
            <span className="text-xs text-ink-500">Answer at least one question first.</span>
          ) : null}
          {draft && !draft.ok ? <span className="text-sm text-red-700">{draft.error}</span> : null}
        </div>
      </form>

      {/* ------------------------------------------------- review and publish */}
      <form action={publish} className="space-y-3 border-t border-ink-100 pt-5">
        {interviewFields}

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink-800">Your About section</span>
          {draft?.ok ? (
            <span className="text-xs text-ink-500">
              {draft.source === 'model'
                ? 'Draft written from your answers — edit anything that is not how you would say it.'
                : 'Written from your answers. Worth a pass in your own voice.'}
            </span>
          ) : null}
        </div>

        <textarea
          name="about"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          maxLength={6000}
          placeholder="Answer the questions above and press Write my About — or just type it yourself."
          className="w-full rounded-md border border-ink-300 px-3 py-2 text-sm leading-relaxed"
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish to my website'}
          </Button>
          {text.trim() ? (
            <button
              type="button"
              onClick={() => setText('')}
              className="text-sm text-ink-500 hover:text-ink-800"
            >
              Clear
            </button>
          ) : null}
          <span className={cn('text-sm', dirty ? 'text-amber-700' : 'text-ink-400')}>
            {saved?.ok
              ? saved.message
              : dirty
                ? 'Not published yet.'
                : about
                  ? 'Live on your website.'
                  : ''}
          </span>
          {saved && !saved.ok ? <span className="text-sm text-red-700">{saved.error}</span> : null}
        </div>
      </form>
    </div>
  );
}

function Chips({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint: string;
  options: readonly { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <span className="text-sm font-medium text-ink-800">{label}</span>
      <span className="mt-0.5 block text-xs text-ink-500">{hint}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition',
                on
                  ? 'border-ink-900 bg-ink-900 font-medium text-white'
                  : 'border-ink-300 text-ink-700 hover:border-ink-500',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
