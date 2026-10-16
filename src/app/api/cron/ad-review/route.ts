/**
 * Every two hours: look for ads Facebook rejected or flagged. See
 * `src/lib/meta/ad-review-sweep.ts`.
 *
 * AUTH: `CRON_SECRET` in the Authorization header, same fail-closed gate as the
 * other crons. Always 200 on an authenticated call — a failed lot is reported
 * in the body, and a retry would only spend rate limit.
 */
import { NextResponse } from 'next/server';
import { runAdReviewSweep } from '@/lib/meta/ad-review-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const run = await runAdReviewSweep();
  console.log(
    `[ad-review] ${run.lots} lot(s) — ${run.flagged} flagged, ${run.alerted} new alert(s)`,
  );
  for (const s of run.skipped) console.log(`[ad-review] skipped: ${s}`);
  for (const e of run.errors) console.log(`[ad-review] error: ${e}`);

  return NextResponse.json(run);
}
