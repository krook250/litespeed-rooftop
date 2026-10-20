/**
 * Bringing a `videos` row up to date with Mux.
 *
 * Two callers, on purpose: the Mux webhook, and the page the dealer is looking
 * at while it processes. Either alone would do; both means a video still turns
 * READY if the webhook is misconfigured, and still turns READY if the dealer
 * closed the tab. Asking Mux for the asset each time, rather than trusting the
 * event payload, keeps it to one code path that cannot read a stale event.
 */

import 'server-only';
import { and, eq, lt, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { cancelUpload, deleteAsset, getAsset, getUpload, readyMp4 } from './mux';

export type VideoRow = typeof t.videos.$inferSelect;

/** Mux's error, or a fallback, said once. */
function failWords(raw: string | undefined): string {
  if (!raw) return "Couldn't process this video. Try uploading it again.";
  if (/duration|too (long|short)/i.test(raw)) return `This video's length won't work: ${raw}`;
  return `Couldn't process this video: ${raw}`;
}

export async function syncVideo(v: VideoRow): Promise<VideoRow> {
  if (v.status === 'FAILED') return v;
  if (v.status === 'READY' && v.mp4Name) return v;

  let assetId = v.muxAssetId;
  if (!assetId && v.muxUploadId) {
    const up = await getUpload(v.muxUploadId);
    if (!up) return v;
    if (up.status === 'errored' || up.status === 'cancelled' || up.status === 'timed_out') {
      return save(v, { status: 'FAILED', error: up.status === 'timed_out' ? 'The upload never finished. Try again.' : failWords(up.error?.message) });
    }
    assetId = up.asset_id ?? null;
  }
  if (!assetId) return v;

  const asset = await getAsset(assetId);
  if (!asset) return v;

  if (asset.status === 'errored') {
    return save(v, { muxAssetId: assetId, status: 'FAILED', error: failWords(asset.errors?.messages?.join(' ')) });
  }

  const ready = asset.status === 'ready';
  const next = await save(v, {
    muxAssetId: assetId,
    status: ready ? 'READY' : 'PROCESSING',
    playbackId: asset.playback_ids?.find((p) => p.policy === 'public')?.id ?? v.playbackId,
    durationSec: asset.duration ?? v.durationSec,
    aspectRatio: asset.aspect_ratio ?? v.aspectRatio,
    mp4Name: readyMp4(asset),
    error: null,
  });

  if (ready && v.status !== 'READY') await retireOlderWalkarounds(next);
  return next;
}

async function save(v: VideoRow, patch: Partial<VideoRow>): Promise<VideoRow> {
  const [row] = await db
    .update(t.videos)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(t.videos.id, v.id))
    .returning();
  return row ?? { ...v, ...patch };
}

/**
 * A vehicle has one walkaround. A new one replaces the old only once it plays,
 * so the listing is never left without one while the replacement encodes.
 */
async function retireOlderWalkarounds(v: VideoRow) {
  if (v.kind !== 'WALKAROUND' || !v.vehicleId) return;
  const old = await db
    .select()
    .from(t.videos)
    .where(
      and(
        eq(t.videos.vehicleId, v.vehicleId),
        eq(t.videos.kind, 'WALKAROUND'),
        ne(t.videos.id, v.id),
        lt(t.videos.createdAt, v.createdAt),
      ),
    );
  for (const o of old) await removeVideo(o);
}

/** Gone from Mux and from us. The row goes even if Mux doesn't answer; an orphan asset costs pennies. */
export async function removeVideo(v: VideoRow) {
  if (v.muxAssetId) await deleteAsset(v.muxAssetId);
  else if (v.muxUploadId && v.status === 'UPLOADING') await cancelUpload(v.muxUploadId);
  await db.delete(t.videos).where(eq(t.videos.id, v.id));
}
