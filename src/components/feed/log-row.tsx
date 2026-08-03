import Link from 'next/link';
import type { FeedCard } from '@/lib/feed';
import type { FeedEventKind } from '@/db/schema';
import { cn } from '@/components/ui';
import { shortTitle, usd } from '@/lib/domain';

/**
 * The same event, drawn as a log line.
 *
 * This is not a lesser feed. `feed_events` has always been a dealer log —
 * timestamped, tenant-scoped, one number minimum per row — and Lot Walk's
 * social feel is a layer on top of it. Take the layer off and what is left is
 * the thing the owner-plus-two-reps store actually wants: something that looks
 * like the management software they already run, with no avatars and no emoji.
 *
 * **Section 2's rule does more work here, not less.** On a card the number sits
 * under a headline and has room to be secondary. On a log line the number *is*
 * the line — strip the avatar and the reaction row and a row with no figure on
 * it is one line of nothing. Which is why the stats render inline here rather
 * than being dropped as chrome.
 *
 * Comments are not hidden, they are counted. A row whose thread is invisible
 * with no trace would mean the two views disagree about what happened, and the
 * whole premise is that they are the same stream. The count is the honest
 * minimum; the conversation is one click away in Lot Walk.
 */

const GLYPH: Record<FeedEventKind, { mark: string; tone: string; label: string }> = {
  acquired:         { mark: '+',  tone: 'text-ink-600',      label: 'Acquired' },
  recon_in:         { mark: '→',  tone: 'text-amber-700',    label: 'Into recon' },
  recon_out:        { mark: '✓',  tone: 'text-emerald-700',  label: 'Recon closed' },
  photos:           { mark: '▣',  tone: 'text-ink-600',      label: 'Photos' },
  front_line:       { mark: '●',  tone: 'text-emerald-700',  label: 'Front line' },
  price_change:     { mark: '$',  tone: 'text-blue-700',     label: 'Price' },
  at_risk:          { mark: '!',  tone: 'text-age-warn',     label: 'At risk' },
  aged:             { mark: '!!', tone: 'text-age-aged',     label: 'Aged' },
  water:            { mark: '~',  tone: 'text-age-hot',      label: 'Water' },
  vdp_milestone:    { mark: '↑',  tone: 'text-blue-700',     label: 'Traffic' },
  sync_error:       { mark: '×',  tone: 'text-red-700',      label: 'Channel' },
  sold:             { mark: '★',  tone: 'text-emerald-700',  label: 'Sold' },
  team:             { mark: '·',  tone: 'text-violet-700',   label: 'Team' },
  note:             { mark: '·',  tone: 'text-ink-600',      label: 'Note' },
  domain:           { mark: '@',  tone: 'text-blue-700',     label: 'Website' },
  transfer_out:     { mark: '⇢',  tone: 'text-violet-700',   label: 'Transfer' },
  transfer_inbound: { mark: '⇠',  tone: 'text-violet-700',   label: 'Inbound' },
  transfer_in:      { mark: '⇥',  tone: 'text-violet-700',   label: 'Arrived' },
};

/** Absolute, not relative: a log is read for "when exactly", a feed for "just now". */
function stamp(d: Date) {
  const dt = new Date(d);
  const today = new Date().toDateString() === dt.toDateString();
  const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return today ? time : `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

export function LogRow({ card }: { card: FeedCard }) {
  const { event, vehicle, actor } = card;
  const g = GLYPH[event.kind];

  return (
    <div className="flex items-start gap-2.5 px-3 py-1.5 hover:bg-ink-50">
      <span className="tnum w-14 shrink-0 pt-0.5 text-right text-[11px] text-ink-400">
        {stamp(event.createdAt)}
      </span>

      <span
        className={cn(
          'flex w-[5.75rem] shrink-0 items-baseline gap-1 pt-0.5 text-[10px] font-bold uppercase tracking-wide',
          g.tone,
        )}
      >
        <span className="w-3 text-center" aria-hidden>
          {g.mark}
        </span>
        <span className="truncate">{g.label}</span>
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-snug text-ink-900">
          {event.title}
          {card.commentCount ? (
            <span
              className="ml-1.5 align-middle text-[10px] text-ink-400"
              title={`${card.commentCount} comment${card.commentCount === 1 ? '' : 's'} in Lot Walk`}
            >
              💬{card.commentCount}
            </span>
          ) : null}
        </div>
        {/* One line, truncated — not dropped. The body is where a sync error
            puts the channel's actual complaint, and a log that swallows it is
            a log you cannot work from. */}
        {event.body ? (
          <div className="truncate text-[11px] leading-snug text-ink-500">{event.body}</div>
        ) : null}
        {/* The stats are the row. Strip the avatar and the reaction bar and a
            line with no figure on it is one line of nothing — which is why
            section 2's rule does more work here, not less. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3.5 gap-y-0.5">
          {event.stats.map((s, i) => (
            <span key={`${s.k}-${i}`} className="text-[11px] text-ink-500">
              {s.k}{' '}
              <span
                className={cn(
                  'tnum font-semibold',
                  s.good && 'text-emerald-700',
                  s.bad && 'text-red-700',
                  !s.good && !s.bad && 'text-ink-800',
                )}
              >
                {s.v}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="hidden w-44 shrink-0 pt-0.5 text-right lg:block">
        {vehicle ? (
          <Link href={`/admin/inventory/${vehicle.id}`} className="block hover:underline">
            <div className="truncate text-[11.5px] font-medium text-ink-800">
              {shortTitle(vehicle)}
            </div>
            <div className="tnum truncate text-[10.5px] text-ink-500">
              STK {vehicle.stockNumber} · {usd(vehicle.salePrice ?? vehicle.price)}
            </div>
          </Link>
        ) : null}
      </div>

      <span className="hidden w-24 shrink-0 truncate pt-0.5 text-right text-[11px] text-ink-400 sm:block">
        {actor?.name ?? 'System'}
      </span>
    </div>
  );
}
