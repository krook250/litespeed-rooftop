'use client';

/**
 * The interactive parts of a Lot Walk card.
 *
 * Facebook's *grammar* — reaction row, comment thread, composer — with none of
 * its *chrome*. No blue bar, no thumbs-up mark, no rounded-blue anything. The
 * palette is the app's own charcoal ramp, so a card reads as part of Rooftop
 * rather than as a social network someone bolted on. Cloning the look reads
 * cheap to the one person we need to impress, and invites a letter.
 */

import { useOptimistic, useRef, useState, useTransition } from 'react';
import { addComment, postNote, toggleReaction } from '@/lib/feed-actions';
import { cn } from '@/components/ui';

export function Avatar({
  name,
  size = 38,
  system = false,
}: {
  name: string;
  size?: number;
  system?: boolean;
}) {
  if (system) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg bg-ink-900 font-black text-emerald-400"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title="Posted by Rooftop"
      >
        R
      </div>
    );
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  // Deterministic hue per person, so the same face is the same colour everywhere.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(140deg, hsl(${h} 45% 42%), hsl(${(h + 40) % 360} 45% 30%))`,
      }}
      title={name}
    >
      {initials}
    </div>
  );
}

type ReactionState = { kind: 'THUMB' | 'FIRE'; count: number; mine: boolean }[];

const GLYPH = { THUMB: '👍', FIRE: '🔥' } as const;
const LABEL = { THUMB: 'Noted', FIRE: 'Hot unit' } as const;

export function ReactionRow({
  eventId,
  reactions,
  commentCount,
  vehicleHref,
}: {
  eventId: string;
  reactions: ReactionState;
  commentCount: number;
  vehicleHref: string | null;
}) {
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    reactions,
    (state: ReactionState, kind: 'THUMB' | 'FIRE') =>
      state.map((r) =>
        r.kind === kind ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r,
      ),
  );

  return (
    <div className="flex items-center gap-1 border-t border-ink-100 px-3 py-1.5">
      {optimistic.map((r) => (
        <button
          key={r.kind}
          type="button"
          title={LABEL[r.kind]}
          onClick={() =>
            startTransition(async () => {
              setOptimistic(r.kind);
              const fd = new FormData();
              fd.set('eventId', eventId);
              fd.set('kind', r.kind);
              await toggleReaction(fd);
            })
          }
          className={cn(
            'tnum inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
            r.mine
              ? 'bg-ink-900 text-white'
              : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
          )}
        >
          <span aria-hidden>{GLYPH[r.kind]}</span>
          {r.count > 0 ? r.count : ''}
        </button>
      ))}
      <span className="tnum px-2 text-xs text-ink-500">
        {commentCount === 0
          ? 'No comments'
          : `${commentCount} comment${commentCount === 1 ? '' : 's'}`}
      </span>
      <div className="flex-1" />
      {vehicleHref ? (
        <a
          href={vehicleHref}
          className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-100"
        >
          Open the unit →
        </a>
      ) : null}
    </div>
  );
}

export function CommentBox({ eventId, me }: { eventId: string; me: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={ref}
      action={(fd) =>
        startTransition(async () => {
          setValue('');
          await addComment(fd);
        })
      }
      className="flex items-center gap-2.5"
    >
      <input type="hidden" name="eventId" value={eventId} />
      <Avatar name={me} size={28} />
      <input
        name="body"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        placeholder="Write a comment…"
        className="min-w-0 flex-1 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-xs outline-none focus:border-ink-400 disabled:opacity-60"
      />
      {value.trim() ? (
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-60"
        >
          Post
        </button>
      ) : null}
    </form>
  );
}

/**
 * "Post something to the lot." A human post still gets numbers attached — the
 * server reads the state of the lot at write time, so the composer never asks
 * anyone to type a figure.
 */
export function Composer({
  me,
  rooftops,
}: {
  me: string;
  rooftops: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar name={me} />
        {open ? null : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex-1 rounded-full bg-ink-50 px-4 py-2.5 text-left text-sm text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-100"
          >
            Post something to the lot, {me.split(' ')[0]}…
          </button>
        )}
        {open ? (
          <form
            action={(fd) =>
              startTransition(async () => {
                setValue('');
                setOpen(false);
                await postNote(fd);
              })
            }
            className="flex flex-1 flex-col gap-2"
          >
            <textarea
              name="body"
              autoFocus
              rows={3}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="First line is the headline. Everything after it is the detail."
              className="w-full resize-none rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
            />
            <div className="flex items-center gap-2">
              {rooftops.length > 1 ? (
                <select
                  name="rooftopId"
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700 outline-none"
                >
                  {rooftops.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="rooftopId" value={rooftops[0]?.id ?? ''} />
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setValue('');
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !value.trim()}
                className="rounded-lg bg-ink-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
              >
                Post to the lot
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
