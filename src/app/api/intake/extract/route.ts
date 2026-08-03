/**
 * POST /api/intake/extract — pages in, a reviewable vehicle out.
 *
 * WHY THIS IS A ROUTE HANDLER AND NOT A SERVER ACTION
 * Everything else that writes in this app is a server action, and for form posts
 * that is the right shape. This one is not, on purpose: the roadmap says a PWA
 * first and a native app after, and a native client cannot call a server action
 * — the protocol is a React-internal detail, not an API. A plain multipart POST
 * returning plain JSON is callable from a service worker, from a background
 * upload queue, from Swift, and from curl at three in the morning when a dealer
 * says it read the wrong mileage.
 *
 * The cost of that decision is one hand-rolled auth check and one hand-rolled
 * FormData parse, both below. The benefit is that the app does not need a second
 * intake path later, and neither does the offline queue.
 *
 * WHAT THIS HANDLER OWNS
 * Auth, tenant scope, size limits, byte sniffing, and shaping the response.
 * Everything else is `lib/intake/scan.ts`, so a second transport is thirty lines
 * rather than a fork.
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { scan } from '@/lib/intake/scan';
import {
  MAX_PAGES,
  MAX_TOTAL_BYTES,
  sniffDocument,
} from '@/lib/intake/sniff';
import type { Page } from '@/lib/intake/read-document';

export const runtime = 'nodejs';
/**
 * A cold vision read of a three-page window sticker can take twenty seconds, and
 * the platform default would cut it off at ten — producing a timeout that looks
 * exactly like a bad photo. Sixty is generous enough that a genuine hang is a
 * genuine hang.
 */
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const me = await requireSession();
  const scopeIds = (await sessionScope()).rooftopIds;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, 'Send this as multipart/form-data with one or more `pages` files.');
  }

  const rooftopId = String(form.get('rooftopId') ?? '');
  // Same rule as `saveVehicle`: a rooftop id off a request is a claim, not a
  // fact. Refuse rather than default, so a crafted post cannot file a scan
  // against the next dealer's lot.
  if (!rooftopId || !scopeIds.includes(rooftopId)) {
    return bad(403, 'That rooftop is not one of yours.');
  }

  const barcodeVin = str(form.get('barcodeVin'));

  const files = form.getAll('pages').filter((f): f is File => f instanceof File);
  if (!files.length && !barcodeVin) {
    return bad(400, 'Attach at least one page, or send a `barcodeVin`.');
  }
  if (files.length > MAX_PAGES) {
    return bad(413, `${files.length} pages is more than the ${MAX_PAGES} this reads at once.`);
  }

  const pages: Page[] = [];
  let total = 0;
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      return bad(413, 'Those pages add up to more than this accepts in one go. Send them in two scans.');
    }
    const sniffed = sniffDocument(bytes);
    if (!sniffed.ok) return bad(415, sniffed.error);
    pages.push({ bytes, contentType: sniffed.contentType });
  }

  try {
    const result = await scan({
      pages,
      rooftopId,
      userId: me.id,
      barcodeVin,
    });
    return NextResponse.json(result);
  } catch (err) {
    // The scan orchestrator swallows its own recoverable failures, so anything
    // arriving here is unexpected. Log it with the tenant attached and return
    // something a person on a lot can act on.
    console.error('[intake] scan failed', { rooftopId, err });
    return bad(500, 'Something broke reading that document. The VIN box below still works.');
  }
}

function str(v: FormDataEntryValue | null): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function bad(status: number, message: string) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
