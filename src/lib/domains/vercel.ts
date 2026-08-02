/**
 * Rooftop Auto — Vercel Domains + Registrar API client.
 *
 * TWO DIFFERENT KINDS OF CALL LIVE IN THIS FILE, and the difference matters:
 *
 *   - Project domain calls (add / verify / get / remove) are free and reversible.
 *   - Registrar calls (`buy`) **spend Litespeed's money on Litespeed's card.**
 *     Per `claude/billing-and-domain-economics.md` §2, Litespeed pays Vercel and
 *     the dealer is charged separately, so an unguarded search-and-buy is a way
 *     for a dealer to spend David's money. The guardrails below are the feature,
 *     not an afterthought.
 *
 * The four guardrails, all enforced **server-side**:
 *   1. Price ceiling via `expectedPrice`, computed here and never taken from the
 *      client. Vercel rejects a mismatch with `expected_price_mismatch`.
 *   2. Premium domains excluded outright — they are what turns a $15 ceiling
 *      into four figures.
 *   3. One domain per storefront, plus a hard account-level cap. Enforced by the
 *      caller in `actions.ts` against the database; the constants live here.
 *   4. The **renewal** price is checked against the cap and recorded, not just
 *      the first year. A $9 first year can renew at $40.
 *
 * `autoRenew` is a required field on purchase, so it is required in our types
 * too rather than defaulted silently.
 *
 * SECRET HANDLING: `VERCEL_API_TOKEN` buys domains. It is read only inside this
 * module, this module is `server-only`, and no function here returns the token
 * or echoes it into an error. Set it in Vercel env vars the same way
 * `BETTER_AUTH_SECRET` is — Production and Preview, never in a client bundle.
 */

import 'server-only';
import type { DomainChallenge, RegistrantContact } from '@/db/schema';

const API = 'https://api.vercel.com';

/* -------------------------------------------------------------- the caps */

/**
 * Hard ceiling for a single domain's first year, in whole dollars. A normal
 * `.com` is $10–15; anything above this is either a premium or a TLD we have no
 * business auto-buying for a used-car lot.
 */
export const DOMAIN_PRICE_CAP_USD = Number(process.env.DOMAIN_PRICE_CAP_USD ?? 25);

/**
 * Ceiling for the *renewal*, checked separately. Renewals are routinely higher
 * than the promotional first year, and year two should be a decision rather than
 * a surprise on the statement.
 */
export const DOMAIN_RENEWAL_CAP_USD = Number(process.env.DOMAIN_RENEWAL_CAP_USD ?? 45);

/** Account-level cap: total purchased domains per dealer group without a human. */
export const DOMAINS_PER_GROUP_CAP = Number(process.env.DOMAINS_PER_GROUP_CAP ?? 3);

/**
 * TLDs we will auto-buy. An allowlist, not a denylist — a denylist means the
 * next weird TLD is purchasable by default, and some of them renew at $200.
 */
export const ALLOWED_TLDS = new Set(
  (process.env.DOMAIN_ALLOWED_TLDS ?? 'com,net,org,auto,cars,us,co,biz,motors')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
);

/* ------------------------------------------------------------ base client */

export class VercelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'VercelApiError';
  }
}

function requireToken(): string {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) {
    throw new VercelApiError(
      'VERCEL_API_TOKEN is not set. Domain features are disabled until it is.',
      500,
      'missing_token',
    );
  }
  return token;
}

function teamQuery(): string {
  const teamId = process.env.VERCEL_TEAM_ID;
  return teamId ? `teamId=${encodeURIComponent(teamId)}` : '';
}

function withTeam(path: string): string {
  const q = teamQuery();
  if (!q) return path;
  return path.includes('?') ? `${path}&${q}` : `${path}?${q}`;
}

export function domainsConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
}

