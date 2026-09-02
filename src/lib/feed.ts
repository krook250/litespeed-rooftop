/**
 * Lot Walk — the event emitters.
 *
 * Section 2 of `claude/data-model-and-decisions.md` is the whole design in two
 * lines: **the system is the primary author, humans comment**, and **every card
 * carries a number**. Both rules are enforced here rather than in the UI, so a
 * card that violates them cannot be written in the first place:
 *
 *  - Every emitter is called from a real write path. Nothing in this file
 *    invents activity; if no unit moved, the feed does not move.
 *  - `stats` is a non-empty tuple at the type level. `emitFeedEvent` will not
 *    compile without at least one number, and `assertHasStats` catches anything
 *    that sneaks through a cast at runtime.
 *
 * Deliberately free of `server-only` and of every `next/*` import, exactly like
 * `auth-config.ts`: `src/db/seed.ts` and the backfill run this under plain tsx
 * with no request context.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import type { FeedEventKind, FeedStat, Vehicle } from '@/db/schema';
import {
  activePrice,
  daysInStock,
  grossPotential,
  isAged,
  isAtRisk,
  isWaterUnit,
  num,
  shortTitle,
  totalCost,
  usd,
} from '@/lib/domain';

/** At least one element. This is how "every card carries a number" is typed. */
export type NonEmpty<T> = [T, ...T[]];

export type EmitInput = {
  rooftopId: string;
  kind: FeedEventKind;
  title: string;
  /** The sentence under the headline. Optional — the stats are not. */
  body?: string;
  stats: NonEmpty<FeedStat>;
  /** null/undefined = the system posted it. */
  actorId?: string | null;
  vehicleId?: string | null;
  subjectUserId?: string | null;
  /**
   * Set for anything derived from a threshold rather than from a write —
   * "crossed 30 days" must post once, however often the sweep runs. Leave null
   * where repetition is the truth: every price change is genuinely news.
   */
  dedupeKey?: string | null;
  createdAt?: Date;
};

/** Belt and braces for the non-empty tuple, since callers can always cast. */
function assertHasStats(input: EmitInput) {
  if (!Array.isArray(input.stats) || input.stats.length === 0) {
    throw new Error(
      `feed_event "${input.kind}" was emitted with no stats. Every card carries a ` +
        'number — see section 2 of data-model-and-decisions.md.',
    );
  }
}

/**
 * Write one feed event. Returns the row, or null when a dedupeKey collided,
 * which is the normal and expected outcome for sweep-driven events.
 */
export async function emitFeedEvent(input: EmitInput) {
  assertHasStats(input);

  const values: typeof t.feedEvents.$inferInsert = {
    rooftopId: input.rooftopId,
    kind: input.kind,
    actorId: input.actorId ?? null,
    vehicleId: input.vehicleId ?? null,
    subjectUserId: input.subjectUserId ?? null,
    title: input.title,
    body: input.body ?? '',
    stats: input.stats,
    dedupeKey: input.dedupeKey ?? null,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  };

  const rows = await db
    .insert(t.feedEvents)
    .values(values)
    .onConflictDoNothing({ target: t.feedEvents.dedupeKey })
    .returning();

  return rows[0] ?? null;
}

/* ------------------------------------------------------------ stat recipes */

type MoneyVehicle = Pick<
  Vehicle,
  'cost' | 'pack' | 'reconCost' | 'price' | 'salePrice' | 'marketValue' | 'acquiredDate' | 'frontLineDate' | 'soldDate'
>;

export const daysStat = (v: MoneyVehicle): FeedStat => {
  const d = daysInStock(v);
  return { k: 'Days in stock', v: `${d}d`, bad: d >= 46, good: d <= 15 };
};

export const askingStat = (v: MoneyVehicle): FeedStat => ({
  k: 'Asking',
  v: usd(activePrice(v)),
});

export const grossStat = (v: MoneyVehicle): FeedStat => {
  const g = grossPotential(v);
  return { k: 'Gross if it sells', v: usd(g), good: g >= 1500, bad: g < 0 };
};

export const tiedUpStat = (v: MoneyVehicle): FeedStat => ({
  k: 'Tied up',
  v: usd(totalCost(v)),
});

/* --------------------------------------------------------- write emitters */

type VehicleLike = Vehicle;

