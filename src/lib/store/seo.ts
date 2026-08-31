/**
 * Structured data and the two links that matter on a phone.
 *
 * Pure — takes plain objects, returns plain objects and strings. No database, no
 * React, no `headers()`. That is what lets the JSON-LD be asserted in tests
 * rather than eyeballed in view-source, which is how structured data normally
 * rots: nothing renders differently when it is wrong.
 *
 * WHAT ACTUALLY DOES THE SEO WORK HERE, SINCE IT IS EASY TO GUESS WRONG
 * Not a map. An embedded map contributes nothing to ranking and costs real
 * mobile LCP on the page that has to load fastest. What Google reads is
 * `AutoDealer` with an address, coordinates and `openingHoursSpecification`,
 * backed by the same name/address/phone in visible text — the NAP consistency
 * that local ranking has always turned on. A "Directions" button that opens the
 * buyer's own maps app serves the human better than an iframe they cannot pinch.
 *
 * ONE `AutoDealer` PER PHYSICAL LOT, not per website. A two-lot dealer is two
 * places, and collapsing them into one node with one address is the single most
 * common way a multi-location business ends up ranking for neither. The brand
 * above them is an `Organization`, and each lot points at it.
 */

import { openingHoursSpecification, isWeekHours, type WeekHours } from './hours';

/** Everything the SEO helpers need from a rooftop row. */
export type SeoRooftop = {
  id: string;
  slug: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  hours: unknown;
};

/** Everything the SEO helpers need from a storefront row. */
export type SeoStorefront = {
  name: string;
  slug: string;
  domain: string | null;
  domainStatus: string;
  tagline: string | null;
  about: string | null;
  phone: string;
};

/* ------------------------------------------------------------------ urls */

/**
 * The one origin every absolute URL on this storefront must use.
 *
 * A storefront answers on two addresses — its Rooftop slug and, once pointed,
 * the dealer's own domain — and structured data that names the wrong one is
 * worse than none: it tells Google the canonical page is somewhere the dealer
 * does not control. So the rule matches the `canonical` tag in
 * `src/app/s/[slug]/layout.tsx`: the custom domain wins the moment it is LIVE,
 * and the request host is the fallback.
 */
export function canonicalOrigin(sf: Pick<SeoStorefront, 'domain' | 'domainStatus'>, host: string | null): string {
  if (sf.domain && sf.domainStatus === 'LIVE') return `https://${sf.domain}`;
  const bare = (host ?? '').split(':')[0];
  return bare ? `https://${bare}` : '';
}

/** `(360) 555-0142` → `tel:+13605550142`. Digits only; the display form stays human. */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `tel:+1${digits}` : `tel:+${digits}`;
}

export function fullAddress(r: Pick<SeoRooftop, 'addressLine1' | 'city' | 'state' | 'postalCode'>): string {
  return `${r.addressLine1}, ${r.city}, ${r.state} ${r.postalCode}`;
}

/**
 * A directions link that opens the buyer's own maps app.
 *
 * Google's `api=1` form is the documented, stable one, and iOS hands it to Apple
 * Maps or Google Maps according to what the buyer has installed rather than
 * forcing a browser tab. Coordinates go in when we have them — a lot on a road
 * that was resurveyed, or one of three units at the same street number, is where
 * a text address sends somebody to the wrong gate — but the address is *always*
 * sent too, because a bare pin gives the buyer nothing to read to confirm they
 * are heading to the right dealership.
 */
export function directionsUrl(r: SeoRooftop): string {
  const address = fullAddress(r);
  const destination = r.latitude != null && r.longitude != null
    ? `${r.latitude},${r.longitude}`
    : address;
  const params = new URLSearchParams({ api: '1', destination });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Where this lot's own page lives. */
export function visitPath(basePath: string, r: Pick<SeoRooftop, 'slug'>): string {
  return `${basePath}/visit/${r.slug}`;
}

/* -------------------------------------------------------------- json-ld */

type Json = Record<string, unknown>;

const clean = (o: Json): Json =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''));

