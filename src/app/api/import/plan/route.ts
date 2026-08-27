/**
 * Dry-run an inventory file. Writes nothing.
 *
 * A ROUTE HANDLER RATHER THAN A SERVER ACTION, for the reason
 * `claude/vehicle-intake-by-document.md` gives about the intake endpoint: the
 * server-action protocol is a React internal, so a native client cannot call
 * one. Plain JSON in, plain JSON out, and the mapping screen re-posts on every
 * change to the mapping rather than holding a parsed file anywhere.
 *
 * WHAT COMES BACK IS A SUMMARY, NOT THE DRAFTS. Twenty-one trucks carry 415
 * photo URLs and ~2,900 options between them; serialising the full drafts to a
 * browser that only renders a table is megabytes for nothing. The commit
 * endpoint re-plans from the same file anyway — see the note there about why it
 * must.
 */

import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { vinsInScope } from '@/lib/scoped-db';
import { parseCsv } from '@/lib/import/csv';
import { inferMapping, unmappedRequired, type Mapping } from '@/lib/import/mapping';
import { planImport } from '@/lib/import/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Big enough for a large lot with long descriptions, small enough to refuse a mistake. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  await requireSession();
  const scope = await sessionScope();

  let body: { csv?: string; mapping?: Mapping };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const csv = body.csv ?? '';
  if (!csv.trim()) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 12MB.' }, { status: 413 });
  }

  const table = parseCsv(csv);
  if (table.headers.length === 0) {
    return NextResponse.json({ error: 'No header row found.' }, { status: 400 });
  }

  // A mapping sent back from the screen wins; otherwise guess.
  const mapping = body.mapping && Object.keys(body.mapping).length
    ? body.mapping
    : inferMapping(table.headers);

  const plan = planImport(table.rows, mapping, { existingVins: await vinsInScope(scope) });

  return NextResponse.json({
    headers: table.headers,
    mapping,
    missing: unmappedRequired(mapping),
    ragged: table.ragged.slice(0, 20),
    raggedCount: table.ragged.length,
    summary: plan.summary,
    rows: plan.rows.map((r) => ({
      line: r.line,
      vin: r.vin,
      title: r.title,
      action: r.action,
      price: r.draft?.price ?? null,
      mileage: r.draft?.mileage ?? null,
      stockNumber: r.draft?.stockNumber ?? null,
      bodyStyle: r.draft?.bodyStyle ?? null,
      photos: r.draft?.photoUrls.length ?? 0,
      options: r.draft?.options.length ?? 0,
      issues: r.issues,
    })),
  });
}