/** The unit landed. */
export async function feedAcquired(v: VehicleLike, actorId?: string | null) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'acquired',
    vehicleId: v.id,
    actorId,
    title: `${shortTitle(v)} landed on the lot`,
    body:
      `${v.acquisitionSource.toLowerCase().replace('_', ' ')} · ${num(v.mileage)} miles · ` +
      'stock #' + v.stockNumber + '. Not syndicated to the paid channels until photos are up.',
    stats: [tiedUpStat(v), { k: 'ACV', v: usd(v.cost) }, { k: 'Market', v: usd(v.marketValue) }],
    dedupeKey: `acquired:${v.id}`,
  });
}

export async function feedReconIn(v: VehicleLike, actorId?: string | null) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'recon_in',
    vehicleId: v.id,
    actorId,
    title: `${shortTitle(v)} went into the recon bay`,
    body: 'Held out of syndication until it comes back out and gets photographed.',
    stats: [
      daysStat(v),
      { k: 'Recon so far', v: usd(v.reconCost) },
      { k: 'Tied up', v: usd(totalCost(v)) },
    ],
    dedupeKey: `recon_in:${v.id}`,
  });
}

export async function feedReconOut(v: VehicleLike, reconDays: number, actorId?: string | null) {
  const onTarget = reconDays <= 7;
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'recon_out',
    vehicleId: v.id,
    actorId,
    title: `Recon closed on the ${shortTitle(v)} — ${reconDays} days`,
    body: onTarget ? 'Inside the 5–7 day target.' : 'Over the 5–7 day target.',
    stats: [
      { k: 'Recon time', v: `${reconDays}d`, good: onTarget, bad: !onTarget },
      { k: 'Recon cost', v: usd(v.reconCost) },
      tiedUpStat(v),
    ],
    dedupeKey: `recon_out:${v.id}`,
  });
}

/** Photos crossed the threshold that lets marketplaces accept the unit. */
export async function feedPhotos(v: VehicleLike, photoCount: number, actorId?: string | null) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'photos',
    vehicleId: v.id,
    actorId,
    title: `${photoCount} photos up on the ${shortTitle(v)}`,
    body: 'Marketplaces enforce photo minimums — this is the gate between recon and revenue.',
    stats: [
      { k: 'Photos', v: `${photoCount} / 8`, good: photoCount >= 8, bad: photoCount < 8 },
      daysStat(v),
      askingStat(v),
    ],
    dedupeKey: `photos:${v.id}:${photoCount}`,
  });
}

export async function feedFrontLine(
  v: VehicleLike,
  opts: { reconDays: number | null; photoCount: number; channelCount: number; actorId?: string | null },
) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'front_line',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `${shortTitle(v)} is front-line ready`,
    body:
      (opts.reconDays == null
        ? ''
        : `Recon closed in ${opts.reconDays} day${opts.reconDays === 1 ? '' : 's'}, `) +
      `${opts.photoCount} photo${opts.photoCount === 1 ? '' : 's'} up, merchandising complete. ` +
      `Queued out to ${opts.channelCount} channel${opts.channelCount === 1 ? '' : 's'}.`,
    stats: [askingStat(v), grossStat(v), { k: 'Channels', v: num(opts.channelCount) }],
    dedupeKey: `front_line:${v.id}`,
  });
}

export async function feedPriceChange(
  v: VehicleLike,
  opts: { oldPrice: number; newPrice: number; reason?: string | null; actorId?: string | null },
) {
  const down = opts.newPrice < opts.oldPrice;
  const delta = Math.abs(opts.newPrice - opts.oldPrice);
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'price_change',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `${shortTitle(v)} ${down ? 'cut' : 'raised'} ${usd(delta)} to ${usd(opts.newPrice)}`,
    body: opts.reason?.trim()
      ? opts.reason.trim()
      : `Was ${usd(opts.oldPrice)}. ${down ? 'Priced down' : 'Priced up'} and pushed to every live channel.`,
    stats: [
      { k: down ? 'Price cut' : 'Price raised', v: usd(delta), bad: down, good: !down },
      daysStat(v),
      { k: 'Gross now', v: usd(opts.newPrice - totalCost(v)), bad: opts.newPrice - totalCost(v) < 0 },
    ],
    // Every reprice is real news. No dedupe.
  });
}

