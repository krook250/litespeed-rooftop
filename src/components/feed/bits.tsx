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

import Link from 'next/link';
import { type ReactNode, useOptimistic, useRef, useState, useTransition } from 'react';
import {
  addComment,
  postNote,
  requestPhotos,
  ringTheBell,
  toggleReaction,
} from '@/lib/feed-actions';
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
  // Deterministic hue per person, so the same face is the same color everywhere.
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
  share,
}: {
  eventId: string;
  reactions: ReactionState;
  commentCount: number;
  vehicleHref: string | null;
  /** The share control, when this kind of card is worth posting about. */
  share?: ReactNode;
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
    <div className="flex flex-wrap items-center gap-1 border-t border-ink-100 px-3 py-1.5">
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
      {share}
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
 *
 * The action row underneath is the Lot Walk half of the morale bet. A feed
 * nobody can *start* something in is a notifications page, and a notifications
 * page is the thing a three-person lot correctly finds silly. Every button
 * below does something real:
 *
 *  - **Log a unit** and **Price change** are links. They go to the screen where
 *    that work already happens, and the feed picks the event up from the write,
 *    the same as it would if you had navigated there yourself. A composer that
 *    reimplemented either would be a second, worse intake form.
 *  - **Ring the bell** and **Request photos** post, because there is no screen
 *    for either — one is a celebration and one is a shortfall, and both are
 *    facts about the lot that nothing else was going to write down.
 */
export function Composer({
  me,
  rooftops,
}: {
  me: string;
  rooftops: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState<null | 'note' | 'bell'>(null);
  const [value, setValue] = useState('');
  const [pending, startTransition] = useTransition();
  const open = mode !== null;
  const isBell = mode === 'bell';
  const rooftopId = rooftops[0]?.id ?? '';

  const close = () => {
    setMode(null);
    setValue('');
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar name={me} />
        {open ? null : (
          <button
            type="button"
            onClick={() => setMode('note')}
            className="flex-1 rounded-full bg-ink-50 px-4 py-2.5 text-left text-sm text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-100"
          >
            Post something to the lot, {me.split(' ')[0]}…
          </button>
        )}
        {open ? (
          <form
            action={(fd) =>
              startTransition(async () => {
                const post = isBell ? ringTheBell : postNote;
                close();
                await post(fd);
              })
            }
            className="flex flex-1 flex-col gap-2"
          >
            {isBell ? (
              <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
                <span aria-hidden>🔔</span> Ring the bell
                <span className="font-medium text-ink-500">
                  — this month&rsquo;s numbers ride along
                </span>
              </div>
            ) : null}
            <textarea
              name="body"
              autoFocus
              rows={3}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                isBell
                  ? 'What are we celebrating? “Tina just sold her first one.”'
                  : 'First line is the headline. Everything after it is the detail.'
              }
              className={cn(
                'w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none',
                isBell
                  ? 'border-amber-300 bg-amber-50/40 focus:border-amber-500'
                  : 'border-ink-200 focus:border-ink-400',
              )}
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
                <input type="hidden" name="rooftopId" value={rooftopId} />
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !value.trim()}
                className={cn(
                  'rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50',
                  isBell ? 'bg-amber-600 hover:bg-amber-700' : 'bg-ink-900 hover:bg-ink-800',
                )}
              >
                {isBell ? 'Ring it' : 'Post to the lot'}
              </button>
            </div>
          </form>
        ) : null}
      </div>

      {open ? null : (
        <div className="mt-2.5 flex flex-wrap gap-2 border-t border-ink-100 pt-2.5">
          <ActionLink href="/admin/inventory/new" icon="🚚" label="Log a unit" />
          <ActionButton icon="🔔" label="Ring the bell" onClick={() => setMode('bell')} accent />
          <ActionLink href="/admin/inventory?view=at-risk" icon="💲" label="Price change" />
          <form
            action={(fd) => startTransition(async () => { await requestPhotos(fd); })}
          >
            <input type="hidden" name="rooftopId" value={rooftopId} />
            <ActionButton icon="📸" label="Request photos" type="submit" disabled={pending} />
          </form>
          <ActionButton icon="📣" label="Announcement" onClick={() => setMode('note')} />
        </div>
      )}
    </div>
  );
}

const ACTION_CLASS =
  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ' +
  'text-ink-600 ring-1 ring-inset ring-ink-200 transition-colors hover:bg-ink-50 ' +
  'hover:text-ink-900 disabled:opacity-50';

function ActionLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} className={ACTION_CLASS}>
      <span aria-hidden>{icon}</span>
      {label}
    </Link>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  type = 'button',
  disabled,
  accent,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        ACTION_CLASS,
        accent && 'text-amber-800 ring-amber-300 hover:bg-amber-50 hover:text-amber-900',
      )}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}
