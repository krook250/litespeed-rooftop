/**
 * SHOWCASE — photo-led.
 *
 * Posture: lingering. One featured unit gets a full-width hero, then larger
 * two-across cards below. Filters move to a collapsed bar above the grid rather
 * than a permanent rail, because at this inventory size narrowing is not the
 * buyer's first problem — being interested is.
 *
 * The right pick for a smaller lot with genuinely good photography, or for
 * specialty inventory where each unit is worth a second look. It is the wrong
 * pick for eighty units, and the picker says so.
 */

import Link from 'next/link';
import { SrpFilters, FILTER_KEYS, type FilterKey } from '@/components/store/srp-filters';
import { VehicleCard, primaryPhoto } from '@/components/store/vehicle-card';
import { activePrice, miles, usd, vehicleTitle, BODY_LABEL, DRIVETRAIN_LABEL } from '@/lib/domain';
import type { StorefrontView } from './types';
import { ActivePills, EmptyState, ResultCount, SortBar } from './shared';

export function ShowcaseLayout({ view }: { view: StorefrontView }) {
  const { storefront, inventory, results, filters, facets, basePath, searchParams: sp, activeFilterCount } = view;
  const activeKeys = FILTER_KEYS.filter((k) => filters[k] !== '' && filters[k] !== null) as FilterKey[];

  /*
   * The hero is the first result, not a hand-picked "featured" flag. That is
   * deliberate: a featured flag is one more thing a dealer has to remember to
   * update, and a stale hero is worse than no hero. Whatever sorts first is by
   * definition what the dealer most wants seen under the current sort.
   */
  const hero = results[0] ?? null;
  const rest = results.slice(1);
  const heroPhoto = hero ? primaryPhoto(hero) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {hero ? (
        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper)] shadow-sm">
          <Link href={`${basePath}/${hero.stockNumber}`} className="block">
            <div className="relative aspect-[16/8] w-full bg-[var(--paper-2)]">
              {heroPhoto ? (
                <img
                  src={heroPhoto.url}
                  alt={vehicleTitle(hero)}
                  className="h-full w-full object-cover"
                  fetchPriority="high"
                />
              ) : null}
              <div className="absolute left-4 top-4 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--on-accent)]">
                On the front line
              </div>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4 p-5">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold tracking-tight text-[var(--text)]">
                  {vehicleTitle(hero)}
                </h1>
                <p className="tnum mt-1 text-sm text-[var(--text-2)]">
                  {miles(hero.mileage)} · {BODY_LABEL[hero.bodyStyle] ?? hero.bodyStyle} ·{' '}
                  {DRIVETRAIN_LABEL[hero.drivetrain] ?? hero.drivetrain} · Stock #{hero.stockNumber}
                </p>
              </div>
              <div className="text-right">
                <div className="tnum text-3xl font-black text-[var(--brand-text)]">
                  {usd(activePrice(hero))}
                </div>
                <span className="text-xs font-semibold text-[var(--text-3)] group-hover:underline">
                  See details and photos →
                </span>
              </div>
            </div>
          </Link>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--text)]">
            {hero ? 'More on the lot' : 'Current inventory'}
          </h2>
          <ResultCount shown={results.length} total={inventory.length} filtered={activeFilterCount > 0} />
        </div>
        <SortBar basePath={basePath} sp={sp} filters={filters} />
      </div>

      <ActivePills activeKeys={activeKeys} basePath={basePath} sp={sp} filters={filters} />

      <details className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--text)]">
          Narrow it down {activeFilterCount ? `(${activeFilterCount})` : ''}
        </summary>
        <div className="mt-4">
          <SrpFilters
            idPrefix="sc"
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

      <div className="mt-6">
        {results.length ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {rest.map((v) => (
              <VehicleCard key={v.id} v={v} basePath={basePath} badgeFreshAir={view.badgeFreshAir} />
            ))}
          </div>
        ) : (
          <EmptyState basePath={basePath} total={inventory.length} phone={storefront.phone} />
        )}
      </div>
    </div>
  );
}
