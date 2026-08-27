/**
 * The intake orchestrator: pages in, a reviewable vehicle out.
 *
 * Everything user-facing goes through this one function — the web app's upload,
 * the barcode fast path, and whatever the native client posts later. Keeping the
 * sequencing here rather than in the route handler is what makes that true: the
 * route's job is auth, limits and JSON, and it should stay short enough that a
 * second transport can be added without copying any logic.
 *
 * THE SEQUENCE, AND WHY IT IS THIS ORDER
 *   1. read the pages          — the only slow step, and the only paid one
 *   2. settle on a VIN         — check digit arithmetic, no network
 *   3. decode the VIN          — free, cached, authoritative for specs
 *   4. merge with precedence   — vPIC beats the document, always
 *   5. look for a duplicate    — before a person types anything, not after
 *   6. record the scan         — so a bad read is a lookup, not a re-enactment
 *
 * Step 5 is easy to leave out and expensive to leave out. Two people adding cars
 * at a three-person store will scan the same auction sheet within an hour of
 * each other, and finding out after the unit is live means deleting one and
 * hoping nothing syndicated first.
 */

import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { decodeVin } from './vin-decode';
import { merge, chooseVin } from './merge';
import { normaliseVin } from './parse';
import { readDocument, availableReader, type DocClaims, type Page } from './read-document';
import type { Extraction, ScanResult, ScanWarning } from './types';

/**
 * Raw transcripts and vendor payloads are only kept when this is set. See the
 * note on `intakeScans` in the schema: a title's text contains the previous
 * owner's name and address, and holding that by default is a Safeguards answer
 * nobody wants to give in exchange for debugging convenience.
 */
const RETAIN_RAW = process.env.INTAKE_RETAIN_RAW === '1';

export type ScanRequest = {
  pages: Page[];
  rooftopId: string;
  userId?: string | null;
  /**
   * A VIN the client already read off a machine-readable code. When this is
   * present and clean, the reader is skipped entirely — the whole scan is a
   * cached vPIC lookup and comes back in well under a second.
   */
  barcodeVin?: string | null;
};

export async function scan(req: ScanRequest): Promise<ScanResult> {
  const started = Date.now();

  /* --- 1. read ------------------------------------------------------------ */

  // The barcode fast path. A doorjamb label's Code 39 strip or a dealer's own
  // stock sticker gives an exact VIN, and once we have one that satisfies its
  // check digit there is nothing a document reader can add that vPIC will not
  // give us for free. Skipping the read here is most of the "speed" in this
  // feature: no upload, no model call, no cost.
  const barcodeClean = req.barcodeVin ? normaliseVin(req.barcodeVin)?.checksums : false;
  const skipRead = barcodeClean && req.pages.length === 0;

  const readStart = Date.now();
  const read = skipRead
    ? { reader: 'barcode' as const, claims: null, text: '', raw: null, escalated: false, error: undefined }
    : await readDocument(req.pages, { shouldEscalate: vinLooksWrong });
  const readMs = Date.now() - readStart;

  const warnings: ScanWarning[] = [];
  if (read.error) {
    /**
     * Tell the truth about whose problem this is.
     *
     * The old wording said "try a straighter, better-lit photo" for every
     * failure including a rejected API key — which sent somebody standing on a
     * lot into a loop of retaking photographs of a perfectly good document
     * against a fault no photograph could fix. Advice that cannot work is worse
     * than no advice.
     */
    if (availableReader() === 'none') {
      warnings.push({
        code: 'READER_UNAVAILABLE',
        message:
          'Document reading is not switched on for this environment yet. You can still scan a VIN barcode or type the VIN in.',
      });
    } else if (read.errorKind === 'CONFIG') {
      warnings.push({
        code: 'READER_MISCONFIGURED',
        message:
          'Document reading is switched on but the reader rejected the request — that is a setup problem on our side, not your photo. Type the VIN in for now and tell us; retaking it will not help.',
      });
    } else if (read.errorKind === 'TIMEOUT') {
      warnings.push({
        code: 'READER_TIMEOUT',
        message:
          'The reader took too long to answer. Try once more, or type the VIN in — this one is usually a bad moment rather than a bad photo.',
      });
    } else {
      warnings.push({
        code: 'PARTIAL_READ',
        message:
          'The reader could not finish this document. Try a straighter, better-lit photo, or type the VIN in.',
      });
    }
  }

  /* --- 2 & 3. VIN, then decode ------------------------------------------- */

  const picked = chooseVin({
    barcodeVin: req.barcodeVin,
    claimedVin: read.claims?.vin,
    text: read.text,
  });

  let vinDecoded: Extraction | null = null;
  let vinDecodeFailed = false;
  const decodeStart = Date.now();
  if (picked.candidate?.checksums) {
    const decoded = await decodeVin(picked.candidate.vin);
    if (decoded.ok) vinDecoded = decoded.extraction;
    else vinDecodeFailed = decoded.reason !== 'INVALID_VIN';
  }
  const decodeMs = Date.now() - decodeStart;

  /* --- 4. merge ----------------------------------------------------------- */

  const merged = merge({
    barcodeVin: req.barcodeVin,
    claims: read.claims,
    text: read.text,
    vinDecoded,
    vinDecodeFailed,
  });
  warnings.push(...merged.warnings);

  /* --- 5. duplicate check ------------------------------------------------- */

  let existingVehicleId: string | undefined;
  if (merged.vin) {
    const existing = await findExistingVin(req.rooftopId, merged.vin.vin);
    if (existing) {
      existingVehicleId = existing.id;
      warnings.unshift({
        code: 'DUPLICATE_VIN',
        message: `${existing.year} ${existing.make} ${existing.model} (stock ${existing.stockNumber}) is already in inventory with this VIN.`,
      });
    }
  }

  /* --- 6. record ---------------------------------------------------------- */

  const totalMs = Date.now() - started;
  const scanId = await recordScan({
    req,
    read,
    merged,
    warnings,
    readMs,
    totalMs,
  });

  return {
    ok: Boolean(merged.vin) || Object.keys(merged.extraction).length > 0,
    scanId,
    documentKind: read.claims?.documentKind ?? (skipRead ? 'VIN_PLATE' : 'UNKNOWN'),
    reader: read.reader,
    extraction: merged.extraction,
    warnings,
    existingVehicleId,
    // Page images are deliberately not persisted here — see the note below.
    blobKeys: [],
    timings: { readMs, decodeMs, totalMs },
  };
}

