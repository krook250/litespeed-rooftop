'use server';

/**
 * Server actions for dealer domains and storefront branding.
 *
 * TENANT SCOPING: every action here resolves the storefront through
 * `assertStorefrontInScope(await sessionScope(), id)` before it reads or writes.
 * The storefront id arrives off a FormData and is therefore attacker-controlled;
 * this is the same hole that had to be closed on the vehicle write paths in §4 of
 * `claude/auth-hosting-and-scale.md`, and it is closed the same way.
 *
 * MONEY: `purchaseDomain` is the only action that spends anything. Its guardrails
 * are layered on purpose — database caps here, price caps in `./vercel.ts`, and
 * `expectedPrice` at Vercel — because any single one of them can be wrong.
 */

import { revalidatePath } from 'next/cache';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { getSessionUser, requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertStorefrontInScope } from '@/lib/scoped-db';
import { lookupDomain } from './lookup';
import { buildInstructions, type Instructions } from './instructions';
import {
  DOMAINS_PER_GROUP_CAP,
  VercelApiError,
  addProjectDomain,
  buyDomain,
  domainsConfigured,
  getDomainConfig,
  getProjectDomain,
  quoteDomain,
  removeProjectDomain,
  verifyProjectDomain,
  type QuoteResult,
} from './vercel';
import { emitDomainBlocked, emitDomainLive, emitDomainPointed, emitDomainPurchased } from './feed';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

const PUBLIC_STATUSES = ['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'] as const;

/** Units the storefront actually shows — the number that goes on the feed card. */
async function publicUnitCount(storefrontId: string): Promise<number> {
  const links = await db
    .select({ rooftopId: t.storefrontRooftops.rooftopId })
    .from(t.storefrontRooftops)
    .where(eq(t.storefrontRooftops.storefrontId, storefrontId));
  if (!links.length) return 0;

  // Counted in the database across every rooftop the storefront fronts, because
  // a virtual storefront consolidates several physical lots into one website.
  const [row] = await db
    .select({ n: count() })
    .from(t.vehicles)
    .where(
      and(
        inArray(t.vehicles.rooftopId, links.map((l) => l.rooftopId)),
        inArray(t.vehicles.status, [...PUBLIC_STATUSES]),
      ),
    );
  return row?.n ?? 0;
}

async function firstRooftopId(storefrontId: string): Promise<string | null> {
  const links = await db
    .select({ rooftopId: t.storefrontRooftops.rooftopId })
    .from(t.storefrontRooftops)
    .where(eq(t.storefrontRooftops.storefrontId, storefrontId))
    .limit(1);
  return links[0]?.rooftopId ?? null;
}

/* ------------------------------------------------------ 1. bring your own */

/**
 * Look a domain up and return the dealer-specific instructions. Read-only: it
 * touches DNS and RDAP but changes nothing, so it is safe to call on every
 * keystroke-debounced preview.
 */
