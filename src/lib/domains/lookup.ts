/**
 * Rooftop Auto — dealer domain lookup.
 *
 * Given a domain a dealer already owns, find out enough about it to tell them
 * exactly what to change — not a generic help article. Every field returned here
 * exists to drive a specific instruction or a specific warning in
 * `./instructions.ts`.
 *
 * Server-only. Uses `node:dns` rather than shelling out to `dig`, because this
 * runs inside a Vercel function. Note that `proxy.ts` is Node runtime in Next 16,
 * but this module is never called from there — domain lookups happen on the
 * admin path, never on the request path of a storefront.
 *
 * NB: this file is `domains/lookup.ts`, not `domain.ts`. `src/lib/domain.ts` is
 * the dealer *business* math (aging, gross, days in stock) and has nothing to do
 * with DNS.
 */

import 'server-only';
import { Resolver } from 'node:dns/promises';

/** Vercel's documented apex A record and CNAME target. */
export const VERCEL_A_RECORD = '76.76.21.21';
export const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com';

const RESOLVERS = ['1.1.1.1', '8.8.8.8'];
const LOOKUP_TIMEOUT_MS = 5_000;

export type ApexSupport = 'alias' | 'a-only';

export type DnsHost = {
  id: string;
  name: string;
  /**
   * `alias` means the host can flatten a CNAME at the apex (ALIAS / ANAME /
   * CNAME flattening), which survives an IP change. `a-only` means a literal A
   * record is the only option. This is failure mode #3: getting it wrong sends
   * a Bluehost dealer looking for a record type their panel does not have.
   */
  apexSupport: ApexSupport;
  /** Named in the instructions so the dealer knows which screen to open. */
  panel: string;
};

type HostFingerprint = DnsHost & { match: RegExp };

const DNS_HOSTS: HostFingerprint[] = [
  { id: 'cloudflare',  name: 'Cloudflare',        match: /\.ns\.cloudflare\.com$/i,            apexSupport: 'alias',  panel: 'the Cloudflare dashboard → DNS → Records' },
  { id: 'godaddy',     name: 'GoDaddy',           match: /\.domaincontrol\.com$/i,             apexSupport: 'a-only', panel: 'GoDaddy → My Products → Domains → DNS' },
  { id: 'bluehost',    name: 'Bluehost',          match: /\.(bluehost\.com|mybluehost\.me)$/i, apexSupport: 'a-only', panel: 'Bluehost → Domains → DNS' },
  { id: 'hostgator',   name: 'HostGator',         match: /\.hostgator\.com$/i,                 apexSupport: 'a-only', panel: 'HostGator cPanel → Zone Editor' },
  { id: 'namecheap',   name: 'Namecheap',         match: /\.(registrar-servers|namecheaphosting)\.com$/i, apexSupport: 'alias', panel: 'Namecheap → Domain List → Manage → Advanced DNS' },
  { id: 'route53',     name: 'Amazon Route 53',   match: /awsdns/i,                            apexSupport: 'alias',  panel: 'Route 53 → Hosted zones' },
  { id: 'dnsimple',    name: 'DNSimple',          match: /\.dnsimple\.com$/i,                  apexSupport: 'alias',  panel: 'DNSimple → the domain → DNS records' },
  { id: 'googledom',   name: 'Squarespace Domains', match: /\.googledomains\.com$/i,           apexSupport: 'a-only', panel: 'Squarespace Domains → DNS' },
  { id: 'squarespace', name: 'Squarespace',       match: /\.squarespacedns\.com$/i,            apexSupport: 'a-only', panel: 'Squarespace → Settings → Domains' },
  { id: 'wix',         name: 'Wix',               match: /\.wixdns\.net$/i,                    apexSupport: 'a-only', panel: 'Wix → Domains → Advanced' },
  { id: 'networksol',  name: 'Network Solutions', match: /\.worldnic\.com$/i,                  apexSupport: 'a-only', panel: 'Network Solutions → Manage Domains → Edit DNS' },
  { id: 'ionos',       name: 'IONOS',             match: /\.ui-dns\.(com|de|org|biz)$/i,       apexSupport: 'a-only', panel: 'IONOS → Domains & SSL → DNS' },
  { id: 'dreamhost',   name: 'DreamHost',         match: /\.dreamhost\.com$/i,                 apexSupport: 'a-only', panel: 'DreamHost → Manage Domains → DNS' },
  { id: 'siteground',  name: 'SiteGround',        match: /\.siteground\.(net|biz)$/i,          apexSupport: 'a-only', panel: 'SiteGround → Site Tools → Domain → DNS Zone Editor' },
  { id: 'wpengine',    name: 'WP Engine',         match: /\.wpengine\.com$/i,                  apexSupport: 'alias',  panel: 'WP Engine → DNS' },
  { id: 'vercel',      name: 'Vercel',            match: /\.vercel-dns\.com$/i,                apexSupport: 'alias',  panel: 'Vercel → Domains' },
  { id: 'porkbun',     name: 'Porkbun',           match: /\.porkbun\.com$/i,                   apexSupport: 'alias',  panel: 'Porkbun → the domain → DNS Records' },
  // Dealers migrating off a franchise website land here more often than you'd think.
  { id: 'dealercom',   name: 'Dealer.com',        match: /dealer\.com$/i,                      apexSupport: 'a-only', panel: 'your Dealer.com account rep' },
  { id: 'dealeron',    name: 'DealerOn',          match: /dealeron\.com$/i,                    apexSupport: 'a-only', panel: 'your DealerOn account rep' },
  { id: 'dealercarsearch', name: 'Dealer Car Search', match: /dealercarsearch\.com$/i,         apexSupport: 'a-only', panel: 'your Dealer Car Search account rep' },
];

