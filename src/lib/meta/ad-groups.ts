import 'server-only';

/**
 * The local half of a group: its name, its filters, and the ids of what it
 * became at Meta.
 *
 * Ad copy is NOT here — it stays in `meta_ad_copy`, keyed on the shelf, because
 * this table is deliberately one row per shelf (see the schema note). When that
 * limit lifts, copy moves onto `adGroupId` and this is where that join lands.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import type { AdGroupFilters } from '@/db/schema';

export type AdGroupRow = typeof t.metaAdGroups.$inferSelect;

export async function adGroupsForRooftop(rooftopId: string): Promise<AdGroupRow[]> {
  return db
    .select()
    .from(t.metaAdGroups)
    .where(eq(t.metaAdGroups.rooftopId, rooftopId))
    .orderBy(asc(t.metaAdGroups.createdAt));
}

export async function adGroupFor(rooftopId: string, bucket: string): Promise<AdGroupRow | null> {
  const [row] = await db
    .select()
    .from(t.metaAdGroups)
    .where(and(eq(t.metaAdGroups.rooftopId, rooftopId), eq(t.metaAdGroups.bucket, bucket)))
    .limit(1);
  return row ?? null;
}

/**
 * Save what the dealer typed, before anything is sent to Facebook.
 *
 * Save-then-build, in that order, for the reason the ad copy learned the hard
 * way: a build that fails at Meta must still leave the dealer's own words and
 * their rule on the screen. Losing a filter set because Facebook was slow is
 * the bug that makes people stop trusting a form.
 */
export async function upsertAdGroup(input: {
  rooftopId: string;
  bucket: string;
  name: string;
  filters: AdGroupFilters;
  dailyBudgetUsd: number;
  radiusMiles: number;
}): Promise<AdGroupRow> {
  const [row] = await db
    .insert(t.metaAdGroups)
    .values({
      rooftopId: input.rooftopId,
      bucket: input.bucket,
      name: input.name,
      filters: input.filters,
      dailyBudgetUsd: input.dailyBudgetUsd,
      radiusMiles: input.radiusMiles,
    })
    .onConflictDoUpdate({
      target: [t.metaAdGroups.rooftopId, t.metaAdGroups.bucket],
      set: {
        name: input.name,
        filters: input.filters,
        dailyBudgetUsd: input.dailyBudgetUsd,
        radiusMiles: input.radiusMiles,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

/** Record what the build produced, so a dead product set can be spotted later. */
export async function noteAdGroupBuilt(
  rooftopId: string,
  bucket: string,
  ids: { adSetId?: string | null; productSetId?: string | null },
): Promise<void> {
  await db
    .update(t.metaAdGroups)
    .set({ ...ids, updatedAt: new Date() })
    .where(and(eq(t.metaAdGroups.rooftopId, rooftopId), eq(t.metaAdGroups.bucket, bucket)));
}
