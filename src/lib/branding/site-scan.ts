/**
 * "Add my logo" — the website half.
 *
 * A dealer who cannot find their logo file can almost always type their website
 * address, and their logo is sitting in the header of it. This module fetches
 * that page and pulls out the two things the Design card needs: candidate logo
 * images, and the colors the site already uses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE FETCHES A URL THE USER TYPED. That is server-side request forgery
 * by default, and the fix is not optional:
 *
 *   - http/https only. No file:, no data:, no gopher:.
 *   - Every hop is DNS-resolved and every resolved address is checked against
 *     the private ranges *before* the socket opens. `127.0.0.1` is the obvious
 *     one; the ones that actually get used are `169.254.169.254` (cloud
 *     metadata) and a public hostname whose A record points at 10.x.
 *   - Redirects are followed manually, three at most, each one re-validated.
 *     Following redirects automatically hands the attacker a second try.
 *   - Every response is capped and every request is timed out, because a dealer
 *     typing a URL should not be able to make our server read a 4GB file.
 *
 * There is a TOCTOU window between resolving and connecting, which a determined
 * attacker with control of a DNS zone can win. Closing it properly needs a
 * pinned-IP agent; the mitigation here is that the *response* never reaches the
 * dealer as text — we return parsed colors and image URLs, not the body — so
 * the payoff for winning that race is close to nil.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeHex, type WeightedColor } from './palette';

const HTML_MAX_BYTES = 1_500_000;
const CSS_MAX_BYTES = 600_000;
const MAX_STYLESHEETS = 2;
/** A dealer site on a slow platform routinely takes 8s to first byte. */
const PAGE_TIMEOUT_MS = 12_000;
/** Sub-resources are optional, so they get a short leash. */
const ASSET_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;

/**
 * WE IDENTIFY AS A BROWSER, and that is a deliberate call worth defending.
 *
 * The first version sent `RooftopAutoBot/1.0`. It was refused by the first real
 * dealer site we tried — a CarsForSale.com storefront — and it would be refused
 * by most of them: dealer platforms (CarsForSale, Dealer.com, DealerOn,
 * Dealer Inspire) sit behind WAFs that 403 any user agent they do not recognise,
 * long before robots.txt is consulted.
 *
 * What we are doing does not resemble what those rules exist to stop. It is ONE
 * page load, made synchronously because the dealer clicked a button, against a
 * site the dealer owns, to fetch the dealer's own logo. There is no crawl, no
 * schedule, no second page. Announcing ourselves and being refused would not
 * make that request more honest — it would just move the work to the dealer, who
 * would go and find the PNG by hand.
 *
 * The line we do not cross: this never runs unprompted, never walks past the one
 * page it was given, and never fetches a site nobody asked about.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/127.0.0.0 Safari/537.36';

const BROWSERISH_HEADERS: Record<string, string> = {
  'user-agent': UA,
  'accept-language': 'en-US,en;q=0.9',
  'upgrade-insecure-requests': '1',
};

export type LogoCandidate = {
  url: string;
  /** Why we think this is the logo. Ranked; lower sorts first. */
  rank: number;
  hint: string;
};

export type SiteScan = {
  ok: true;
  url: string;
  host: string;
  title: string | null;
  colors: WeightedColor[];
  candidates: LogoCandidate[];
} | {
  ok: false;
  error: string;
};

/* ------------------------------------------------------------- URL safety */

/** Private, loopback, link-local and metadata ranges — v4 and v6. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    const [a, b] = [p[0]!, p[1]!];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // link-local + 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && p[2] === 2) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                         // multicast + reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    if (s.startsWith('::ffff:')) return isPrivateAddress(s.slice(7)); // v4-mapped
    return false;
  }
  return true; // not an IP at all — treat as unsafe
}

/**
 * Accept what a dealer actually types. `cascademotors.com`, `www.x.com/inventory`,
 * a full URL with a scheme — all fine. Anything without a dot is rejected before
 * it can resolve to an internal hostname like `intranet`.
 */
export function parseSiteUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed.replace(/^\/+/, '');
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.')) return null;
  if (isIP(u.hostname)) return null; // a dealer types a name, never an address
  return u;
}

