import Link from 'next/link';
import type { LiveVehicle } from '@/lib/queries';
import { BODY_LABEL, DRIVETRAIN_LABEL, activePrice, miles, usd } from '@/lib/domain';
import { cn } from '@/components/ui';

/* --------------------------------------------------------------- contract */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type SortKey = 'newest' | 'price-asc' | 'price-desc' | 'miles-asc' | 'year-desc';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest listed' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'miles-asc', label: 'Lowest mileage' },
  { key: 'year-desc', label: 'Newest year' },
];

export type Filters = {
  q: string;
  make: string;
  model: string;
  body: string;
  drivetrain: string;
  minPrice: number | null;
  maxPrice: number | null;
  maxMiles: number | null;
  minYear: number | null;
  /* RV. Opposite polarity on purpose, because the questions are opposite:
   * length is a ceiling — "will it fit my site, can my truck pull it" — and
   * sleeps is a floor — "does it hold my family". Getting either backwards
   * gives an answer that is precisely useless. */
  maxLengthFt: number | null;
  minSleeps: number | null;
  sort: SortKey;
};

/** Filter keys that show up as a clearable pill. `sort` is not a filter. */
export const FILTER_KEYS = [
  'q', 'make', 'model', 'body', 'drivetrain', 'minPrice', 'maxPrice', 'maxMiles', 'minYear',
  'maxLengthFt', 'minSleeps',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/* ---------------------------------------------------------------- parsing */

function first(sp: RawSearchParams, key: string): string {
  const raw = sp[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').trim();
}

function intOrNull(sp: RawSearchParams, key: string): number | null {
  const cleaned = first(sp, key).replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseFilters(sp: RawSearchParams): Filters {
  const sortRaw = first(sp, 'sort');
  const sort = SORTS.some((s) => s.key === sortRaw) ? (sortRaw as SortKey) : 'newest';
  return {
    q: first(sp, 'q'),
    make: first(sp, 'make'),
    model: first(sp, 'model'),
    body: first(sp, 'body'),
    drivetrain: first(sp, 'drivetrain'),
    minPrice: intOrNull(sp, 'minPrice'),
    maxPrice: intOrNull(sp, 'maxPrice'),
    maxMiles: intOrNull(sp, 'maxMiles'),
    maxLengthFt: intOrNull(sp, 'maxLengthFt'),
    minSleeps: intOrNull(sp, 'minSleeps'),
    minYear: intOrNull(sp, 'minYear'),
    sort,
  };
}

export function activeFilterCount(f: Filters): number {
  return FILTER_KEYS.filter((k) => f[k] !== '' && f[k] !== null).length;
}

/* -------------------------------------------------------------- filtering */

/** `skip` lets us count a facet's options against every *other* filter. */
export function matchesFilters(
  v: LiveVehicle,
  f: Filters,
  skip?: 'make' | 'body' | 'drivetrain',
): boolean {
  if (f.q) {
    const hay = `${v.year} ${v.make} ${v.model} ${v.trim} ${v.stockNumber} ${v.vin ?? ''}`.toLowerCase();
    for (const term of f.q.toLowerCase().split(/\s+/).filter(Boolean)) {
      if (!hay.includes(term)) return false;
    }
  }
  if (skip !== 'make') {
    if (f.make && v.make !== f.make) return false;
    if (f.model && v.model !== f.model) return false;
  }
  if (skip !== 'body' && f.body && v.bodyStyle !== f.body) return false;
  if (skip !== 'drivetrain' && f.drivetrain && v.drivetrain !== f.drivetrain) return false;

  const price = activePrice(v);
  if (f.minPrice != null && price < f.minPrice) return false;
  if (f.maxPrice != null && price > f.maxPrice) return false;
  if (f.maxMiles != null && v.mileage > f.maxMiles) return false;
  if (f.minYear != null && v.year < f.minYear) return false;

  /* A unit with no measurement recorded is EXCLUDED, not included, whenever one
   * of these is set. Both are hard constraints — a 32-foot site and a family of
   * six — and "we never wrote the length down" is not evidence that it fits.
   * The permissive reading would put units in a result set the shopper has just
   * said they cannot use, which is worse than a short list. */
  if (f.maxLengthFt != null && (v.rvLengthFt == null || v.rvLengthFt > f.maxLengthFt)) return false;
  if (f.minSleeps != null && (v.rvSleeps == null || v.rvSleeps < f.minSleeps)) return false;
  return true;
}

const listedAt = (v: LiveVehicle) =>
  new Date(v.frontLineDate ?? v.acquiredDate).getTime();

export function sortVehicles(list: LiveVehicle[], sort: SortKey): LiveVehicle[] {
  const out = [...list];
  switch (sort) {
    case 'price-asc':
      return out.sort((a, b) => activePrice(a) - activePrice(b));
    case 'price-desc':
      return out.sort((a, b) => activePrice(b) - activePrice(a));
    case 'miles-asc':
      return out.sort((a, b) => a.mileage - b.mileage);
    case 'year-desc':
      return out.sort((a, b) => b.year - a.year || a.mileage - b.mileage);
    default:
      return out.sort((a, b) => listedAt(b) - listedAt(a));
  }
}

/* ------------------------------------------------------------------- urls */

export function buildHref(
  base: string,
  sp: RawSearchParams,
  changes: Record<string, string | null>,
): string {
  const p = new URLSearchParams();
  for (const [k, raw] of Object.entries(sp)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) p.set(k, value);
  }
  for (const [k, value] of Object.entries(changes)) {
    if (value === null || value === '') p.delete(k);
    else p.set(k, value);
  }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

export function pillLabel(key: FilterKey, f: Filters): string {
  switch (key) {
    case 'q': return `“${f.q}”`;
    case 'make': return f.make;
    case 'model': return f.model;
    case 'body': return BODY_LABEL[f.body] ?? f.body;
    case 'drivetrain': return DRIVETRAIN_LABEL[f.drivetrain] ?? f.drivetrain;
    case 'minPrice': return `${usd(f.minPrice)} and up`;
    case 'maxPrice': return `Up to ${usd(f.maxPrice)}`;
    case 'maxMiles': return `Under ${miles(f.maxMiles)}`;
    case 'minYear': return `${f.minYear} and newer`;
    case 'maxLengthFt': return `${f.maxLengthFt} ft or less`;
    case 'minSleeps': return `Sleeps ${f.minSleeps}+`;
  }
}

/* ------------------------------------------------------------------- form */

export type FacetOption = { value: string; label: string; count: number };

const MILEAGE_STEPS = [25_000, 50_000, 75_000, 100_000, 125_000, 150_000];
/* Campground and towing thresholds, not round numbers for their own sake: many
 * state parks cap around 30 ft, and half-ton trucks run out of tongue weight
 * well before 35. */
const LENGTH_STEPS = [20, 25, 30, 35, 40, 45];
const SLEEPS_STEPS = [2, 4, 6, 8, 10];

const fieldClass =
  'w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2.5 py-2 text-sm text-[var(--text)] ' +
  'focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/20';

const labelClass = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]';

function Facet({
  idPrefix,
  name,
  label,
  value,
  options,
  anyLabel,
}: {
  idPrefix: string;
  name: string;
  label: string;
  value: string;
  options: FacetOption[];
  anyLabel: string;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={`${idPrefix}-${name}`}>
        {label}
      </label>
      <select id={`${idPrefix}-${name}`} name={name} defaultValue={value} className={fieldClass}>
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );
}

export function SrpFilters({
  idPrefix,
  basePath,
  filters,
  makes,
  models,
  bodies,
  drivetrains,
  years,
  showAuto,
  showRv,
  className,
}: {
  /** the rail renders twice (mobile drawer + desktop), so ids must not collide */
  idPrefix: string;
  basePath: string;
  filters: Filters;
  makes: FacetOption[];
  models: FacetOption[];
  bodies: FacetOption[];
  drivetrains: FacetOption[];
  years: number[];
  /* Which questions this lot can answer, derived from what is actually on it —
   * see `s/[slug]/page.tsx`. An RV lot is not asked about drivetrain or
   * odometer, a car lot is not asked how many it sleeps, and a lot carrying
   * both is asked everything. Derived rather than configured: it cannot go
   * stale, and it needs nobody to have set it up correctly. */
  showAuto: boolean;
  showRv: boolean;
  className?: string;
}) {
  return (
    <form method="get" action={basePath} className={cn('space-y-4', className)}>
      <input type="hidden" name="sort" value={filters.sort} />

      <div>
        <label className={labelClass} htmlFor={`${idPrefix}-q`}>
          Search
        </label>
        <input
          id={`${idPrefix}-q`}
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Year, make, model, stock or VIN"
          className={fieldClass}
        />
      </div>

      <Facet idPrefix={idPrefix} name="make" label="Make" value={filters.make} options={makes} anyLabel="All makes" />
      <Facet
        idPrefix={idPrefix}
        name="model"
        label="Model"
        value={filters.model}
        options={models}
        anyLabel={filters.make ? `All ${filters.make} models` : 'All models'}
      />
      <Facet
        idPrefix={idPrefix}
        name="body"
        label={showRv && !showAuto ? 'RV type' : 'Body style'}
        value={filters.body}
        options={bodies}
        anyLabel={showRv && !showAuto ? 'All RV types' : 'All body styles'}
      />
      {showAuto ? (
        <Facet
          idPrefix={idPrefix}
          name="drivetrain"
          label="Drivetrain"
          value={filters.drivetrain}
          options={drivetrains}
          anyLabel="Any drivetrain"
        />
      ) : null}

      {showRv ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-maxLengthFt`}>
              Max length
            </label>
            <select
              id={`${idPrefix}-maxLengthFt`}
              name="maxLengthFt"
              defaultValue={filters.maxLengthFt ? String(filters.maxLengthFt) : ''}
              className={cn(fieldClass, 'tnum')}
            >
              <option value="">Any</option>
              {LENGTH_STEPS.map((n) => (
                <option key={n} value={n}>{n} ft</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-minSleeps`}>
              Sleeps at least
            </label>
            <select
              id={`${idPrefix}-minSleeps`}
              name="minSleeps"
              defaultValue={filters.minSleeps ? String(filters.minSleeps) : ''}
              className={cn(fieldClass, 'tnum')}
            >
              <option value="">Any</option>
              {SLEEPS_STEPS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div>
        <span className={labelClass}>Price</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            name="minPrice"
            min={0}
            step={500}
            defaultValue={filters.minPrice ?? ''}
            placeholder="Min"
            aria-label="Minimum price"
            className={cn(fieldClass, 'tnum')}
          />
          <span className="text-[var(--text-3)]">to</span>
          <input
            type="number"
            inputMode="numeric"
            name="maxPrice"
            min={0}
            step={500}
            defaultValue={filters.maxPrice ?? ''}
            placeholder="Max"
            aria-label="Maximum price"
            className={cn(fieldClass, 'tnum')}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {showAuto ? (
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-maxMiles`}>
              Max miles
            </label>
            <select
              id={`${idPrefix}-maxMiles`}
              name="maxMiles"
              defaultValue={filters.maxMiles ? String(filters.maxMiles) : ''}
              className={cn(fieldClass, 'tnum')}
            >
              <option value="">Any</option>
              {MILEAGE_STEPS.map((m) => (
                <option key={m} value={m}>
                  {m.toLocaleString('en-US')}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-minYear`}>
            Year and newer
          </label>
          <select
            id={`${idPrefix}-minYear`}
            name="minYear"
            defaultValue={filters.minYear ? String(filters.minYear) : ''}
            className={cn(fieldClass, 'tnum')}
          >
            <option value="">Any</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          className="flex-1 rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-semibold text-[var(--on-brand)] hover:opacity-90"
        >
          Show matches
        </button>
        <Link
          href={basePath}
          className="rounded-md px-3 py-2 text-sm font-medium text-[var(--text-2)] hover:bg-[var(--paper-2)]"
        >
          Reset
        </Link>
      </div>
    </form>
  );
}

/**
 * The same filters, laid out as a bar.
 *
 * Showcase has no rail to put them in, and what it had instead was a collapsed
 * `<details>` plus a separate sort control — which meant a shopper who wanted a
 * $20k AWD truck had to open a disclosure, and sorting and filtering were two
 * different interactions that each reloaded the page.
 *
 * This is one GET form, so filters and sort submit together. Two rows on
 * purpose: the top row is what people actually use (words, make, model), the
 * second is the narrowing nobody does first. On a phone it all stacks, which is
 * fine — a stacked filter form is what every listings site does at that width.
 *
 * `SrpFilters` (the rail) stays as it is. Classic and lot-list want a column.
 */
export function SrpFilterBar({
  idPrefix,
  basePath,
  filters,
  makes,
  models,
  bodies,
  drivetrains,
  years,
  showAuto,
  showRv,
  className,
}: {
  idPrefix: string;
  basePath: string;
  filters: Filters;
  makes: FacetOption[];
  models: FacetOption[];
  bodies: FacetOption[];
  drivetrains: FacetOption[];
  years: number[];
  /* Which questions this lot can answer, derived from what is actually on it —
   * see `s/[slug]/page.tsx`. An RV lot is not asked about drivetrain or
   * odometer, a car lot is not asked how many it sleeps, and a lot carrying
   * both is asked everything. Derived rather than configured: it cannot go
   * stale, and it needs nobody to have set it up correctly. */
  showAuto: boolean;
  showRv: boolean;
  className?: string;
}) {
  return (
    <form
      method="get"
      action={basePath}
      className={cn(
        'rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm',
        className,
      )}
    >
      {/* words, make, model, go — the row that does most of the work */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-q`}>
            Search
          </label>
          <input
            id={`${idPrefix}-q`}
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Year, make, model, stock or VIN"
            className={fieldClass}
          />
        </div>

        <Facet idPrefix={idPrefix} name="make" label="Make" value={filters.make} options={makes} anyLabel="All makes" />
        <Facet
          idPrefix={idPrefix}
          name="model"
          label="Model"
          value={filters.model}
          options={models}
          anyLabel={filters.make ? `All ${filters.make} models` : 'All models'}
        />

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-md bg-[var(--brand)] px-5 py-2 text-sm font-semibold text-[var(--on-brand)] hover:opacity-90 lg:w-auto"
          >
            Search
          </button>
        </div>
      </div>

      {/* the narrowing */}
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3 sm:grid-cols-3 lg:grid-cols-6">
        <Facet
          idPrefix={idPrefix}
          name="body"
          label={showRv && !showAuto ? 'RV type' : 'Body'}
          value={filters.body}
          options={bodies}
          anyLabel="Any"
        />
        {showAuto ? (
          <Facet
            idPrefix={idPrefix}
            name="drivetrain"
            label="Drivetrain"
            value={filters.drivetrain}
            options={drivetrains}
            anyLabel="Any"
          />
        ) : null}
        {showRv ? (
          <>
            <div>
              <label className={labelClass} htmlFor={`${idPrefix}-maxLengthFt`}>
                Max length
              </label>
              <select
                id={`${idPrefix}-maxLengthFt`}
                name="maxLengthFt"
                defaultValue={filters.maxLengthFt ? String(filters.maxLengthFt) : ''}
                className={cn(fieldClass, 'tnum')}
              >
                <option value="">Any</option>
                {LENGTH_STEPS.map((n) => (
                  <option key={n} value={n}>{n} ft</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`${idPrefix}-minSleeps`}>
                Sleeps at least
              </label>
              <select
                id={`${idPrefix}-minSleeps`}
                name="minSleeps"
                defaultValue={filters.minSleeps ? String(filters.minSleeps) : ''}
                className={cn(fieldClass, 'tnum')}
              >
                <option value="">Any</option>
                {SLEEPS_STEPS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        <div className="col-span-2 sm:col-span-1">
          <span className={labelClass}>Price</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              name="minPrice"
              min={0}
              step={500}
              defaultValue={filters.minPrice ?? ''}
              placeholder="Min"
              aria-label="Minimum price"
              className={cn(fieldClass, 'tnum')}
            />
            <span className="text-[var(--text-3)]">–</span>
            <input
              type="number"
              inputMode="numeric"
              name="maxPrice"
              min={0}
              step={500}
              defaultValue={filters.maxPrice ?? ''}
              placeholder="Max"
              aria-label="Maximum price"
              className={cn(fieldClass, 'tnum')}
            />
          </div>
        </div>

        {showAuto ? (
          <div>
            <label className={labelClass} htmlFor={`${idPrefix}-maxMiles`}>
              Max miles
            </label>
            <select
              id={`${idPrefix}-maxMiles`}
              name="maxMiles"
              defaultValue={filters.maxMiles ? String(filters.maxMiles) : ''}
              className={cn(fieldClass, 'tnum')}
            >
              <option value="">Any</option>
              {MILEAGE_STEPS.map((m) => (
                <option key={m} value={m}>
                  {m.toLocaleString('en-US')}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-minYear`}>
            Year and newer
          </label>
          <select
            id={`${idPrefix}-minYear`}
            name="minYear"
            defaultValue={filters.minYear ? String(filters.minYear) : ''}
            className={cn(fieldClass, 'tnum')}
          >
            <option value="">Any</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/*
          Sort lives inside the form here rather than beside it. On the rail
          layouts it is a separate row of links because the rail already owns
          the filtering; in a bar, two controls that both reload the results and
          sit six inches apart is one control too many.
        */}
        <div>
          <label className={labelClass} htmlFor={`${idPrefix}-sort`}>
            Sort
          </label>
          <select id={`${idPrefix}-sort`} name="sort" defaultValue={filters.sort} className={fieldClass}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-2 text-right">
        <Link href={basePath} className="text-xs font-medium text-[var(--text-3)] hover:underline">
          Reset all
        </Link>
      </div>
    </form>
  );
}