export async function feedSold(
  v: VehicleLike,
  opts: { soldPrice: number; frontGross: number; daysToSell: number; actorId?: string | null },
) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'sold',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `Sold — ${shortTitle(v)}`,
    body: `Stock #${v.stockNumber} retailed at ${usd(opts.soldPrice)} after ${opts.daysToSell} days on the lot.`,
    stats: [
      { k: 'Front gross', v: usd(opts.frontGross), good: opts.frontGross > 0, bad: opts.frontGross <= 0 },
      { k: 'Days to turn', v: `${opts.daysToSell}d`, good: opts.daysToSell <= 45 },
      { k: 'Sold price', v: usd(opts.soldPrice) },
    ],
    dedupeKey: `sold:${v.id}`,
  });
}

/* ------------------------------------------------------------- transfers */

/**
 * Moving a unit between two of the group's own lots is the one event that
 * belongs to **two** rooftops, and `feed_events.rooftopId` holds one. So a
 * transfer is two cards, not one: the departure posts to the origin lot, the
 * arrival posts to the destination. Both hang off the same `vehicle_transfers`
 * row and dedupe on its id, so a double-submitted form cannot double-post.
 *
 * Rooftop display names arrive already shortened — the emitter has no group
 * context, exactly like `feedSyncError` takes the channel's name rather than
 * looking it up. See `src/lib/transfers.ts`.
 */

/** How long the car was actually on the road, in the words a porter would use. */
export function transitLabel(ms: number) {
  const hours = ms / 3_600_000;
  if (hours < 1) return 'Under an hour';
  if (hours < 36) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The unit left the origin lot. Posted to the lot it left. */
export async function feedTransferOut(
  v: VehicleLike,
  opts: { transferId: string; toRooftopName: string; note?: string | null; actorId?: string | null },
) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'transfer_out',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `${shortTitle(v)} left for ${opts.toRooftopName}`,
    body:
      (opts.note?.trim() ? `${opts.note.trim()} ` : '') +
      `Stock #${v.stockNumber} stays on this lot's books and stays listed until somebody marks it ` +
      `arrived — a unit that goes dark mid-move loses its ranking on the marketplaces.`,
    stats: [daysStat(v), tiedUpStat(v), { k: 'Headed to', v: opts.toRooftopName }],
    dedupeKey: `transfer_out:${opts.transferId}`,
  });
}

/**
 * Something is coming. Posted to the **destination** lot the moment the unit
 * leaves the other one.
 *
 * This is the third card in a move, and the one that carries the most useful
 * information to the person reading it: the porter at the far end needs a spot
 * cleared and needs to know to expect keys, and he needs that before the truck
 * turns up rather than after. The "On the way" rail says the same thing, but a
 * rail is scrolled past and a card can be replied to — "put it in the front
 * row" is a comment on this card and nowhere else.
 *
 * Deliberately **not** emitted on the "it's already there" shortcut: a warning
 * that a car is coming is noise when the car is already parked outside.
 */
export async function feedTransferInbound(
  v: VehicleLike,
  opts: {
    transferId: string;
    toRooftopId: string;
    fromRooftopName: string;
    note?: string | null;
    actorId?: string | null;
  },
) {
  return emitFeedEvent({
    // The unit still belongs to the origin lot until it arrives, so the target
    // rooftop is passed in rather than read off the vehicle.
    rooftopId: opts.toRooftopId,
    kind: 'transfer_inbound',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `${shortTitle(v)} is on its way here from ${opts.fromRooftopName}`,
    body:
      (opts.note?.trim() ? `${opts.note.trim()} ` : '') +
      `Stock #${v.stockNumber}. Mark it arrived when it is on the ground and its listings move here.`,
    stats: [daysStat(v), askingStat(v), { k: 'Coming from', v: opts.fromRooftopName }],
    dedupeKey: `transfer_inbound:${opts.transferId}`,
  });
}

/**
 * The inbound unit is not coming after all.
 *
 * Only emitted when the destination was actually told to expect it. A lot that
 * was promised a car and never told otherwise goes looking for it, which is a
 * worse failure than one more card.
 */
export async function feedTransferInboundCancelled(
  v: VehicleLike,
  opts: {
    transferId: string;
    toRooftopId: string;
    fromRooftopName: string;
    actorId?: string | null;
  },
) {
  return emitFeedEvent({
    rooftopId: opts.toRooftopId,
    kind: 'transfer_inbound',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `${shortTitle(v)} is not coming after all`,
    body: `The move was called off. Stock #${v.stockNumber} is staying at ${opts.fromRooftopName}.`,
    stats: [daysStat(v), askingStat(v), { k: 'Staying at', v: opts.fromRooftopName }],
    dedupeKey: `transfer_inbound_cancelled:${opts.transferId}`,
  });
}

