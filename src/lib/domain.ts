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

/** Only front-line ready units belong on paid marketplaces. */
export function isSyndicatable(status: string) {
  return status === 'FRONT_LINE_READY' || status === 'PENDING_SALE' || status === 'PHOTOS_PENDING';
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