function identifyDnsHost(nameservers: string[]): DnsHost | null {
  for (const ns of nameservers) {
    const hit = DNS_HOSTS.find((h) => h.match.test(ns));
    if (hit) {
      const { match: _match, ...host } = hit;
      return host;
    }
  }
  return null;
}

/* ------------------------------------------------------------ normalisation */

export type NormalizeResult =
  | { ok: true; domain: string; hadWww: boolean; isSubdomain: boolean }
  | { ok: false; error: string };

const MULTI_PART_TLDS = new Set(['co.uk', 'com.au', 'co.nz', 'com.br', 'co.za', 'com.mx']);

/**
 * Dealers paste all sorts of things: `https://www.cascademotorswa.com/inventory`,
 * `WWW.Cascade Motors .com`, an email address, a trailing dot. Get to a bare apex
 * or fail with something a human can act on.
 */
export function normalizeDomain(raw: unknown): NormalizeResult {
  if (typeof raw !== 'string') return { ok: false, error: 'Enter a domain name.' };

  let s = raw.trim().toLowerCase();
  if (!s) return { ok: false, error: 'Enter a domain name.' };

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.replace(/^[^/@]*@/, '');                // pasted an email address
  s = s.split(/[/?#]/)[0]!;                     // path, query, fragment
  s = s.split(':')[0]!;                         // port
  s = s.replace(/\.+$/, '');                    // trailing dot
  s = s.replace(/\s+/g, '');                    // "cascade motors .com"

  if (!s) return { ok: false, error: 'Enter a domain name.' };

  const hadWww = s.startsWith('www.');
  if (hadWww) s = s.slice(4);

  let ascii: string;
  try {
    ascii = new URL(`http://${s}`).hostname; // gives us IDN → punycode for free
  } catch {
    return { ok: false, error: `"${raw.trim()}" doesn't look like a domain name.` };
  }

  if (!ascii.includes('.')) {
    return { ok: false, error: `"${ascii}" is missing a domain ending like .com.` };
  }
  if (!/^[a-z0-9.-]+$/.test(ascii) || ascii.includes('..') || ascii.startsWith('-')) {
    return { ok: false, error: `"${raw.trim()}" doesn't look like a domain name.` };
  }

  const labels = ascii.split('.');
  const multiPart = MULTI_PART_TLDS.has(labels.slice(-2).join('.')) && labels.length === 3;
  const isSubdomain = labels.length > 2 && !multiPart;

  return { ok: true, domain: ascii, hadWww, isSubdomain };
}

/* -------------------------------------------------------------- the lookup */

export type CaaRecord = { critical: number; issue?: string; issuewild?: string; iodef?: string };

export type CaaAnalysis = {
  status: 'none' | 'permissive' | 'permits-letsencrypt' | 'blocks-letsencrypt' | 'blocks-all';
  blocksLetsEncrypt: boolean;
  issuers: string[];
  foundAt: string | null;
  records: CaaRecord[];
};

export type DomainLookup = {
  ok: true;
  domain: string;
  input: { raw: string; hadWww: boolean; isSubdomain: boolean };
  registered: boolean;
  registrar: string | null;
  registrarStatuses: string[];
  expiresAt: string | null;
  rdapAvailable: boolean;
  nameservers: string[];
  dnsHost: DnsHost | null;
  apex: { a: string[]; aaaa: string[]; pointsAtVercel: boolean; inUse: boolean };
  www: { cname: string[]; a: string[]; pointsAtVercel: boolean; inUse: boolean };
  mx: { exchange: string; priority: number }[];
  hasEmail: boolean;
  txt: string[];
  caa: CaaAnalysis;
  checkedAt: string;
};

export type DomainLookupResult = DomainLookup | { ok: false; error: string };

function makeResolver() {
  const r = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 });
  r.setServers(RESOLVERS);
  return r;
}

