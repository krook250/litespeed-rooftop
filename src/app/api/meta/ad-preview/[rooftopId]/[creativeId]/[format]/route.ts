/**
 * An ad preview, served from our own origin so Meta's token never reaches the
 * browser.
 *
 * WHY THIS ROUTE EXISTS AT ALL. `GET /{creative_id}/previews` hands back an
 * `<iframe>` whose `src` is a facebook.com URL with an access token in the query
 * string. Embedding that directly is what most ad tools do, and on this product
 * it would publish a **non-expiring Business Integration System User token** —
 * the credential whose entire selling point is that it survives staff turnover —
 * into a page any dealership employee can open devtools on.
 *
 * So the flow is: resolve the token server-side, ask Meta for the preview URL,
 * fetch that URL server-side, and return the HTML from here. The browser only
 * ever sees our path. The iframe in the Ad Desk points at this.
 *
 * Scoped like every other authenticated route: the rooftop id is checked against
 * the session's scope before a token is loaded, so the credential is picked by
 * who is asking rather than by what they asked for. The creative id needs no
 * separate ownership check — the token that fetches it belongs to this dealer's
 * business, and Meta refuses anything outside it.
 */

import { NextResponse } from 'next/server';
import { sessionScope } from '@/lib/queries';
import { assertRooftopInScope } from '@/lib/scoped-db';
import { requireGroupId } from '@/lib/auth';
import { tokenFor } from '@/lib/meta/connect';
import { previewUrlForCreative, PREVIEW_FORMATS, type PreviewFormat } from '@/lib/meta/campaigns';

export const dynamic = 'force-dynamic';

/** A plain, styled message rendered inside the iframe when there is nothing to show. */
function note(text: string, status = 200) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px system-ui;color:#6b7280;` +
      `display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:1rem">` +
      `${text}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ rooftopId: string; creativeId: string; format: string }> },
) {
  const { rooftopId, creativeId, format } = await params;

  const groupId = await requireGroupId();
  const rooftop = await assertRooftopInScope(await sessionScope(), rooftopId);
  if (!rooftop) return note('Not found.', 404);

  if (!PREVIEW_FORMATS.some((f) => f.key === format)) return note('Unknown preview format.', 400);
  if (!/^\d+$/.test(creativeId)) return note('Unknown ad.', 400);

  const conn = await tokenFor(groupId);
  if (!conn) return note('Facebook is not connected.');

  const url = await previewUrlForCreative(conn.token, creativeId, format as PreviewFormat);
  if (!url) return note('Facebook has no preview for this placement.');

  try {
    const res = await fetch(url, { cache: 'no-store' });
    const html = await res.text();
    return new NextResponse(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Never cached: the upstream URL is short-lived and the content is one
        // dealer's ad. A shared cache entry here would be a cross-tenant leak.
        'cache-control': 'no-store, private',
      },
    });
  } catch {
    return note('Could not load the preview just now.');
  }
}