function postalAddress(r: SeoRooftop): Json {
  return {
    '@type': 'PostalAddress',
    streetAddress: r.addressLine1,
    addressLocality: r.city,
    addressRegion: r.state,
    postalCode: r.postalCode,
    addressCountry: 'US',
  };
}

/**
 * One lot, as `AutoDealer`.
 *
 * `@id` is the lot's own page URL and is stable, so every other node — the
 * brand's `Organization`, a vehicle's `seller` — refers to this one rather than
 * repeating the address and drifting from it.
 *
 * `openingHoursSpecification` is omitted entirely when the hours are unset or
 * unreadable. An empty array is a claim ("we are never open"); its absence is
 * the truthful "not stated".
 */
export function autoDealerLd(
  r: SeoRooftop,
  opts: { origin: string; basePath: string; brandName: string; logoUrl?: string | null },
): Json {
  const url = `${opts.origin}${visitPath(opts.basePath, r)}`;
  const spec = isWeekHours(r.hours) ? openingHoursSpecification(r.hours as WeekHours) : [];
  return clean({
    '@type': 'AutoDealer',
    '@id': url,
    name: dealerNodeName(opts.brandName, r.name),
    url,
    telephone: r.phone,
    address: postalAddress(r),
    geo: r.latitude != null && r.longitude != null
      ? { '@type': 'GeoCoordinates', latitude: r.latitude, longitude: r.longitude }
      : undefined,
    openingHoursSpecification: spec.length ? spec : undefined,
    image: opts.logoUrl ? `${opts.origin}${opts.logoUrl}` : undefined,
    parentOrganization: { '@id': `${opts.origin}${opts.basePath || '/'}#org` },
  });
}

/**
 * The whole storefront as one `@graph`: the brand, then every lot under it.
 *
 * A graph rather than several loose scripts because the nodes reference each
 * other by `@id`, and a parser that has to stitch three separate blocks together
 * is a parser given the chance to stitch them wrong.
 */
export function storefrontLd(
  sf: SeoStorefront,
  rooftops: SeoRooftop[],
  opts: { origin: string; basePath: string; logoUrl?: string | null },
): Json {
  const home = `${opts.origin}${opts.basePath || '/'}`;
  const org = clean({
    '@type': 'Organization',
    '@id': `${home}#org`,
    name: sf.name,
    url: home,
    description: sf.about ? firstParagraph(sf.about) : sf.tagline ?? undefined,
    telephone: sf.phone,
    logo: opts.logoUrl ? `${opts.origin}${opts.logoUrl}` : undefined,
  });
  return {
    '@context': 'https://schema.org',
    '@graph': [
      org,
      ...rooftops.map((r) =>
        autoDealerLd(r, { ...opts, brandName: sf.name })),
    ],
  };
}

