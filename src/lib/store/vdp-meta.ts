/**
 * Rooftop Auto — the `<title>` and meta description of a vehicle page.
 *
 * The title is what a phone shows in search results, and it shows about the
 * first sixty characters. So the words a buyer typed come first — used, year,
 * make, model, town — and the stock number, which nobody searches for, is not
 * in it at all. The layout's template appends the dealer name after it.
 *
 * The description leads with the facts that decide a click (miles, price, where)
 * and then fills with the dealer's own words, cut on a word boundary. A DMS
 * description is often a wall of options or boilerplate; on its own it would
 * spend the whole snippet before saying what the truck costs.
 *
 * Pure.
 */

export type VdpMetaInput = {
  year: number;
  make: string;
  model: string;
  trim: string | null;
  /** null when the unit has no odometer (towable RVs). */
  mileage: number | null;
  price: number;
  city: string;
  state: string;
  dealer: string;
  description: string | null;
};

/** Year + make + model always; trim only while it still fits. */
const NAME_BUDGET = 42;
export const DESCRIPTION_MAX = 160;

export function vdpTitle(v: Pick<VdpMetaInput, 'year' | 'make' | 'model' | 'trim' | 'city' | 'state'>): string {
  const base = [v.year, v.make, v.model].filter(Boolean).join(' ');
  const trim = (v.trim ?? '').trim();
  const name = trim && `${base} ${trim}`.length <= NAME_BUDGET ? `${base} ${trim}` : base;
  const where = v.city ? ` in ${v.city}${v.state ? `, ${v.state}` : ''}` : '';
  return `Used ${name} for Sale${where}`;
}

/** Cut to `max` on a word boundary, with an ellipsis when anything was dropped. */
export function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, '')}…`;
}

export function vdpDescription(v: VdpMetaInput, fmt: { miles: (n: number) => string; usd: (n: number) => string }): string {
  const name = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
  const facts = [
    v.mileage != null && v.mileage > 0 ? fmt.miles(v.mileage) : null,
    v.price > 0 ? fmt.usd(v.price) : null,
  ].filter(Boolean);
  const where = v.city ? ` in ${v.city}${v.state ? `, ${v.state}` : ''}` : '';
  const lead = `${name}${facts.length ? `, ${facts.join(', ')}` : ''} at ${v.dealer}${where}.`;

  const own = (v.description ?? '').replace(/\s+/g, ' ').trim();
  if (!own || lead.length >= DESCRIPTION_MAX - 20) return clip(lead, DESCRIPTION_MAX);
  return clip(`${lead} ${own}`, DESCRIPTION_MAX);
}
