/**
 * Rooftop Auto — sitemap.xml and robots.txt for a dealer's own domain.
 *
 * Pure. The route handlers under `src/app/s/[slug]/{sitemap.xml,robots.txt}`
 * load the rows and hand them here.
 *
 * ## Only on the dealer's live domain
 *
 * Same rule as the layout's metadata: nothing is indexed until the dealer is
 * on their own domain, and the `/s/<slug>` path never is. So a sitemap is only
 * served when the request arrived on that live domain — anywhere else it 404s,
 * because a sitemap listing URLs that all say `noindex` is a contradiction
 * Search Console reports as an error.
 *
 * ## What is in it
 *
 * Every URL here is one that carries its own canonical: the home page, one
 * `/visit/<lot>` per lot, the loan application, and every public vehicle.
 * Filtered SRPs (`?make=`) are not — they canonicalise to the home page, and
 * listing them would be submitting duplicates. Privacy is `noindex`.
 *
 * `lastmod` on a vehicle is its `updatedAt`, which moves on a price drop or new
 * photos — the two changes worth a recrawl. Google ignores `priority` and
 * `changefreq`, so neither is emitted.
 */

export type SitemapVehicle = {
  stockNumber: string;
  updatedAt: Date;
  photos: { url: string }[];
};

export type SitemapInput = {
  origin: string; // https://<domain>, no trailing slash
  lotSlugs: string[];
  vehicles: SitemapVehicle[];
};

/** Google reads up to 1,000 images per URL; a VDP gallery is well under that, but cap it anyway. */
const MAX_IMAGES = 20;

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absolute(origin: string, url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${origin}${url}`;
  return null;
}

export function buildSitemap({ origin, lotSlugs, vehicles }: SitemapInput): string {
  const entries: string[] = [];
  const newest = vehicles.reduce<Date | null>(
    (max, v) => (!max || v.updatedAt > max ? v.updatedAt : max),
    null,
  );

  const url = (loc: string, lastmod?: Date | null, images: string[] = []) =>
    [
      '  <url>',
      `    <loc>${xmlEscape(loc)}</loc>`,
      ...(lastmod ? [`    <lastmod>${lastmod.toISOString()}</lastmod>`] : []),
      ...images.map((i) => `    <image:image><image:loc>${xmlEscape(i)}</image:loc></image:image>`),
      '  </url>',
    ].join('\n');

  // The home page is the SRP; it changes whenever any car does.
  entries.push(url(`${origin}/`, newest));
  for (const lot of lotSlugs) entries.push(url(`${origin}/visit/${encodeURIComponent(lot)}`));
  entries.push(url(`${origin}/loan-application`));

  for (const v of vehicles) {
    const images = v.photos
      .map((p) => absolute(origin, p.url))
      .filter((u): u is string => Boolean(u))
      .slice(0, MAX_IMAGES);
    entries.push(url(`${origin}/${encodeURIComponent(v.stockNumber.toLowerCase())}`, v.updatedAt, images));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * `/s/` is disallowed on the dealer's domain: `proxy.ts` leaves a hand-typed
 * `/s/` path alone, so it resolves, and it is never what we want crawled.
 * Nothing else is blocked — a `Disallow` stops Google reading the `noindex`
 * on a page, which keeps it in the index as a bare URL rather than removing it.
 */
export function buildRobots(origin: string | null): string {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /s/'];
  if (origin) lines.push('', `Sitemap: ${origin}/sitemap.xml`);
  return lines.join('\n') + '\n';
}
