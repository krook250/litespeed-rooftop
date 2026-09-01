/**
 * CLASSIC — the layout that shipped first, now one of three.
 *
 * Posture: browsing. A filter rail on the left and a dense three-across grid on
 * the right. This is the right default for a lot carrying forty units or more,
 * where the buyer arrives knowing roughly what they want and needs to narrow.
 */

import { SrpFilters, FILTER_KEYS, type FilterKey } from '@/components/store/srp-filters';
import { VehicleCard } from '@/components/store/vehicle-card';
import { BODY_LABEL } from '@/lib/domain';
import type { StorefrontView } from './types';
import { ActivePills, EmptyState, ResultCount, SortBar } from './shared';

export function ClassicLayout({ view }: { view: StorefrontView }) {
  const { storefront, inventory, results, filters, facets, basePath, searchParams: sp, activeFilterCount } = view;
  const activeKeys = FILTER_KEYS.filter((k) => filters[k] !== '' && filters[k] !== null) as FilterKey[];

  const rail = (idPrefix: string) => (
    <SrpFilters
      idPrefix={idPrefix}
      basePath={basePath}
      filters={filters}
      makes={facets.makes}
      models={facets.models}
      bodies={facets.bodies}
      drivetrains={facets.drivetrains}
      years={facets.years}
    />
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">
            {filters.make || filters.body
              ? `${filters.make} ${filters.body ? BODY_LABEL[filters.body] ?? '' : ''} inventory`.trim()
              : 'Current inventory'}
          </h1>
          <ResultCount shown={results.length} total={inventory.length} filtered={activeFilterCount > 0} />
        </div>
        <SortBar basePath={basePath} sp={sp} filters={filters} />
      </div>

      <ActivePills activeKeys={activeKeys} basePath={basePath} sp={sp} filters={filters} />

      <div className="mt-5 lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 lg:hidden">
            <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--text)]">
              Filters {activeFilterCount ? `(${activeFilterCount})` : ''}
            </summary>
            <div className="mt-4">{rail('m')}</div>
          </details>
          <div className="hidden lg:block">
            <h2 className="mb-3 text-sm font-semibold text-[var(--text)]">Filters</h2>
            {rail('d')}
          </div>
        </aside>

        <div className="mt-5 lg:mt-0">
          {results.length ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((v) => (
                <VehicleCard key={v.id} v={v} basePath={basePath} badgeFreshAir={view.badgeFreshAir} />
              ))}
            </div>
          ) : (
            <EmptyState basePath={basePath} total={inventory.length} phone={storefront.phone} />
          )}
        </div>
      </div>
    </div>
  );
}
