/**
 * Rooftop Auto — the home page's `<title>`, meta description and H1.
 *
 * "near me" is not something a page can say its way into: Google swaps it for
 * the searcher's location and answers from Business Profiles. What the site
 * adds is relevance — the words for what is on the lot, next to the town on
 * the lot's address (which must match the Business Profile). The business name
 * is the brand and goes last; "Malabar Truck and Trade" is in Palm Bay.
 *
 * The lineup comes from the inventory, so an RV lot says RVs and a truck lot
 * leads with Trucks, with no per-dealer setting to forget.
 *
 * Pure.
 */

import { clip } from './vdp-meta';

export type Place = { city: string; state: string } | null;

const GROUP: Record<string, string> = {
  TRUCK: 'Trucks', SUV: 'SUVs', VAN: 'Vans',
  SEDAN: 'Cars', COUPE: 'Cars', HATCHBACK: 'Cars', WAGON: 'Cars', CONVERTIBLE: 'Cars',
  TRAVEL_TRAILER: 'RVs', FIFTH_WHEEL: 'RVs', TOY_HAULER: 'RVs', POP_UP: 'RVs', TRUCK_CAMPER: 'RVs',
  CLASS_A: 'RVs', CLASS_B: 'RVs', CLASS_C: 'RVs',
};
/** Tie-break order, and the phrase used when the lot is empty. */
const ORDER = ['Cars', 'Trucks', 'SUVs', 'Vans', 'RVs'];
const FALLBACK = ['Cars', 'Trucks', 'SUVs'];
/** A group has to be at least this share of the lot to be named — one minivan doesn't make a van dealer. */
const MIN_SHARE = 0.1;

export function lineup(bodies: string[]): string {
  const counts = new Map<string, number>();
  for (const b of bodies) {
    const g = GROUP[b];
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const groups = total
    ? [...counts.entries()]
        .filter(([, n]) => n / total >= MIN_SHARE)
        .sort((a, b) => b[1] - a[1] || ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]))
        .slice(0, 3)
        .map(([g]) => g)
    : FALLBACK;
  if (groups.length === 1) return groups[0];
  return `${groups.slice(0, -1).join(', ')} & ${groups[groups.length - 1]}`;
}

const where = (p: Place) => (p?.city ? ` in ${p.city}${p.state ? `, ${p.state}` : ''}` : '');

/** H1: "Used Trucks, Cars & SUVs in Palm Bay, FL". */
export function homeHeading(words: string, place: Place): string {
  return `Used ${words}${where(place)}`;
}

/** `<title>`: search words and town first, brand last. */
export function homeTitle(words: string, place: Place, dealer: string): string {
  return `Used ${words} for Sale${where(place)} · ${dealer}`;
}

export const HOME_DESCRIPTION_MAX = 160;

export function homeDescription(
  words: string,
  place: Place,
  dealer: string,
  count: number,
  fromPrice: number | null,
  blurb: string | null,
  usd: (n: number) => string,
): string {
  const stock = count
    ? `: ${count} in stock${fromPrice != null && count > 1 ? `, from ${usd(fromPrice)}` : ''}`
    : '';
  const lead = `Used ${words} for sale at ${dealer}${where(place)}${stock}.`;
  const rest = (blurb ?? '').trim();
  return clip(rest ? `${lead} ${rest}` : lead, HOME_DESCRIPTION_MAX);
}
