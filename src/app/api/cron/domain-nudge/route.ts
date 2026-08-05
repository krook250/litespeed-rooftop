/**
 * Daily sweep: nudge dealers who saved a domain and never switched it over.
 *
 * `RESERVED` exists so a dealer can take their time. The cost of that is that
 * nobody is coming back to the Website screen on their own — the domain sits
 * saved, their customers keep landing on the site they are leaving, and there is
 * no moment that ever surfaces it again. This is that moment.
 *
 * Deliberately gentle. The card is only worth posting once the storefront is
 * actually ready, because nudging a dealer to point their domain at a site with
 * no logo and no cars is worse than saying nothing. When they are *not* ready,
 * the card names what is missing instead — which is a to-do, not a nag.
 *
 * AUTH: `CRON_SECRET` in the `Authorization` header, the same shape Vercel Cron
 * sends. Refusing when it is unset is the safe default: this route emits feed
 * events for every tenant on the platform, so an unauthenticated version of it is
 * a spam endpoint. It fails closed in local dev too, which is correct — a
 * scheduled sweep is not something you want firing off a stray curl.
 */

import { NextResponse } from 'next/server';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { emitDomainStalled } from '@/lib/domains/feed';
import { buildReadiness, readinessSummary } from '@/lib/domains/readiness';
import { publicUnitCount } from '@/lib/domains/units';

export const dynamic = 'force-dynamic';

/**
 * Long enough that it never lands on a dealer still working through setup, short
 * enough to catch someone before the reservation is forgotten entirely.
 */
const NUDGE_AFTER_DAYS = 7;

/** ISO week key, so the dedupe in `emitDomainStalled` allows one card a week. */
function weekKey(d: Date): string {
  const t0 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t0.setUTCDate(t0.getUTCDate() + 4 - (t0.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t0.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t0.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t0.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const cutoff = new Date(Date.now() - NUDGE_AFTER_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: t.storefronts.id,
      slug: t.storefronts.slug,
      domain: t.storefronts.domain,
      logoKey: t.storefronts.logoKey,
      brandColor: t.storefronts.brandColor,
      accentColor: t.storefronts.accentColor,
      reservedAt: t.storefronts.domainReservedAt,
      priorDns: t.storefronts.domainPriorDns,
    })
    .from(t.storefronts)
    .where(
      and(
        eq(t.storefronts.domainStatus, 'RESERVED'),
        isNotNull(t.storefronts.domain),
        lt(t.storefronts.domainReservedAt, cutoff),
      ),
    );

  const week = weekKey(new Date());
  let nudged = 0;

  for (const sf of rows) {
    const [link] = await db
      .select({ rooftopId: t.storefrontRooftops.rooftopId })
      .from(t.storefrontRooftops)
      .where(eq(t.storefrontRooftops.storefrontId, sf.id))
      .limit(1);
    if (!link) continue;

    const units = await publicUnitCount(sf.id);

    /*
     * Readiness is computed without a DNS lookup here on purpose. Re-resolving
     * every reserved domain on a nightly sweep is a lot of DNS traffic to decide
     * the wording of a feed card, and the CAA branch is re-checked for real on the
     * cutover screen — which is where getting it wrong would actually cost
     * something. `caaBlocks: false` risks a card that is slightly too encouraging;
     * it cannot cause a bad cutover.
     */
    const readiness = buildReadiness({
      logoKey: sf.logoKey,
      brandColor: sf.brandColor,
      accentColor: sf.accentColor,
      publicUnitCount: units,
      caaBlocks: false,
      // Not re-checked on the sweep, same reasoning as CAA above.
      domainRegistered: true,
      mx: sf.priorDns?.mx ?? [],
    });

    const daysWaiting = sf.reservedAt
      ? Math.max(0, Math.round((Date.now() - new Date(sf.reservedAt).getTime()) / 86_400_000))
      : NUDGE_AFTER_DAYS;

    await emitDomainStalled({
      rooftopId: link.rooftopId,
      storefrontId: sf.id,
      domain: sf.domain!,
      unitCount: units,
      daysWaiting,
      week,
      reason: readiness.ready
        ? 'Your storefront is finished and ready — all that is left is two DNS records.'
        : readinessSummary(readiness),
    });
    nudged += 1;
  }

  return NextResponse.json({ ok: true, considered: rows.length, nudged });
}
