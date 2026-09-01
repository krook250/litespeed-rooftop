/**
 * Rooftop Auto — taking ownership of imported photos.
 *
 * THE PROBLEM. A lot imported from CarsForSale arrives with its photo URLs
 * pointing at `cdn05.carsforsale.com`. Cancelling that account is the entire
 * reason the dealer moved to us, and the day he does it every one of those URLs
 * returns 404: his storefront goes grey, CarGurus and Meta start rejecting units
 * for broken images, and the listings fall out of both. So the bytes have to
 * become ours before that day.
 *
 * WHY A QUEUE. Twenty-one trucks is roughly two hundred fetches against someone
 * else's CDN. That does not belong inside a request a human is waiting on, and a
 * failure at photo 140 must not cost the other 139 or the import itself.
 *
 * THE SAFETY PROPERTY. `vehicle_photos.url` is swapped only after the bytes are
 * in Blob, and only if it still holds the exact source URL we started from. So
 * there is never a moment where a photo is missing, and a human who replaced the
 * photo while the job was queued keeps their version.
 */

import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import { and, asc, eq, isNotNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { extForContentType, isForeignPhotoUrl } from './url';

/** Five tries then stop. A CDN that has refused us five times is not flaky. */
export const MAX_ATTEMPTS = 5;

/** Vehicle photos off a marketplace run 200KB–3MB. 12MB is a wrong answer. */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 20_000;

/** A year. The Blob key is a content hash, so the bytes behind it cannot change. */
const CACHE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Four at a time. Enough to drain a lot inside one cron window, gentle enough
 * not to look like an attack to the CDN we are politely draining.
 */
const CONCURRENCY = 4;

type QueueItem = {
  id: string;
  photoId: string;
  vehicleId: string;
  sourceUrl: string;
  attempts: number;
};

export type IngestRun = {
  claimed: number;
  ingested: number;
  reused: number;
  failed: number;
  warnings: string[];
};

/* --------------------------------------------------------------- enqueue */

/**
 * Queue every photo that is on loan. Photos already on Blob, and generated
 * placeholder tiles, are filtered out here rather than being discovered as
 * no-ops by the worker.
 *
 * Idempotent: the unique index on `photoId` means importing the same lot twice
 * enqueues each photo once.
 */
export async function enqueuePhotoIngests(
  photos: Array<{ id: string; vehicleId: string; url: string }>,
): Promise<number> {
  const rows = photos
    .filter((p) => isForeignPhotoUrl(p.url))
    .map((p) => ({ photoId: p.id, vehicleId: p.vehicleId, sourceUrl: p.url }));
  if (!rows.length) return 0;

  const inserted = await db
    .insert(t.photoIngests)
    .values(rows)
    .onConflictDoNothing({ target: t.photoIngests.photoId })
    .returning({ id: t.photoIngests.id });

  return inserted.length;
}

/* ----------------------------------------------------------------- worker */

export async function runPhotoIngests(limit = 60): Promise<IngestRun> {
  const queue: QueueItem[] = await db
    .select({
      id: t.photoIngests.id,
      photoId: t.photoIngests.photoId,
      vehicleId: t.photoIngests.vehicleId,
      sourceUrl: t.photoIngests.sourceUrl,
      attempts: t.photoIngests.attempts,
    })
    .from(t.photoIngests)
    .where(and(eq(t.photoIngests.status, 'PENDING'), lt(t.photoIngests.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(t.photoIngests.createdAt))
    .limit(limit);

  const run: IngestRun = {
    claimed: queue.length,
    ingested: 0,
    reused: 0,
    failed: 0,
    warnings: [],
  };
  if (!queue.length) return run;

  let cursor = 0;
  async function worker() {
    for (;;) {
      const item = queue[cursor++];
      if (!item) return;
      try {
        const existing = await alreadyFetched(item.sourceUrl);
        if (existing) {
          await finish(item, existing);
          run.reused++;
          continue;
        }
        await fetchAndStore(item);
        run.ingested++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        run.failed++;
        run.warnings.push(`${item.sourceUrl} — ${message}`);
        await recordFailure(item, message);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()),
  );

  return run;
}

/**
 * The same source URL fetched once is not fetched again. Re-importing a lot, or
 * two units sharing a stock photo, costs one round trip, not two.
 */
async function alreadyFetched(sourceUrl: string): Promise<string | null> {
  const rows = await db
    .select({ blobUrl: t.photoIngests.blobUrl })
    .from(t.photoIngests)
    .where(
      and(
        eq(t.photoIngests.sourceUrl, sourceUrl),
        eq(t.photoIngests.status, 'DONE'),
        isNotNull(t.photoIngests.blobUrl),
      ),
    )
    .limit(1);
  return rows[0]?.blobUrl ?? null;
}

async function fetchAndStore(item: QueueItem): Promise<void> {
  const res = await fetch(item.sourceUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: { accept: 'image/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  const ext = extForContentType(contentType);
  // A CDN that has started serving an HTML error page for a dead photo is the
  // exact failure this whole job exists to get ahead of. Do not store it.
  if (!ext) throw new Error(`not an image we accept (${contentType || 'no content-type'})`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('empty response');
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Error(`${Math.round(bytes.length / 1024)}KB exceeds the photo cap`);
  }

  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const blob = await put(`vehicles/${item.vehicleId}/${sha}.${ext}`, bytes, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
    cacheControlMaxAge: CACHE_SECONDS,
  });

  await finish(item, blob.url);
}

/**
 * Swap the photo over and close the job.
 *
 * The `url` equality check in the WHERE clause is load-bearing: if a human
 * replaced this photo while the job sat in the queue, their upload wins and we
 * quietly leave it alone. The ingest still records DONE — the bytes are stored
 * either way, and re-queueing would only fight the human again.
 */
async function finish(item: QueueItem, blobUrl: string): Promise<void> {
  await db
    .update(t.vehiclePhotos)
    .set({ url: blobUrl })
    .where(and(eq(t.vehiclePhotos.id, item.photoId), eq(t.vehiclePhotos.url, item.sourceUrl)));

  await db
    .update(t.photoIngests)
    .set({
      status: 'DONE',
      blobUrl,
      attempts: item.attempts + 1,
      attemptedAt: new Date(),
      lastError: '',
    })
    .where(eq(t.photoIngests.id, item.id));
}

async function recordFailure(item: QueueItem, message: string): Promise<void> {
  const attempts = item.attempts + 1;
  await db
    .update(t.photoIngests)
    .set({
      attempts,
      attemptedAt: new Date(),
      lastError: message.slice(0, 500),
      status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
    })
    .where(eq(t.photoIngests.id, item.id));
}
