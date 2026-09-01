/**
 * Drains the imported-photo queue: fetch what is still hosted on the site the
 * dealer is leaving, store it in Blob, point the photo at our copy.
 *
 * AUTH: `CRON_SECRET` in the Authorization header, same gate and same
 * fail-closed-when-unset posture as `/api/cron/cargurus-feed`. This one reaches
 * out to arbitrary URLs on the internet and writes to Blob, so a stray curl
 * should not be able to start it.
 *
 * Runs often, because the queue is only full right after an import and a dealer
 * watching his new storefront should not have to wait a day for his photos to
 * become durable.
 *
 * Always 200 on an authenticated call. A photo that failed is recorded on its
 * own row with the reason and retried on the next pass; a non-2xx here would
 * only make Vercel re-run the whole batch.
 */

import { NextResponse } from 'next/server';
import { runPhotoIngests } from '@/lib/photos/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Sixty fetches against someone else's CDN, four at a time. */
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Not found', { status: 404 });
  }

  const run = await runPhotoIngests();

  console.log(
    `[photo-ingest] claimed ${run.claimed} — ${run.ingested} stored, ${run.reused} reused, ${run.failed} failed`,
  );
  for (const w of run.warnings) console.log(`[photo-ingest] warning: ${w}`);

  return NextResponse.json(run);
}