/**
 * The unit landed at the far end. Posted to the receiving lot, and the only
 * card whose stats include how long the move actually took.
 *
 * Days in stock is on this card on purpose, and it does not restart: a unit that
 * was 52 days old at the old lot is 52 days old at the new one. Resetting the
 * clock on transfer is how aged inventory gets laundered into fresh inventory,
 * and the whole point of the feed is that it does not lie about where the money
 * is sitting.
 */
export async function feedTransferIn(
  v: VehicleLike,
  opts: {
    transferId: string;
    fromRooftopName: string;
    toRooftopName: string;
    transitMs: number;
    actorId?: string | null;
  },
) {
  return emitFeedEvent({
    // The vehicle row has already been moved by the time this is called, but
    // pass it explicitly rather than trusting call order.
    rooftopId: v.rooftopId,
    kind: 'transfer_in',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `${shortTitle(v)} arrived from ${opts.fromRooftopName}`,
    body:
      `Stock #${v.stockNumber} is on the ground at ${opts.toRooftopName} and its listings now point ` +
      `here. Days in stock did not reset — the money has been tied up since the day it was bought.`,
    stats: [
      { k: 'In transit', v: transitLabel(opts.transitMs) },
      daysStat(v),
      tiedUpStat(v),
    ],
    dedupeKey: `transfer_in:${opts.transferId}`,
  });
}

/**
 * The move was called off. Posted back to the origin lot, because that is the
 * feed where the departure card is sitting and where somebody is otherwise
 * about to go looking for a car that never left.
 */
export async function feedTransferCancelled(
  v: VehicleLike,
  opts: {
    transferId: string;
    fromRooftopName: string;
    toRooftopName: string;
    actorId?: string | null;
  },
) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'transfer_out',
    vehicleId: v.id,
    actorId: opts.actorId,
    title: `The move to ${opts.toRooftopName} is off — ${shortTitle(v)} is staying put`,
    body: `Stock #${v.stockNumber} never changed hands. Nothing about its listings changed either.`,
    stats: [daysStat(v), tiedUpStat(v), { k: 'Staying at', v: opts.fromRooftopName }],
    dedupeKey: `transfer_cancelled:${opts.transferId}`,
  });
}

/**
 * A channel rejected the unit. Emitted from the sync engine, which is the only
 * place that knows a change failed to land.
 */
export async function feedSyncError(
  v: VehicleLike,
  opts: { channelName: string; channelShort: string; message: string; liveOn: number; totalChannels: number },
) {
  return emitFeedEvent({
    rooftopId: v.rooftopId,
    kind: 'sync_error',
    vehicleId: v.id,
    title: `${opts.channelName} rejected stock #${v.stockNumber}`,
    body: `${opts.message} The unit is live everywhere else — it is only dark on ${opts.channelShort}.`,
    stats: [
      { k: 'Channel', v: opts.channelShort, bad: true },
      { k: 'Live on', v: `${opts.liveOn} of ${opts.totalChannels}` },
      askingStat(v),
    ],
    // One card per unit per channel per day: a flapping feed is a muted feed.
    dedupeKey: `sync_error:${v.id}:${opts.channelShort}:${new Date().toISOString().slice(0, 10)}`,
  });
}

/* ------------------------------------------------------- derived (sweep) */

const VDP_MILESTONES = [100, 250, 500, 1000, 2000] as const;

/**
 * Threshold events. These are the ones no write path can produce, because
 * nothing happened — time passed. Idempotent by construction: every event
 * carries a dedupeKey and the unique index does the rest, so this is safe to
 * call on every feed render.
 *
 * At ~25 units per rooftop that is two queries and a handful of inserts. At
 * 200 dealers this becomes roadmap item 6's worker; the emitters do not change.
 */
