/**
 * Dealer domain math. Every number a dealer already tracks lives here so the
 * admin, the storefront and the reporting page can never disagree.
 */

import type { Vehicle } from '@/db/schema';

export const DAY = 86_400_000;

/* ------------------------------------------------------------------ aging */

export const AGING_BUCKETS = [
  { key: '0-15', label: '0–15', min: 0, max: 15, tone: 'fresh' },
  { key: '16-30', label: '16–30', min: 16, max: 30, tone: 'ok' },
  { key: '31-45', label: '31–45', min: 31, max: 45, tone: 'warn' },
  { key: '46-60', label: '46–60', min: 46, max: 60, tone: 'hot' },
  { key: '61+', label: '61+', min: 61, max: Infinity, tone: 'aged' },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]['key'];
export type AgingTone = (typeof AGING_BUCKETS)[number]['tone'];

/**
 * Two clocks, because the lot argues about this.
 *  - dateIn: days since the unit was acquired. Slow recon shows up as aging.
 *  - frontLine: days since it was actually retail-ready.
 */
export type DisMode = 'dateIn' | 'frontLine';

export function daysInStock(
  v: Pick<Vehicle, 'acquiredDate' | 'frontLineDate' | 'soldDate'>,
  mode: DisMode = 'dateIn',
  now: Date = new Date(),
): number {
  const end = v.soldDate ? new Date(v.soldDate).getTime() : now.getTime();
  const startRaw = mode === 'frontLine' ? v.frontLineDate ?? null : v.acquiredDate;
  if (!startRaw) return 0; // not front line yet — zero days on the front line
  const start = new Date(startRaw).getTime();
  return Math.max(0, Math.floor((end - start) / DAY));
}

export function bucketFor(days: number) {
  return AGING_BUCKETS.find((b) => days >= b.min && days <= b.max) ?? AGING_BUCKETS[4];
}

/** At-risk = 30–45 days. Past 45 it is no longer at risk, it is a problem. */
export function isAtRisk(days: number) {
  return days >= 30 && days <= 45;
}

export function isAged(days: number) {
  return days >= 61;
}

export function isFreshAir(days: number) {
  return days <= 15;
}

/**
 * Should the storefront badge anything "Just arrived" at all?
 *
 * The badge is driven by `acquiredDate`, and for an imported lot every row got
 * `acquiredDate = the moment of the import` — deliberately, because nothing in a
 * syndication export says when the dealer bought the car and inventing a date
 * would put fake numbers on the aging report (see `claude/inventory-import.md`).
 *
 * The side effect only shows up on the public site: for the first two weeks
 * after a migration, **every unit on the lot wears "Just arrived"**, including a
 * truck that has been sitting for eight months. That is both a false claim to a
 * buyer and a badge that means nothing, since it is on everything.
 *
 * So the badge is suppressed when it would apply to most of the inventory. A
 * label on nine cars out of ten is not news, it is wallpaper — and the shape of
 * "almost all of it arrived at once" is exactly the import signature. This
 * heals itself: as real units arrive over the following weeks the proportion
 * falls, and the badge starts working without anybody doing anything.
 *
 * Chosen over adding an `acquiredDateIsEstimate` column because the column
 * would need a migration and a backfill, and would still be wrong for a dealer
 * who imported once and then genuinely bought ten cars in a week.
 */
export const FRESH_AIR_BADGE_CEILING = 0.4;

export function shouldBadgeFreshAir(freshCount: number, totalCount: number): boolean {
  if (totalCount === 0) return false;
  return freshCount / totalCount <= FRESH_AIR_BADGE_CEILING;
}

/* ------------------------------------------------------------------ money */

/** Total money in the unit. Internal only — never syndicate this. */
export function totalCost(v: Pick<Vehicle, 'cost' | 'pack' | 'reconCost'>) {
  return v.cost + v.pack + v.reconCost;
}

/** A water unit is one where you are into it deeper than the market will pay. */
export function isWaterUnit(
  v: Pick<Vehicle, 'cost' | 'pack' | 'reconCost' | 'marketValue'>,
) {
  return v.marketValue > 0 && totalCost(v) > v.marketValue;
}

/**
 * Do we actually know what this unit cost us?
 *
 * A CSV import carries price and mileage but almost never cost, so an imported
 * lot lands with `cost`, `pack` and `reconCost` all zero — and then
 * `grossPotential` returns the full asking price and every screen paints it
 * green. Zero cost is not a cheap car, it is a missing number, and the two must
 * never render the same way.
 *
 * `isWaterUnit` has the quieter version of this: with no cost it can never be
 * true, so an unknown unit is silently "fine".
 */
