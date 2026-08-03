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

/**
 * ENDPOINT HISTORY, because this bit was already rebuilt once: the original
 * implementation used `/v4/domains/status`, `/v4/domains/price` and
 * `/v5/domains/buy`. Vercel **sunsetted all three on 9 Nov 2025** and replaced
 * them with the `/v1/registrar/*` API. The old paths now return a sunset notice
 * rather than data. Everything below is the current contract, taken from the
 * endpoint reference — including the field names, which changed too
 * (`postalCode` → `zip`, flat contact fields → nested `contactInformation`).
 */

export type Availability = { available: boolean };

/**
 * One call gives all three prices, which is why the renewal guardrail is cheap:
 * we do not have to ask twice, and we can never end up with a first-year price
 * and no renewal to check it against.
 */
export type DomainPrice = {
  years: number;
  purchasePrice: number | string;
  renewalPrice: number | string;
  transferPrice: number | string;
};

/** Prices come back as number or string depending on TLD. Normalise once. */
function toNumber(v: number | string | undefined | null): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function checkAvailability(domain: string): Promise<boolean> {
  const r = await vercelFetch<Availability>(
    `/v1/registrar/domains/${encodeURIComponent(domain)}/availability`,
  );
  return Boolean(r.available);
}

export async function getPrice(domain: string, years = 1): Promise<DomainPrice> {
  return vercelFetch<DomainPrice>(
    `/v1/registrar/domains/${encodeURIComponent(domain)}/price?years=${years}`,
  );
}

/** TLD-specific required contact fields, so the ICANN form asks the right things. */
export async function getContactInfoSchema(tld: string): Promise<unknown> {
  return vercelFetch(`/v1/registrar/tlds/${encodeURIComponent(tld)}/contact-info-schema`);
}

export async function getSupportedTlds(): Promise<unknown> {
  return vercelFetch('/v1/registrar/tlds/supported');
}

/* ------------------------------------------------------------- the quote */

