/**
 * Scheduled push of each dealer's DealerCenter file.
 *
 * ONCE A NIGHT, BECAUSE THAT IS DEALERCENTER'S ENTIRE MENU. Their Inventory
 * Importer offers "One Time" or "Automated Nightly Feed" and nothing else — no
 * hourly, no real-time, no documented manual import button. Sending twice would
 * not make a car appear any sooner. See `claude/dealercenter-interop.md`.
 *
 * WHY 05:00 UTC. The file has to be sitting in the folder before their importer
 * sweeps it, and Malabar's DealerCenter screen shows a last import at 3:11 AM in
 * a timezone nobody has told us. 05:00 UTC is midnight Eastern and 10pm Pacific,
 * which is ahead of 3 AM in either. **Worth pinning down with DC support** — if
 * their sweep is earlier than this, the dealer gets yesterday's file every day
 * and nothing anywhere says so.
 *
 * AUTH: `CRON_SECRET` in the Authorization header, same shape Vercel Cron sends
 * and the same gate as the other cron routes. Refusing when it is unset fails
 * closed in local dev too, which is correct — this reads inventory for every
 * tenant and writes it into dealers' own management systems.
 *
 * Always 200 on an authenticated call, including when every dealer was skipped.
 * A non-2xx is Vercel's retry signal, and retrying a run that deliberately
 * declined would re-run the guard to the same conclusion.
 *
 * THIS ROUTE IS LIVE THE DAY IT DEPLOYS AND WILL DO NOTHING. The gate is the
 * connection state, not this file: `DEALERCENTER_FILE_STATUSES` excludes
 * `SUBMITTED`, so until a dealer's connection moves to `CONNECTED` the run finds
 * nobody and logs a considered count of zero. That is the intended state before
 * cutover — do not "fix" it by adding SUBMITTED back.
 */

import { NextResponse } from 'next/server';
import { runDealerCenterUpload } from '@/lib/dealercenter/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** FTP plus a build per dealer. Well clear of the default 10s. */
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const run = await runDealerCenterUpload();

  // The lines an operator greps for at 6am.
  console.log(
    `[dealercenter] ${run.considered} eligible — ` +
      `${run.uploaded} uploaded, ${run.skipped} skipped, ${run.failed} failed`,
  );
  for (const f of run.files) {
    console.log(
      `[dealercenter] ${f.status} ${f.filename} (${f.rooftopName}) — ` +
        `${f.rows} rows, ${f.excluded} held out${f.message ? ` — ${f.message}` : ''}`,
    );
  }
  for (const w of run.warnings) console.log(`[dealercenter] warning: ${w}`);

  return NextResponse.json(run);
}