/**
 * Escalate when the model's own VIN fails its check digit.
 *
 * This is the rare case of a system that can grade its own homework. The digit
 * is arithmetic over the other sixteen characters, so a failure is proof of a
 * misread rather than a suspicion of one — which makes it exactly the right
 * trigger for spending a second, more expensive read. A clean read never pays.
 */
function vinLooksWrong(claims: DocClaims): boolean {
  if (!claims.vin) return false;
  const c = normaliseVin(claims.vin);
  return !c || !c.checksums;
}

async function findExistingVin(rooftopId: string, vin: string) {
  // Scoped to the dealer group rather than the single rooftop: a unit sitting at
  // the other lot is still a duplicate, and "add it again at this location" is a
  // transfer, not an intake.
  const group = await db
    .select({ groupId: t.rooftops.groupId })
    .from(t.rooftops)
    .where(eq(t.rooftops.id, rooftopId))
    .limit(1);
  const groupId = group[0]?.groupId;
  if (!groupId) return null;

  const rows = await db
    .select({
      id: t.vehicles.id,
      year: t.vehicles.year,
      make: t.vehicles.make,
      model: t.vehicles.model,
      stockNumber: t.vehicles.stockNumber,
    })
    .from(t.vehicles)
    .where(
      and(
        eq(t.vehicles.vin, vin),
        inArray(
          t.vehicles.rooftopId,
          db.select({ id: t.rooftops.id }).from(t.rooftops).where(eq(t.rooftops.groupId, groupId)),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Page images are NOT written to `blobs`.
 *
 * `lib/storage.ts` spells out the arithmetic that makes logos-in-Postgres fine
 * and states plainly that it is "exactly why vehicle photos must not come here".
 * A scanned title is a vehicle photo by weight — several megabytes, one or more
 * per unit — so it goes to R2 with the rest of the photo pipeline when roadmap
 * item 3 lands, and until then the browser keeps its own copy for the preview.
 * Storing them now would quietly undo a boundary the codebase argued for.
 */
async function recordScan(args: {
  req: ScanRequest;
  read: Awaited<ReturnType<typeof readDocument>>;
  merged: ReturnType<typeof merge>;
  warnings: ScanWarning[];
  readMs: number;
  totalMs: number;
}): Promise<string | null> {
  const { req, read, merged, warnings, readMs, totalMs } = args;
  try {
    const rows = await db
      .insert(t.intakeScans)
      .values({
        rooftopId: req.rooftopId,
        userId: req.userId ?? null,
        reader: read.reader,
        escalated: read.escalated,
        documentKind: read.claims?.documentKind ?? 'UNKNOWN',
        pageCount: req.pages.length,
        blobKeys: [],
        vin: merged.vin?.vin ?? null,
        vinChecksums: merged.vin ? merged.vin.checksums : null,
        extraction: merged.extraction,
        warnings,
        transcript: RETAIN_RAW ? read.text.slice(0, 20_000) : null,
        rawResponse: RETAIN_RAW ? (read.raw as object | null) : null,
        readMs,
        totalMs,
        error: read.error ?? null,
      })
      .returning({ id: t.intakeScans.id });
    return rows[0]?.id ?? null;
  } catch {
    // A scan that cannot be logged is still a scan. Never fail the user's
    // upload because the audit write did.
    return null;
  }
}
