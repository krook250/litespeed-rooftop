/**
 * Accumulates the Marketing API call volume that the `Marketing API Access
 * Tier` upgrade is measured on. See `src/lib/meta/warm.ts` for why Rooftop's
 * own traffic is zero and why this cannot run off-server.
 *
 * AUTH: `CRON_SECRET` in the Authorization header, same gate and same
 * fail-closed-when-unset posture as `/api/cron/photo-ingest`. This one spends
 * a dealer's rate-limit budget, so a stray curl should not be able to start it.
 *
 * Always 200 on an authenticated call. A failed read is counted and reported;
 * a non-2xx here would only make Vercel re-run the batch, which is the one
 * thing a rate-limited account does not need.
 *
 * TEMPORARY. Delete this route and its `vercel.json` entry once the tier is
 * Full — verify with `devtools_api_usage call_volume lookback_minutes=21600`
 * before re-requesting, and remember Meta takes up to 2 days to register calls.
 */

import { NextResponse } from 'next/server';
import { runMetaWarm } from '@/lib/meta/warm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Paced reads: 3 accounts x 8 calls at 4s apart, plus headroom. */
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const run = await runMetaWarm();

  console.log(
    `[meta-warm] ${run.accounts} account(s) — ${run.ok} ok, ${run.failed} failed`,
  );
  for (const s of run.skipped) console.log(`[meta-warm] skipped: ${s}`);
  for (const e of run.errors) console.log(`[meta-warm] error: ${e}`);

  return NextResponse.json(run);
}
