/**
 * Rooftop Auto — which bucket a storefront visit came from.
 *
 * Pure, no I/O, so it can be tested and so the beacon and the lead form agree.
 * Six buckets and no more: a dealer asking "is Facebook working" needs a word
 * they recognise, not a referrer hostname.
 *
 * Order matters. A click ID or a paid UTM beats the referrer, because a Google
 * ad click arrives with google.com as its referrer and is not organic search.
 */

export const SOURCES = ['facebook', 'google_ads', 'search', 'marketplace', 'direct', 'other'] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABEL: Record<Source, string> = {
  facebook: 'Facebook & Instagram',
  google_ads: 'Google ads',
  search: 'Google & other search',
  marketplace: 'CarGurus & marketplaces',
  direct: 'Direct',
  other: 'Other websites',
};

/** `internal` means "a page on this site linked here" — inherit the visit's source. */
export type Classified = Source | 'internal';

const FACEBOOK = /(^|\.)(facebook|fb|instagram|messenger)\.com$|(^|\.)fb\.me$|(^|\.)l\.instagram\.com$/;
const SEARCH = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|brave|aol|ask)\.[a-z.]+$|(^|\.)search\.yahoo\.[a-z.]+$/;
const MARKETPLACE =
  /(^|\.)(cargurus|autotrader|cars|carfax|carsforsale|craigslist|offerup|truecar|edmunds|kbb|carsdirect|autolist|capitalone|carvana)\.[a-z.]+$/;

const PAID = /^(cpc|ppc|paid|paidsearch|paid_search|paid-search|sem|display|cpm)$/i;

export function classifySource(input: {
  referrer: string | null | undefined;
  search: string | null | undefined;
  /** The host the page was served on — a referrer from here is internal. */
  ownHost: string | null | undefined;
}): { source: Classified; referrerHost: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null } {
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(input.search ?? '');
  } catch {
    q = new URLSearchParams();
  }
  const utmSource = clip(q.get('utm_source'));
  const utmMedium = clip(q.get('utm_medium'));
  const utmCampaign = clip(q.get('utm_campaign'));

  let referrerHost: string | null = null;
  try {
    referrerHost = input.referrer ? new URL(input.referrer).hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch {
    referrerHost = null;
  }
  const own = (input.ownHost ?? '').toLowerCase().split(':')[0]!.replace(/^www\./, '');

  const base = { referrerHost, utmSource, utmMedium, utmCampaign };
  const us = (utmSource ?? '').toLowerCase();

  if (q.has('gclid') || q.has('gbraid') || q.has('wbraid') || (/google|adwords/.test(us) && PAID.test(utmMedium ?? ''))) {
    return { source: 'google_ads', ...base };
  }
  if (q.has('fbclid') || /^(facebook|fb|ig|instagram|meta|messenger)$/.test(us)) {
    return { source: 'facebook', ...base };
  }
  if (us) {
    if (/google|bing|yahoo/.test(us)) return { source: PAID.test(utmMedium ?? '') ? 'google_ads' : 'search', ...base };
    if (MARKETPLACE.test(`${us}.com`)) return { source: 'marketplace', ...base };
    return { source: 'other', ...base };
  }

  if (!referrerHost) return { source: 'direct', ...base };
  if (own && referrerHost === own) return { source: 'internal', ...base };
  if (referrerHost === 'rooftopauto.com' || referrerHost.endsWith('.rooftopauto.com')) {
    return { source: 'internal', ...base };
  }
  if (FACEBOOK.test(referrerHost)) return { source: 'facebook', ...base };
  if (SEARCH.test(referrerHost)) return { source: 'search', ...base };
  if (MARKETPLACE.test(referrerHost)) return { source: 'marketplace', ...base };
  return { source: 'other', ...base };
}

export function isSource(v: unknown): v is Source {
  return typeof v === 'string' && (SOURCES as readonly string[]).includes(v);
}

function clip(v: string | null): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, 120) : null;
}

/**
 * Not people. Anything that runs our script and says what it is gets dropped.
 * The ones that lie are mostly headless Chrome, which `navigator.webdriver`
 * catches on the client before the beacon is sent.
 */
export function isBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return true;
  return /bot|crawl|spider|slurp|facebookexternalhit|facebot|preview|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|scrapy|phantom|selenium|puppeteer|playwright/.test(
    ua,
  );
}

/** Cookie names, shared by the beacon and the lead form. */
export const VISITOR_COOKIE = 'rt_vid';
export const SOURCE_COOKIE = 'rt_src';
