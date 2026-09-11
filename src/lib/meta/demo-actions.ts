'use server';

/**
 * The dealer's two campaign actions: build one, and read it back.
 *
 * Kept out of `actions.ts` deliberately: that file is the connect flow. This
 * file started as the App Review demonstration harness and is now the campaign
 * builder a dealer uses, which means the ad account it points at is real and
 * funded. Everything it creates lands PAUSED and the dealer turns it on in Ads
 * Manager; that is the only thing preventing spend.
 *
 * The build itself lives in `./campaign-build.ts`, which Rooftop staff also call
 * from `src/lib/ops/ad-desk-actions.ts` under a different guard. What stays here
 * is this file's own answer to "may you touch this lot?" — the group comes from
 * the session, the rooftop id arrives off a form and is therefore checked
 * against `sessionScope()` before it is used for anything.
 */

import { revalidatePath } from 'next/cache';
import { requireGroupId } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { MetaApiError } from './graph';
import { tokenFor } from './connect';
import { readInsights, type DemoCampaignResult, type InsightsResult } from './campaigns';
import { DEFAULT_BUCKET, type BucketKey } from './buckets';
import { buildCampaignForRooftop, runCampaignForRooftop, validateCampaignInput } from './campaign-build';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

/* ---------------------------------------------------------- the campaign */

export async function createDemoCampaignAction(
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

  const outcome = await buildCampaignForRooftop({
    groupId,
    rooftop,
    bucket,
    dailyBudgetUsd,
    radiusMiles,
  });

  if (outcome.ok) revalidatePath('/admin/ad-desk');
  return outcome;
}

/* --------------------------------------------------------- start and stop */

/**
 * The dealer's own on/off switch.
 *
 * This is the click that spends money, and it is deliberately theirs. Building
 * is safe and reversible; starting is neither, so the two are separate buttons
 * and nothing in the build path ever sets ACTIVE.
 */
export async function setCampaignRunningAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ running: boolean }>> {
  const groupId = await requireGroupId();
  const rooftopId = String(formData.get('rooftopId') ?? '');
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const running = String(formData.get('running') ?? '') === 'true';

  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return { ok: false, error: 'That lot was not found.' };

  const outcome = await runCampaignForRooftop({ groupId, rooftop, campaignId, running });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath('/admin/ad-desk');
  return {
    ok: true,
    data: { running },
    message: running
      ? 'Your ads are running. Facebook usually takes a few minutes to start delivering.'
      : 'Stopped. Nothing more will spend on this campaign.',
  };
}

/* ----------------------------------------------------------- the reading */

export async function readCampaignInsightsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<InsightsResult>> {
  const groupId = await requireGroupId();
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  if (!campaignId) return { ok: false, error: 'No campaign to read.' };

  const conn = await tokenFor(groupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected.' };

  try {
    const result = await readInsights(conn.token, campaignId);
    return {
      ok: true,
      data: result,
      message: result.emptyByDesign
        ? 'Read back from Facebook: no spend, impressions or clicks. Expected — this campaign has not been turned on yet, so it has never delivered.'
        : `Read back ${result.rows.length} row(s) of delivery from Facebook.`,
    };
  } catch (err) {
    if (err instanceof MetaApiError) return { ok: false, error: err.dealerMessage };
    throw err;
  }
}
