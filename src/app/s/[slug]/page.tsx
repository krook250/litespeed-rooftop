/**
 * Storefront SRP.
 *
 * This route no longer renders a page — it resolves a `StorefrontView` once and
 * hands it to whichever layout the dealer picked. All three layouts consume the
 * identical object, which is what keeps a fourth layout from touching this file.
 *
 * `[slug]` is either a real slug or a **hostname**, because `proxy.ts` rewrites a
 * dealer's custom domain into this tree using the host as the segment.
 * `getStorefrontByKey` matches either; slugs never contain a dot and domains
 * always do, so the two can't collide.
 */

import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getLiveInventory, getStorefrontByKey, storefrontBasePath, type LiveVehicle } from '@/lib/queries';
import { BODY_LABEL, DRIVETRAIN_LABEL } from '@/lib/domain';
import { layoutFor } from '@/components/store/layouts';
import type { StorefrontView } from '@/components/store/layouts/types';
import {
  activeFilterCount,
  matchesFilters,
  parseFilters,
  sortVehicles,
  type FacetOption,
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
  const storefront = await getStorefrontByKey(slug);
  if (!storefront) notFound();

  const host = (await headers()).get('host');
  const basePath = storefrontBasePath(storefront, host);
  const filters: Filters = parseFilters(sp);

  const inventory = (await getLiveInventory({ rooftopIds: storefront.rooftopIds })).filter((v) =>
    PUBLIC_STATUSES.has(v.status),
  );

  const results = sortVehicles(
    inventory.filter((v) => matchesFilters(v, filters)),
    filters.sort,
  );

  /* Facet counts are measured against every filter except the facet itself, so a
     dealer can see what switching to Trucks would actually return. */
  const makePool = inventory.filter((v) => matchesFilters(v, filters, 'make'));
  const bodyPool = inventory.filter((v) => matchesFilters(v, filters, 'body'));
  const drivetrainPool = inventory.filter((v) => matchesFilters(v, filters, 'drivetrain'));

  const view: StorefrontView = {
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
    },
    basePath,
    searchParams: sp,
    activeFilterCount: activeFilterCount(filters),
    logoUrl: storefront.logoKey ? `/api/logo/${storefront.logoKey}` : null,
  };

  const Layout = layoutFor(storefront.layout);
  return <Layout view={view} />;
}
