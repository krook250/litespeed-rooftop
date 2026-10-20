/**
 * Mux, the small part of it we use. Plain fetch, no SDK: four endpoints.
 *
 *   createUpload  — a one-time URL the browser PUTs the file to
 *   getUpload     — which asset an upload became
 *   getAsset      — playback id, duration, and whether the MP4 is written yet
 *   deleteAsset   — when the dealer deletes the video
 *
 * Every asset is created with the video row's id as `passthrough`, so the
 * webhook and the poller can both find the row from the asset alone.
 *
 * Settings, and why:
 *  - `video_quality: basic` — free encoding. These are phone walkarounds on a
 *    used car lot, not a film.
 *  - `max_resolution_tier: 1080p` — a 4K original is stored and streamed as
 *    1080p. Instagram refuses anything wider than 1920px.
 *  - `static_renditions` 1080p and highest — the MP4 Meta fetches. 1080p is
 *    skipped when the original is smaller, and then `highest` is the original's
 *    own size, which is smaller still.
 */

import 'server-only';

const API = 'https://api.mux.com/video/v1';

export function muxConfigured(): boolean {
  return Boolean(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET);
}

function auth(): string {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET are not set.');
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

async function mux<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  }).catch((e: unknown) => {
    console.error('[mux] fetch:', method, path, e instanceof Error ? e.message : e);
    return null;
  });
  if (!res) return null;
  if (method === 'DELETE') return (res.ok || res.status === 404 ? ({} as T) : null);
  const json = (await res.json().catch(() => null)) as { data?: T; error?: unknown } | null;
  if (!res.ok || !json?.data) {
    console.error('[mux]', method, path, res.status, JSON.stringify(json).slice(0, 400));
    return null;
  }
  return json.data;
}

export type MuxUpload = {
  id: string;
  url: string;
  status: 'waiting' | 'asset_created' | 'errored' | 'cancelled' | 'timed_out';
  asset_id?: string;
  error?: { type?: string; message?: string };
};

export type MuxAsset = {
  id: string;
  status: 'preparing' | 'ready' | 'errored';
  passthrough?: string;
  duration?: number;
  aspect_ratio?: string;
  playback_ids?: { id: string; policy: string }[];
  errors?: { type?: string; messages?: string[] };
  static_renditions?: {
    files?: { name: string; status: 'preparing' | 'ready' | 'skipped' | 'errored' }[];
  };
};

/** A one-time upload URL. `origin` is the page the browser uploads from. */
export function createUpload(videoId: string, origin: string) {
  return mux<MuxUpload>('POST', '/uploads', {
    cors_origin: origin,
    timeout: 3600 * 6,
    new_asset_settings: {
      playback_policies: ['public'],
      video_quality: 'basic',
      max_resolution_tier: '1080p',
      static_renditions: [{ resolution: '1080p' }, { resolution: 'highest' }],
      passthrough: videoId,
    },
  });
}

export const getUpload = (id: string) => mux<MuxUpload>('GET', `/uploads/${encodeURIComponent(id)}`);
export const getAsset = (id: string) => mux<MuxAsset>('GET', `/assets/${encodeURIComponent(id)}`);
export const deleteAsset = (id: string) => mux<object>('DELETE', `/assets/${encodeURIComponent(id)}`);
export const cancelUpload = (id: string) => mux<object>('POST', `/uploads/${encodeURIComponent(id)}/cancel`);

/** The MP4 to hand Meta, once one is written. 1080p first, the original's size if 1080p was skipped. */
export function readyMp4(asset: MuxAsset): string | null {
  const files = asset.static_renditions?.files ?? [];
  for (const name of ['1080p.mp4', 'highest.mp4']) {
    if (files.some((f) => f.name === name && f.status === 'ready')) return name;
  }
  return null;
}
