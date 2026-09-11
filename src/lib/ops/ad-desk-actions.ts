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
 * WHAT IS DELIBERATELY ABSENT: no connect, no disconnect, no pause or unpause.
 * Connecting is the dealer's consent to give and revoke, and turning a campaign
 * on is the decision that starts the spending. An operator who needs either does
 * it in the dealer's own account or in Ads Manager, where it is attributable to
 * a person rather than to "ops".
 */

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/ops/guard';
import { opsRooftopInGroup } from '@/lib/ops/ad-desk-queries';
import { buildCampaignForRooftop, validateCampaignInput } from '@/lib/meta/campaign-build';
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
