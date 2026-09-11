'use server';

/**
 * Writing one ad's copy.
 *
 * EVERY ACTION HERE IS KEYED TO A GROUP (`bucket`, the shelf key) AND TO ONE
 * AD. There is no lot-wide copy to edit. That is the same shape as Ads
 * Manager, and the reason is the same: a dealer running "all front-line" at
 * $50 and "61+ days" at $25 wants different words on each, not one sentence
 * stretched across both.
 *
 * SAVING DOES NOT TOUCH FACEBOOK. It changes what the next push sends;
 * `updateGroupAdsAction` is the push, and it is a separate press because it
 * talks to Facebook and takes a few seconds. A dealer who tweaks a headline at
 * 11pm should not discover in the morning that it restarted their learning
 * phase — and once the push is deliberate, an autosave can be added later
 * without a nasty surprise.
 */

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { readAdFields, validateAdCopy } from './ad-copy-spec';
import { isBucketKey } from './buckets';
import { upsertAdCopy } from './ad-copy';
import { refreshGroupForRooftop } from './campaign-build';
import { requireGroupId } from '@/lib/auth';

export type CopyResult = { ok: true; message: string } | { ok: false; error: string };

export async function saveAdCopyAction(_prev: unknown, formData: FormData): Promise<CopyResult> {
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const bucket = String(formData.get('bucket') ?? '');
  const copyId = String(formData.get('copyId') ?? '').trim() || null;

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };
  if (!isBucketKey(bucket)) return { ok: false, error: 'That group was not found.' };

  const fields = readAdFields(formData);
  const invalid = validateAdCopy(fields);
  if (invalid) return { ok: false, error: invalid };

  const ok = await upsertAdCopy({ rooftopId, bucket, copyId, fields });
  if (!ok) return { ok: false, error: 'That ad was not found.' };

  revalidatePath('/admin/ad-desk');
  return { ok: true, message: 'Saved. Press Update on Facebook when you want it live.' };
}

/**
 * Turn an ad off. Never deletes.
 *
 * The row holds the only record of what a losing ad said, and the ad Meta
 * already ran from it keeps reporting against that name. Deleting would leave
 * a dealer with numbers for copy nobody can read any more. The next push
 * pauses the ad at Facebook — see the sweep in `createDemoCampaign`.
 */
export async function retireAdCopyAction(_prev: unknown, formData: FormData): Promise<CopyResult> {
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const bucket = String(formData.get('bucket') ?? '');
  const copyId = String(formData.get('copyId') ?? '').trim();

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop || !copyId || !isBucketKey(bucket)) return { ok: false, error: 'That ad was not found.' };

  const active = await db
    .select({ id: t.metaAdCopy.id })
    .from(t.metaAdCopy)
    .where(
      and(
        eq(t.metaAdCopy.rooftopId, rooftopId),
        eq(t.metaAdCopy.bucket, bucket),
        eq(t.metaAdCopy.active, true),
      ),
    );
  if (active.length <= 1) {
    return { ok: false, error: 'This is the only ad in the group — edit it rather than turning it off.' };
  }

  await db
    .update(t.metaAdCopy)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(t.metaAdCopy.id, copyId), eq(t.metaAdCopy.rooftopId, rooftopId)));

  revalidatePath('/admin/ad-desk');
  return { ok: true, message: 'Turned off. Press Update on Facebook and it stops running.' };
}

/**
 * Push one group's saved ads onto Facebook.
 *
 * Separate from saving on purpose — see the note at the top. Never starts or
 * stops anything.
 */
export async function updateGroupAdsAction(_prev: unknown, formData: FormData): Promise<CopyResult> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const bucket = String(formData.get('bucket') ?? '');

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };
  if (!isBucketKey(bucket)) return { ok: false, error: 'That group was not found.' };

  const outcome = await refreshGroupForRooftop({ groupId, rooftop, bucket });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath('/admin/ad-desk');
  return { ok: true, message: outcome.message };
}
