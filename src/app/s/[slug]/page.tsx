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
import { getLiveInventory, getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { layoutFor } from '@/components/store/layouts';
import { StoreSections } from '@/components/store/location';
import { ShopByMake } from '@/components/store/shop-by-make';
import { buildStorefrontView, PUBLIC_STATUSES } from '@/components/store/build-view';
import { facetLinks } from '@/lib/store/facets';
import { canonicalOrigin, storefrontLd, type SeoRooftop } from '@/lib/store/seo';
import type { RawSearchParams } from '@/components/store/srp-filters';

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

  const inventory = (await getLiveInventory({ rooftopIds: storefront.rooftopIds })).filter((v) =>
    PUBLIC_STATUSES.has(v.status),
  );

  const view = buildStorefrontView({ storefront, inventory, sp, basePath });

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
