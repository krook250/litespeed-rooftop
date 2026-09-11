'use server';

/**
 * The operator's campaign actions.
 *
 * Same build as the dealer's, different door. `src/lib/meta/demo-actions.ts`
 * resolves the lot through `sessionScope()`; these resolve it through
 * `requireStaff()` plus `opsRooftopInGroup`, which refuses a rooftop id that
 * does not belong to the group id sent alongside it.
 *
 * EVERY ACTION RE-CHECKS STAFF. The page guard is not enough — a server action
 * is a POST endpoint reachable by anyone who can guess its id, whether or not
 * they could ever render the page that submits it. This is the same rule stated
 * in `src/lib/ops/actions.ts` and it matters more here, because these endpoints
 * spend money at Facebook rather than moving a row between states.
 *
 * START AND STOP ARE HERE, AND THEY WERE NOT AT FIRST. The original version
 * withheld them on the reasoning that starting is the moment money moves and so
 * should be the dealer's click. That is right as a default and wrong as a
 * constraint: the operator is onboarding dealers he has no relationship with,
 * bugs will keep happening, and "I cannot help you from here" is a worse outcome
 * than an operator with a switch. Every use is logged with the operator's email
 * before the call runs, which is the accountability the restriction was really
 * reaching for.
 *
 * STILL ABSENT: connect and disconnect. Those are the dealer's consent to give
 * and to revoke, and an operator doing it on their behalf is a different kind of
 * act from working on the ads they hired us to run.
 */

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/ops/guard';
import { opsRooftopInGroup } from '@/lib/ops/ad-desk-queries';
import {
  buildCampaignForRooftop,
  runCampaignForRooftop,
  validateCampaignInput,
} from '@/lib/meta/campaign-build';
import type { DemoCampaignResult } from '@/lib/meta/campaigns';
import { DEFAULT_BUCKET, type BucketKey } from '@/lib/meta/buckets';

export type OpsActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

export async function opsBuildCampaignAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<DemoCampaignResult>> {
  const me = await requireStaff();

  const groupId = String(formData.get('groupId') ?? '');
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const bucket = String(formData.get('bucket') ?? DEFAULT_BUCKET) as BucketKey;
  const dailyBudgetUsd = Number(formData.get('dailyBudget') ?? 25);
  const radiusMiles = Number(formData.get('radiusMiles') ?? 25);

  const rooftop = await opsRooftopInGroup(groupId, rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found in that dealer group.' };

  const invalid = validateCampaignInput(bucket, dailyBudgetUsd, radiusMiles);
  if (invalid) return { ok: false, error: invalid };

  /*
   * Logged before the call, not after. This is one Rooftop employee spending a
   * dealer's money from a screen the dealer cannot see, and the thing worth
   * having when somebody asks "who set this budget?" is a line that exists even
   * if the build then throws.
   */
  console.info(
    '[ops] campaign build ' +
      JSON.stringify({ by: me.email, groupId, rooftopId, bucket, dailyBudgetUsd, radiusMiles }),
  );

  const outcome = await buildCampaignForRooftop({
    groupId,
    rooftop,
    bucket,
    dailyBudgetUsd,
    radiusMiles,
  });

  if (outcome.ok) {
    revalidatePath('/ops/ad-desk');
    revalidatePath(`/ops/accounts/${groupId}`);
    // The dealer's own screen shows the same campaign, and they may well have it
    // open while this runs.
    revalidatePath('/admin/ad-desk');
  }
  return outcome;
}

/**
 * Start or stop a dealer's campaign on their behalf.
 *
 * Logged before the call, like the build, and for a stronger reason: this one
 * begins or ends live spending on somebody else's card.
 */
export async function opsSetCampaignRunningAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<{ running: boolean }>> {
  const me = await requireStaff();

  const groupId = String(formData.get('groupId') ?? '');
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const running = String(formData.get('running') ?? '') === 'true';

  const rooftop = await opsRooftopInGroup(groupId, rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found in that dealer group.' };

  console.info(
    '[ops] campaign ' +
      (running ? 'START' : 'STOP') +
      ' ' +
      JSON.stringify({ by: me.email, groupId, rooftopId, campaignId }),
  );

  const outcome = await runCampaignForRooftop({ groupId, rooftop, campaignId, running });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath('/ops/ad-desk');
  revalidatePath(`/ops/accounts/${groupId}`);
  revalidatePath('/admin/ad-desk');
  return {
    ok: true,
    data: { running },
    message: running ? 'Started. This is now spending.' : 'Stopped.',
  };
}
