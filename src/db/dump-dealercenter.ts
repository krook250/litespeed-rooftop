/**
 * Write one rooftop's DealerCenter file to disk and say what is in it.
 *
 * The point is to read a real file, built from real inventory, before
 * DealerCenter ever receives one — and to read it with the held-out units and
 * their reasons beside it, which is the part a CSV cannot show you.
 *
 * Read-only. Opens no FTP connection, writes nothing to the database, and
 * ignores the blocker except to print it: a file that must not be *sent* is
 * exactly the file you most want to look at.
 *
 * MUST RUN WITH `--conditions=react-server`. `feed.ts` imports `server-only`,
 * which throws on import anywhere else; the flag resolves it to an empty module,
 * the same way the `test` script does.
 *
 * Usage:
 *   npx tsx --conditions=react-server src/db/dump-dealercenter.ts "Malabar Truck and Trade"
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import { loadDealerCenterFeed } from '../lib/dealercenter/feed';

async function main() {
  const name = process.argv[2];
  const outDir = process.argv[3] ?? '.';
  if (!name) {
    console.error(
      'usage: npx tsx --conditions=react-server src/db/dump-dealercenter.ts "<rooftop name>" [outDir]',
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

  const feed = await loadDealerCenterFeed(lots[0].id);
  if (!feed) {
    console.error('Rooftop vanished between the two queries.');
    process.exit(1);
  }

  const filename = feed.filename || 'dealercenter-NO-DCID.csv';
  const path = `${outDir.replace(/[\\/]$/, '')}/${filename}`;
  writeFileSync(path, feed.csv, 'utf8');

  console.log('');
  console.log(`  ${feed.rooftopName}`);
  console.log(`  DCID              ${feed.dcid || '(none)'}`);
  console.log(`  connection        ${feed.connectionStatus ?? '(no connection row)'}`);
  console.log(`  live inventory    ${feed.counts.considered}`);
  console.log(`  rows in the file  ${feed.counts.sent}`);
  console.log(`  held out          ${feed.counts.excluded}`);
  console.log(`  written to        ${path}`);
  console.log(`  sendable          ${feed.blocker ? `NO — ${feed.blocker}` : 'yes'}`);

  const held = feed.built.vehicles.filter((v) => v.row === null);
  if (held.length > 0) {
    console.log('');
    console.log('  held out:');
    for (const v of held) {
      console.log(`    ${v.stockNumber}  ${v.title}`);
      for (const i of v.issues) console.log(`      - [${i.code}] ${i.reason}`);
    }
  }

  /**
   * Blank columns, counted across the whole file.
   *
   * This is the number worth looking at before a dealer's DMS sees this. A
   * column blank on every row is either a field we cannot fill (fine, and
   * documented in DC_BLANK_FIELDS) or a mapping that silently produced nothing
   * (not fine), and the two are indistinguishable from the CSV alone.
   */
  if (feed.counts.sent > 0) {
    const emptyEverywhere: string[] = [];
    const emptySometimes: string[] = [];
    for (const c of feed.built.columns) {
      const blanks = feed.built.rows.filter((r) => (r[c] ?? '') === '').length;
      if (blanks === feed.built.rows.length) emptyEverywhere.push(c);
      else if (blanks > 0) emptySometimes.push(`${c} (${blanks})`);
    }
    console.log('');
    console.log(`  blank on every row: ${emptyEverywhere.join(', ') || 'none'}`);
    console.log(`  blank on some rows: ${emptySometimes.join(', ') || 'none'}`);
  }

  console.log('');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
