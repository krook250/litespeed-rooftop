import 'server-only';

/**
 * Reading a lot's ad copy.
 *
 * ONE ROW IS ONE AD, AND EVERY ROW BELONGS TO ONE GROUP (`bucket`, the shelf
 * key). There is no lot-wide copy: two groups on the same lot can say
 * completely different things, and editing an ad in one never touches the
 * other — the same rule Ads Manager works by.
 *
 * THE EMPTY CASE IS NOT AN ERROR AND IS NOT SEEDED. A group with no rows gets
 * the hardcoded default back, unsaved, so a build from the ops screen still
 * produces an ad. The first save is what creates a row.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import type { BucketKey } from './buckets';
import { defaultAdCopy, type AdCopyFields } from './ad-copy-spec';

export type AdCopy = AdCopyFields & { id: string | null };

/**
 * The ads one group's build should produce, in order.
 *
 * Active only: a turned-off ad keeps its row so the dealer does not lose the
 * numbers that told them it lost, but it stops being built — and the build's
 * sweep pauses it at Facebook.
 */
export async function adCopyForGroup(
  rooftopId: string,
  bucket: BucketKey,
  dealerName: string,
): Promise<AdCopy[]> {
  const rows = await db
    .select()
    .from(t.metaAdCopy)
    .where(
      and(
        eq(t.metaAdCopy.rooftopId, rooftopId),
        eq(t.metaAdCopy.bucket, bucket),
        eq(t.metaAdCopy.active, true),
      ),
    )
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

/**
 * Insert or update one ad's row. Returns false when `copyId` was given but no
 * row matched — scoped by rooftop AND group as well as id, because the id
 * arrives off a form and the rooftop check alone only proves they own the lot
 * they named.
 */
export async function upsertAdCopy(input: {
  rooftopId: string;
  bucket: BucketKey;
  copyId: string | null;
  fields: AdCopyFields;
}): Promise<boolean> {
  const { rooftopId, bucket, copyId, fields } = input;

  if (copyId) {
    const updated = await db
      .update(t.metaAdCopy)
      .set({ ...fields, updatedAt: new Date() })
      .where(
        and(
          eq(t.metaAdCopy.id, copyId),
          eq(t.metaAdCopy.rooftopId, rooftopId),
          eq(t.metaAdCopy.bucket, bucket),
        ),
      )
      .returning({ id: t.metaAdCopy.id });
    return updated.length > 0;
  }

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max("sortOrder"), -1) + 1` })
    .from(t.metaAdCopy)
    .where(and(eq(t.metaAdCopy.rooftopId, rooftopId), eq(t.metaAdCopy.bucket, bucket)));
  await db.insert(t.metaAdCopy).values({ rooftopId, bucket, ...fields, sortOrder: next ?? 0 });
  return true;
}

/** Everything on the lot, every group, turned-off rows included, for the editor. */
export async function allAdCopyForRooftop(rooftopId: string) {
  return db
    .select()
    .from(t.metaAdCopy)
    .where(eq(t.metaAdCopy.rooftopId, rooftopId))
    .orderBy(asc(t.metaAdCopy.sortOrder), asc(t.metaAdCopy.createdAt));
}
