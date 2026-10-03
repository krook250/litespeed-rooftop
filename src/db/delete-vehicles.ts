/**
 * Delete vehicles from one rooftop, by VIN, on purpose.
 *
 * There is no delete anywhere in the product — the only other
 * `delete(t.vehicles)` in this codebase is the seed wipe — so this is it until
 * there is a button. It exists for the case that produced it: inventory synced
 * in from another system that includes units the dealer has already sold, with
 * no sale price and no sale date, which are not history and should not become
 * history by being marked SOLD.
 *
 * ## Why marking them SOLD is the wrong move, and deleting is right
 *
 * `SOLD` with no `salePrice` and no `soldDate` is worse than absent. Reporting
 * reads sold units for turn, days supply and gross; a unit sold for an unknown
 * amount on an unknown date pollutes every one of those numbers quietly and
 * permanently. A car that was never really ours to sell should leave.
 *
 * ## What actually happens
 *
 * The database is built for this. Every table that references a vehicle
 * cascades — photos, photo ingests, sync states, price changes and the rest go
 * with it in one statement. Two deliberately do not: `leads` and `intakeScans`
 * keep their rows with `vehicleId` set to null, so a customer who asked about a
 * car is not deleted along with the car. Lead counts are printed before anything
 * happens, because that unlink is the one consequence you cannot undo by
 * re-importing the vehicle.
 *
 * Photo *blobs* in storage are not touched and become orphaned. They are not
 * reachable from anywhere after this and cost approximately nothing; deleting
 * them needs the blob client and is not worth coupling to this.
 *
 * ## Why it takes VINs and not a filter
 *
 * `--list` finds candidates; it never deletes them. Deleting takes explicit
 * VINs, so a filter that matches one car too many cannot quietly take it. A VIN
 * that is not in the named rooftop is refused rather than searched for
 * elsewhere.
 *
 * Usage:
 *   npx tsx src/db/delete-vehicles.ts "Malabar Truck and Trade" --list
 *   npx tsx src/db/delete-vehicles.ts "Malabar Truck and Trade" 1GC... 1GT...
 *   npx tsx src/db/delete-vehicles.ts "Malabar Truck and Trade" 1GC... --confirm
 */

import 'dotenv/config';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';

const SOLD_STATUSES = ['SOLD', 'WHOLESALED'] as const;

export type Candidate = {
  id: string;
  vin: string | null;
  stockNumber: string;
  title: string;
  status: string;
  price: number;
  salePrice: number | null;
  soldDate: Date | null;
  photos: number;
  leads: number;
};

async function rooftopByName(name: string): Promise<{ id: string; name: string }> {
  const lots = await db
    .select({ id: t.rooftops.id, name: t.rooftops.name })
    .from(t.rooftops)
    .where(eq(t.rooftops.name, name));
  if (lots.length === 0) {
    const all = await db.select({ name: t.rooftops.name }).from(t.rooftops).orderBy(t.rooftops.name);
    throw new Error(
      `No rooftop named exactly "${name}". Rooftops on this database:\n` +
        all.map((r) => `  ${r.name}`).join('\n'),
    );
  }
  if (lots.length > 1) throw new Error(`${lots.length} rooftops are named "${name}".`);
  return lots[0];
}

async function describe(rooftopId: string, where: ReturnType<typeof and>): Promise<Candidate[]> {
  const rows = await db
    .select({
      id: t.vehicles.id,
      vin: t.vehicles.vin,
      stockNumber: t.vehicles.stockNumber,
      year: t.vehicles.year,
      make: t.vehicles.make,
      model: t.vehicles.model,
      status: t.vehicles.status,
      price: t.vehicles.price,
      salePrice: t.vehicles.salePrice,
      soldDate: t.vehicles.soldDate,
    })
    .from(t.vehicles)
    .where(and(eq(t.vehicles.rooftopId, rooftopId), where));

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];

  const photoCounts = await db
    .select({ vehicleId: t.vehiclePhotos.vehicleId, n: sql<number>`count(*)::int` })
    .from(t.vehiclePhotos)
    .where(inArray(t.vehiclePhotos.vehicleId, ids))
    .groupBy(t.vehiclePhotos.vehicleId);

  const leadCounts = await db
    .select({ vehicleId: t.leads.vehicleId, n: sql<number>`count(*)::int` })
    .from(t.leads)
    .where(inArray(t.leads.vehicleId, ids))
    .groupBy(t.leads.vehicleId);

  const photosBy = new Map(photoCounts.map((r) => [r.vehicleId, r.n]));
  const leadsBy = new Map(leadCounts.map((r) => [r.vehicleId, r.n]));

  return rows.map((r) => ({
    id: r.id,
    vin: r.vin,
    stockNumber: r.stockNumber,
    title: `${r.year} ${r.make} ${r.model}`,
    status: r.status,
    price: r.price,
    salePrice: r.salePrice,
    soldDate: r.soldDate,
    photos: photosBy.get(r.id) ?? 0,
    leads: leadsBy.get(r.id) ?? 0,
  }));
}

