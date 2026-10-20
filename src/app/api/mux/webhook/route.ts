/**
 * Mux webhook. Point Mux at `https://app.rooftopauto.com/api/mux/webhook`.
 *
 * Only finds the row and calls `syncVideo`, which asks Mux for the asset
 * itself. So the event's payload is a hint about *which* video changed, never
 * a statement of what it changed to, and an old or replayed event does no harm.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { syncVideo } from '@/lib/video/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Five minutes either way, Mux's own suggestion. */
const TOLERANCE_S = 300;

function verified(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const ts = Number(parts.t);
  if (!parts.t || !parts.v1 || !Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_S) return false;
  const want = createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest('hex');
  const a = Buffer.from(want);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

type MuxEvent = {
  type?: string;
  data?: { id?: string; asset_id?: string; upload_id?: string; passthrough?: string };
};

export async function POST(request: Request) {
  const secret = process.env.MUX_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[mux webhook] MUX_WEBHOOK_SECRET is not set');
    return new Response('not configured', { status: 503 });
  }
  const raw = await request.text();
  if (!verified(raw, request.headers.get('mux-signature'), secret)) {
    return new Response('bad signature', { status: 401 });
  }

  let event: MuxEvent;
  try {
    event = JSON.parse(raw) as MuxEvent;
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const type = event.type ?? '';
  const d = event.data ?? {};
  if (!type.startsWith('video.asset.') && !type.startsWith('video.upload.')) return new Response('ignored');

  const isUpload = type.startsWith('video.upload.');
  const assetId = isUpload ? d.asset_id : type.includes('static_rendition') ? d.asset_id : d.id;
  const uploadId = isUpload ? d.id : d.upload_id;

  const clauses = [
    d.passthrough && !isUpload ? eq(t.videos.id, d.passthrough) : undefined,
    assetId ? eq(t.videos.muxAssetId, assetId) : undefined,
    uploadId ? eq(t.videos.muxUploadId, uploadId) : undefined,
  ].filter((c) => c !== undefined);
  if (!clauses.length) return new Response('nothing to match');

  const rows = await db.select().from(t.videos).where(or(...clauses)).limit(1);
  const row = rows[0];
  // Not ours (deleted already, or another environment sharing the Mux account). 200 so Mux stops retrying.
  if (!row) return new Response('unknown video');

  const withAsset = assetId && !row.muxAssetId ? { ...row, muxAssetId: assetId } : row;
  await syncVideo(withAsset);
  return new Response('ok');
}
