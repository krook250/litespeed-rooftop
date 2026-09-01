/**
 * Which photo URLs are ours, and which are on loan.
 *
 * Four kinds of URL end up in `vehicle_photos.url`:
 *
 *   1. A Vercel Blob URL — bytes we hold. Nothing to do.
 *   2. `/api/photo?...` — a generated placeholder tile, rendered on demand from
 *      query parameters. Not a photograph and not fetchable as one.
 *   3. An absolute URL on one of our own domains — the demo lot's photos are
 *      served as static assets from `app.rooftopauto.com`. Also already ours.
 *      This one cost us: the first backfill queued 165 of them for copying into
 *      Blob because the check below only recognised Blob itself.
 *   4. Anything else on http(s) — someone else's CDN, almost always the site the
 *      dealer is in the middle of leaving. These are the ones with a fuse on them.
 *
 * Note that a dealer's *own* old website is category 4, not 3. That site dies
 * when he stops paying for it, which is the whole problem.
 *
 * Kept pure and free of `server-only` so it can be unit tested and reused by the
 * backfill script, which runs outside Next.
 */

/** Blob's public host. Anything under it is already ours. */
const BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';

/** Our own domain and every subdomain of it. */
const OWN_DOMAIN = 'rooftopauto.com';

function isOwnHost(host: string): boolean {
  if (host.endsWith(BLOB_HOST_SUFFIX)) return true;
  return host === OWN_DOMAIN || host.endsWith(`.${OWN_DOMAIN}`);
}

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
  return !isOwnHost(host);
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