/**
 * Sold or wholesaled, with neither a sale price nor a sale date.
 *
 * Both halves matter. A unit with a sale price and no date is a data-entry gap
 * worth fixing, not a car to delete, and this must not offer it up as one.
 */
export async function soldWithoutSaleData(rooftopId: string): Promise<Candidate[]> {
  return describe(
    rooftopId,
    and(
      inArray(t.vehicles.status, [...SOLD_STATUSES]),
      or(isNull(t.vehicles.salePrice), eq(t.vehicles.salePrice, 0)),
      isNull(t.vehicles.soldDate),
    ),
  );
}

export async function deleteByVin(
  rooftopId: string,
  vins: string[],
): Promise<{ deleted: Candidate[] }> {
  const found = await describe(rooftopId, inArray(t.vehicles.vin, vins));
  const missing = vins.filter((v) => !found.some((f) => f.vin?.toUpperCase() === v.toUpperCase()));
  if (missing.length > 0) {
    throw new Error(
      `Not in this rooftop, so nothing was deleted: ${missing.join(', ')}.\n` +
        'Check the VIN, or the rooftop. This does not go looking in other lots.',
    );
  }
  await db.delete(t.vehicles).where(
    inArray(
      t.vehicles.id,
      found.map((f) => f.id),
    ),
  );
  return { deleted: found };
}

function line(c: Candidate): string {
  const sale = c.salePrice ? `$${c.salePrice}` : '—';
  const when = c.soldDate ? c.soldDate.toISOString().slice(0, 10) : '—';
  return (
    `    ${c.vin ?? '(no VIN)'}  ${c.title.padEnd(28)} ${c.status.padEnd(11)} ` +
    `asking $${String(c.price).padEnd(7)} sold ${sale.padEnd(8)} ${when.padEnd(11)} ` +
    `${c.photos} photo(s)${c.leads > 0 ? `, ${c.leads} LEAD(S)` : ''}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const list = args.includes('--list');
  // Every unit, whatever its status. `--list` only finds vehicles already marked
  // sold, and a lot synced in from another system carries units the dealer sold
  // there and never marked here — which is exactly the case this was built for,
  // and exactly the one `--list` cannot see.
  const listAll = args.includes('--all');
  const confirm = args.includes('--confirm');
  const positional = args.filter((a) => !a.startsWith('--'));
  const name = positional[0];
  // VINs are stored uppercase; a pasted lowercase one should still match rather
  // than silently report 'not in this rooftop'.
  const vins = positional.slice(1).map((v) => v.trim().toUpperCase());

  if (!name) {
      console.error(
      'usage: npx tsx src/db/delete-vehicles.ts "<rooftop name>" [--list | --all | <VIN>... [--confirm]]',
    );
    process.exit(1);
  }

  const lot = await rooftopByName(name);

  if (list || listAll) {
    const cands = listAll
      ? await describe(lot.id, sql`true`)
      : await soldWithoutSaleData(lot.id);
    console.log('');
    console.log(
      listAll
        ? `  ${lot.name} — every vehicle`
        : `  ${lot.name} — sold or wholesaled, no sale price, no sale date`,
    );
    console.log('');
    if (cands.length === 0) console.log('    (none)');
    else for (const c of [...cands].sort((a, b) => a.title.localeCompare(b.title))) {
      console.log(line(c));
    }
    console.log('');
    console.log(`  ${cands.length} vehicle(s). Nothing was deleted — pass the VINs you want gone.`);
    console.log('');
    process.exit(0);
  }

  if (vins.length === 0) {
    console.error('No VINs given. Use --list to see candidates.');
    process.exit(1);
  }

  const preview = await describe(lot.id, inArray(t.vehicles.vin, vins));
  const missing = vins.filter((v) => !preview.some((p) => p.vin?.toUpperCase() === v.toUpperCase()));

  console.log('');
  console.log(`  ${lot.name}`);
  console.log('');
  for (const c of preview) console.log(line(c));
  if (missing.length > 0) {
    console.log('');
    console.log(`  NOT FOUND in this rooftop: ${missing.join(', ')}`);
  }

  const leads = preview.reduce((n, c) => n + c.leads, 0);
  console.log('');
  if (leads > 0) {
    console.log(`  ${leads} lead(s) will be kept but unlinked from their vehicle. That cannot be undone`);
    console.log('  by re-importing the car.');
    console.log('');
  }

  if (!confirm) {
    console.log(`  DRY RUN — nothing deleted. Re-run with --confirm to delete ${preview.length}.`);
    console.log('');
    process.exit(0);
  }

  const { deleted } = await deleteByVin(lot.id, vins);
  console.log(`  DELETED ${deleted.length} vehicle(s). Photo blobs in storage are now orphaned.`);
  console.log('');
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