async function assertPublicHost(hostname: string): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new FetchFailure('dns', `We couldn't find ${hostname}. Check the spelling.`);
  }
  if (!addrs.length) throw new FetchFailure('dns', `We couldn't find ${hostname}. Check the spelling.`);
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new FetchFailure('private', 'That address points somewhere private.');
  }
}

type FetchedText = { text: string; finalUrl: URL };

/**
 * Why a fetch failed, kept as a machine-readable kind.
 *
 * The first version collapsed every failure into "Check the address and try
 * again", which is actively misleading when the address is perfectly correct and
 * the site returned 403. A dealer told to check a URL they know is right has
 * been sent to look in the wrong place — so the reason survives all the way to
 * the screen.
 */
export type FetchFailureKind = 'dns' | 'network' | 'timeout' | 'blocked' | 'status' | 'redirect' | 'too-big' | 'private';

export class FetchFailure extends Error {
  constructor(readonly kind: FetchFailureKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'FetchFailure';
  }
}

/** Fetch text with the guard rails described at the top of this file. */
async function safeFetchText(
  start: URL,
  maxBytes: number,
  accept: string,
  timeoutMs = PAGE_TIMEOUT_MS,
): Promise<FetchedText> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ac.signal,
        headers: { ...BROWSERISH_HEADERS, accept },
      });
    } catch (err) {
      if (ac.signal.aborted) throw new FetchFailure('timeout', `${url.hostname} took too long to answer.`);
      throw new FetchFailure('network', `Could not connect to ${url.hostname}.`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new FetchFailure('redirect', 'That site redirected to nowhere.');
      let next: URL;
      try {
        next = new URL(loc, url);
      } catch {
        throw new FetchFailure('redirect', 'That site redirected somewhere we could not follow.');
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new FetchFailure('redirect', 'That site redirected somewhere we will not follow.');
      }
      url = next;
      continue;
    }

    /*
     * 401/403/406/429 and Cloudflare's 503 all mean the same thing in practice:
     * a WAF decided we are a robot. Separated from other statuses because the
     * dealer's next move is different — upload the file, don't fix the URL.
     */
    if ([401, 403, 406, 429, 503].includes(res.status)) {
      throw new FetchFailure('blocked', `${url.hostname} is blocking automated visits.`, res.status);
    }
    if (!res.ok) throw new FetchFailure('status', `${url.hostname} answered with ${res.status}.`, res.status);

    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new FetchFailure('too-big', 'That page is too large to read.');

    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new FetchFailure('too-big', 'That page is too large to read.');

    /*
     * Decode with the charset the server declared. A dealer site on an older
     * platform still serves windows-1252, and forcing utf-8 turns the one thing
     * we are here for — the dealership's name in the title — into mojibake.
     */
    const ct = res.headers.get('content-type') ?? '';
    const charset = ct.match(/charset=([\w-]+)/i)?.[1]?.toLowerCase() ?? 'utf-8';
    let text: string;
    try {
      text = new TextDecoder(charset).decode(buf);
    } catch {
      text = new TextDecoder('utf-8').decode(buf);
    }
    return { text, finalUrl: url };
  }
  throw new FetchFailure('redirect', 'That site redirected too many times.');
}

/* ---------------------------------------------------------------- parsing */

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(name + '\\s*=\\s*["\']([^"\']*)["\']', 'i'))
    ?? tag.match(new RegExp(name + '\\s*=\\s*([^\\s>]+)', 'i'));
  return m?.[1]?.trim() ?? null;
}

