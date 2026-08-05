/**
 * How many vehicles a storefront would actually show a visitor right now.
 *
 * Lifted out of `actions.ts` when the Website page needed the same number to
 * decide whether a storefront is ready for its own domain. Two callers computing
 * "units on the site" separately is how the feed card and the readiness
 * checklist end up disagreeing in front of a dealer.
 *
 * SCOPING: this takes an **already-scoped** `storefrontId`. It does no tenant
 * check of its own, exactly like the private helper it replaces — every caller
 * resolves the storefront through `assertStorefrontInScope` or `storefrontsInScope`
 * first. Keeping it unscoped here rather than half-scoped is deliberate: a helper
 * that looks like it checks but does not is worse than one that plainly does not.
 * If you call this with an id off a request body, you have a bug.
 */

import 'server-only';
import { and, count, inArray, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';

/** The statuses that put a vehicle on the public storefront. */
export const PUBLIC_STATUSES = ['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE'] as const;

export async function publicUnitCount(storefrontId: string): Promise<number> {
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