async function vercelFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const token = requireToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15_000);

  let res: Response;
  try {
    res = await fetch(`${API}${withTeam(path)}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
  } catch (err) {
    throw new VercelApiError(
      err instanceof Error && err.name === 'AbortError'
        ? 'Vercel took too long to respond.'
        : 'Could not reach Vercel.',
      504,
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const errObj = (json as { error?: { code?: string; message?: string } }).error;
    // Deliberately does not include the request headers: the token must never
    // reach a log line or an error surfaced to a dealer.
    throw new VercelApiError(
      errObj?.message ?? `Vercel returned ${res.status}.`,
      res.status,
      errObj?.code ?? null,
    );
  }
  return json as T;
}

/* --------------------------------------------------- project domains (free) */

export type VercelProjectDomain = {
  name: string;
  apexName?: string;
  verified: boolean;
  verification?: DomainChallenge[];
  redirect?: string | null;
  createdAt?: number;
};

function projectId(): string {
  const id = process.env.VERCEL_PROJECT_ID;
  if (!id) throw new VercelApiError('VERCEL_PROJECT_ID is not set.', 500, 'missing_project');
  return id;
}

/** `POST /v10/projects/{id}/domains`. Idempotent enough — an existing domain 409s. */
export async function addProjectDomain(domain: string): Promise<VercelProjectDomain> {
  return vercelFetch<VercelProjectDomain>(`/v10/projects/${encodeURIComponent(projectId())}/domains`, {
    method: 'POST',
    body: { name: domain },
  });
}

export async function getProjectDomain(domain: string): Promise<VercelProjectDomain> {
  return vercelFetch<VercelProjectDomain>(
    `/v9/projects/${encodeURIComponent(projectId())}/domains/${encodeURIComponent(domain)}`,
  );
}

/** Asks Vercel to re-check DNS now rather than waiting for its own sweep. */
export async function verifyProjectDomain(domain: string): Promise<VercelProjectDomain> {
  return vercelFetch<VercelProjectDomain>(
    `/v9/projects/${encodeURIComponent(projectId())}/domains/${encodeURIComponent(domain)}/verify`,
    { method: 'POST' },
  );
}

export async function removeProjectDomain(domain: string): Promise<void> {
  await vercelFetch(
    `/v9/projects/${encodeURIComponent(projectId())}/domains/${encodeURIComponent(domain)}`,
    { method: 'DELETE' },
  );
}

/** Certificate state. Vercel issues automatically; this is what we poll to show it. */
export type DomainConfig = { misconfigured: boolean; configuredBy?: string | null };

export async function getDomainConfig(domain: string): Promise<DomainConfig> {
  return vercelFetch<DomainConfig>(`/v6/domains/${encodeURIComponent(domain)}/config`);
}

/* ------------------------------------------------ registrar (spends money) */

export type Availability = { available: boolean };
export type PriceInfo = { price: number; period: number };

export async function checkAvailability(domain: string): Promise<boolean> {
  const r = await vercelFetch<Availability>(`/v4/domains/status?name=${encodeURIComponent(domain)}`);
  return Boolean(r.available);
}

/**
 * `type` distinguishes the promotional first year from the recurring price.
 * We always ask for both — see guardrail 4.
 */
export async function getPrice(domain: string, type: 'new' | 'renewal' = 'new'): Promise<PriceInfo> {
  return vercelFetch<PriceInfo>(
    `/v4/domains/price?name=${encodeURIComponent(domain)}&type=${type}`,
  );
}

/** TLD-specific required contact fields, so the ICANN form asks for the right things. */
export async function getTldContactSchema(tld: string): Promise<unknown> {
  return vercelFetch(`/v4/domains/tlds/${encodeURIComponent(tld)}`);
}

/* ------------------------------------------------------------- the quote */

export type QuoteRejection = {
  ok: false;
  /** Machine-readable so the UI can branch; every one is dealer-visible copy. */
  reason:
    | 'unavailable'
    | 'tld-not-allowed'
    | 'premium'
    | 'over-price-cap'
    | 'over-renewal-cap'
    | 'api-error';
  message: string;
  priceUsd?: number;
  renewalPriceUsd?: number;
};

export type Quote = {
  ok: true;
  domain: string;
  priceUsd: number;
  renewalPriceUsd: number;
  years: number;
  capUsd: number;
  renewalCapUsd: number;
};

export type QuoteResult = Quote | QuoteRejection;

export function tldOf(domain: string): string {
  return domain.split('.').pop()!.toLowerCase();
}

/**
 * The single chokepoint for "may we buy this, and for how much".
 *
 * Everything the buy path needs to know is decided here, on the server, from
 * Vercel's own numbers. The client never supplies a price — it supplies a
 * domain name, and gets back a quote it cannot influence.
 */
export async function quoteDomain(rawDomain: string, years = 1): Promise<QuoteResult> {
  const domain = rawDomain.trim().toLowerCase();
  const tld = tldOf(domain);

  // Guardrail 2a: allowlisted TLDs only, checked before we spend an API call.
  if (!ALLOWED_TLDS.has(tld)) {
    return {
      ok: false,
      reason: 'tld-not-allowed',
      message:
        `We don't sell .${tld} domains. Stick to .com if you can — it's what customers type by default, ` +
        `and it's the one that still wins a tie.`,
    };
  }

  try {
    if (!(await checkAvailability(domain))) {
      return {
        ok: false,
        reason: 'unavailable',
        message: `${domain} is already registered. Try a variation, or use the "I already own a domain" option if it's yours.`,
      };
    }

    const [newPrice, renewalPrice] = await Promise.all([
      getPrice(domain, 'new'),
      getPrice(domain, 'renewal').catch(() => null),
    ]);

    const priceUsd = Math.ceil(newPrice.price * years);
    // If Vercel won't quote a renewal, assume the worst rather than the best.
    const renewalPriceUsd = renewalPrice ? Math.ceil(renewalPrice.price) : DOMAIN_RENEWAL_CAP_USD + 1;

    /*
     * Guardrail 2b: premium detection. Vercel does not always flag a premium
     * explicitly, but it always prices one — a .com quoted well above the
     * standard registration fee is a premium by definition. Treating "expensive"
     * as "premium" is the conservative direction to be wrong in.
     */
    if (priceUsd > DOMAIN_PRICE_CAP_USD) {
      return {
        ok: false,
        reason: priceUsd > DOMAIN_PRICE_CAP_USD * 3 ? 'premium' : 'over-price-cap',
        message:
          `${domain} costs $${priceUsd} for the first year, which is above what we register ` +
          `automatically. It's likely a premium name held for resale. Pick another one, or ask us and ` +
          `we'll look at it by hand.`,
        priceUsd,
        renewalPriceUsd,
      };
    }

    // Guardrail 4: the renewal is the real cost.
    if (renewalPriceUsd > DOMAIN_RENEWAL_CAP_USD) {
      return {
        ok: false,
        reason: 'over-renewal-cap',
        message:
          `${domain} is $${priceUsd} for the first year but renews at $${renewalPriceUsd} a year after ` +
          `that. That's above what we register automatically. Pick a name with a normal renewal price.`,
        priceUsd,
        renewalPriceUsd,
      };
    }

    return {
      ok: true,
      domain,
      priceUsd,
      renewalPriceUsd,
      years,
      capUsd: DOMAIN_PRICE_CAP_USD,
      renewalCapUsd: DOMAIN_RENEWAL_CAP_USD,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'api-error',
      message:
        err instanceof VercelApiError
          ? `We couldn't check that domain right now (${err.message}). Try again in a moment.`
          : "We couldn't check that domain right now. Try again in a moment.",
    };
  }
}