export async function sweepDerivedFeedEvents(rooftopIds: string[]) {
  if (!rooftopIds.length) return { created: 0 };

  const LIVE = ['ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'] as const;

  const inventory = await db
    .select()
    .from(t.vehicles)
    .where(and(inArray(t.vehicles.rooftopId, rooftopIds), inArray(t.vehicles.status, LIVE)));

  if (!inventory.length) return { created: 0 };

  const viewRows = await db
    .select({
      vehicleId: t.vehicleDailyStats.vehicleId,
      views: sql<number>`sum(${t.vehicleDailyStats.vdpViews})::int`,
      leads: sql<number>`sum(${t.vehicleDailyStats.leads})::int`,
    })
    .from(t.vehicleDailyStats)
    .where(inArray(t.vehicleDailyStats.vehicleId, inventory.map((v) => v.id)))
    .groupBy(t.vehicleDailyStats.vehicleId);
  const views = new Map(viewRows.map((r) => [r.vehicleId, r]));

  let created = 0;
  const bump = (row: unknown) => {
    if (row) created++;
  };

  for (const v of inventory) {
    const d = daysInStock(v);

    if (isAtRisk(d)) {
      bump(
        await emitFeedEvent({
          rooftopId: v.rooftopId,
          kind: 'at_risk',
          vehicleId: v.id,
          title: `${shortTitle(v)} crossed 30 days`,
          body:
            'On the at-risk list now. This is the window where a price move still works — ' +
            'past 60 you are wholesaling it.',
          stats: [daysStat(v), tiedUpStat(v), grossStat(v)],
          dedupeKey: `at_risk:${v.id}`,
        }),
      );
    }

    if (isAged(d)) {
      const agg = views.get(v.id);
      bump(
        await emitFeedEvent({
          rooftopId: v.rooftopId,
          kind: 'aged',
          vehicleId: v.id,
          title: `${shortTitle(v)} is now an aged unit at ${d} days`,
          body:
            `${num(agg?.views ?? 0)} VDP views and ${num(agg?.leads ?? 0)} lead` +
            `${(agg?.leads ?? 0) === 1 ? '' : 's'} lifetime — ` +
            ((agg?.views ?? 0) > 150
              ? 'this is a price problem, not a traffic problem.'
              : 'nobody is finding it. Merchandising first, then price.'),
          stats: [
            { k: 'Days in stock', v: `${d}d`, bad: true },
            askingStat(v),
            { k: 'Market', v: usd(v.marketValue) },
          ],
          dedupeKey: `aged:${v.id}`,
        }),
      );
    }

    if (isWaterUnit(v)) {
      bump(
        await emitFeedEvent({
          rooftopId: v.rooftopId,
          kind: 'water',
          vehicleId: v.id,
          title: `${shortTitle(v)} is a water unit`,
          body: `Total cost is above what the market says it is worth, and it has been here ${d} days.`,
          stats: [
            tiedUpStat(v),
            { k: 'Market', v: usd(v.marketValue) },
            { k: 'Underwater', v: usd(-(totalCost(v) - v.marketValue)), bad: true },
          ],
          dedupeKey: `water:${v.id}`,
        }),
      );
    }

    const total = views.get(v.id)?.views ?? 0;
    const hit = [...VDP_MILESTONES].reverse().find((m) => total >= m);
    if (hit && v.status === 'FRONT_LINE_READY') {
      bump(
        await emitFeedEvent({
          rooftopId: v.rooftopId,
          kind: 'vdp_milestone',
          vehicleId: v.id,
          title: `${shortTitle(v)} passed ${num(hit)} VDP views`,
          body: 'The interest is there. If it is not closing at this traffic, it is priced wrong.',
          stats: [
            { k: 'VDP views', v: num(total), good: true },
            { k: 'Leads', v: num(views.get(v.id)?.leads ?? 0) },
            daysStat(v),
          ],
          dedupeKey: `vdp:${v.id}:${hit}`,
        }),
      );
    }
  }

  return { created };
}

/* --------------------------------------------------------------- reads */

/**
 * How this user reads the event stream: their own choice if they made one, the
 * dealership's otherwise.
 *
 * The null in `users.feedStyle` is the whole mechanism — it is the difference
 * between "I picked Lot Walk" and "I never picked", and only the second follows
 * the owner when they change the house default. Resolved in one place so the
 * page, the switcher and any future per-rooftop rule cannot disagree.
 *
 * Lives here rather than in `queries.ts` for the same reason the emitters do:
 * `queries.ts` imports `server-only`, and this has to be callable from the test
 * runner under plain tsx.
 */
