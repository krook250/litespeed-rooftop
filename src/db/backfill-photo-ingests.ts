/**
 * `npm run db:enqueue-photos` — queue every photo still hosted somewhere else.
 *
 * For lots imported before the ingest queue existed. Additive and idempotent:
 * the unique index on `photoId` means running it twice queues nothing new, and
 * photos already on Blob or rendered as placeholder tiles are filtered out.
 *
 * This script only writes queue rows — it does no fetching and needs no Blob
 * token, so it is safe to run from a laptop against production. The cron in
 * `/api/cron/photo-ingest` does the actual work, on Vercel, where the network
 * and the Blob credentials are.
 */

import 'dotenv/config';
import { db } from './index';
import * as t from './schema';
import { enqueuePhotoIngests } from '@/lib/photos/ingest';

async function main() {
  const photos = await db
    .select({
      id: t.vehiclePhotos.id,
      vehicleId: t.vehiclePhotos.vehicleId,
      url: t.vehiclePhotos.url,
    })
    .from(t.vehiclePhotos);

  const queued = await enqueuePhotoIngests(photos);
  console.log(`scanned ${photos.length} photos — queued ${queued}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
