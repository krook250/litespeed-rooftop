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

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getLiveInventory, getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { layoutFor } from '@/components/store/layouts';
import { StoreSections } from '@/components/store/location';
import { ShopByMake } from '@/components/store/shop-by-make';
import { buildStorefrontView, PUBLIC_STATUSES } from '@/components/store/build-view';
import { facetLine, facetLinks } from '@/lib/store/facets';
import { canonicalOrigin, storefrontLd, type SeoRooftop } from '@/lib/store/seo';
import type { RawSearchParams } from '@/components/store/srp-filters';
import { activePrice, usd } from '@/lib/domain';
import { homeDescription, homeHeading, homeTitle, lineup } from '@/lib/store/home-meta';

/**
 * Title, description and H1 for the home page, from the lot's address and what
 * is actually on it. See `src/lib/store/home-meta.ts`.
 */
async function loadHome(slug: string) {
  const storefront = await getStorefrontByKey(slug);
  if (!storefront) return null;
  const inventory = (await getLiveInventory({ rooftopIds: storefront.rooftopIds })).filter((v) =>
    PUBLIC_STATUSES.has(v.status),
  );
  const lot = storefront.rooftops[0];
  const place = lot ? { city: lot.city, state: lot.state } : null;
  const words = lineup(inventory.map((v) => v.bodyStyle));
  const fromPrice = inventory.length ? Math.min(...inventory.map(activePrice)) : null;
  return {
    storefront,
    inventory,
    title: homeTitle(words, place, storefront.name),
    heading: homeHeading(words, place),
    line: facetLine(inventory.length, storefront.name, fromPrice, usd),
    description: homeDescription(
      words, place, storefront.name, inventory.length, fromPrice, storefront.tagline ?? null, usd,
    ),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const home = await loadHome(slug);
  if (!home) return {};
  /* `absolute`: the brand is already in it, so the layout's "· name" template must not add it twice. */
  return { title: { absolute: home.title }, description: home.description };
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
  const home = await loadHome(slug);
  if (!home) notFound();
  const { storefront, inventory } = home;

  const host = (await headers()).get('host');
  const basePath = storefrontBasePath(storefront, host);

  /* The town H1 is for the unfiltered page. Once a shopper filters, the layout's
     own heading and result count say what they're looking at. */
  const unfiltered = buildStorefrontView({ storefront, inventory, sp, basePath });
  const view = unfiltered.activeFilterCount === 0
    ? { ...unfiltered, heading: { title: home.heading, line: home.line } }
    : unfiltered;

  const Layout = layoutFor(storefront.layout);

  /*
   * The `@graph` for the whole storefront: the brand as an `Organization`, then
   * one `AutoDealer` per physical lot beneath it. Built from the same rows the
   * visible location cards below render, so the structured data and the NAP text
   * cannot drift apart — which is the failure mode that quietly costs local
   * ranking, because nothing on the page looks wrong when they do.
   */
  const rooftops = storefront.rooftops as unknown as SeoRooftop[];
  const ld = storefrontLd(storefront, rooftops, {
    origin: canonicalOrigin(storefront, host),
    basePath,
    logoUrl: view.logoUrl,
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <Layout view={view} />
      <ShopByMake links={facetLinks(inventory).makes} basePath={basePath} />
      <StoreSections
        name={storefront.name}
        about={storefront.about}
        rooftops={rooftops}
        basePath={basePath}
      />
    </>
  );
}
