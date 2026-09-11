import 'server-only';

/**
 * Reading a lot's ad copy.
 *
 * THE EMPTY CASE IS NOT AN ERROR AND IS NOT SEEDED. A lot with no rows gets the
 * hardcoded default back, unsaved. That keeps two things true at once: every
 * existing lot keeps running exactly the ads it ran before this table existed,
 * and nothing writes rows to the database for dealers who never open the editor.
 * The first save is what creates a row.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { defaultAdCopy, type AdCopyFields } from './ad-copy-spec';

export type AdCopy = AdCopyFields & { id: string | null };

/**
 * The variants an ad build should produce, in order.
 *
 * Active only: a retired variant keeps its row so the dealer does not lose the
 * numbers that told them it lost, but it stops being built.
 */
export async function adCopyForRooftop(
  rooftopId: string,
  dealerName: string,
): Promise<AdCopy[]> {
  const rows = await db
    .select()
    .from(t.metaAdCopy)
    .where(and(eq(t.metaAdCopy.rooftopId, rooftopId), eq(t.metaAdCopy.active, true)))
    .orderBy(asc(t.metaAdCopy.sortOrder), asc(t.metaAdCopy.createdAt));

  if (!rows.length) return [{ id: null, ...defaultAdCopy(dealerName) }];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    message: r.message,
    headline: r.headline,
    description: r.description,
    callToAction: r.callToAction,
  }));
}

/** Everything, retired included, for the editor. */
export async function allAdCopyForRooftop(rooftopId: string) {
  return db
    .select()
    .from(t.metaAdCopy)
    .where(eq(t.metaAdCopy.rooftopId, rooftopId))
    .orderBy(asc(t.metaAdCopy.sortOrder), asc(t.metaAdCopy.createdAt));
}
