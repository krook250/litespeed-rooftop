/**
 * The one place a `StorefrontView` is assembled, so the home page and the
 * make / model / body pages hand every layout the identical shape.
 */

import type { LiveVehicle } from '@/lib/queries';
import { BODY_LABEL, DRIVETRAIN_LABEL, daysInStock, isFreshAir, isRvBody, shouldBadgeFreshAir } from '@/lib/domain';
import type { StorefrontView } from '@/components/store/layouts/types';
import {
  activeFilterCount,
  matchesFilters,
  parseFilters,
  sortVehicles,
  type FacetOption,
  type RawSearchParams,
} from '@/components/store/srp-filters';

/** ARRIVED and IN_RECON units have no photo set and are not retail-ready. */
export const PUBLIC_STATUSES = new Set(['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE']);

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

export function buildStorefrontView({
  storefront,
  inventory,
  sp,
  basePath,
  heading = null,
}: {
  storefront: StorefrontView['storefront'];
  /** Public inventory only — the caller filters by `PUBLIC_STATUSES`. */
  inventory: LiveVehicle[];
  sp: RawSearchParams;
  basePath: string;
  heading?: StorefrontView['heading'];
}): StorefrontView {
  const filters = parseFilters(sp);

  const results = sortVehicles(
    inventory.filter((v) => matchesFilters(v, filters)),
    filters.sort,
  );

  /* Facet counts are measured against every filter except the facet itself, so a
     dealer can see what switching to Trucks would actually return. */
  const makePool = inventory.filter((v) => matchesFilters(v, filters, 'make'));
  const bodyPool = inventory.filter((v) => matchesFilters(v, filters, 'body'));
  const drivetrainPool = inventory.filter((v) => matchesFilters(v, filters, 'drivetrain'));

  return {
    storefront,
    inventory,
    results,
    filters,
    facets: {
      makes: tally(makePool, (v) => v.make, (k) => k),
      models: tally(
        makePool.filter((v) => !filters.make || v.make === filters.make),
        (v) => v.model,
        (k) => k,
      ),
      bodies: tally(bodyPool, (v) => v.bodyStyle, (k) => BODY_LABEL[k] ?? k),
      drivetrains: tally(drivetrainPool, (v) => v.drivetrain, (k) => DRIVETRAIN_LABEL[k] ?? k),
      years: [...new Set(inventory.map((v) => v.year))].sort((a, b) => b - a),
      /* Measured against the whole lot, not the filtered results — same rule as
       * the fresh-air badge below. Filtering down to Fifth Wheel must not make
       * the Drivetrain control disappear mid-search.
       *
       * An empty lot falls back to the car rail: a dealer who has not added
       * inventory yet is overwhelmingly a car dealer, and a storefront with no
       * filters at all looks broken rather than empty. */
      showRv: inventory.some((v) => isRvBody(v.bodyStyle)),
      showAuto:
        inventory.some((v) => !isRvBody(v.bodyStyle)) ||
        !inventory.some((v) => isRvBody(v.bodyStyle)),
    },
    basePath,
    searchParams: sp,
    activeFilterCount: activeFilterCount(filters),
    /* Measured against the whole lot, not the filtered results: switching to
       Trucks must not change whether a badge is honest. */
    badgeFreshAir: shouldBadgeFreshAir(
      inventory.filter((v) => isFreshAir(daysInStock(v))).length,
      inventory.length,
    ),
    logoUrl: storefront.logoKey ? `/api/logo/${storefront.logoKey}` : null,
    heading,
  };
}
