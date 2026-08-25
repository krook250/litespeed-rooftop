/**
 * Download the CarGurus upload file for one rooftop.
 *
 * WHY THIS IS SESSION-AUTHENTICATED AND THE META FEED IS NOT
 *
 * The Meta feed route is an unauthenticated URL guarded by an unguessable
 * secret, because Meta's own infrastructure fetches it on a schedule with no
 * session to lean on. CarGurus does the opposite: they do not pull, we push,
 * over FTP with credentials they issue. Nobody outside the building ever needs
 * to fetch this URL, so it takes the ordinary admin session and the ordinary
 * tenant scope, and there is no secret to leak.
 *
 * Until the FTP transport exists this is the whole delivery mechanism: an
 * operator downloads the file and uploads it. That is deliberately a fine place
 * to stop. Onboarding is per-dealer and manual anyway — see
 * `claude/syndication-onboarding-runbook.md` — so a human is already in this
 * loop, and a downloadable file is what makes the first real upload possible
 * without also having to trust a scheduler nobody has watched run yet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { loadCarGurusFeed } from '@/lib/cargurus/feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ rooftopId: string }> },
) {
  const { rooftopId } = await ctx.params;

  await requireSession();
  const scope = await sessionScope();
  // A rooftop id from another tenant is a 404, not a 403 — a 403 would confirm
  // the id exists.
  if (!(await assertRooftopInScope(scope, rooftopId))) {
    return new NextResponse('Not found', { status: 404 });
  }

  const feed = await loadCarGurusFeed(rooftopId);
  if (!feed) return new NextResponse('Not found', { status: 404 });

  // CarGurus: "file names do not need to be unique." Dated anyway, because the
  // operator uploading these will have several in a downloads folder and needs
  // to know which is which.
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `cargurus-${feed.slug}-${stamp}.csv`;

  return new NextResponse(feed.csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store, max-age=0',
      // Turns "why does CarGurus show 34 cars when I have 41?" into a question
      // answerable from the response rather than a database session.
      'x-rooftop-cargurus-considered': String(feed.counts.considered),
      'x-rooftop-cargurus-sent': String(feed.counts.sent),
      'x-rooftop-cargurus-excluded': String(feed.counts.excluded),
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'no-referrer',
    },
  });
}
