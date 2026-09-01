/**
 * Which photo URLs are ours, and which are on loan.
 *
 * Three kinds of URL end up in `vehicle_photos.url`:
 *
 *   1. A Vercel Blob URL — bytes we hold. Nothing to do.
 *   2. `/api/photo?...` — a generated placeholder tile, rendered on demand from
 *      query parameters. Not a photograph and not fetchable as one.
 *   3. Anything else on http(s) — someone else's CDN, almost always the site the
 *      dealer is in the middle of leaving. These are the ones with a fuse on them.
 *
 * Kept pure and free of `server-only` so it can be unit tested and reused by the
 * backfill script, which runs outside Next.
 */

/** Blob's public host. Anything under it is already ours. */
const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';

export function isForeignPhotoUrl(url: string): boolean {
  // Relative URLs are ours by construction — /api/photo tiles, mostly.
  if (!/^https?:\/\//i.test(url)) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    // An unparseable URL is not something we can fetch, so it is not a job.
    return false;
  }
  return !host.endsWith(BLOB_HOST_SUFFIX);
}

/**
 * File extension for the Blob key. Deliberately narrow: we store what we can
 * prove is an image, and the three formats every channel accepts. A content type
 * we do not recognise is a reason to refuse the photo, not to guess an extension.
 */
export function extForContentType(contentType: string): 'jpg' | 'png' | 'webp' | null {
  const ct = contentType.split(';')[0]!.trim().toLowerCase();
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  if (ct === 'image/png') return 'png';
  if (ct === 'image/webp') return 'webp';
  return null;
}
