/**
 * Make, model and body-style landing pages — `/used/chevrolet`,
 * `/used/chevrolet/silverado-1500`, `/used/trucks`.
 *
 * The same inventory grid as the home page, preset to one slice, with its own
 * title, H1 and canonical so it can rank for "used silverado <town>". The why,
 * and the URL rules, are in `src/lib/store/facets.ts`.
 *
 * Out of stock is not a 404: the page stays up with an empty state, drops out of
 * the index and the sitemap, and comes back on its own when a matching car does.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getLiveInventory, getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { activePrice, usd } from '@/lib/domain';
import { layoutFor } from '@/components/store/layouts';
import { ShopByMake } from '@/components/store/shop-by-make';
import { buildStorefrontView, PUBLIC_STATUSES } from '@/components/store/build-view';
import {
  facetHeading,
  facetLine,
  facetLinks,
  facetName,
  facetPath,
  makePath,
  matchesFacet,
  resolveFacet,
} from '@/lib/store/facets';
import { breadcrumbLd, canonicalOrigin, canonicalUrl } from '@/lib/store/seo';
import type { RawSearchParams } from '@/components/store/srp-filters';

type Params = { params: Promise<{ slug: string; facet: string[] }> };

async function load(slug: string, parts: string[]) {
  const storefront = await getStorefrontByKey(slug);
  if (!storefront) return null;
  const inventory = (await getLiveInventory({ rooftopIds: storefront.rooftopIds })).filter((v) =>
    PUBLIC_STATUSES.has(v.status),
  );
  const facet = resolveFacet(parts, inventory);
  if (!facet) return null;

  const matching = inventory.filter((v) => matchesFacet(v, facet));
  const fromPrice = matching.length ? Math.min(...matching.map(activePrice)) : null;
  const lot = storefront.rooftops[0];
  const place = lot ? { city: lot.city, state: lot.state } : null;

  return {
    storefront,
    inventory,
    facet,
    count: matching.length,
    title: facetHeading(facet, place),
    line: facetLine(matching.length, storefront.name, fromPrice, usd),
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, facet: parts } = await params;
  const data = await load(slug, parts);
  if (!data) return { title: 'Not found' };
  const { storefront: sf, facet, count, title, line } = data;

  const host = (await headers()).get('host')?.toLowerCase().replace(/^www\./, '') ?? '';
  const onOwnDomain = Boolean(sf.domain) && sf.domainStatus === 'LIVE' && host === sf.domain;
  const url = canonicalUrl(sf, host, facetPath(facet));

  /* Same rule as everywhere on the storefront — nothing indexed off the dealer's
     own domain — plus one more: an empty page is not indexed either. */
  return {
    title,
    description: line,
    alternates: { canonical: url },
    ...(onOwnDomain && count > 0 ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function FacetPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<RawSearchParams> }) {
  const { slug, facet: parts } = await params;
  const data = await load(slug, parts);
  if (!data) notFound();
  const { storefront, inventory, facet, title, line } = data;

  const host = (await headers()).get('host');
  const basePath = storefrontBasePath(storefront, host);

  /*
   * The slice is applied as ordinary filters, so the rail and pills show it as
   * selected. Changing any filter from here lands on the home page with that
   * query — this page is the way in, the home page is where a search is refined.
   * Sort and anything else the shopper set are kept.
   */
  const sp: RawSearchParams = { ...(await searchParams) };
  delete sp.make;
  delete sp.model;
  delete sp.body;
  if (facet.kind === 'body') sp.body = facet.body;
  else {
    sp.make = facet.make;
    if (facet.model) sp.model = facet.model;
  }

  const view = buildStorefrontView({ storefront, inventory, sp, basePath, heading: { title, line } });
  const Layout = layoutFor(storefront.layout);

  const origin = canonicalOrigin(storefront, host);
  const home = `${origin}${basePath || '/'}`;
  const trail = [{ name: storefront.name, url: home }];
  if (facet.kind === 'make' && facet.model) {
    trail.push({ name: facet.make, url: canonicalUrl(storefront, host, makePath(facet.make)) });
  }
  trail.push({ name: facetName(facet), url: canonicalUrl(storefront, host, facetPath(facet)) });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd(trail)) }} />
      <Layout view={view} />
      <ShopByMake links={facetLinks(inventory).makes} basePath={basePath} />
    </>
  );
}
