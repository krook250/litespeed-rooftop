/**
 * What did the browser actually send us?
 *
 * The filename and the `Content-Type` on a multipart part are both supplied by
 * the client, which means neither is evidence. `lib/storage.ts` already makes
 * this argument for logos; the same rule applies harder here, because these
 * bytes get forwarded to a third-party API and a mislabelled file is a request
 * that fails 20 seconds later with a vendor error instead of failing instantly
 * with something a person can act on.
 *
 * Separate from the logo sniffer on purpose: different size budget (a phone
 * photo is legitimately 3MB), different accepted set (PDF yes, and HEIC needs
 * its own message rather than "not an image").
 */

/** Per page. A phone photo downscaled to 1600px lands around 300–600KB. */
export const MAX_PAGE_BYTES = 8 * 1024 * 1024;
/** Per request. Both sides of a title plus a sticker is a realistic maximum. */
export const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_PAGES = 6;

export type DocSniff =
  | { ok: true; contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'application/pdf' }
  | { ok: false; error: string };

export function sniffDocument(buf: Buffer): DocSniff {
  if (buf.length === 0) return { ok: false, error: 'That file is empty.' };
  if (buf.length > MAX_PAGE_BYTES) {
    return {
      ok: false,
      error: `That page is ${Math.round(buf.length / 1024 / 1024)}MB. Photos are compressed before upload — if this came from a scanner, export it smaller.`,
    };
  }

  const b = buf;

  // PDF: "%PDF-"
  if (b.length > 5 && b.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { ok: true, contentType: 'application/pdf' };
  }

  // JPEG: FF D8 FF
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ok: true, contentType: 'image/jpeg' };
  }

  // PNG
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ok: true, contentType: 'image/png' };
  }

  // WebP: "RIFF"..."WEBP"
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ok: true, contentType: 'image/webp' };
  }

  // GIF
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))) {
    return { ok: true, contentType: 'image/gif' };
  }

  /**
   * HEIC/HEIF — an iPhone's default. The web UI converts to JPEG on the canvas
   * before upload so this should not arrive from the browser, but a native
   * client posting to the same endpoint absolutely will, and "that doesn't look
   * like an image" would be a maddening error to debug from an app.
   */
  if (b.length > 12 && b.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('ascii');
    if (/^(heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1|avif)$/.test(brand)) {
      return {
        ok: false,
        error:
          'That is an iPhone HEIC image, which the reader cannot open. Convert it to JPEG before sending — the web app does this automatically.',
      };
    }
  }

  return { ok: false, error: "That file isn't a JPEG, PNG, WebP or PDF." };
}
