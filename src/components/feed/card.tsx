import Link from 'next/link';
import type { FeedCard, FeedGroup } from '@/lib/feed';
import type { FeedEventKind } from '@/db/schema';
import { AgeBadge, cn } from '@/components/ui';
import { Avatar, CommentBox, ReactionRow } from '@/components/feed/bits';
import { ShareButton } from '@/components/feed/share';
import { daysInStock, relativeTime, shortTitle, totalCost, usd } from '@/lib/domain';

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
  bell:          { icon: '🔔', label: 'Rang the bell',  accent: 'bg-amber-100 text-amber-800' },
  domain:        { icon: '🌐', label: 'Website',        accent: 'bg-blue-50 text-blue-700' },
  transfer_out:  { icon: '🚛', label: 'Lot transfer',   accent: 'bg-violet-50 text-violet-700' },
  transfer_inbound: { icon: '🛬', label: 'Inbound',     accent: 'bg-violet-50 text-violet-700' },
  transfer_in:   { icon: '📍', label: 'Arrived on lot', accent: 'bg-violet-50 text-violet-700' },
};

/* --------------------------------------------------------------- sharing */

/**
 * Which cards are worth posting to a dealership's own page.
 *
 * Not every event is. "Crossed 30 days" is a management fact and posting it
 * publicly tells a shopper exactly how long you have been sitting on a unit —
 * so the shareable kinds are the ones a lot would put on its page anyway: a
 * sale, a bell, a fresh arrival, a unit going front-line, new photos, and a
 * price drop. Anything else gets no button rather than a bad suggestion.
 */
const SHAREABLE: FeedEventKind[] = [
  'sold', 'bell', 'acquired', 'front_line', 'photos', 'price_change',
];

function caption(card: FeedCard, dealer: string): string {
  const { event, vehicle } = card;
  const name = vehicle ? shortTitle(vehicle) : null;
  const price = vehicle ? usd(vehicle.salePrice ?? vehicle.price) : null;
  const miles = vehicle ? `${vehicle.mileage.toLocaleString('en-US')} miles` : null;

  switch (event.kind) {
    case 'sold':
      return name
        ? `SOLD! 🎉 The ${name} found its person today. Thank you for trusting ${dealer}.`
        : `Another one sold today. Thank you for trusting ${dealer}. 🎉`;
    case 'bell':
      // The person already wrote the words — that is what the bell is.
      return event.body ? `${event.title}\n\n${event.body}` : event.title;
    case 'acquired':
      return name
        ? `Just landed at ${dealer}: ${name}${miles ? `, ${miles}` : ''}. ` +
          `Photos going up shortly — message us if you want first look.`
        : `New arrival on the lot at ${dealer}. Photos going up shortly.`;
    case 'front_line':
      return name
        ? `Ready to go today — ${name}${price ? ` at ${price}` : ''}. ` +
          `Serviced, detailed and on the front line at ${dealer}.`
        : `Fresh on the front line at ${dealer}.`;
    case 'photos':
      return name
        ? `New photos of the ${name}${price ? ` — ${price}` : ''}. Come take a look at ${dealer}.`
        : `New photos up at ${dealer}.`;
    case 'price_change':
      return name
        ? `Price drop on the ${name}${price ? ` — now ${price}` : ''}. ` +
          `First one here gets it. ${dealer}.`
        : `Price drop at ${dealer} — come see what moved.`;
    default:
      return event.title;
  }
}

/**
 * The public address of a unit, or null.
 *
 * Only built for a storefront on its own domain. On the shared app host the
 * VDP lives under `/s/<slug>/<stock>`, which is a real page but reads as a
 * staging URL — putting that in front of a shopper on Facebook makes the
 * dealership look like it is renting a folder on somebody else's website. No
 * link is better than that link.
 */
function vdpUrl(card: FeedCard, shareBase: string | null): string | null {
  if (!shareBase || !card.vehicle) return null;
  return `${shareBase}/${card.vehicle.stockNumber}`;
}