/* --------------------------------------------------------------- the buy */

export type BuyInput = {
  domain: string;
  years: number;
  /** Required by Vercel, so required here. No silent default. */
  autoRenew: boolean;
  /** The dealer's details. Never Litespeed's — see schema `RegistrantContact`. */
  registrant: RegistrantContact;
  /** The quote this purchase was authorised against. */
  expectedPriceUsd: number;
};

export type BuyResult =
  | { ok: true; orderId: string | null; domain: string; pricePaidUsd: number }
  | { ok: false; reason: string; message: string };

/**
 * Buy a domain. **This spends money.**
 *
 * Re-quotes from scratch immediately before purchase and refuses if the price
 * moved or the caps are breached — the caller's quote may be minutes old and a
 * stale quote is exactly how you end up buying something expensive. `expectedPrice`
 * then gives Vercel a second, independent chance to reject on mismatch.
 */
export async function buyDomain(input: BuyInput): Promise<BuyResult> {
  const fresh = await quoteDomain(input.domain, input.years);
  if (!fresh.ok) {
    return { ok: false, reason: fresh.reason, message: fresh.message };
  }
  if (fresh.priceUsd !== input.expectedPriceUsd) {
    return {
      ok: false,
      reason: 'price-changed',
      message:
        `The price for ${input.domain} changed from $${input.expectedPriceUsd} to $${fresh.priceUsd} ` +
        `while you were filling in the form. Nothing has been charged — check the new price and try again.`,
    };
  }

  try {
    const res = await vercelFetch<{ orderId?: string; domain?: { name?: string } }>('/v5/domains/buy', {
      method: 'POST',
      timeoutMs: 60_000, // registry round-trips are slow; a timeout here is ambiguous, not free
      body: {
        name: fresh.domain,
        expectedPrice: fresh.priceUsd,
        renew: input.autoRenew,
        years: input.years,
        country: input.registrant.country,
        orgName: input.registrant.companyName || undefined,
        firstName: input.registrant.firstName,
        lastName: input.registrant.lastName,
        address1: input.registrant.address1,
        city: input.registrant.city,
        state: input.registrant.state,
        postalCode: input.registrant.postalCode,
        phone: input.registrant.phone,
        email: input.registrant.email,
      },
    });
    return {
      ok: true,
      orderId: res.orderId ?? null,
      domain: res.domain?.name ?? fresh.domain,
      pricePaidUsd: fresh.priceUsd,
    };
  } catch (err) {
    if (err instanceof VercelApiError) {
      // Vercel's own ceiling errors, surfaced as themselves rather than "something went wrong".
      if (err.code === 'expected_price_mismatch') {
        return {
          ok: false,
          reason: 'price-changed',
          message: `The price for ${input.domain} changed before the purchase went through. Nothing was charged.`,
        };
      }
      if (err.code === 'order_too_expensive') {
        return {
          ok: false,
          reason: 'over-price-cap',
          message: `${input.domain} costs more than we register automatically. Nothing was charged.`,
        };
      }
      return { ok: false, reason: err.code ?? 'api-error', message: err.message };
    }
    return { ok: false, reason: 'api-error', message: 'The purchase could not be completed.' };
  }
}

/**
 * Transfer-out auth code. A dealer who cancels must be able to take a domain
 * they paid toward — `claude/billing-and-domain-economics.md` §3. Mechanically
 * possible, so it should never require an email to support.
 */
export async function getTransferAuthCode(domain: string): Promise<string | null> {
  const r = await vercelFetch<{ authCode?: string }>(
    `/v4/domains/${encodeURIComponent(domain)}/auth-code`,
  );
  return r.authCode ?? null;
}