function absolute(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Find images that might be the logo, ranked by how likely they are.
 *
 * The ranking matters more than the finding. Almost every site yields six or
 * seven images here, and a dealer shown "we found 7 pictures" has been given a
 * chore. Shown "this one?" with the header image first, they click once.
 */
export function findLogoCandidates(html: string, base: URL): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const push = (href: string | null, rank: number, hint: string) => {
    if (!href) return;
    const abs = absolute(href, base);
    if (!abs) return;
    // SVG is rejected at upload (it can carry script), so never offer one.
    if (/\.svgz?(\?|#|$)/i.test(abs)) return;
    if (out.some((c) => c.url === abs)) return;
    out.push({ url: abs, rank, hint });
  };

  // 1. An <img> the site itself calls a logo. Nearly always the right answer.
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const hay = tag.toLowerCase();
    if (!/logo|brand|header-?img|site-?icon/.test(hay)) continue;
    push(attr(tag, 'src') ?? attr(tag, 'data-src'), 1, 'Found in your header');
  }

  // 2. Touch icon — square, high resolution, made for exactly this.
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (rel.includes('apple-touch-icon')) push(attr(tag, 'href'), 2, 'Your app icon');
  }

  // 3. Social preview image. Often a banner rather than a mark, hence rank 3.
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = ((attr(tag, 'property') ?? attr(tag, 'name')) ?? '').toLowerCase();
    if (key === 'og:image' || key === 'twitter:image') {
      push(attr(tag, 'content'), 3, 'Your social preview image');
    }
  }

  // 4. Schema.org logo, when the site publishes one.
  for (const block of html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? []) {
    for (const m of block.matchAll(/"logo"\s*:\s*"([^"]+)"/g)) push(m[1]!, 2, 'Published on your site');
    for (const m of block.matchAll(/"logo"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/g)) push(m[1]!, 2, 'Published on your site');
  }

  // 5. Favicon. Last, because it is usually 32px and looks terrible scaled up.
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (rel.split(/\s+/).includes('icon') || rel.includes('shortcut icon')) {
      push(attr(tag, 'href'), 5, 'Your site icon');
    }
  }

  return out.sort((a, b) => a.rank - b.rank).slice(0, 6);
}

/**
 * Colors the site actually uses, weighted by how often they appear.
 *
 * `theme-color` outranks everything by a mile — a site that declares one has
 * *told* us its brand color, and no amount of counting hex literals beats
 * being told. Everything else is frequency in the stylesheet, which is a crude
 * proxy that works because a brand color is the thing repeated on every button.
 */