export async function resolveFeedStyle(user: {
  groupId: string;
  feedStyle: t.FeedStyle | null;
}): Promise<{ style: t.FeedStyle; houseStyle: t.FeedStyle; isOverride: boolean }> {
  const rows = await db
    .select({ feedStyle: t.dealerGroups.feedStyle })
    .from(t.dealerGroups)
    .where(eq(t.dealerGroups.id, user.groupId))
    .limit(1);
  const houseStyle = rows[0]?.feedStyle ?? 'SOCIAL';
  return {
    style: user.feedStyle ?? houseStyle,
    houseStyle,
    // Choosing the same thing the house chose is not an override — otherwise
    // the switcher nags about a difference that does not exist.
    isOverride: user.feedStyle != null && user.feedStyle !== houseStyle,
  };
}

export type FeedCard = {
  event: typeof t.feedEvents.$inferSelect;
  vehicle: (typeof t.vehicles.$inferSelect) | null;
  photo: string | null;
  actor: { id: string; name: string; role: string } | null;
  subject: { id: string; name: string; role: string } | null;
  reactions: { kind: t.FeedReactionKind; count: number; mine: boolean }[];
  comments: { id: string; body: string; createdAt: Date; author: string }[];
  /**
   * Always populated, even when the thread itself was not fetched. The log
   * presentation renders a count rather than the conversation, and a row whose
   * thread is invisible *with no trace* would mean the two views disagree about
   * what happened — which breaks the premise that they are one stream.
   */
  commentCount: number;
};

/* ------------------------------------------------------------- roll-ups */

/**
 * Threshold kinds crossed by several units on the same morning.
 *
 * These are the only kinds that arrive in a clump. Every other kind is a
 * discrete thing somebody did to one unit; `at_risk`, `aged` and `water` are a
 * sweep noticing that the calendar moved, so five of them land within the same
 * second and turn the feed into a wall of near-identical cards.
 */
const ROLLUP_KINDS: FeedEventKind[] = ['at_risk', 'aged', 'water'];

export type FeedGroup = {
  /**
   * The card that owns the conversation.
   *
   * The **oldest** member, not the newest, and that is the whole trick: a group
   * gains members as the morning's sweep runs, so anchoring to the newest would
   * move the thread out from under anyone who had already commented. The oldest
   * member of a same-day clump never changes.
   */
  anchor: FeedCard;
  /** Newest first. Length 1 means this is an ordinary card, not a roll-up. */
  cards: FeedCard[];
};

/**
 * Group a same-day clump of threshold events into one card.
 *
 * **Read-time only.** Nothing here changes what was emitted or what is stored —
 * the rows are still one per unit, the log still draws one line each, and a
 * dealer who switches views sees the same history counted the same way. This
 * resolves open question 2 in `claude/lot-walk.md`: it was never per-unit
 * *versus* digest, it was per-unit in the register and digest in the feed.
 *
 * Only Lot Walk calls this. A log that collapsed five rows into one would be
 * hiding entries from a register, which is the one thing a register may not do.
 */
export function groupFeed(cards: FeedCard[]): FeedGroup[] {
  const out: FeedGroup[] = [];
  const index = new Map<string, FeedGroup>();

  for (const card of cards) {
    const { kind, createdAt, rooftopId } = card.event;
    if (!ROLLUP_KINDS.includes(kind)) {
      out.push({ anchor: card, cards: [card] });
      continue;
    }
    // Same kind, same lot, same calendar day. Two lots crossing 30 days on the
    // same morning are two different conversations.
    const key = `${kind}:${rooftopId}:${new Date(createdAt).toDateString()}`;
    const existing = index.get(key);
    if (existing) {
      existing.cards.push(card);
      // Events arrive newest first, so each new member is older than the last.
      existing.anchor = card;
    } else {
      const group: FeedGroup = { anchor: card, cards: [card] };
      index.set(key, group);
      out.push(group);
    }
  }

  return out;
}

/**
 * The feed itself. Scoped by rooftop, newest first. Everything a card needs is
 * fetched in five queries rather than N — a feed that N+1s is a feed that
 * feels slow, and a slow feed is a dashboard nobody opens.
 */