/** Vehicle detail page: the car, its offer, and who is selling it. */
export function vehicleLd(
  v: {
    vin: string;
    year: number;
    make: string;
    model: string;
    trim: string | null;
    mileage: number;
    price: number;
    salePrice: number | null;
    exteriorColor: string | null;
    interiorColor: string | null;
    bodyStyle: string;
    fuelType: string | null;
    transmission: string | null;
    drivetrain: string | null;
    engine: string | null;
    doors: number | null;
    description: string | null;
    status: string;
    stockNumber: string;
    photos: { url: string }[];
    rooftopId: string;
  },
  opts: { origin: string; url: string; sellerId: string; brandName: string },
): Json {
  const price = v.salePrice ?? v.price;
  const name = `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ''}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Vehicle',
    ...clean({
      name,
      url: opts.url,
      vehicleIdentificationNumber: v.vin,
      sku: v.stockNumber,
      description: v.description ? firstParagraph(v.description) : undefined,
      brand: { '@type': 'Brand', name: v.make },
      model: v.model,
      vehicleModelDate: String(v.year),
      /* `mileageFromOdometer` wants a QuantitativeValue with a unit code, not a
         bare number — SMI is UN/CEFACT for the statute mile. A plain integer is
         accepted and then silently read as kilometres by some consumers. */
      mileageFromOdometer: { '@type': 'QuantitativeValue', value: v.mileage, unitCode: 'SMI' },
      color: v.exteriorColor ?? undefined,
      vehicleInteriorColor: v.interiorColor ?? undefined,
      bodyType: v.bodyStyle,
      fuelType: v.fuelType ?? undefined,
      vehicleTransmission: v.transmission ?? undefined,
      driveWheelConfiguration: v.drivetrain ?? undefined,
      vehicleEngine: v.engine ? { '@type': 'EngineSpecification', name: v.engine } : undefined,
      numberOfDoors: v.doors ?? undefined,
      image: v.photos.slice(0, 8).map((p) => absolute(p.url, opts.origin)),
      offers: clean({
        '@type': 'Offer',
        '@id': `${opts.url}#offer`,
        url: opts.url,
        price,
        priceCurrency: 'USD',
        itemCondition: 'https://schema.org/UsedCondition',
        /* PENDING_SALE is a deposit, not a sale. `InStock` would be a lie and
           `SoldOut` would drop a car that can still come back. */
        availability: v.status === 'PENDING_SALE'
          ? 'https://schema.org/LimitedAvailability'
          : 'https://schema.org/InStock',
        seller: { '@id': opts.sellerId },
      }),
    }),
  };
}

export function breadcrumbLd(
  trail: { name: string; url: string }[],
): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: t.url,
    })),
  };
}

/**
 * What to call one lot.
 *
 * A multi-lot dealer wants the brand and the lot together — "Cascade Motors —
 * Orchards" — so a search result says which one it is. But dealers name their
 * rooftops inconsistently: some are bare ("Orchards"), some already carry the
 * brand ("Cascade Motors — Orchards"). Concatenating unconditionally produced
 * "Rooftop Demo Motors Vancouver — Rooftop Demo Motors — Vancouver" on the very
 * first real row, and a duplicated business name in structured data is the kind
 * of thing that reads as spam to the consumer of it.
 *
 * So: if either name already contains the other, the longer one is the whole
 * answer. Only genuinely disjoint names get joined.
 */
export function dealerNodeName(brandName: string, rooftopName: string): string {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const b = norm(brandName);
  const r = norm(rooftopName);
  if (b === r) return rooftopName;
  if (r.includes(b)) return rooftopName;
  if (b.includes(r)) return brandName;
  return `${brandName} — ${rooftopName}`;
}

/* --------------------------------------------------------------- helpers */

function absolute(url: string, origin: string): string {
  return /^https?:\/\//i.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * The first paragraph, capped.
 *
 * A dealer's "about" runs to whatever they typed and an imported description can
 * carry a 139-item factory spec dump (see `claude/inventory-import.md`). Neither
 * belongs whole inside a `description` property, so this takes the opening
 * paragraph and stops at a sentence boundary near 300 characters rather than
 * mid-word.
 */
export function firstParagraph(text: string, max = 300): string {
  const para = text.trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ').trim();
  if (para.length <= max) return para;
  const cut = para.slice(0, max);

  // A sentence boundary is the best cut, but only if it is late enough to still
  // be a summary. One in the first 40% would return a fragment of the paragraph
  // and read as truncated.
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > max * 0.5) return cut.slice(0, stop + 1);

  /*
   * Otherwise trim the half-word at the end — but only when that costs little.
   * Backing up to the last whitespace sounds harmless and is not: a paragraph
   * whose last space falls early (an early period followed by a long unbroken
   * run) collapses to a fraction of the budget, which is the exact failure the
   * sentence-boundary guard above just avoided. Past that point a hard cut is
   * the better answer — real prose always has a space near the end, so this
   * branch only fires on text that has no word boundaries to respect anyway.
   */
  const trimmed = cut.replace(/\s+\S*$/, '');
  return (trimmed.length >= max * 0.8 ? trimmed : cut).trimEnd() + '…';
}

/** Paragraphs, for rendering `about` without ever accepting markup. */
export function paragraphs(text: string): string[] {
  return text.trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