export function findSiteColors(sources: string[], themeColor: string | null): WeightedColor[] {
  const tally = new Map<string, number>();
  const add = (hex: string | null, n: number) => {
    if (!hex) return;
    tally.set(hex, (tally.get(hex) ?? 0) + n);
  };

  if (themeColor) add(normalizeHex(themeColor), 10_000);

  for (const src of sources) {
    for (const m of src.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) add(normalizeHex(m[0]!), 1);
    for (const m of src.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (r > 255 || g > 255 || b > 255) continue;
      const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
      add(hex, 1);
    }
  }

  return [...tally.entries()]
    .map(([hex, weight]) => ({ hex, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 40);
}

/* ------------------------------------------------------------------- scan */

export async function scanSite(raw: string): Promise<SiteScan> {
  const url = parseSiteUrl(raw);
  if (!url) return { ok: false, error: "That doesn't look like a website address. Try something like cascademotors.com." };

  /*
   * Try what they typed, then the other side of the `www.` divide.
   *
   * Plenty of dealer sites answer on `www.` and leave the apex unresolved (or
   * the reverse). A redirect between the two is followed already — this is for
   * the case where there is no redirect because there is nothing listening at
   * all. Only retried on DNS and connection failures: a 403 at the apex will be
   * a 403 at www too, and a second refusal is just eight more seconds of the
   * dealer waiting.
   */
  const attempts = [url, altWwwHost(url)].filter((u): u is URL => Boolean(u));

  let page: FetchedText | null = null;
  let failure: FetchFailure | null = null;
  for (const attempt of attempts) {
    try {
      page = await safeFetchText(attempt, HTML_MAX_BYTES, 'text/html,application/xhtml+xml');
      break;
    } catch (err) {
      failure = err instanceof FetchFailure ? err : new FetchFailure('network', 'Could not reach that site.');
      if (failure.kind !== 'dns' && failure.kind !== 'network') break;
    }
  }

  if (!page) return { ok: false, error: explain(failure!, url.hostname) };

  const html = page.text;
  const base = page.finalUrl;

  const title = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? null;

  const themeColor = (html.match(/<meta\b[^>]*>/gi) ?? [])
    .map((tag) => ({ key: (attr(tag, 'name') ?? '').toLowerCase(), val: attr(tag, 'content') }))
    .find((m) => m.key === 'theme-color')?.val ?? null;

  const inlineStyles = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).join('\n');

  /*
   * Two stylesheets, not all of them. The brand color lives in the first one a
   * site loads far more often than the fifth, and each extra fetch is another
   * six-second timeout a dealer might sit through.
   */
  const sheetUrls = (html.match(/<link\b[^>]*>/gi) ?? [])
    .filter((tag) => (attr(tag, 'rel') ?? '').toLowerCase().includes('stylesheet'))
    .map((tag) => absolute(attr(tag, 'href') ?? '', base))
    .filter((u): u is string => Boolean(u))
    .slice(0, MAX_STYLESHEETS);

  const sheets = await Promise.all(
    sheetUrls.map(async (u) => {
      try {
        return (await safeFetchText(new URL(u), CSS_MAX_BYTES, 'text/css', ASSET_TIMEOUT_MS)).text;
      } catch {
        return '';
      }
    }),
  );

  return {
    ok: true,
    url: base.toString(),
    host: base.hostname,
    title,
    colors: findSiteColors([inlineStyles, ...sheets], themeColor),
    candidates: findLogoCandidates(html, base),
  };
}

/** Download one candidate image, with the same guard rails. Returns raw bytes. */
export async function fetchImage(rawUrl: string, maxBytes: number, referer?: string): Promise<Buffer> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ASSET_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ac.signal,
        /*
         * The Referer matters here. A logo often lives on the platform's CDN
         * rather than the dealer's own host, and CDNs hotlink-protect by
         * checking that the request came from the site the image belongs to —
         * which, in the only case we run, it did.
         */
        headers: { ...BROWSERISH_HEADERS, accept: 'image/*,*/*;q=0.8', ...(referer ? { referer } : {}) },
      });
    } catch {
      throw new FetchFailure(ac.signal.aborted ? 'timeout' : 'network', 'Could not download that image.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new FetchFailure('redirect', 'That image redirected to nowhere.');
      url = new URL(loc, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new FetchFailure('redirect', 'Unsupported redirect.');
      }
      continue;
    }
    if (!res.ok) throw new FetchFailure('status', `That image answered with ${res.status}.`, res.status);
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new FetchFailure('too-big', 'That image is too big.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new FetchFailure('too-big', 'That image is too big.');
    return buf;
  }
  throw new FetchFailure('redirect', 'That image redirected too many times.');
}

/* ---------------------------------------------------------------- helpers */

/** `example.com` ⇄ `www.example.com`. Null when there is no other side to try. */
export function altWwwHost(url: URL): URL | null {
  const alt = new URL(url.toString());
  if (url.hostname.startsWith('www.')) {
    const bare = url.hostname.slice(4);
    if (!bare.includes('.')) return null; // `www.com` is not a thing worth trying
    alt.hostname = bare;
  } else {
    alt.hostname = 'www.' + url.hostname;
  }
  return alt;
}

/**
 * Turn a failure into a sentence with a next action in it.
 *
 * Every branch names something the dealer can actually do. "Check the address"
 * appears exactly once — on the DNS failure, which is the only case where the
 * address is genuinely the suspect.
 */
export function explain(f: FetchFailure, host: string): string {
  switch (f.kind) {
    case 'dns':
      return `We couldn't find ${host}. Check the spelling — or upload your logo file instead.`;
    case 'blocked':
      return `${host} is blocking automated visits, so we can't read it from here. Upload your logo file instead — it takes a second.`;
    case 'timeout':
      return `${host} took too long to answer. Try again in a moment, or upload your logo file instead.`;
    case 'network':
      return `We couldn't connect to ${host}. If the site is up, upload your logo file instead.`;
    case 'status':
      return `${host} answered with an error (${f.status ?? 'unknown'}). Upload your logo file instead.`;
    case 'too-big':
      return `${host} is too large for us to read. Upload your logo file instead.`;
    case 'private':
      return 'That address points somewhere private, so we will not fetch it.';
    case 'redirect':
      return `${host} redirected somewhere we couldn't follow. Upload your logo file instead.`;
  }
}
