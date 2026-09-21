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
 * Full.
 *
 * DO NOT verify with `devtools_api_usage call_volume`. It reads the app-level
 * Graph API counter, and per Meta's rate-limiting docs the Marketing API "has
 * its own rate limiting logic and is excluded from all the Graph API rate
 * limitations" — so that counter reads 0 no matter how many ads calls this
 * makes. The two `total_calls: 0` readings that prompted this warmer proved
 * nothing either way, and chasing that zero has now cost time twice.
 *
 * Verify instead in the App Dashboard: Use cases -> Create & manage ads ->
 * Customize -> Permissions and features, the `API Calls` column. That is the
 * meter Meta grades. This log line is the other source of truth: `ok` is a
 * successful Marketing API call, `failed` is one against the 15% budget.
 *
 * The bar is 500 successful calls in a rolling 15 days, error rate under 15%
 * across the last 500 calls. Meta takes up to 2 days to register calls. The
 * screen-recording requirement was dropped for tier upgrades on 4 May 2026, so
 * a re-request is cheap — but a run with non-zero `failed` is worth fixing
 * first, since the error rate is scored on the same window.
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