export type QuoteRejection = {
  ok: false;
  reason:
    | 'unavailable'
    | 'tld-not-allowed'
    | 'premium'
    | 'over-price-cap'
    | 'over-renewal-cap'
    | 'no-price'
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
 * Everything the buy path needs is decided here, on the server, from Vercel's
 * own numbers. The client supplies a domain name and receives a quote it cannot
 * influence.
 */
export async function quoteDomain(rawDomain: string, years = 1): Promise<QuoteResult> {
  const domain = rawDomain.trim().toLowerCase();
  const tld = tldOf(domain);

  // Guardrail 2a: allowlisted TLDs only, before we spend an API call.
  if (!ALLOWED_TLDS.has(tld)) {
    return {
      ok: false,
      reason: 'tld-not-allowed',
      message:
        `We don't sell .${tld} domains. Stick to .com if you can — it's what customers type by ` +
        `default, and it's the one that still wins a tie.`,
    };
  }

  try {
    if (!(await checkAvailability(domain))) {
      return {
        ok: false,
        reason: 'unavailable',
        message:
          `${domain} is already registered. Try a variation, or use "I already own a domain" if it's yours.`,
      };
    }

    const price = await getPrice(domain, years);
    const priceUsd = toNumber(price.purchasePrice);
    const renewalUsd = toNumber(price.renewalPrice);

    if (priceUsd === null) {
      return {
        ok: false,
        reason: 'no-price',
        message: `We couldn't get a price for ${domain}. Try another name.`,
      };
    }

    /*
     * Guardrail 4 first, and fail closed: if Vercel will not quote a renewal we
     * refuse rather than assume it is cheap. An unknown recurring cost on
     * Litespeed's card is the exact thing the cap exists to prevent.
     */
    if (renewalUsd === null) {
      return {
        ok: false,
        reason: 'over-renewal-cap',
        message:
          `We couldn't get a renewal price for ${domain}, so we won't register it automatically. ` +
          `Pick another name, or ask us to look at it by hand.`,
        priceUsd: Math.ceil(priceUsd),
      };
    }

    const first = Math.ceil(priceUsd);
    const renewal = Math.ceil(renewalUsd);

    /*
     * Guardrail 2b: premium detection. Vercel does not always flag a premium
     * explicitly, but it always prices one — a domain quoted well above the
     * standard registration fee is a premium by definition. Treating
     * "expensive" as "premium" is the conservative direction to be wrong in.
     */
    if (first > DOMAIN_PRICE_CAP_USD) {
      return {
        ok: false,
        reason: first > DOMAIN_PRICE_CAP_USD * 3 ? 'premium' : 'over-price-cap',
        message:
          `${domain} costs $${first} for the first year, which is above what we register ` +
          `automatically. It's likely a premium name held for resale. Pick another one, or ask us ` +
          `and we'll look at it by hand.`,
        priceUsd: first,
        renewalPriceUsd: renewal,
      };
    }

    if (renewal > DOMAIN_RENEWAL_CAP_USD) {
      return {
        ok: false,
        reason: 'over-renewal-cap',
        message:
          `${domain} is $${first} for the first year but renews at $${renewal} a year after that. ` +
          `That's above what we register automatically. Pick a name with a normal renewal price.`,
        priceUsd: first,
        renewalPriceUsd: renewal,
      };
    }

    return {
      ok: true,
      domain,
      priceUsd: first,
      renewalPriceUsd: renewal,
      years: price.years ?? years,
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

/**
 * Vercel requires E.164 with an optional dot separator:
 *   ^(?=(?:\D*\d){8,15}$)\+[1-9]\d{0,2}\.?\d+$
 *
 * A dealer types "(360) 555-0142". That is rejected outright, and the rejection
 * would arrive *after* they filled in a ten-field ICANN form — so normalise it
 * here rather than making them guess the format.
 */
export function toE164(raw: string, defaultCountryCode = '1'): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  let cc: string;
  let rest: string;
  if (trimmed.startsWith('+')) {
    // Already international: assume 1–3 digit country code.
    cc = digits.slice(0, digits.length > 11 ? 2 : 1);
    rest = digits.slice(cc.length);
  } else if (digits.length === 10) {
    cc = defaultCountryCode;
    rest = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    cc = '1';
    rest = digits.slice(1);
  } else {
    cc = defaultCountryCode;
    rest = digits;
  }

  const out = `+${cc}.${rest}`;
  return /^(?=(?:\D*\d){8,15}$)\+[1-9]\d{0,2}\.?\d+$/.test(out) ? out : null;
}

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
 * moved or a cap is breached — the caller's quote may be minutes old, and a
 * stale quote is exactly how you end up buying something expensive.
 * `expectedPrice` then gives Vercel a second, independent chance to reject.
 */
export async function buyDomain(input: BuyInput): Promise<BuyResult> {
  const fresh = await quoteDomain(input.domain, input.years);
  if (!fresh.ok) return { ok: false, reason: fresh.reason, message: fresh.message };

  if (fresh.priceUsd !== input.expectedPriceUsd) {
    return {
      ok: false,
      reason: 'price-changed',
      message:
        `The price for ${input.domain} changed from $${input.expectedPriceUsd} to $${fresh.priceUsd} ` +
        `while you were filling in the form. Nothing has been charged — check the new price and try again.`,
    };
  }

  const phone = toE164(input.registrant.phone);
  if (!phone) {
    return {
      ok: false,
      reason: 'invalid-phone',
      message: `"${input.registrant.phone}" isn't a phone number we can register a domain with. Use a 10-digit US number.`,
    };
  }

  try {
    const res = await vercelFetch<{ orderId?: string }>(
      `/v1/registrar/domains/${encodeURIComponent(fresh.domain)}/buy`,
      {
        method: 'POST',
        timeoutMs: 60_000, // registry round-trips are slow; a timeout here is ambiguous, not free
        body: {
          autoRenew: input.autoRenew,
          years: input.years,
          expectedPrice: fresh.priceUsd,
          contactInformation: {
            firstName: input.registrant.firstName,
            lastName: input.registrant.lastName,
            email: input.registrant.email,
            phone,
            address1: input.registrant.address1,
            ...(input.registrant.address2 ? { address2: input.registrant.address2 } : {}),
            city: input.registrant.city,
            state: input.registrant.state,
            zip: input.registrant.zip,
            country: input.registrant.country,
            ...(input.registrant.companyName ? { companyName: input.registrant.companyName } : {}),
          },
        },
      },
    );
    return {
      ok: true,
      orderId: res.orderId ?? null,
      domain: fresh.domain,
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
      if (err.code === 'additional_contact_info_required' || err.code === 'invalid_additional_contact_info') {
        return {
          ok: false,
          reason: 'contact-info',
          message:
            `.${tldOf(input.domain)} needs extra owner details we don't collect yet. Pick a .com, or ask us to register it by hand.`,
        };
      }
      return { ok: false, reason: err.code ?? 'api-error', message: err.message };
    }
    return { ok: false, reason: 'api-error', message: 'The purchase could not be completed.' };
  }
}

/** Order status, for a purchase that did not complete synchronously. */
export async function getDomainOrder(orderId: string): Promise<unknown> {
  return vercelFetch(`/v1/registrar/orders/${encodeURIComponent(orderId)}`);
}

/**
 * Transfer-out auth code. A dealer who cancels must be able to take a domain
 * they paid toward — `claude/billing-and-domain-economics.md` §3. Mechanically
 * possible, so it should never require an email to support.
 */
export async function getTransferAuthCode(domain: string): Promise<string | null> {
  const r = await vercelFetch<{ authCode?: string }>(
    `/v1/registrar/domains/${encodeURIComponent(domain)}/auth-code`,
  );
  return r.authCode ?? null;
}
