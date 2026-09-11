'use server';

/**
 * Writing a lot's ad copy.
 *
 * Nothing here touches Facebook. Saving copy changes what the NEXT build sends;
 * it does not reach in and rewrite a running ad, and the panel says so. That
 * split is deliberate — editing text should never be the thing that changes
 * what a live campaign is spending on, and a dealer who tweaks a headline at
 * 11pm should not discover in the morning that it restarted their learning
 * phase.
 */

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { validateAdCopy, type AdCopyFields } from './ad-copy-spec';
import { refreshAdsForRooftop } from './campaign-build';
import { requireGroupId } from '@/lib/auth';

export type CopyResult = { ok: true; message: string } | { ok: false; error: string };

function readFields(formData: FormData): AdCopyFields {
  return {
    name: String(formData.get('name') ?? '').trim(),
    message: String(formData.get('message') ?? '').trim(),
    headline: String(formData.get('headline') ?? '').trim(),
    description: String(formData.get('description') ?? '').trim(),
    callToAction: String(formData.get('callToAction') ?? 'LEARN_MORE'),
  };
}

export async function saveAdCopyAction(_prev: unknown, formData: FormData): Promise<CopyResult> {
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const copyId = String(formData.get('copyId') ?? '').trim();

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  const fields = readFields(formData);
  const invalid = validateAdCopy(fields);
  if (invalid) return { ok: false, error: invalid };

  if (copyId) {
    /*
     * Scoped by rooftop as well as id. The id arrives off a form, and without
     * the second clause a dealer could edit another group's copy by guessing
     * one — the rooftop check above only proves they own the lot they named.
     */
    const updated = await db
      .update(t.metaAdCopy)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(t.metaAdCopy.id, copyId), eq(t.metaAdCopy.rooftopId, rooftopId)))
      .returning({ id: t.metaAdCopy.id });
    if (!updated.length) return { ok: false, error: 'That version was not found.' };
  } else {
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max("sortOrder"), -1) + 1` })
      .from(t.metaAdCopy)
      .where(eq(t.metaAdCopy.rooftopId, rooftopId));
    await db.insert(t.metaAdCopy).values({ rooftopId, ...fields, sortOrder: next ?? 0 });
  }

  revalidatePath('/admin/ad-desk');
  return {
    ok: true,
    message: 'Saved. Build the campaign again to put this in front of shoppers.',
  };
}

/**
 * Retire a variant. Never deletes.
 *
 * The row holds the only record of what a losing variant said, and the ad Meta
 * already ran from it keeps reporting against that name. Deleting would leave a
 * dealer with numbers for copy nobody can read any more.
 */
export async function retireAdCopyAction(_prev: unknown, formData: FormData): Promise<CopyResult> {
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const copyId = String(formData.get('copyId') ?? '').trim();

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop || !copyId) return { ok: false, error: 'That version was not found.' };

  const active = await db
    .select({ id: t.metaAdCopy.id })
    .from(t.metaAdCopy)
    .where(and(eq(t.metaAdCopy.rooftopId, rooftopId), eq(t.metaAdCopy.active, true)));
  if (active.length <= 1) {
    return { ok: false, error: 'This is your only version — edit it rather than turning it off.' };
  }

  await db
    .update(t.metaAdCopy)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(t.metaAdCopy.id, copyId), eq(t.metaAdCopy.rooftopId, rooftopId)));

  revalidatePath('/admin/ad-desk');
  return { ok: true, message: 'Turned off. It stops being built from the next build on.' };
}

/**
 * Push saved copy onto the campaigns that already exist.
 *
 * Separate from saving on purpose. Saving is free, instant and local; this one
 * talks to Facebook and can take a few seconds per campaign. Merging them would
 * mean every keystroke-then-save round trip rewrote live ads, and would make an
 * autosave impossible to add later without a nasty surprise.
 */
export async function refreshAdsAction(_prev: unknown, formData: FormData): Promise<CopyResult> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  const outcome = await refreshAdsForRooftop({ groupId, rooftop });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath('/admin/ad-desk');
  return { ok: true, message: outcome.message };
}
