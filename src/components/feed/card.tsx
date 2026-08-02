import Link from 'next/link';
import type { FeedCard } from '@/lib/feed';
import type { FeedEventKind } from '@/db/schema';
import { AgeBadge, cn } from '@/components/ui';
import { Avatar, CommentBox, ReactionRow } from '@/components/feed/bits';
import { daysInStock, relativeTime, shortTitle, usd } from '@/lib/domain';

/**
 * One card.
 *
 * The shape is fixed and the stat strip is not optional — see section 2 of
 * `claude/data-model-and-decisions.md`. `stats` is typed as a non-empty tuple
 * at the emitter, so by the time a card reaches here it has a number on it;
 * this component renders the strip unconditionally rather than defensively,
 * because a missing strip should be loud.
 */

const KIND: Record<FeedEventKind, { icon: string; label: string; accent: string }> = {
  acquired:      { icon: '🚚', label: 'Acquired',       accent: 'bg-ink-100 text-ink-700' },
  recon_in:      { icon: '🔧', label: 'Into recon',     accent: 'bg-amber-50 text-amber-800' },
  recon_out:     { icon: '✅', label: 'Recon closed',   accent: 'bg-emerald-50 text-emerald-700' },
  photos:        { icon: '📸', label: 'Photos',         accent: 'bg-ink-100 text-ink-700' },
  front_line:    { icon: '🟢', label: 'Front line',     accent: 'bg-emerald-50 text-emerald-700' },
  price_change:  { icon: '💲', label: 'Price change',   accent: 'bg-blue-50 text-blue-700' },
  at_risk:       { icon: '⚠︎', label: 'At risk',        accent: 'bg-age-warnbg text-age-warn' },
  aged:          { icon: '🕒', label: 'Aged unit',      accent: 'bg-age-agedbg text-age-aged' },
  water:         { icon: '🌊', label: 'Water unit',     accent: 'bg-age-hotbg text-age-hot' },
  vdp_milestone: { icon: '📈', label: 'Traffic',        accent: 'bg-blue-50 text-blue-700' },
  sync_error:    { icon: '⛔', label: 'Channel error',  accent: 'bg-red-50 text-red-700' },
  sold:          { icon: '🔔', label: 'Sold',           accent: 'bg-emerald-50 text-emerald-700' },
  team:          { icon: '👋', label: 'Team',           accent: 'bg-violet-50 text-violet-700' },
  note:          { icon: '📣', label: 'Note',           accent: 'bg-ink-100 text-ink-700' },
  domain:        { icon: '🌐', label: 'Website',        accent: 'bg-blue-50 text-blue-700' },
};

export function FeedPost({ card, me }: { card: FeedCard; me: string }) {
  const { event, vehicle, photo, actor, subject } = card;
  const meta = KIND[event.kind];
  const isSystem = !actor;
  const dis = vehicle ? daysInStock(vehicle) : null;

  return (
    <article className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      {/* who / when */}
      <div className="flex items-start gap-3 px-4 pb-2.5 pt-3.5">
        <Avatar name={actor?.name ?? 'Rooftop'} system={isSystem} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink-900">{actor?.name ?? 'Rooftop'}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
            <span>{isSystem ? 'Automatic' : (actor?.role ?? '').toLowerCase().replace('_', ' ')}</span>
            <span>·</span>
            <span>{relativeTime(event.createdAt)}</span>
            {vehicle && dis != null ? (
              <>
                <span>·</span>
                <AgeBadge days={dis} />
              </>
            ) : null}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
            meta.accent,
          )}
        >
          {meta.label}
        </span>
      </div>

      {/* what happened */}
      <div className="px-4 pb-3">
        <h3 className="text-[16px] font-bold leading-snug tracking-tight text-ink-900">
          <span className="mr-1.5" aria-hidden>
            {meta.icon}
          </span>
          {event.title}
        </h3>
        {event.body ? (
          <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-600">
            {event.body}
          </p>
        ) : null}
      </div>

      {/* the person, when the card is about a person */}
      {subject ? (
        <div className="mx-4 mb-3 flex items-center gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3">
          <Avatar name={subject.name} size={44} />
          <div className="min-w-0">
            <div className="text-sm font-bold text-ink-900">{subject.name}</div>
            <div className="text-xs text-ink-500">{subject.role.toLowerCase().replace('_', ' ')}</div>
          </div>
        </div>
      ) : null}

      {/* the unit */}
      {vehicle ? (
        <Link
          href={`/admin/inventory/${vehicle.id}`}
          className="block border-y border-ink-100 hover:bg-ink-50"
        >
          <div className="flex items-center gap-3 px-4 py-2.5">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt=""
                className="h-14 w-20 shrink-0 rounded-md border border-ink-200 object-cover"
              />
            ) : (
              <div className="h-14 w-20 shrink-0 rounded-md border border-dashed border-ink-300 bg-ink-50" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold text-ink-900">{shortTitle(vehicle)}</div>
              <div className="tnum truncate text-xs text-ink-500">
                STK {vehicle.stockNumber} · {usd(vehicle.salePrice ?? vehicle.price)} ·{' '}
                {vehicle.mileage.toLocaleString('en-US')} mi
              </div>
            </div>
          </div>
        </Link>
      ) : null}

      {/* the number. Never conditional — this is the whole bet. */}
      <div className="flex border-t border-ink-100">
        {event.stats.map((s, i) => (
          <div
            key={`${s.k}-${i}`}
            className={cn(
              'min-w-0 flex-1 px-4 py-2.5',
              i < event.stats.length - 1 && 'border-r border-ink-100',
            )}
          >
            <div className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">
              {s.k}
            </div>
            <div
              className={cn(
                'tnum mt-0.5 truncate text-[15px] font-bold tracking-tight',
                s.good && 'text-emerald-700',
                s.bad && 'text-red-700',
                !s.good && !s.bad && 'text-ink-900',
              )}
            >
              {s.v}
            </div>
          </div>
        ))}
      </div>

      {event.kind === 'sync_error' ? (
        <div className="flex gap-2 border-t border-ink-100 px-4 py-2.5">
          <Link
            href="/admin/syndication"
            className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800"
          >
            Open in Syndication
          </Link>
        </div>
      ) : null}

      <ReactionRow
        eventId={event.id}
        reactions={card.reactions}
        commentCount={card.comments.length}
        vehicleHref={vehicle ? `/admin/inventory/${vehicle.id}` : null}
      />

      <div className="flex flex-col gap-2.5 border-t border-ink-100 bg-ink-50 px-4 py-3">
        {card.comments.map((c) => (
          <div key={c.id} className="flex gap-2.5">
            <Avatar name={c.author} size={28} />
            <div className="min-w-0 rounded-2xl bg-white px-3 py-1.5 ring-1 ring-inset ring-ink-200">
              <div className="text-xs font-bold text-ink-900">{c.author}</div>
              <div className="text-[13px] text-ink-700">{c.body}</div>
            </div>
          </div>
        ))}
        <CommentBox eventId={event.id} me={me} />
      </div>
    </article>
  );
}
