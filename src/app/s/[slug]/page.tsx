import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLiveInventory, getStorefrontBySlug, type LiveVehicle } from '@/lib/queries';
import { BODY_LABEL, DRIVETRAIN_LABEL } from '@/lib/domain';
import { VehicleCard } from '@/components/store/vehicle-card';
import {
  FILTER_KEYS,
  SORTS,
  SrpFilters,
  activeFilterCount,
  buildHref,
  matchesFilters,
  parseFilters,
  pillLabel,
  sortVehicles,
  type FacetOption,
  type FilterKey,
  type Filters,
  type RawSearchParams,
} from '@/components/store/srp-filters';

/** ARRIVED and IN_RECON units have no photo set and are not retail-ready. */
const PUBLIC_STATUSES = new Set(['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE']);

function tally<T extends string>(
  list: LiveVehicle[],
  pick: (v: LiveVehicle) => T,
  label: (key: T) => string,
): FacetOption[] {
  const counts = new Map<T, number>();
  for (const v of list) {
    const key = pick(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default async function StorefrontSrp({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const storefront = await getStorefrontBySlug(slug);
  if (!storefront) notFound();

  const basePath = `/s/${storefront.slug}`;
  const filters: Filters = parseFilters(sp);

  const inventory = (await getLiveInventory({ rooftopIds: storefront.rooftopIds })).filter((v) =>
    PUBLIC_STATUSES.has(v.status),
  );

  const results = sortVehicles(
    inventory.filter((v) => matchesFilters(v, filters)),
    filters.sort,
  );

  /* Facet counts are measured against every filter except the facet itself,
     so a dealer can see what switching to Trucks would actually return. */
  const makePool = inventory.filter((v) => matchesFilters(v, filters, 'make'));
  const bodyPool = inventory.filter((v) => matchesFilters(v, filters, 'body'));
  const drivetrainPool = inventory.filter((v) => matchesFilters(v, filters, 'drivetrain'));

  const makes = tally(makePool, (v) => v.make, (k) => k);
  const models = tally(
    makePool.filter((v) => !filters.make || v.make === filters.make),
    (v) => v.model,
    (k) => k,
  );
  const bodies = tally(bodyPool, (v) => v.bodyStyle, (k) => BODY_LABEL[k] ?? k);
  const drivetrains = tally(drivetrainPool, (v) => v.drivetrain, (k) => DRIVETRAIN_LABEL[k] ?? k);
  const years = [...new Set(inventory.map((v) => v.year))].sort((a, b) => b - a);

  const activeKeys = FILTER_KEYS.filter((k) => filters[k] !== '' && filters[k] !== null);
  const filterCount = activeFilterCount(filters);

  const rail = (idPrefix: string) => (
    <SrpFilters
      idPrefix={idPrefix}
      basePath={basePath}
      filters={filters}
      makes={makes}
      models={models}
      bodies={bodies}
      drivetrains={drivetrains}
      years={years}
    />
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">
            {filters.make || filters.body
              ? `${filters.make} ${filters.body ? BODY_LABEL[filters.body] ?? '' : ''} inventory`.trim()
              : 'Current inventory'}
          </h1>
          <p className="tnum mt-0.5 text-sm text-ink-600">
            {results.length} {results.length === 1 ? 'vehicle' : 'vehicles'}
            {filterCount ? ` of ${inventory.length} on the lot` : ' available now'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Sort
          </span>
          {SORTS.map((s) => {
            const active = s.key === filters.sort;
            return (
              <Link
                key={s.key}
                href={buildHref(basePath, sp, { sort: s.key === 'newest' ? null : s.key })}
                className={
                  active
                    ? 'rounded-md bg-ink-900 px-2 py-1 text-xs font-semibold text-white'
                    : 'rounded-md px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-100'
                }
                aria-current={active ? 'true' : undefined}
              >
                {s.label}
              </Link>
            );
          })}
        </div>
      </div>

      {activeKeys.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {activeKeys.map((key: FilterKey) => (
            <Link
              key={key}
              href={buildHref(basePath, sp, { [key]: null })}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-300 bg-white px-3 py-1 text-xs font-medium text-ink-700 hover:border-ink-400 hover:bg-ink-50"
            >
              {pillLabel(key, filters)}
              <span aria-hidden className="text-ink-400">
                ×
              </span>
              <span className="sr-only">Remove filter</span>
            </Link>
          ))}
          <Link
            href={buildHref(basePath, {}, { sort: filters.sort === 'newest' ? null : filters.sort })}
            className="text-xs font-semibold text-[var(--brand)] hover:underline"
          >
            Clear all
          </Link>
        </div>
      ) : null}

      <div className="mt-5 lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="rounded-xl border border-ink-200 bg-white p-4 lg:hidden" open={false}>
            <summary className="cursor-pointer list-none text-sm font-semibold text-ink-900">
              Filters {filterCount ? `(${filterCount})` : ''}
            </summary>
            <div className="mt-4">{rail('m')}</div>
          </details>
          <div className="hidden lg:block">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Filters</h2>
            {rail('d')}
          </div>
        </aside>

        <div className="mt-5 lg:mt-0">
          {results.length ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((v) => (
                <VehicleCard key={v.id} v={v} basePath={basePath} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50 px-6 py-16 text-center">
              <p className="text-sm font-semibold text-ink-800">
                Nothing on the lot matches that search.
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
                We turn inventory weekly — widen the price or mileage range, or clear the filters to
                see all {inventory.length} units.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={basePath}
                  className="rounded-md bg-[var(--brand)] px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Clear all filters
                </Link>
                <a
                  href={`tel:+1${storefront.phone.replace(/\D/g, '')}`}
                  className="rounded-md border border-ink-300 px-3.5 py-2 text-sm font-medium text-ink-800 hover:bg-white"
                >
                  Call {storefront.phone}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
