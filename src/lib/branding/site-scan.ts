/**
 * "Add my logo" — the website half.
 *
 * A dealer who cannot find their logo file can almost always type their website
 * address, and their logo is sitting in the header of it. This module fetches
 * that page and pulls out the two things the Design card needs: candidate logo
 * images, and the colours the site already uses.
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
 * dealer as text — we return parsed colours and image URLs, not the body — so
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
const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;

const UA = 'RooftopAutoBot/1.0 (+https://rooftopauto.com; dealer logo import)';

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
  const addrs = await lookup(hostname, { all: true });
  if (!addrs.length) throw new Error('That address does not resolve.');
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) throw new Error('That address points somewhere private.');
  }
}

type FetchedText = { text: string; finalUrl: URL };

/** Fetch text with the guard rails described at the top of this file. */
async function safeFetchText(start: URL, maxBytes: number, accept: string): Promise<FetchedText> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ac.signal,
        headers: { 'user-agent': UA, accept },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('That site redirected to nowhere.');
      const next = new URL(loc, url);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new Error('That site redirected somewhere we will not follow.');
      }
      url = next;
      continue;
    }

    if (!res.ok) throw new Error('That site answered with ' + res.status + '.');

    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > maxBytes) throw new Error('That page is too large to read.');

    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error('That page is too large to read.');
    return { text: new TextDecoder('utf-8').decode(buf), finalUrl: url };
  }
  throw new Error('That site redirected too many times.');
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
 * Colours the site actually uses, weighted by how often they appear.
 *
 * `theme-color` outranks everything by a mile — a site that declares one has
 * *told* us its brand colour, and no amount of counting hex literals beats
 * being told. Everything else is frequency in the stylesheet, which is a crude
 * proxy that works because a brand colour is the thing repeated on every button.
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

  let page: FetchedText;
  try {
    page = await safeFetchText(url, HTML_MAX_BYTES, 'text/html,application/xhtml+xml');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reach that site.';
    return { ok: false, error: /private|resolve|redirect|large/.test(msg) ? msg : `Couldn't load ${url.hostname}. Check the address and try again.` };
  }

  const html = page.text;
  const base = page.finalUrl;

  const title = html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? null;

  const themeColor = (html.match(/<meta\b[^>]*>/gi) ?? [])
    .map((tag) => ({ key: (attr(tag, 'name') ?? '').toLowerCase(), val: attr(tag, 'content') }))
    .find((m) => m.key === 'theme-color')?.val ?? null;

  const inlineStyles = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? []).join('\n');

  /*
   * Two stylesheets, not all of them. The brand colour lives in the first one a
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
        return (await safeFetchText(new URL(u), CSS_MAX_BYTES, 'text/css')).text;
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
export async function fetchImage(rawUrl: string, maxBytes: number): Promise<Buffer> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url.hostname);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': UA, accept: 'image/*' } });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('That image redirected to nowhere.');
      url = new URL(loc, url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported redirect.');
      continue;
    }
    if (!res.ok) throw new Error('That image answered with ' + res.status + '.');
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw new Error('That image is too big.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error('That image is too big.');
    return buf;
  }
  throw new Error('That image redirected too many times.');
}
