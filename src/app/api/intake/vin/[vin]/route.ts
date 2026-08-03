/**
 * GET /api/intake/vin/:vin — decode only, no document.
 *
 * Three callers, all of which want the same thing and none of which have a file
 * to upload:
 *
 *   - the barcode fast path, when the phone read the doorjamb strip directly
 *   - the VIN box, when someone typed or pasted seventeen characters
 *   - the offline queue, replaying a VIN captured with no signal
 *
 * It is a GET because the answer is a pure function of the VIN and is cached
 * forever behind `vinDecodes` — which means a native client can cache it too,
 * and a re-scan on a lot with one bar of signal still fills the form.
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { decodeVin } from '@/lib/intake/vin-decode';
import { expectedCheckDigit, normaliseVin } from '@/lib/intake/parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Params typed explicitly rather than via the generated `RouteContext` global,
// matching `api/logo/[key]/route.ts`. The generated form only exists after a
// `next typegen`, so a clean checkout would not typecheck before its first build.
export async function GET(_req: Request, ctx: { params: Promise<{ vin: string }> }) {
  // Not public: vPIC is free and open, but this endpoint is also a free
  // unauthenticated proxy to a government API sitting on our rate limit and our
  // Vercel bill. Session-gated for the same reason every other route here is.
  await requireSession();

  const { vin } = await ctx.params;
  const candidate = normaliseVin(vin);

  if (!candidate) {
    return NextResponse.json(
      { ok: false, error: 'A VIN is 17 characters and never contains I, O or Q.' },
      { status: 400 },
    );
  }

  if (!candidate.checksums) {
    // Returning *what the digit should have been* turns "invalid VIN" into a
    // one-character diagnosis. Position 9 is the one to look at again.
    return NextResponse.json(
      {
        ok: false,
        vin: candidate.vin,
        error:
          `${candidate.vin} does not pass its check digit — character 9 reads "${candidate.vin[8]}" ` +
          `and should be "${expectedCheckDigit(candidate.vin) ?? '?'}". One of the seventeen is wrong.`,
      },
      { status: 422 },
    );
  }

  const decoded = await decodeVin(candidate.vin);
  if (!decoded.ok) {
    return NextResponse.json(
      {
        ok: false,
        vin: candidate.vin,
        error:
          decoded.reason === 'UNAVAILABLE'
            ? 'NHTSA is not answering right now. Fill the rest in by hand and it will still save.'
            : 'NHTSA has no record for that VIN.',
      },
      { status: decoded.reason === 'UNAVAILABLE' ? 503 : 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    vin: candidate.vin,
    repairedFrom: candidate.repairedFrom ?? null,
    cached: decoded.cached,
    extraction: decoded.extraction,
  });
}
