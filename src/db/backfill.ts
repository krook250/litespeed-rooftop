/**
 * `npm run db:backfill` — replay existing history into the Lot Walk feed.
 *
 * Additive and idempotent (every emitted event carries a dedupeKey), so unlike
 * `db:seed` this one is safe against a real database and carries no guard.
 */

import 'dotenv/config';
import { allRooftopIds, backfillFeed } from './backfill-feed';

async function main() {
  const rooftopIds = await allRooftopIds();
  if (!rooftopIds.length) {
    console.log('no rooftops — nothing to backfill');
    process.exit(0);
  }
  const { created } = await backfillFeed({ rooftopIds });
  console.log(`backfilled ${created} feed events across ${rooftopIds.length} rooftops`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