export function hasCost(v: Pick<Vehicle, 'cost' | 'pack' | 'reconCost'>) {
  return totalCost(v) > 0;
}

export function grossPotential(
  v: Pick<Vehicle, 'cost' | 'pack' | 'reconCost' | 'price' | 'salePrice'>,
) {
  return (v.salePrice ?? v.price) - totalCost(v);
}

export function activePrice(v: Pick<Vehicle, 'price' | 'salePrice'>) {
  return v.salePrice ?? v.price;
}

/** Percent of market. Under 100 is priced below market. */
export function priceToMarket(v: Pick<Vehicle, 'price' | 'salePrice' | 'marketValue'>) {
  if (!v.marketValue) return null;
  return Math.round((activePrice(v) / v.marketValue) * 1000) / 10;
}

/* -------------------------------------------------------------- reporting */

/**
 * Days supply = current front-line inventory ÷ average units retailed per day.
 * Independents generally live between 45 and 60.
 */
export function daysSupply(inventoryCount: number, unitsSold: number, overDays: number) {
  if (unitsSold <= 0) return null;
  return Math.round((inventoryCount / (unitsSold / overDays)) * 10) / 10;
}

/**
 * Turn rate = annualised units retailed ÷ average inventory carried.
 * 12–15x is strong; the top operators run 22.
 */
export function turnRate(unitsSold: number, overDays: number, avgInventory: number) {
  if (avgInventory <= 0 || overDays <= 0) return null;
  const annualised = unitsSold * (365 / overDays);
  return Math.round((annualised / avgInventory) * 10) / 10;
}

export const TURN_BENCHMARK = { strong: 12, elite: 22 };
export const RECON_TARGET_DAYS = 7;

/* ------------------------------------------------------------- formatting */

export const usd = (n: number | null | undefined) => {
  if (n == null) return '—';
  const v = Math.round(n);
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
};

export const usdExact = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const miles = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('en-US')} mi`;

export const num = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US');

export function vehicleTitle(v: Pick<Vehicle, 'year' | 'make' | 'model' | 'trim'>) {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
}

export function shortTitle(v: Pick<Vehicle, 'year' | 'make' | 'model'>) {
  return `${v.year} ${v.make} ${v.model}`;
}

export function relativeTime(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return 'never';
  const ms = now.getTime() - new Date(d).getTime();
  if (ms < 0) {
    const ahead = -ms;
    if (ahead < 60_000) return 'in under a minute';
    if (ahead < 3_600_000) return `in ${Math.round(ahead / 60_000)} min`;
    if (ahead < 86_400_000) return `in ${Math.round(ahead / 3_600_000)} hr`;
    return `in ${Math.round(ahead / 86_400_000)} d`;
  }
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} hr ago`;
  return `${Math.round(ms / 86_400_000)} d ago`;
}

/* ------------------------------------------------------------ status copy */

export const VEHICLE_STATUS_LABEL: Record<string, string> = {
  ARRIVED: 'Arrived',
  IN_RECON: 'In recon',
  PHOTOS_PENDING: 'Photos pending',
  FRONT_LINE_READY: 'Front-line ready',
  PENDING_SALE: 'Pending sale',
  SOLD: 'Sold',
  WHOLESALED: 'Wholesaled',
};

export const SYNC_STATUS_LABEL: Record<string, string> = {
  NOT_LISTED: 'Not listed',
  PENDING: 'Pending',
  QUEUED: 'Queued',
  SYNCING: 'Syncing',
  LIVE: 'Live',
  ERROR: 'Error',
  REMOVED: 'Removed',
  EXCLUDED: 'Excluded',
};

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  CONNECTED: 'Live',
  PENDING_SETUP: 'Not set up',
  AWAITING_DEALER: 'Waiting on you',
  SUBMITTED: 'Submitted',
  DISCONNECTED: 'Not connected',
  ERROR: 'Needs attention',
};

/**
 * The same states, said to ourselves rather than to the dealer.
 *
 * "Waiting on you" is correct on the dealer's screen and useless on ours — the
 * whole point of splitting the middle states is that each one names a different
 * queue, and the internal queue board needs the other half of the sentence.
 */
export const CONNECTION_STATUS_INTERNAL: Record<string, string> = {
  CONNECTED: 'Live',
  PENDING_SETUP: 'Not started',
  AWAITING_DEALER: 'Waiting on dealer',
  SUBMITTED: 'Waiting on channel',
  DISCONNECTED: 'Not connected',
  ERROR: 'Needs attention',
};

