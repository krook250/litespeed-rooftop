/**
 * Set every lot's timezone from its address.
 *
 * `rooftops.timezone` defaulted to America/Los_Angeles and nothing set it, so
 * lots outside the Pacific showed open/closed against the wrong clock. New
 * saves derive it (`saveRooftopDetails`); this fixes the rows already there.
 *
 * Idempotent — a second run changes nothing. Rows with no recognizable state
 * are left alone. Prints every change so the run is its own check.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './index';
import * as t from './schema';
import { timezoneFor } from '../lib/store/timezone';

async function main() {
  const rows = await db
    .select({
      id: t.rooftops.id,
      name: t.rooftops.name,
      state: t.rooftops.state,
      postalCode: t.rooftops.postalCode,
      timezone: t.rooftops.timezone,
    })
    .from(t.rooftops);

  let changed = 0;
  for (const r of rows) {
    const tz = timezoneFor(r.state, r.postalCode);
    if (!tz || tz === r.timezone) continue;
    await db.update(t.rooftops).set({ timezone: tz }).where(eq(t.rooftops.id, r.id));
    console.log(`${r.name} (${r.state} ${r.postalCode}): ${r.timezone} -> ${tz}`);
    changed++;
  }
  console.log(`updated ${changed} of ${rows.length} lot(s)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
