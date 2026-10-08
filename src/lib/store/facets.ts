/**
 * Rooftop Auto — make, model and body-style landing pages.
 *
 * `/used/chevrolet`, `/used/chevrolet/silverado-1500`, `/used/trucks`.
 *
 * ## Why these exist
 *
 * "used silverado malabar" is the query a buyer types, and the home page with
 * `?make=Chevrolet` cannot rank for it: a query-string view canonicalises to the
 * home page, so as far as Google is concerned it is the home page. These are
 * real URLs with their own title, heading and canonical. They are also where
 * the old CarsForSale make / model / body URLs now 301 to — those carried years
 * of links, and pointing them at a filtered home page was throwing that away.
 *
 * ## `/used/` prefix
 *
 * A bare `/chevrolet` would share a URL space with stock numbers (`/491674`,
 * `/e4851`), and "is this a make or a stock number" is not a question a router
 * should have to answer from the database.
 *
 * ## Slugs, not names
 *
 * Inventory makes arrive however the DMS spells them — `GMC`, `Gmc`, `Sierra
 * 2500HD`, `Sierra 2500hd`. The URL is the slug; the page resolves it against
 * what is actually on the lot, so case and punctuation never decide whether a
 * page has cars on it.
 *
 * Pure. No database, so the routing is tested without one.
 */

import { BODY_LABEL } from '@/lib/domain';

export type FacetVehicle = { make: string; model: string; bodyStyle: string };

export type Facet =
  | { kind: 'make'; make: string; model: string | null; makeSlug: string; modelSlug: string | null }
  | { kind: 'body'; body: string; bodySlug: string };

export const FACET_PREFIX = '/used';

/** `Silverado 1500` → `silverado-1500`, `Mercedes-Benz` → `mercedes-benz`. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* Plural, because the page is about all of them. */
const BODY_SLUGS: Record<string, string> = {
  SEDAN: 'sedans', SUV: 'suvs', TRUCK: 'trucks', COUPE: 'coupes', HATCHBACK: 'hatchbacks',
  WAGON: 'wagons', VAN: 'minivans', CONVERTIBLE: 'convertibles',
  TRAVEL_TRAILER: 'travel-trailers', FIFTH_WHEEL: 'fifth-wheels', TOY_HAULER: 'toy-haulers',
  POP_UP: 'pop-up-campers', TRUCK_CAMPER: 'truck-campers',
  CLASS_A: 'class-a-motorhomes', CLASS_B: 'class-b-motorhomes', CLASS_C: 'class-c-motorhomes',
};
const BODY_PLURAL: Record<string, string> = {
  SEDAN: 'Sedans', SUV: 'SUVs', TRUCK: 'Trucks', COUPE: 'Coupes', HATCHBACK: 'Hatchbacks',
  WAGON: 'Wagons', VAN: 'Minivans', CONVERTIBLE: 'Convertibles',
  TRAVEL_TRAILER: 'Travel Trailers', FIFTH_WHEEL: 'Fifth Wheels', TOY_HAULER: 'Toy Haulers',
  POP_UP: 'Pop-Up Campers', TRUCK_CAMPER: 'Truck Campers',
  CLASS_A: 'Class A Motorhomes', CLASS_B: 'Class B Motorhomes', CLASS_C: 'Class C Motorhomes',
};
const BODY_BY_SLUG = Object.fromEntries(Object.entries(BODY_SLUGS).map(([k, v]) => [v, k]));

export function bodySlug(body: string): string | null {
  return BODY_SLUGS[body] ?? null;
}

export function makePath(make: string, model?: string | null): string {
  return model
    ? `${FACET_PREFIX}/${slugify(make)}/${slugify(model)}`
    : `${FACET_PREFIX}/${slugify(make)}`;
}

export function bodyPath(body: string): string | null {
  const s = bodySlug(body);
  return s ? `${FACET_PREFIX}/${s}` : null;
}

