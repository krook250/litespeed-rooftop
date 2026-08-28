/**
 * Write an inventory file into a rooftop.
 *
 * RE-PLANS FROM THE FILE. IT DOES NOT ACCEPT A PLAN.
 *
 * The obvious shape — the screen already has a plan, so post it back — hands a
 * browser the ability to name a rooftop, a VIN and a price and have them
 * written. That is not a bug in a validator somewhere; the endpoint would be
 * doing exactly what it was asked. So the client sends the same two things it
 * sent to `/plan` (the file and the agreed mapping) and the server derives
 * everything it writes. The only thing a caller can influence is the mapping,
 * which is a choice of column names, and those are checked against the file.
 *
 * The tenant check is in `commitImport`, which takes a `Scope` and refuses a
 * rooftop outside it.
 */

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth';
import { sessionScope } from '@/lib/queries';
import { vinsInScope } from '@/lib/scoped-db';
import { parseCsv } from '@/lib/import/csv';
import { unmappedRequired, type Mapping } from '@/lib/import/mapping';
import { planImport } from '@/lib/import/plan';
import { enrichPlan } from '@/lib/import/enrich';
import { commitImport } from '@/lib/import/commit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Hundreds of inserts plus their photos. Nowhere near the default 10s. */
export const maxDuration = 300;

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  await requireSession();
  const scope = await sessionScope();

  let body: { csv?: string; mapping?: Mapping; rooftopId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const csv = body.csv ?? '';
  const rooftopId = body.rooftopId ?? '';
  const mapping = body.mapping ?? {};

  if (!csv.trim()) return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
  if (Buffer.byteLength(csv, 'utf8') > MAX_BYTES) {
    return NextResponse.json({ error: 'That file is larger than 12MB.' }, { status: 413 });
  }
  if (!rooftopId) return NextResponse.json({ error: 'Pick a lot to import into.' }, { status: 400 });

  const missing = unmappedRequired(mapping);
  if (missing.length) {
    return NextResponse.json(
      { error: `Still unmapped: ${missing.join(', ')}.` },
      { status: 400 },
    );
  }

  const table = parseCsv(csv);
  const named = Object.values(mapping).filter(Boolean) as string[];
  const unknown = named.filter((h) => !table.headers.includes(h));
  if (unknown.length) {
    return NextResponse.json(
      { error: `Mapping names columns this file does not have: ${unknown.join(', ')}.` },
      { status: 400 },
    );
  }

  const raw = planImport(table.rows, mapping, { existingVins: await vinsInScope(scope) });
  // Same enrichment the preview ran. Every decode is cached in `vin_decodes` by
  // then, so this is a database read rather than twenty-one network calls.
  const { plan } = await enrichPlan(raw);

  try {
    const result = await commitImport(scope, rooftopId, plan);
    revalidatePath('/admin/inventory');
    revalidatePath('/admin/dashboard');
    return NextResponse.json({ ...result, summary: plan.summary });
  } catch (e) {
    // `commitImport` throws only for a rooftop outside the scope, and says the
    // same thing for "not yours" as for "does not exist".
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Import failed.' },
      { status: 404 },
    );
  }
}
