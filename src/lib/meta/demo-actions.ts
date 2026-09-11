'use server';

/**
 * The dealer's group actions: build one, and switch one on or off.
 *
 * Kept out of `actions.ts` deliberately: that file is the connect flow. This
 * file started as the App Review demonstration harness and is now the builder
 * a dealer uses, which means the ad account it points at is real and funded.
 * Everything it creates lands PAUSED and the dealer starts it from the group's
 * own switch; that is the only thing preventing spend.
 *
 * The build itself lives in `./campaign-build.ts`, which Rooftop staff also
 * call from `src/lib/ops/ad-desk-actions.ts` under a different guard. What
 * stays here is this file's own answer to "may you touch this lot?" — the group
 * comes from the session, the rooftop id arrives off a form and is therefore
 * checked against `sessionScope()` before it is used for anything.
 */

import { revalidatePath } from 'next/cache';
import { requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import type { DemoCampaignResult } from './campaigns';
import { DEFAULT_BUCKET, type BucketKey } from './buckets';
import { buildCampaignForRooftop, runGroupForRooftop, validateCampaignInput } from './campaign-build';
import { readAdFields, validateAdCopy } from './ad-copy-spec';
import { upsertAdCopy } from './ad-copy';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

/** How many ads the new-group form may carry. Two or three is plenty; the form enforces the same. */
const MAX_INLINE_ADS = 3;

/* ------------------------------------------------------------ the build */

/**
 * Build a group — or update an existing one's budget and radius.
 *
 * THE ADS ARE WRITTEN BEFORE THE BUILD, ON THE SAME FORM. The first version of
 * this screen had the copy editor in a separate panel above the build button,
 * nothing connected them, and the first campaign went out saying words the
 * dealer had never seen. So the new-group form carries its own ads
 * (`ad0.*`, `ad1.*`…, counted by `adCount`), they are saved to the group's
 * rows first, and only then does the build read them back. A form with no
 * `adCount` — the "update budget" form on an existing group — skips that step
 * and leaves the ads alone.
 */
export async function buildGroupAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<DemoCampaignResult>> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const bucket = String(formData.get('bucket') ?? DEFAULT_BUCKET) as BucketKey;
  const dailyBudgetUsd = Number(formData.get('dailyBudget') ?? 25);
  const radiusMiles = Number(formData.get('radiusMiles') ?? 25);

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  const invalid = validateCampaignInput(bucket, dailyBudgetUsd, radiusMiles);
  if (invalid) return { ok: false, error: invalid };

  const adCountRaw = formData.get('adCount');
  if (adCountRaw !== null) {
    const adCount = Math.min(MAX_INLINE_ADS, Math.max(0, Number(adCountRaw) || 0));
    const ads = Array.from({ length: adCount }, (_, i) => ({
      copyId: String(formData.get(`ad${i}.copyId`) ?? '').trim() || null,
      fields: readAdFields(formData, `ad${i}`),
    }));

    // Validate every ad before saving any, so a typo in the third one does not
    // leave the first two saved and the group half-written.
    for (const [i, ad] of ads.entries()) {
      const bad = validateAdCopy(ad.fields);
      if (bad) return { ok: false, error: `Ad ${i + 1}: ${bad}` };
    }
    for (const ad of ads) {
      const ok = await upsertAdCopy({ rooftopId, bucket, copyId: ad.copyId, fields: ad.fields });
      if (!ok) return { ok: false, error: 'One of these ads was not found. Reload and try again.' };
    }
  }

  const outcome = await buildCampaignForRooftop({
    groupId,
    rooftop,
    bucket,
    dailyBudgetUsd,
    radiusMiles,
  });

  // Saved rows are on screen either way — a build that failed at Facebook
  // should still show the dealer the words they wrote.
  // 'layout' so the group pages under /ads refresh too, not just the index.
  revalidatePath('/admin/ad-desk', 'layout');
  return outcome;
}

/* --------------------------------------------------------- start and stop */

/**
 * The dealer's own on/off switch, per group.
 *
 * This is the click that spends money, and it is deliberately theirs. Building
 * is safe and reversible; starting is neither, so the two are separate buttons
 * and nothing in the build path ever sets ACTIVE.
 */
export async function setGroupRunningAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ running: boolean }>> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const adSetId = String(formData.get('adSetId') ?? '').trim();
  const running = String(formData.get('running') ?? '') === 'true';

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  const outcome = await runGroupForRooftop({ groupId, rooftop, adSetId, running });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  // 'layout' so the group pages under /ads refresh too, not just the index.
  revalidatePath('/admin/ad-desk', 'layout');
  return {
    ok: true,
    data: { running },
    message: running
      ? 'Running. Facebook usually takes a few minutes to start delivering.'
      : 'Stopped. Nothing more will spend on this group.',
  };
}