export async function previewDomain(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<Instructions>> {
  const raw = String(formData.get('domain') ?? '');
  const storefrontId = String(formData.get('storefrontId') ?? '');

  const sf = await assertStorefrontInScope(await sessionScope(), storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const lookup = await lookupDomain(raw);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  // Someone else's storefront already answers on this hostname.
  const taken = await db
    .select({ id: t.storefronts.id })
    .from(t.storefronts)
    .where(and(eq(t.storefronts.domain, lookup.domain), ne(t.storefronts.id, storefrontId)))
    .limit(1);
  if (taken.length) {
    return { ok: false, error: `${lookup.domain} is already connected to another Rooftop storefront.` };
  }

  return { ok: true, data: buildInstructions(lookup) };
}

/**
 * Attach the domain: register it with Vercel, store the verification challenges
 * against `storefronts.domain`, and start the status clock.
 *
 * Refuses while a pre-flight blocker stands. That is the point of checking CAA
 * before we promise SSL — attaching a domain whose certificate provably cannot
 * issue produces a dealer watching a spinner forever.
 */
export async function attachDomain(_prev: unknown, formData: FormData): Promise<ActionResult> {
  if (!domainsConfigured()) {
    return { ok: false, error: 'Domain support is not configured yet. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID.' };
  }

  const storefrontId = String(formData.get('storefrontId') ?? '');
  const raw = String(formData.get('domain') ?? '');
  const scope = await sessionScope();
  const sf = await assertStorefrontInScope(scope, storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const lookup = await lookupDomain(raw);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  const instructions = buildInstructions(lookup);
  if (instructions.ok && instructions.state === 'blocked') {
    const rooftopId = await firstRooftopId(storefrontId);
    if (rooftopId) {
      await emitDomainBlocked({
        rooftopId,
        domain: lookup.domain,
        unitCount: await publicUnitCount(storefrontId),
        reason: instructions.blockers[0]?.title ?? 'Something needs fixing first.',
        blockerCount: instructions.blockers.length,
      });
    }
    await db
      .update(t.storefronts)
      .set({
        domain: lookup.domain,
        domainSource: 'BYO',
        domainStatus: 'BLOCKED',
        domainError: instructions.blockers[0]?.title ?? null,
        domainAddedAt: new Date(),
        domainCheckedAt: new Date(),
      })
      .where(eq(t.storefronts.id, storefrontId));
    revalidatePath('/admin/website');
    return { ok: false, error: instructions.blockers[0]?.title ?? 'This domain needs a fix first.' };
  }

  try {
    const added = await addProjectDomain(lookup.domain);
    // `www` too, so a visitor typing either one lands somewhere real.
    await addProjectDomain(`www.${lookup.domain}`).catch(() => undefined);

    await db
      .update(t.storefronts)
      .set({
        domain: lookup.domain,
        domainSource: 'BYO',
        domainStatus: added.verified ? 'SSL_ISSUING' : 'PENDING_DNS',
        domainVerification: added.verification ?? [],
        domainError: null,
        domainAddedAt: new Date(),
        domainCheckedAt: new Date(),
      })
      .where(eq(t.storefronts.id, storefrontId));

    const rooftopId = await firstRooftopId(storefrontId);
    if (rooftopId) {
      await emitDomainPointed({
        rooftopId,
        domain: lookup.domain,
        unitCount: await publicUnitCount(storefrontId),
        host: instructions.ok && 'host' in instructions ? instructions.host : 'your DNS provider',
        actorId: (await getSessionUser())?.id ?? null,
      });
    }

    revalidatePath('/admin/website');
    return { ok: true, message: `${lookup.domain} added. We'll watch DNS and turn it on automatically.` };
  } catch (err) {
    const msg =
      err instanceof VercelApiError
        ? err.code === 'domain_already_in_use'
          ? `${lookup.domain} is already attached to another project. Remove it there first.`
          : err.message
        : 'Could not add that domain.';
    await db
      .update(t.storefronts)
      .set({ domainError: msg, domainStatus: 'ERROR', domainCheckedAt: new Date() })
      .where(eq(t.storefronts.id, storefrontId));
    revalidatePath('/admin/website');
    return { ok: false, error: msg };
  }
}

/**
 * Poll: pending → verifying → SSL issuing → live.
 *
 * Vercel is the source of truth for verification; `getDomainConfig` is the source
 * of truth for whether DNS actually points at us. Both are needed — a domain can
 * be "verified" (we own it) and still misconfigured (records not pointed yet).
 */
export async function refreshDomainStatus(storefrontId: string): Promise<ActionResult> {
  const scope = await sessionScope();
  const sf = await assertStorefrontInScope(scope, storefrontId);
  if (!sf?.domain) return { ok: false, error: 'No domain on this storefront.' };
  if (!domainsConfigured()) return { ok: false, error: 'Domain support is not configured.' };

  try {
    let vd = await getProjectDomain(sf.domain);
    if (!vd.verified) vd = await verifyProjectDomain(sf.domain).catch(() => vd);

    const cfg = await getDomainConfig(sf.domain).catch(() => ({ misconfigured: true }));

    let status: typeof t.storefronts.$inferSelect['domainStatus'];
    if (!vd.verified) status = (vd.verification?.length ?? 0) > 0 ? 'VERIFYING' : 'PENDING_DNS';
    else if (cfg.misconfigured) status = 'PENDING_DNS';
    else status = 'LIVE';

    /*
     * SSL_ISSUING is a real state, not cosmetic: DNS resolves and Vercel has
     * accepted the domain, but the certificate has not landed. Showing "live"
     * here means a dealer clicks through to a browser warning.
     */
    const wasLive = sf.domainStatus === 'LIVE';
    const nowLive = status === 'LIVE';

    await db
      .update(t.storefronts)
      .set({
        domainStatus: status,
        domainVerification: vd.verification ?? [],
        domainCheckedAt: new Date(),
        domainError: null,
        ...(nowLive && !sf.domainVerifiedAt ? { domainVerifiedAt: new Date() } : {}),
      })
      .where(eq(t.storefronts.id, storefrontId));

    if (nowLive && !wasLive) {
      const rooftopId = await firstRooftopId(storefrontId);
      if (rooftopId) {
        const days = sf.domainAddedAt
          ? Math.max(0, Math.round((Date.now() - new Date(sf.domainAddedAt).getTime()) / 86_400_000))
          : null;
        await emitDomainLive({
          rooftopId,
          storefrontId,
          domain: sf.domain,
          unitCount: await publicUnitCount(storefrontId),
          daysToLive: days,
        });
      }
    }

    revalidatePath('/admin/website');
    return { ok: true, message: status === 'LIVE' ? 'Live.' : 'Still waiting on DNS.' };
  } catch (err) {
    const msg = err instanceof VercelApiError ? err.message : 'Could not check the domain.';
    await db
      .update(t.storefronts)
      .set({ domainError: msg, domainCheckedAt: new Date() })
      .where(eq(t.storefronts.id, storefrontId));
    return { ok: false, error: msg };
  }
}

export async function detachDomain(storefrontId: string): Promise<ActionResult> {
  const sf = await assertStorefrontInScope(await sessionScope(), storefrontId);
  if (!sf?.domain) return { ok: false, error: 'No domain on this storefront.' };

  if (domainsConfigured()) {
    await removeProjectDomain(sf.domain).catch(() => undefined);
    await removeProjectDomain(`www.${sf.domain}`).catch(() => undefined);
  }

  await db
    .update(t.storefronts)
    .set({
      domain: null,
      domainSource: null,
      domainStatus: 'NONE',
      domainVerification: [],
      domainError: null,
      domainAddedAt: null,
      domainVerifiedAt: null,
      domainCheckedAt: null,
    })
    .where(eq(t.storefronts.id, storefrontId));

  revalidatePath('/admin/website');
  return { ok: true, message: 'Domain disconnected. Your storefront is still live on its Rooftop address.' };
}

/* ------------------------------------------------ 2. search and purchase */

export async function searchDomain(_prev: unknown, formData: FormData): Promise<ActionResult<QuoteResult[]>> {
  if (!domainsConfigured()) return { ok: false, error: 'Domain purchase is not configured yet.' };

  const storefrontId = String(formData.get('storefrontId') ?? '');
  const sf = await assertStorefrontInScope(await sessionScope(), storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const term = String(formData.get('term') ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (term.length < 3) return { ok: false, error: 'Type at least three letters.' };

  /*
   * A small fixed candidate set rather than an open search box. Each candidate is
   * a real availability + price call, and the caps reject anything expensive
   * before a dealer ever sees a buy button.
   */
  const candidates = [`${term}.com`, `${term}auto.com`, `${term}motors.com`, `${term}.net`, `${term}cars.com`];
  const quotes = await Promise.all(candidates.map((d) => quoteDomain(d)));
  return { ok: true, data: quotes };
}

/**
 * Buy a domain. **Spends Litespeed's money.**
 *
 * Guardrail order matters. The database caps run first because they are free and
 * cannot be raced; the price caps and `expectedPrice` run inside `buyDomain`,
 * which re-quotes immediately before purchase.
 */
export async function purchaseDomain(_prev: unknown, formData: FormData): Promise<ActionResult> {
  if (!domainsConfigured()) return { ok: false, error: 'Domain purchase is not configured yet.' };

  const storefrontId = String(formData.get('storefrontId') ?? '');
  const scope = await sessionScope();
  const sf = await assertStorefrontInScope(scope, storefrontId);
  if (!sf) return { ok: false, error: 'Storefront not found.' };

  const groupId = await requireGroupId();
  const user = await getSessionUser();

  // Guardrail 3a: one domain per storefront.
  if (sf.domain) {
    return {
      ok: false,
      error: `${sf.name} already has ${sf.domain} connected. Disconnect it before buying another.`,
    };
  }

  // Guardrail 3b: hard account-level cap. A second domain needs a human.
  const [{ n: purchased }] = await db
    .select({ n: count() })
    .from(t.domainOrders)
    .where(and(eq(t.domainOrders.groupId, groupId), eq(t.domainOrders.status, 'PURCHASED')));
  if (purchased >= DOMAINS_PER_GROUP_CAP) {
    return {
      ok: false,
      error: `You've registered ${purchased} domains through Rooftop, which is the limit on the account. Give us a call and we'll add another.`,
    };
  }

  const domain = String(formData.get('domain') ?? '').trim().toLowerCase();
  const autoRenewRaw = formData.get('autoRenew');
  if (autoRenewRaw === null) {
    // Required by Vercel, so never defaulted silently here either.
    return { ok: false, error: 'Choose whether this domain should renew automatically.' };
  }
  const autoRenew = autoRenewRaw === 'on' || autoRenewRaw === 'true';

  const registrant = {
    firstName: String(formData.get('firstName') ?? '').trim(),
    lastName: String(formData.get('lastName') ?? '').trim(),
    companyName: String(formData.get('companyName') ?? '').trim() || undefined,
    email: String(formData.get('email') ?? '').trim(),
    phone: String(formData.get('phone') ?? '').trim(),
    address1: String(formData.get('address1') ?? '').trim(),
    city: String(formData.get('city') ?? '').trim(),
    state: String(formData.get('state') ?? '').trim(),
    zip: String(formData.get('zip') ?? '').trim(),
    country: String(formData.get('country') ?? 'US').trim().toUpperCase(),
  };

  const missing = (['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'state', 'zip'] as const)
    .filter((k) => !registrant[k]);
  if (missing.length) {
    return { ok: false, error: 'ICANN requires a full contact address for the domain owner. Fill in every field.' };
  }

  // Server-side quote. The client never supplies a price.
  const quote = await quoteDomain(domain, 1);
  if (!quote.ok) return { ok: false, error: quote.message };

  const [order] = await db
    .insert(t.domainOrders)
    .values({
      groupId,
      storefrontId,
      domain: quote.domain,
      status: 'PURCHASING',
      priceUsd: quote.priceUsd,
      renewalPriceUsd: quote.renewalPriceUsd,
      years: 1,
      autoRenew,
      capUsd: quote.capUsd,
      registrant,
      orderedBy: user?.id ?? null,
    })
    .returning();

  const result = await buyDomain({
    domain: quote.domain,
    years: 1,
    autoRenew,
    registrant,
    expectedPriceUsd: quote.priceUsd,
  });

  if (!result.ok) {
    await db
      .update(t.domainOrders)
      .set({ status: result.reason === 'over-price-cap' ? 'REJECTED_OVER_CAP' : 'FAILED', error: result.message })
      .where(eq(t.domainOrders.id, order!.id));
    revalidatePath('/admin/website');
    return { ok: false, error: result.message };
  }

  await db
    .update(t.domainOrders)
    .set({ status: 'PURCHASED', vercelOrderId: result.orderId, completedAt: new Date() })
    .where(eq(t.domainOrders.id, order!.id));

  // A domain bought through us needs no dealer DNS work — attach it directly.
  await addProjectDomain(quote.domain).catch(() => undefined);
  await addProjectDomain(`www.${quote.domain}`).catch(() => undefined);

  await db
    .update(t.storefronts)
    .set({
      domain: quote.domain,
      domainSource: 'PURCHASED',
      domainStatus: 'SSL_ISSUING',
      domainAddedAt: new Date(),
      domainCheckedAt: new Date(),
      domainError: null,
    })
    .where(eq(t.storefronts.id, storefrontId));

  const rooftopId = await firstRooftopId(storefrontId);
  if (rooftopId) {
    await emitDomainPurchased({
      rooftopId,
      storefrontId,
      domain: quote.domain,
      unitCount: await publicUnitCount(storefrontId),
      priceUsd: quote.priceUsd,
      renewalPriceUsd: quote.renewalPriceUsd,
      actorId: user?.id ?? null,
    });
  }

  revalidatePath('/admin/website');
  return { ok: true, message: `${quote.domain} is yours. It'll be live in a few minutes.` };
}

/*
 * Layout and branding used to live here. It moved to `src/lib/branding/actions.ts`
 * when the Design card grew a logo-import step: branding is now its own subsystem
 * (scan a website, sniff an image, suggest a palette) and only shared this file
 * because both surfaced on one screen.
 */