export function FeedPost({
  card,
  me,
  dealer,
  shareBase,
}: {
  card: FeedCard;
  me: string;
  /** The dealership's own name — it goes in the caption, not "Rooftop". */
  dealer: string;
  /** `https://theirdomain.com`, or null when they have no custom domain yet. */
  shareBase: string | null;
}) {
  const { event, vehicle, photo, actor, subject } = card;
  const meta = KIND[event.kind];
  const isSystem = !actor;
  const dis = vehicle ? daysInStock(vehicle) : null;

  /**
   * The bell is the one card allowed to shout.
   *
   * Everything else here is deliberately quiet — section 2's whole argument is
   * that a feed dies when it becomes activity theater. The bell is the
   * exception that proves it: it is the only kind a *human* fires on purpose to
   * make the room look up, so it gets a gold rule and a warm ground. If a
   * second kind ever earns this treatment, the rule is being broken.
   */
  const isBell = event.kind === 'bell';

  return (
    <article
      className={cn(
        'overflow-hidden rounded-xl border shadow-sm',
        isBell
          ? 'border-amber-300 bg-gradient-to-b from-amber-50 to-white shadow-amber-100'
          : 'border-ink-200 bg-white',
      )}
    >
      {isBell ? <div className="h-1 bg-gradient-to-r from-amber-400 to-amber-300" /> : null}
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
        <h3
          className={cn(
            'font-bold leading-snug tracking-tight text-ink-900',
            isBell ? 'text-[22px]' : 'text-[16px]',
          )}
        >
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
        share={
          SHAREABLE.includes(event.kind) ? (
            <ShareButton
              content={{
                caption: caption(card, dealer),
                url: vdpUrl(card, shareBase),
                photo,
              }}
            />
          ) : null
        }
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

/* ------------------------------------------------------------- roll-up */

const ROLLUP_COPY: Partial<
  Record<FeedEventKind, { headline: (n: number) => string; body: string; stat: string }>
> = {
  at_risk: {
    headline: (n) => `${n} units are on the at-risk list`,
    body:
      'Between 30 and 45 days. This is the window where a price move still ' +
      'works — past 60 you are wholesaling it.',
    stat: 'At risk',
  },
  aged: {
    headline: (n) => `${n} units crossed 60 days`,
    body: 'Past the window where a price move works. These are wholesale conversations now.',
    stat: 'Aged',
  },
  water: {
    headline: (n) => `${n} units went underwater`,
    body: 'Into them deeper than the market will pay. Every day costs more than the last.',
    stat: 'Water',
  },
};

const SHOWN = 5;

/**
 * A morning's worth of one threshold, as one card.
 *
 * The sweep emits one row per unit and the log draws one line per row — that
 * does not change, and must not: a register that collapses entries is a
 * register you cannot audit. But five near-identical cards in a row is exactly
 * the activity theater section 2 warns about, and it buries the one card in
 * between them that somebody actually needed to see.
 *
 * The unit rows carry photos because the whole argument for a feed over a
 * report is that a used car is a physical object and the person reading this
 * knows it by sight before they know it by stock number.
 *
 * Reactions and comments live on `group.anchor` — see `groupFeed`.
 */
export function FeedRollup({
  group,
  me,
  dealer,
  shareBase,
}: {
  group: FeedGroup;
  me: string;
  dealer: string;
  shareBase: string | null;
}) {
  const { anchor, cards } = group;
  const copy = ROLLUP_COPY[anchor.event.kind];
  const meta = KIND[anchor.event.kind];

  // A roll-up with no copy for its kind should never be built, but rendering
  // the members as ordinary cards is a better failure than rendering nothing.
  if (!copy) {
    return (
      <>
        {cards.map((c) => (
          <FeedPost key={c.event.id} card={c} me={me} dealer={dealer} shareBase={shareBase} />
        ))}
      </>
    );
  }

  const vehicles = cards.map((c) => c.vehicle).filter(Boolean) as NonNullable<
    FeedCard['vehicle']
  >[];
  const tiedUp = vehicles.reduce((s, v) => s + totalCost(v), 0);
  const avgDays = vehicles.length
    ? Math.round(vehicles.reduce((s, v) => s + daysInStock(v), 0) / vehicles.length)
    : 0;
  const hidden = cards.length - SHOWN;

  return (
    <article className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 px-4 pb-2.5 pt-3.5">
        <Avatar name="Rooftop" system />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink-900">Rooftop</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-500">
            <span>Automatic</span>
            <span>·</span>
            <span>{relativeTime(cards[0]!.event.createdAt)}</span>
          </div>
        </div>
        <span
          className={cn('shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold', meta.accent)}
        >
          {meta.label}
        </span>
      </div>

      <div className="px-4 pb-3">
        <h3 className="text-[16px] font-bold leading-snug tracking-tight text-ink-900">
          <span className="mr-1.5" aria-hidden>
            {meta.icon}
          </span>
          {copy.headline(cards.length)}
        </h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-600">{copy.body}</p>
      </div>

      <div className="mx-4 mb-3 overflow-hidden rounded-lg border border-ink-200">
        <div className="divide-y divide-ink-100">
          {cards.slice(0, SHOWN).map((c) =>
            c.vehicle ? (
              <Link
                key={c.event.id}
                href={`/admin/inventory/${c.vehicle.id}`}
                className="flex items-center gap-3 bg-white px-3 py-2 hover:bg-ink-50"
              >
                {c.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.photo}
                    alt=""
                    className="h-10 w-14 shrink-0 rounded border border-ink-200 object-cover"
                  />
                ) : (
                  <div className="h-10 w-14 shrink-0 rounded border border-dashed border-ink-300 bg-ink-50" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-ink-900">
                    {shortTitle(c.vehicle)}
                  </div>
                  <div className="tnum truncate text-[11px] text-ink-500">
                    STK {c.vehicle.stockNumber} ·{' '}
                    {usd(c.vehicle.salePrice ?? c.vehicle.price)}
                  </div>
                </div>
                <AgeBadge days={daysInStock(c.vehicle)} />
              </Link>
            ) : null,
          )}
        </div>
        {hidden > 0 ? (
          <Link
            href="/admin/inventory?view=at-risk"
            className="block border-t border-ink-100 bg-ink-50 px-3 py-2 text-center text-[11px] font-semibold text-ink-600 hover:text-ink-900"
          >
            and {hidden} more →
          </Link>
        ) : null}
      </div>

      {/* the number. Same rule as a single card — this is the whole bet. */}
      <div className="flex border-t border-ink-100">
        <RollupStat k={copy.stat} v={String(cards.length)} bad />
        <RollupStat k="Tied up" v={usd(tiedUp)} />
        <RollupStat k="Avg days" v={String(avgDays)} last />
      </div>

      <ReactionRow
        eventId={anchor.event.id}
        reactions={anchor.reactions}
        commentCount={anchor.comments.length}
        vehicleHref={null}
      />

      <div className="flex flex-col gap-2.5 border-t border-ink-100 bg-ink-50 px-4 py-3">
        {anchor.comments.map((c) => (
          <div key={c.id} className="flex gap-2.5">
            <Avatar name={c.author} size={28} />
            <div className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 ring-1 ring-inset ring-ink-200">
              <div className="text-xs font-bold text-ink-900">{c.author}</div>
              <div className="whitespace-pre-line text-[13px] text-ink-700">{c.body}</div>
            </div>
          </div>
        ))}
        <CommentBox eventId={anchor.event.id} me={me} />
      </div>
    </article>
  );
}

function RollupStat({ k, v, bad, last }: { k: string; v: string; bad?: boolean; last?: boolean }) {
  return (
    <div className={cn('min-w-0 flex-1 px-4 py-2.5', !last && 'border-r border-ink-100')}>
      <div className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-500">{k}</div>
      <div
        className={cn(
          'tnum mt-0.5 truncate text-[15px] font-bold tracking-tight',
          bad ? 'text-red-700' : 'text-ink-900',
        )}
      >
        {v}
      </div>
    </div>
  );
}