export async function getFeed(opts: {
  rooftopIds: string[];
  viewerId: string;
  limit?: number;
  kinds?: FeedEventKind[];
  /**
   * Reactions and comments. The log presentation does not render either, and
   * fetching them to throw them away is two queries per page view for nothing.
   * Defaults to true so the social path is unchanged.
   *
   * The rows are never *deleted* when this is false — a store that switches
   * from the log back to Lot Walk finds its old threads intact, because the
   * two views are presentations of one stream and not two products.
   */
  withSocial?: boolean;
}): Promise<FeedCard[]> {
  const { rooftopIds, viewerId } = opts;
  const withSocial = opts.withSocial ?? true;
  if (!rooftopIds.length) return [];
  const limit = opts.limit ?? 40;

  const where = opts.kinds?.length
    ? and(inArray(t.feedEvents.rooftopId, rooftopIds), inArray(t.feedEvents.kind, opts.kinds))
    : inArray(t.feedEvents.rooftopId, rooftopIds);

  const events = await db
    .select()
    .from(t.feedEvents)
    .where(where)
    .orderBy(desc(t.feedEvents.createdAt))
    .limit(limit);

  if (!events.length) return [];

  const eventIds = events.map((e) => e.id);
  const vehicleIds = [...new Set(events.map((e) => e.vehicleId).filter(Boolean))] as string[];
  const userIds = [
    ...new Set([...events.map((e) => e.actorId), ...events.map((e) => e.subjectUserId)].filter(Boolean)),
  ] as string[];

  const [vehicles, photos, people, reactions, comments, counts] = await Promise.all([
    vehicleIds.length
      ? db.select().from(t.vehicles).where(inArray(t.vehicles.id, vehicleIds))
      : Promise.resolve([]),
    vehicleIds.length
      ? db
          .select()
          .from(t.vehiclePhotos)
          .where(and(inArray(t.vehiclePhotos.vehicleId, vehicleIds), eq(t.vehiclePhotos.isPrimary, true)))
      : Promise.resolve([]),
    db
      .select({ id: t.users.id, name: t.users.name, role: t.users.role })
      .from(t.users)
      .where(userIds.length ? inArray(t.users.id, userIds) : sql`false`),
    withSocial
      ? db.select().from(t.feedReactions).where(inArray(t.feedReactions.eventId, eventIds))
      : Promise.resolve([]),
    withSocial
      ? db
          .select({
            id: t.feedComments.id,
            eventId: t.feedComments.eventId,
            body: t.feedComments.body,
            createdAt: t.feedComments.createdAt,
            author: t.users.name,
          })
          .from(t.feedComments)
          .innerJoin(t.users, eq(t.feedComments.userId, t.users.id))
          .where(inArray(t.feedComments.eventId, eventIds))
          .orderBy(t.feedComments.createdAt)
      : Promise.resolve([]),
    // Counts only, for the log. Cheaper than the thread — no join to users and
    // no bodies over the wire — but still enough that nothing goes missing.
    withSocial
      ? Promise.resolve([])
      : db
          .select({
            eventId: t.feedComments.eventId,
            n: sql<number>`count(*)::int`,
          })
          .from(t.feedComments)
          .where(inArray(t.feedComments.eventId, eventIds))
          .groupBy(t.feedComments.eventId),
  ]);

  const commentCountByEvent = new Map(counts.map((c) => [c.eventId, c.n]));

  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const photoByVehicle = new Map(photos.map((p) => [p.vehicleId, p.url]));
  const personById = new Map(people.map((p) => [p.id, p]));

  return events.map((event) => {
    const mine = reactions.filter((r) => r.eventId === event.id);
    const reactionCounts: FeedCard['reactions'] = (['THUMB', 'FIRE'] as const).map((kind) => ({
      kind,
      count: mine.filter((r) => r.kind === kind).length,
      mine: mine.some((r) => r.kind === kind && r.userId === viewerId),
    }));

    const thread = comments
      .filter((c) => c.eventId === event.id)
      .map(({ id, body, createdAt, author }) => ({ id, body, createdAt, author }));

    return {
      event,
      vehicle: event.vehicleId ? vehicleById.get(event.vehicleId) ?? null : null,
      photo: event.vehicleId ? photoByVehicle.get(event.vehicleId) ?? null : null,
      actor: event.actorId ? personById.get(event.actorId) ?? null : null,
      subject: event.subjectUserId ? personById.get(event.subjectUserId) ?? null : null,
      reactions: reactionCounts,
      comments: thread,
      commentCount: withSocial ? thread.length : commentCountByEvent.get(event.id) ?? 0,
    };
  });
}
