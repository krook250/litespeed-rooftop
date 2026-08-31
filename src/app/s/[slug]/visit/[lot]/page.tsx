/**
 * One lot's page: hours, address, directions.
 *
 * WHY THIS EXISTS AS ITS OWN URL rather than an anchor on the home page.
 * "<dealer> hours" and "<dealer> directions" are two of the highest-intent
 * queries a local business gets, and an anchor cannot rank for either — there is
 * no title, no description and no canonical URL to return. This page has all
 * three, and for a dealer with two lots it is the only page that is *about* one
 * of them.
 *
 * `[lot]` is the rooftop slug. It is validated against the rooftops actually
 * linked to this storefront, not merely looked up: rooftop slugs are unique
 * across every tenant, so resolving one without that check would serve another
 * dealer's address under this dealer's domain.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getStorefrontByKey, storefrontBasePath } from '@/lib/queries';
import { AboutSection, LocationCard } from '@/components/store/location';
import {
  autoDealerLd,
  breadcrumbLd,
  canonicalOrigin,
  fullAddress,
  visitPath,
  type SeoRooftop,
} from '@/lib/store/seo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string; lot: string }> };

async function resolve(slug: string, lot: string) {
  const sf = await getStorefrontByKey(slug);
  if (!sf) return null;
  const rooftop = sf.rooftops.find((r) => r.slug === lot.toLowerCase());
  if (!rooftop) return null;
  return { sf, rooftop: rooftop as unknown as SeoRooftop };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, lot } = await params;
  const found = await resolve(slug, lot);
  if (!found) return { title: 'Not found' };
  const { sf, rooftop } = found;

  const host = (await headers()).get('host')?.toLowerCase().replace(/^www\./, '') ?? '';
  const onOwnDomain = Boolean(sf.domain) && sf.domainStatus === 'LIVE' && host === sf.domain;
  const origin = canonicalOrigin(sf, host);
  const url = `${origin}${visitPath(storefrontBasePath(sf, host), rooftop)}`;

  /*
   * The title is the query, in the order somebody types it. "Hours & Directions"
   * before the dealership name, because the first forty characters are what a
   * phone shows.
   */
  return {
    title: `Hours & Directions — ${rooftop.name}`,
    description:
      `Visit ${sf.name} at ${fullAddress(rooftop)}. Opening hours, phone number and driving directions.`,
    /* Same rule as the storefront layout: nothing is indexed until the dealer is
       on their own domain. See the long note in `../../layout.tsx`. */
    ...(onOwnDomain
      ? { alternates: { canonical: url } }
      : { robots: { index: false, follow: true } }),
  };
}

export default async function VisitPage({ params }: Params) {
  const { slug, lot } = await params;
  const found = await resolve(slug, lot);
  if (!found) notFound();
  const { sf, rooftop } = found;

  const host = (await headers()).get('host');
  const basePath = storefrontBasePath(sf, host);
  const origin = canonicalOrigin(sf, host);
  const home = basePath || '/';
  const logoUrl = sf.logoKey ? `/api/logo/${sf.logoKey}` : null;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      autoDealerLd(rooftop, { origin, basePath, brandName: sf.name, logoUrl }),
      breadcrumbLd([
        { name: sf.name, url: `${origin}${home}` },
        { name: `${rooftop.name} — Hours & Directions`, url: `${origin}${visitPath(basePath, rooftop)}` },
      ]),
    ],
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <nav aria-label="Breadcrumb" className="text-sm text-[var(--text-3)]">
        <Link href={home} className="hover:text-[var(--brand-text)] hover:underline">
          {sf.name}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-[var(--text-2)]">Hours &amp; directions</span>
      </nav>

      {/*
        "Hours & directions at <lot>" rather than "<lot> — hours & directions".
        Dealers routinely name a rooftop with a dash already in it ("Rooftop Demo
        Motors — Vancouver"), and the second dash made the heading read as a
        machine had assembled it. This also puts the two words somebody actually
        searched for at the front, which is where a phone truncates.
      */}
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--text)] sm:text-3xl">
        Hours &amp; directions at {rooftop.name}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[var(--text-2)]">
        {fullAddress(rooftop)}. Call ahead and we&apos;ll have the unit pulled up front when you get
        here.
      </p>

      <div className="mt-6 max-w-md">
        <LocationCard rooftop={rooftop} basePath={basePath} showLink={false} />
      </div>

      {/* Repeated here on purpose — this page can be a buyer's first landing
          from a "<dealer> hours" search, and it should say who the dealer is. */}
      <div className="mt-10">
        <AboutSection name={sf.name} about={sf.about} />
      </div>

      {sf.rooftops.length > 1 ? (
        <section className="mt-10">
          <h2 className="text-lg font-bold text-[var(--text)]">Our other locations</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {sf.rooftops
              .filter((r) => r.id !== rooftop.id)
              .map((r) => (
                <li key={r.id}>
                  <Link
                    href={visitPath(basePath, r)}
                    className="font-semibold text-[var(--brand-text)] hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="text-[var(--text-3)]"> · {r.city}, {r.state}</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-10">
        <Link href={home} className="text-sm font-semibold text-[var(--brand-text)] hover:underline">
          ← See what&apos;s on the lot
        </Link>
      </p>
    </div>
  );
}
