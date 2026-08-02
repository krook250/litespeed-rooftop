/**
 * Serves dealer logos out of the storage seam.
 *
 * Cached `immutable` for a year, which is safe precisely because keys are a hash
 * of the bytes: the content behind a key can never change, and a new logo is a
 * new URL. So this is one origin hit per logo per client, forever — the reason
 * putting logo bytes in Postgres is not a performance problem at this scale.
 */

import { get } from '@/lib/storage';

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const blob = await get(key);
  if (!blob) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(blob.data), {
    headers: {
      'content-type': blob.contentType,
      'content-length': String(blob.bytes),
      'cache-control': 'public, max-age=31536000, immutable',
      // Defence in depth: even though SVG is rejected at upload, never let a
      // stored blob be sniffed into something executable.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
