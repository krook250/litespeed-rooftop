/**
 * Scheduled push of the CarGurus file. Twice daily, per their own guidance:
 * "Please schedule your system for daily or twice-a-day export." Not hourly.
 *
 * AUTH: `CRON_SECRET` in the `Authorization` header, the same shape Vercel Cron
 * sends and the same gate as `/api/cron/domain-nudge`. Refusing when it is unset
 * fails closed in local dev too, which is correct — this reads inventory for
 * every tenant on the platform and pushes it to a public marketplace, and that
 * is not something a stray curl should be able to do.
 *
 * This is the second place in the codebase that reads across every tenant with
 * no session. The other is the domain-nudge sweep. Both are cron-only for the
 * reason documented on `carGurusBatchRooftops` — `requireStaff()` reads request
 * headers and there is no request here.
 *
 * Always 200 on an authenticated call, including when the run refused to upload.
 * A non-2xx is Vercel's retry signal, and retrying a run that deliberately
 * declined to send would just re-run the guard to the same conclusion.
 */

import { NextResponse } from 'next/server';
import { runCarGurusUpload } from '@/lib/cargurus/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** FTP plus a build across every rooftop. Well clear of the default 10s. */
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const run = await runCarGurusUpload();

  // The log line an operator greps for at 6am.
  console.log(
    `[cargurus] ${run.status} ${run.filename} — ${run.rows} rows across ${run.lots} lot(s), ` +
      `${run.excluded} held out${run.message ? ` — ${run.message}` : ''}`,
  );
  for (const w of run.warnings) console.log(`[cargurus] warning: ${w}`);

  return NextResponse.json(run);
}
