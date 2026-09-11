/**
 * What narrows a shelf, in three forms: Meta's, ours, and English.
 *
 * PURE, AND NOT `server-only`. The dealer needs the car count to move as they
 * type, and a round trip per keystroke is both slow and, on a lot with signal
 * problems, indistinguishable from a broken field. So the same matcher runs in
 * the browser against a small list of units the page already has, and on the
 * server when the product set is built. One definition, two callers — the
 * alternative is a count that disagrees with the ad set, which is the kind of
 * lie a dealer only catches after a week of spend.
 *
 * TWO META TRAPS ARE ENCODED HERE, both from the product-set reference:
 *
 *  - Mileage is `mileage_value` in a product-set filter and `mileage.value` in
 *    the feed. The nested spelling in a filter matches nothing, silently.
 *  - `price` in a vehicles catalog carries a currency ("34995 USD"), so a
 *    numeric comparison against it is the documented way to build a set that
 *    quietly holds nothing. We filter on `custom_number_0` instead, which the
 *    feed now writes as whole dollars and which Meta documents as the field for
 *    exactly this — "filter by number ranges when you create sets".
 */

import type { AdGroupFilters } from '@/db/schema';

export type { AdGroupFilters };

/** The subset of Meta's `body_style` enum a used lot actually stocks. */
export const BODY_STYLES = [
  { key: 'TRUCK', label: 'Truck' },
  { key: 'SUV', label: 'SUV' },
  { key: 'SEDAN', label: 'Sedan' },
  { key: 'CROSSOVER', label: 'Crossover' },
  { key: 'COUPE', label: 'Coupe' },
  { key: 'HATCHBACK', label: 'Hatchback' },
  { key: 'MINIVAN', label: 'Minivan' },
  { key: 'VAN', label: 'Van' },
  { key: 'WAGON', label: 'Wagon' },
  { key: 'CONVERTIBLE', label: 'Convertible' },
] as const;

export const EMPTY_FILTERS: AdGroupFilters = {};

/** One car, reduced to the fields a filter can see. */
export type TargetableUnit = {
  days: number;
  year: number;
  make: string;
  body: string;
  miles: number;
  price: number;
};

export function hasAnyFilter(f: AdGroupFilters): boolean {
  return Boolean(
    f.bodyStyles?.length ||
      f.makes?.length ||
      f.yearMin != null ||
      f.yearMax != null ||
      f.mileageMax != null ||
      f.priceMax != null,
  );
}

/** Does this car belong in the group? Mirrors `metaFilterClauses` exactly. */
export function unitMatches(u: TargetableUnit, f: AdGroupFilters): boolean {
  if (f.bodyStyles?.length && !f.bodyStyles.includes(u.body)) return false;
  // Make is compared case-insensitively because Meta's `eq` is, and because a
  // feed that says "GMC" and a picker that says "Gmc" is not a difference any
  // dealer would accept as a reason for an empty group.
  if (f.makes?.length && !f.makes.some((m) => m.toLowerCase() === u.make.toLowerCase())) {
    return false;
  }
  if (f.yearMin != null && u.year < f.yearMin) return false;
  if (f.yearMax != null && u.year > f.yearMax) return false;
  if (f.mileageMax != null && u.miles > f.mileageMax) return false;
  if (f.priceMax != null && u.price > f.priceMax) return false;
  return true;
}