/** `sierra-2500hd` with nothing on the lot to name it → `Sierra 2500hd`. */
function unslug(s: string): string {
  return s
    .split('-')
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^[a-z]+$/.test(w) && !/[aeiou]/.test(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * The URL segments under `/used/` → what the page is about, or null for a URL
 * that is not one of these pages (404).
 *
 * A make or model with no car on the lot still resolves — named from the slug —
 * because the page must stay up when stock runs out: the old CarsForSale URLs
 * point here, and a 404 on Tuesday that comes back Friday is worse for ranking
 * than an honest "none right now".
 */
export function resolveFacet(parts: string[], inventory: FacetVehicle[]): Facet | null {
  const segs = parts.map((p) => decodeURIComponent(p).toLowerCase());
  if (!segs.length || segs.length > 2 || segs.some((s) => !/^[a-z0-9-]+$/.test(s))) return null;

  if (segs.length === 1 && BODY_BY_SLUG[segs[0]!]) {
    return { kind: 'body', body: BODY_BY_SLUG[segs[0]!]!, bodySlug: segs[0]! };
  }

  const [makeSlug, modelSlug = null] = segs as [string, string?];
  const sameMake = inventory.filter((v) => slugify(v.make) === makeSlug);
  const make = sameMake[0]?.make ?? unslug(makeSlug);
  let model: string | null = null;
  if (modelSlug) {
    model = sameMake.find((v) => slugify(v.model) === modelSlug)?.model ?? unslug(modelSlug);
  }
  return { kind: 'make', make, model, makeSlug, modelSlug };
}

export function facetPath(f: Facet): string {
  return f.kind === 'body'
    ? `${FACET_PREFIX}/${f.bodySlug}`
    : `${FACET_PREFIX}/${f.makeSlug}${f.modelSlug ? `/${f.modelSlug}` : ''}`;
}

export function matchesFacet(v: FacetVehicle, f: Facet): boolean {
  if (f.kind === 'body') return v.bodyStyle === f.body;
  if (slugify(v.make) !== f.makeSlug) return false;
  return !f.modelSlug || slugify(v.model) === f.modelSlug;
}

/** What the page is called, in the order somebody types it. */
export function facetName(f: Facet): string {
  if (f.kind === 'body') return BODY_PLURAL[f.body] ?? BODY_LABEL[f.body] ?? f.body;
  return f.model ? `${f.make} ${f.model}` : f.make;
}

export function facetHeading(f: Facet, place: { city: string; state: string } | null): string {
  const where = place?.city ? ` in ${place.city}${place.state ? `, ${place.state}` : ''}` : '';
  return `Used ${facetName(f)}${where}`;
}

/** One line of real numbers. No filler — the count and the floor price are the pitch. */
export function facetLine(count: number, dealer: string, fromPrice: number | null, usd: (n: number) => string): string {
  if (!count) return `None in stock at ${dealer} right now.`;
  const from = fromPrice != null && count > 1 ? `, from ${usd(fromPrice)}` : '';
  return `${count} in stock at ${dealer}${from}.`;
}

export type FacetLink = { path: string; label: string; count: number };

/**
 * Every make, make + model and body page that has at least one car behind it —
 * the sitemap's list, and (makes only) the "Shop by make" row.
 */
export function facetLinks(inventory: FacetVehicle[]): { makes: FacetLink[]; models: FacetLink[]; bodies: FacetLink[] } {
  const makes = new Map<string, FacetLink>();
  const models = new Map<string, FacetLink>();
  const bodies = new Map<string, FacetLink>();
  const bump = (m: Map<string, FacetLink>, path: string, label: string) => {
    const cur = m.get(path);
    if (cur) cur.count += 1;
    else m.set(path, { path, label, count: 1 });
  };
  for (const v of inventory) {
    if (!slugify(v.make)) continue;
    bump(makes, makePath(v.make), v.make);
    if (slugify(v.model)) bump(models, makePath(v.make, v.model), `${v.make} ${v.model}`);
    const bp = bodyPath(v.bodyStyle);
    if (bp) bump(bodies, bp, BODY_PLURAL[v.bodyStyle]!);
  }
  const sorted = (m: Map<string, FacetLink>) => [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { makes: sorted(makes), models: sorted(models), bodies: sorted(bodies) };
}
