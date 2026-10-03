/**
 * One-time: drop generated placeholder tiles from vehicles that also have real
 * photos, and hand the lead slot to the first real photo.
 *
 * Before 3 Oct 2026 an uploaded photo did not displace the `/api/photo?…` tile
 * already on the vehicle, so the tile stayed `isPrimary` and inventory showed
 * it. `uploadVehiclePhoto` now removes the tiles itself; this fixes the rows
 * written before that.
 *
 * Vehicles with ONLY placeholders are left alone — the tile is all they have.
 *
 * Dry run by default. `--apply` to write. Idempotent.
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from './index';

const apply = process.argv.includes('--apply');

const MIXED = sql`
  select "vehicleId" from vehicle_photos
  group by "vehicleId"
  having bool_or(url like '/api/photo?%') and bool_or(url not like '/api/photo?%')`;

async function main() {
  const found = await db.execute(sql`
    select v."stockNumber" as stock, v.year, v.make, v.model,
           count(*) filter (where p.url like '/api/photo?%')::int as placeholders,
           count(*) filter (where p.url not like '/api/photo?%')::int as real
    from vehicle_photos p join vehicles v on v.id = p."vehicleId"
    where p."vehicleId" in (${MIXED})
    group by v.id order by v."stockNumber"`);
  const rows = Array.from(found);
  console.table(rows);
  console.log(`${rows.length} vehicle(s) have both placeholders and real photos`);

  if (!apply) {
    console.log('dry run — nothing changed. Re-run with --apply to write.');
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      delete from vehicle_photos
      where url like '/api/photo?%' and "vehicleId" in (${MIXED})`);
    // Any vehicle left with photos but no lead gets its first one promoted.
    await tx.execute(sql`
      update vehicle_photos set "isPrimary" = true
      where id in (
        select distinct on ("vehicleId") id from vehicle_photos
        where "vehicleId" not in (select "vehicleId" from vehicle_photos where "isPrimary")
        order by "vehicleId", "sortOrder", "createdAt")`);
  });
  console.log('done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