/** The extra clauses to `and` onto the shelf's own, in Meta's grammar. */
export function metaFilterClauses(f: AdGroupFilters): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  if (f.bodyStyles?.length) out.push({ body_style: { is_any: f.bodyStyles } });
  if (f.makes?.length) out.push({ make: { is_any: f.makes } });
  if (f.yearMin != null) out.push({ year: { gte: f.yearMin } });
  if (f.yearMax != null) out.push({ year: { lte: f.yearMax } });
  if (f.mileageMax != null) out.push({ mileage_value: { lte: f.mileageMax } });
  if (f.priceMax != null) out.push({ custom_number_0: { lte: f.priceMax } });

  return out;
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`;

/** The filters as a dealer would say them. Empty string when nothing is set. */
export function describeFilters(f: AdGroupFilters): string {
  const bits: string[] = [];
  if (f.bodyStyles?.length) {
    bits.push(
      f.bodyStyles
        .map((b) => BODY_STYLES.find((x) => x.key === b)?.label ?? b)
        .join(', '),
    );
  }
  if (f.makes?.length) bits.push(f.makes.join(', '));
  if (f.priceMax != null) bits.push(`under ${money(f.priceMax)}`);
  if (f.mileageMax != null) bits.push(`under ${f.mileageMax.toLocaleString('en-US')} miles`);
  if (f.yearMin != null && f.yearMax != null) bits.push(`${f.yearMin}–${f.yearMax}`);
  else if (f.yearMin != null) bits.push(`${f.yearMin} and newer`);
  else if (f.yearMax != null) bits.push(`${f.yearMax} and older`);
  return bits.join(' · ');
}

/**
 * A name built from the rule, offered to the dealer rather than imposed.
 *
 * "Trucks under $25,000" is what they would have typed, and a field that fills
 * itself correctly is the difference between naming every group and naming
 * none of them. They can always overwrite it.
 */
export function suggestName(shelfLabel: string, f: AdGroupFilters): string {
  const described = describeFilters(f);
  if (!described) return shelfLabel;

  const parts: string[] = [];
  if (f.bodyStyles?.length === 1) {
    const one = BODY_STYLES.find((x) => x.key === f.bodyStyles![0]);
    parts.push(one ? `${one.label}s` : f.bodyStyles[0]!);
  } else if (f.bodyStyles?.length) {
    parts.push(
      f.bodyStyles.map((b) => BODY_STYLES.find((x) => x.key === b)?.label ?? b).join(' & '),
    );
  } else if (f.makes?.length) {
    parts.push(f.makes.join(' & '));
  } else {
    parts.push('Vehicles');
  }

  if (f.priceMax != null) parts.push(`under ${money(f.priceMax)}`);
  else if (f.mileageMax != null) parts.push(`under ${f.mileageMax.toLocaleString('en-US')} miles`);
  else if (f.yearMin != null) parts.push(`${f.yearMin} and newer`);

  return parts.join(' ').slice(0, 80);
}

/** Read a filter set off a form. Blank means absent, which means no clause. */
export function readFilters(formData: FormData): AdGroupFilters {
  const num = (k: string): number | null => {
    const raw = String(formData.get(k) ?? '').replace(/[^0-9]/g, '');
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const list = (k: string): string[] =>
    String(formData.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const f: AdGroupFilters = {};
  const bodies = list('f.bodyStyles').filter((b) => BODY_STYLES.some((x) => x.key === b));
  if (bodies.length) f.bodyStyles = bodies;
  const makes = list('f.makes');
  if (makes.length) f.makes = makes;
  const yearMin = num('f.yearMin');
  if (yearMin) f.yearMin = yearMin;
  const yearMax = num('f.yearMax');
  if (yearMax) f.yearMax = yearMax;
  const mileageMax = num('f.mileageMax');
  if (mileageMax) f.mileageMax = mileageMax;
  const priceMax = num('f.priceMax');
  if (priceMax) f.priceMax = priceMax;
  return f;
}

/** Refuse a rule that cannot work before it costs anything. */
export function validateFilters(f: AdGroupFilters): string | null {
  if (f.yearMin != null && f.yearMax != null && f.yearMin > f.yearMax) {
    return 'The year range runs backwards — the first year has to be the earlier one.';
  }
  if (f.yearMin != null && (f.yearMin < 1900 || f.yearMin > 2100)) return 'That year is not a year.';
  if (f.yearMax != null && (f.yearMax < 1900 || f.yearMax > 2100)) return 'That year is not a year.';
  return null;
}