async function attempt<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return { ok: false };
  }
}

/**
 * CAA is checked at the name and then walked *up* the tree (RFC 8659 §3), so a
 * record on the apex governs `www` too. That is the case that silently kills
 * issuance on a subdomain, which is why we walk rather than checking one name.
 */
async function resolveCaaChain(r: Resolver, domain: string) {
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const name = labels.slice(i).join('.');
    const res = await attempt(() => r.resolveCaa(name));
    if (res.ok && res.value.length) {
      return { foundAt: name, records: res.value as CaaRecord[] };
    }
  }
  return { foundAt: null as string | null, records: [] as CaaRecord[] };
}

const LETSENCRYPT_IDENTIFIERS = ['letsencrypt.org'];

/**
 * The important subtlety: a domain having a CAA record is **not** a problem. A
 * naive check blocks on mere presence and would reject nextjs.org, discourse.org
 * and pizzahut.com, all of which carry CAA records that already permit Let's
 * Encrypt. Only an `issue` set that excludes Let's Encrypt actually blocks us.
 */
export function analyseCaa(caa: { foundAt: string | null; records: CaaRecord[] }): CaaAnalysis {
  if (!caa.records.length) {
    return { status: 'none', blocksLetsEncrypt: false, issuers: [], foundAt: null, records: [] };
  }
  const issueTags = caa.records
    .filter((rec) => typeof rec.issue === 'string')
    .map((rec) => rec.issue!.split(';')[0]!.trim().toLowerCase());

  const issuers = issueTags.filter((v) => v !== ';' && v !== '');
  // `issue ";"` is the explicit "no CA may issue anything" form.
  const forbidsAll = issueTags.some((v) => v === ';' || v === '') && issuers.length === 0;

  if (forbidsAll) {
    return { status: 'blocks-all', blocksLetsEncrypt: true, issuers: [], foundAt: caa.foundAt, records: caa.records };
  }
  if (!issuers.length) {
    // Only iodef / issuewild present — no restriction on issuance itself.
    return { status: 'permissive', blocksLetsEncrypt: false, issuers: [], foundAt: caa.foundAt, records: caa.records };
  }
  const permitsLE = issuers.some((v) => LETSENCRYPT_IDENTIFIERS.includes(v));
  return {
    status: permitsLE ? 'permits-letsencrypt' : 'blocks-letsencrypt',
    blocksLetsEncrypt: !permitsLE,
    issuers,
    foundAt: caa.foundAt,
    records: caa.records,
  };
}

type RdapResult = { registered: boolean; registrar: string | null; statuses: string[]; expiresAt: string | null };

/**
 * RDAP for registrar, status and expiry. Advisory only — every instruction we
 * emit keys off DNS, which we can always see. Returns null when RDAP is
 * unreachable so callers can distinguish "not registered" from "couldn't ask".
 */
