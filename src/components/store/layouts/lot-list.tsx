/**
 * LOT_LIST — everything, fast.
 *
 * Posture: scanning. No hero, no card grid. A dense sortable list with the
 * dealer's phone number pinned above it, because on a high-turn lot the page's
 * job is to get a buyer to a stock number and a phone call, not to browse.
 *
 * This is the layout for the dealer who says "just put everything on there."
 * It fits the most units per screen of the three by a wide margin.
 */

import { SrpFilters, FILTER_KEYS, type FilterKey } from '@/components/store/srp-filters';
import type { StorefrontView } from './types';
import { ActivePills, EmptyState, ResultCount, SortBar, VehicleRow } from './shared';

export function LotListLayout({ view }: { view: StorefrontView }) {
  const { storefront, inventory, results, filters, facets, basePath, searchParams: sp, activeFilterCount } = view;
  const activeKeys = FILTER_KEYS.filter((k) => filters[k] !== '' && filters[k] !== null) as FilterKey[];
  const tel = `tel:+1${storefront.phone.replace(/\D/g, '')}`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* The call bar is the point of this layout. It stays put while you scroll. */}
      <div className="sticky top-16 z-20 -mx-4 mb-5 border-y border-ink-200 bg-[var(--brand)] px-4 py-2.5 sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-white">
            {inventory.length} units on the lot right now
          </span>
          <a href={tel} className="tnum text-base font-black text-white hover:underline">
            Call {storefront.phone}
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Inventory</h1>
          <ResultCount shown={results.length} total={inventory.length} filtered={activeFilterCount > 0} />
        </div>
        <SortBar basePath={basePath} sp={sp} filters={filters} />
      </div>

      <ActivePills activeKeys={activeKeys} basePath={basePath} sp={sp} filters={filters} />

      <details className="mt-4 rounded-lg border border-ink-200 bg-white p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-ink-900">
          Filters {activeFilterCount ? `(${activeFilterCount})` : ''}
        </summary>
        <div className="mt-4">
          <SrpFilters
            idPrefix="ll"
            basePath={basePath}
            filters={filters}
            makes={facets.makes}
            models={facets.models}
            bodies={facets.bodies}
            drivetrains={facets.drivetrains}
            years={facets.years}
          />
        </div>
      </details>

      <div className="mt-5">
        {results.length ? (
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            {results.map((v) => (
              <VehicleRow key={v.id} v={v} basePath={basePath} />
            ))}
          </div>
        ) : (
          <EmptyState basePath={basePath} total={inventory.length} phone={storefront.phone} />
        )}
      </div>
    </div>
  );
}
