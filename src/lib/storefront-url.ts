import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { appOrigin } from '@/lib/meta/connect';

/**
 * Where this lot's public storefront lives.
 *
 * A dealer on their own domain gets `https://theirdomain.com`, because
 * `src/proxy.ts` rewrites the host into `/s/[slug]` and the dealer never sees
 * `/s/`. Everyone else gets the shared host. Falling back to the app origin
 * rather than erroring is deliberate: a lot with no storefront yet still has a
 * working feed, and a 404 on a vehicle page is a better failure than no listing
 * at all.
 *
 * A domain mid-verification is skipped in favour of the shared host — putting
 * every URL in a live feed on a hostname that does not resolve yet is worse
 * than an ugly URL that works.
 *
 * SHARED ON PURPOSE. This used to be a private helper inside the Meta feed
 * route. There is exactly one true answer to "where is this dealer's website"
 * and every outbound feed needs it; two copies would diverge the first time a
 * dealer moved domain, and the symptom would be one marketplace quietly
 * pointing at the old hostname.
 */
export async function dealerSiteBase(rooftopId: string): Promise<string> {
  const rows = await db
    .select({
      slug: t.storefronts.slug,
      domain: t.storefronts.domain,
      status: t.storefronts.domainStatus,
    })
    .from(t.storefrontRooftops)
    .innerJoin(t.storefronts, eq(t.storefrontRooftops.storefrontId, t.storefronts.id))
    .where(eq(t.storefrontRooftops.rooftopId, rooftopId));

  const origin = appOrigin().replace(/\/$/, '');
  if (!rows.length) return origin;

  const live = rows.find((r) => r.domain && r.status === 'LIVE');
  if (live?.domain) return `https://${live.domain}`;

  return `${origin}/s/${rows[0]!.slug}`;
}