async function lookupRdap(domain: string): Promise<RdapResult | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: { accept: 'application/rdap+json' },
        signal: ctrl.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return { registered: false, registrar: null, statuses: [], expiresAt: null };
    if (!res.ok) return null;

    const body = (await res.json()) as {
      entities?: { roles?: string[]; handle?: string; vcardArray?: unknown[] }[];
      status?: string[];
      events?: { eventAction?: string; eventDate?: string }[];
    };

    const registrarEntity = (body.entities ?? []).find((e) => (e.roles ?? []).includes('registrar'));
    let registrar: string | null = null;
    if (registrarEntity) {
      const vcard = (registrarEntity.vcardArray?.[1] as unknown[] | undefined) ?? [];
      const fn = (vcard as [string, unknown, string, string][]).find((f) => f?.[0] === 'fn');
      registrar = fn?.[3] ?? registrarEntity.handle ?? null;
    }
    const expiry = (body.events ?? []).find((e) => e.eventAction === 'expiration');

    return {
      registered: true,
      registrar,
      statuses: body.status ?? [],
      expiresAt: expiry?.eventDate ?? null,
    };
  } catch {
    return null;
  }
}

/** The full picture of a domain the dealer already owns. */
export async function lookupDomain(rawDomain: string): Promise<DomainLookupResult> {
  const norm = normalizeDomain(rawDomain);
  if (!norm.ok) return { ok: false, error: norm.error };

  const { domain } = norm;
  const r = makeResolver();

  const [ns, apexA, apexAaaa, wwwCname, wwwA, mx, txt, caaRaw, rdap] = await Promise.all([
    attempt(() => r.resolveNs(domain)),
    attempt(() => r.resolve4(domain)),
    attempt(() => r.resolve6(domain)),
    attempt(() => r.resolveCname(`www.${domain}`)),
    attempt(() => r.resolve4(`www.${domain}`)),
    attempt(() => r.resolveMx(domain)),
    attempt(() => r.resolveTxt(domain)),
    resolveCaaChain(r, domain),
    lookupRdap(domain),
  ]);

  const nameservers = ns.ok ? ns.value.map((n) => n.toLowerCase().replace(/\.$/, '')).sort() : [];
  const caa = analyseCaa(caaRaw);
  const resolvesAtAll = nameservers.length > 0 || apexA.ok || wwwCname.ok;

  const wwwCnames = wwwCname.ok ? wwwCname.value.map((c) => c.toLowerCase().replace(/\.$/, '')) : [];
  const wwwAs = wwwA.ok ? wwwA.value : [];

  return {
    ok: true,
    domain,
    input: { raw: rawDomain, hadWww: norm.hadWww, isSubdomain: norm.isSubdomain },
    registered: rdap ? rdap.registered : resolvesAtAll,
    registrar: rdap?.registrar ?? null,
    registrarStatuses: rdap?.statuses ?? [],
    expiresAt: rdap?.expiresAt ?? null,
    rdapAvailable: rdap !== null,
    nameservers,
    dnsHost: identifyDnsHost(nameservers),
    apex: {
      a: apexA.ok ? apexA.value : [],
      aaaa: apexAaaa.ok ? apexAaaa.value : [],
      pointsAtVercel: apexA.ok && apexA.value.includes(VERCEL_A_RECORD),
      inUse: apexA.ok && apexA.value.length > 0,
    },
    www: {
      cname: wwwCnames,
      a: wwwAs,
      pointsAtVercel:
        wwwCnames.some((c) => c.includes('vercel-dns.com')) || wwwAs.includes(VERCEL_A_RECORD),
      inUse: wwwCnames.length > 0 || wwwAs.length > 0,
    },
    mx: mx.ok ? mx.value.map((m) => ({ exchange: m.exchange.toLowerCase(), priority: m.priority })) : [],
    hasEmail: mx.ok && mx.value.length > 0,
    txt: txt.ok ? txt.value.map((chunks) => chunks.join('')) : [],
    caa,
    checkedAt: new Date().toISOString(),
  };
}