/**
 * Is this connection actually carrying listings?
 *
 * Written as a positive set rather than a list of exclusions, and that is the
 * whole point. The three call sites of this test used to spell it
 * `DISCONNECTED || PENDING_SETUP`, so when migration `0009` split the middle of
 * the lifecycle into AWAITING_DEALER and SUBMITTED, every one of them silently
 * started treating a connection nobody has submitted yet as live. A dealer who
 * has not yet named us to their CarGurus rep would have had sync rows queued
 * against a channel that has never heard of them.
 *
 * ERROR counts as carrying. It means a connection that was live and broke, so
 * its listings are presumably still up and its vehicles still have sync state —
 * `sync-engine.ts` handles it a few lines further on, by refusing the change and
 * saying why. That is a different thing from a channel that was never wired up.
 *
 * Anything added to `connectionStatusEnum` later is not carrying until someone
 * adds it here on purpose, which is the safe direction to fail.
 */
const CARRYING_CONNECTION_STATUSES = new Set(['CONNECTED', 'ERROR']);

export function carriesListings(status: string): boolean {
  return CARRYING_CONNECTION_STATUSES.has(status);
}

/**
 * The statuses a unit is publicly visible in.
 *
 * This is one list doing two jobs that are genuinely the same job: what goes out
 * to a paid marketplace, and what the dealer's own storefront renders. The
 * storefront had its own copy of this set — inline in `s/[slug]/page.tsx`,
 * inline again in `s/[slug]/[stock]/page.tsx`, and once more as
 * `PUBLIC_STATUSES` in `domains/units.ts` — three copies of a list that must
 * agree with this function or a car is on the website and not in the feed.
 */
export const SYNDICATABLE_STATUSES = [
  'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE',
] as const;

/** Only front-line ready units belong on paid marketplaces, or on the storefront. */
export function isSyndicatable(status: string) {
  return (SYNDICATABLE_STATUSES as readonly string[]).includes(status);
}

export const DRIVETRAIN_LABEL: Record<string, string> = {
  FWD: 'FWD', RWD: 'RWD', AWD: 'AWD', FOUR_WD: '4WD',
};

export const TRANSMISSION_LABEL: Record<string, string> = {
  AUTOMATIC: 'Automatic', MANUAL: 'Manual', CVT: 'CVT',
};

export const BODY_LABEL: Record<string, string> = {
  SEDAN: 'Sedan', SUV: 'SUV', TRUCK: 'Truck', COUPE: 'Coupe',
  HATCHBACK: 'Hatchback', WAGON: 'Wagon', VAN: 'Minivan', CONVERTIBLE: 'Convertible',
};

export const FUEL_LABEL: Record<string, string> = {
  GAS: 'Gasoline', DIESEL: 'Diesel', HYBRID: 'Hybrid',
  PLUGIN_HYBRID: 'Plug-in Hybrid', ELECTRIC: 'Electric', FLEX: 'Flex Fuel',
};

/** Rough monthly payment for the VDP calculator. */
export function monthlyPayment(price: number, down: number, apr: number, months: number) {
  const principal = Math.max(0, price - down);
  const r = apr / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

/**
 * Rooftops are named "<Group> — <Location>" so they read correctly on their
 * own. Inside the admin, where the group is already in the chrome, strip the
 * prefix. Works for any tenant; the old hardcoded "Rooftop Demo Motors — " did not.
 */
export function shortRooftopName(rooftopName: string, groupName?: string) {
  if (groupName) {
    for (const dash of [' — ', ' - ', ' ']) {
      const prefix = `${groupName}${dash}`;
      if (rooftopName.startsWith(prefix)) return rooftopName.slice(prefix.length) || rooftopName;
    }
  }
  /**
   * The exact-prefix test above only fires when the group name is a literal
   * prefix of the rooftop name, and real data does not cooperate: the seeded
   * group is "Rooftop Demo Motors Group" while its lots are "Rooftop Demo Motors —
   * Vancouver", so every caller was rendering the full name. Fall back to the
   * separator the naming convention itself defines — "<Group> — <Location>" —
   * which gets "Vancouver" out of that pair and leaves an undashed name like
   * "Bob's Autos" alone.
   */
  for (const dash of [' — ', ' – ', ' - ']) {
    const at = rooftopName.indexOf(dash);
    if (at > 0) return rooftopName.slice(at + dash.length) || rooftopName;
  }
  return rooftopName;
}
