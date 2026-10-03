/**
 * Give a stock number to any vehicle that has none.
 *
 * `vehicles.stockNumber` is NOT NULL, so "none" means the empty string — which
 * the bulk importer can never produce (it derives one and warns; see
 * `deriveStockNumber` and `plan.ts`) but a hand-added vehicle can, because the
 * form has never required it. Two of Malabar's 35 arrived that way, and
 * DealerCenter lists Stock as a required field, so those two units would land in
 * his DMS without the number written on their windshield.
 *
 * ## Why the VIN's last six, and why here rather than in the feed
 *
 * The last six is the factory's sequential serial, and it is already the rule
 * `deriveStockNumber` applies at import — imported cars carry VIN-derived stock
 * numbers today, so this is the existing convention, not a new one.
 *
 * Deriving it *in the feed* instead was the tempting shortcut and is wrong: the
 * number would exist only in DealerCenter, so searching one system for a stock
 * number would not find it in the other. A stock number is the dealer's own
 * identifier for a car. It belongs in his inventory record, once.
 *
 * Idempotent — the filter matches nothing on a second run. Skips any vehicle
 * with no VIN, since there is nothing to derive from; those are reported rather
 * than given a made-up number.
 *
 * ## Scoped to one rooftop, required, not optional
 *
 * The first cut of this ran platform-wide and turned up a test Camaro in another
 * lot alongside the two real trucks. Nothing bad happened because it was a dry
 * run, and that is the point: a write that reaches every tenant on the platform
 * should not be the default shape of a fix for two cars. The rooftop name is a
 * required argument.
 *
 * Usage:
 *   npx tsx src/db/backfill-stock-numbers.ts "Malabar Truck and Trade" --dry-run
 */

import 'dotenv/config';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import { deriveStockNumber } from '../lib/import/mapping';

export type StockBackfillRow = {
  id: string;
  vin: string | null;
  title: string;
  stockNumber: string | null;
};

export async function backfillStockNumbers(
  rooftopId: string,
  dryRun = false,
): Promise<{
  filled: StockBackfillRow[];
  skipped: StockBackfillRow[];
}> {
  const blank = await db
    .select({
      id: t.vehicles.id,
      vin: t.vehicles.vin,
      year: t.vehicles.year,
      make: t.vehicles.make,
      model: t.vehicles.model,
      stockNumber: t.vehicles.stockNumber,
    })
    .from(t.vehicles)
    .where(
      and(
        eq(t.vehicles.rooftopId, rooftopId),
        or(eq(t.vehicles.stockNumber, ''), sql`btrim(${t.vehicles.stockNumber}) = ''`),
      ),
    );

  const filled: StockBackfillRow[] = [];
  const skipped: StockBackfillRow[] = [];

  for (const v of blank) {
    const row: StockBackfillRow = {
      id: v.id,
      vin: v.vin,
      title: `${v.year} ${v.make} ${v.model}`,
      stockNumber: null,
    };

    if (!v.vin || v.vin.trim().length < 6) {
      skipped.push(row);
      continue;
    }

    row.stockNumber = deriveStockNumber(v.vin);
    if (!dryRun) {
      await db
        .update(t.vehicles)
        .set({ stockNumber: row.stockNumber, updatedAt: new Date() })
        .where(eq(t.vehicles.id, v.id));
    }
    filled.push(row);
  }

  return { filled, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const name = args.find((a) => !a.startsWith('--'));
  if (!name) {
    console.error(
      'usage: npx tsx src/db/backfill-stock-numbers.ts "<rooftop name>" [--dry-run]',
    );
    process.exit(1);
  }

  const lots = await db
    .select({ id: t.rooftops.id, name: t.rooftops.name })
    .from(t.rooftops)
    .where(eq(t.rooftops.name, name));
  if (lots.length !== 1) {
    console.error(`Expected exactly one rooftop named "${name}", found ${lots.length}.`);
    process.exit(1);
  }

  const { filled, skipped } = await backfillStockNumbers(lots[0].id, dryRun);
  console.log('');
  console.log(`  ${lots[0].name}`);

  console.log('');
  console.log(dryRun ? '  DRY RUN — nothing written' : '  written');
  for (const v of filled) console.log(`    ${v.vin} → stock ${v.stockNumber}   ${v.title}`);
  if (filled.length === 0) console.log('    (no vehicles were missing a stock number)');

  if (skipped.length > 0) {
    console.log('');
    console.log('  skipped — no VIN to derive from, needs a stock number by hand:');
    for (const v of skipped) console.log(`    ${v.id}   ${v.title}`);
  }
  console.log('');
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
