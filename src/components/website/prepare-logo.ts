/**
 * Get a dealer's logo down to something the server will accept — in the
 * browser, before the file is ever sent.
 *
 * WHY THIS EXISTS (1 Sep 2026, found on Malabar's first real edit)
 *
 * `saveStorefrontDesign` caps a logo at `MAX_LOGO_BYTES` and returns a sentence
 * saying so. That sentence was unreachable. A Next server action rejects the
 * whole request body over `serverActions.bodySizeLimit` *before* any of our
 * code runs, and it rejects it by throwing — not by returning — so Next replaced
 * the dealer's admin page with "A server error occurred." A dealer who picked a
 * 2MB logo and changed a color did not learn that the image was too big; their
 * screen went dark and the color change was lost with it.
 *
 * Raising the body limit alone would not have fixed it: it only moves the cliff.
 * The size a logo needs to be is a fact we know in the browser, at the moment
 * the file is picked, where it can be *fixed* instead of reported. So it is
 * fixed here, and the server's 512KB check goes back to being the belt it was
 * always meant to be rather than the only strap.
 *
 * WHY NOT `prepareForUpload` FROM THE INTAKE PATH
 *
 * That helper always re-encodes to JPEG, which is right for a photograph of a
 * car and wrong for a logo: JPEG has no alpha, so a transparent PNG comes back
 * with a white box behind it — visible on every theme except LIGHT, and worst
 * on the dark one a dealer chose precisely because it looks less generic. Here
 * anything that might carry transparency stays PNG and gets *smaller* instead.
 */

/** Must match `MAX_LOGO_BYTES` in `src/lib/storage.ts`. */
const MAX_LOGO_BYTES = 512 * 1024;

/**
 * A logo is drawn at ~40px tall in the storefront header and at most a couple
 * of hundred px anywhere else. 600 on the long edge is already generous; the
 * smaller steps are only reached by artwork that is mostly photograph.
 */
const EDGES = [600, 460, 340, 240, 160];

/** Only used for source formats that cannot carry transparency anyway. */
const JPEG_QUALITIES = [0.92, 0.82, 0.7];

export type PreparedLogo =
  | { ok: true; file: File; resized: boolean }
  | { ok: false; error: string };

/** Formats the server's `sniffImage` will accept back. */
function keepsAlpha(type: string, name: string): boolean {
  if (/^image\/(png|webp)$/i.test(type)) return true;
  if (/^image\/jpeg$/i.test(type)) return false;
  // Unknown or empty type (some Android pickers, HEIC from an iPhone): assume
  // alpha. A PNG of a 600px logo is small; a flattened transparent logo is not
  // recoverable.
  return !/\.jpe?g$/i.test(name);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function renamed(file: File, ext: string): string {
  return file.name.replace(/\.[^.]+$/, '') + ext;
}

/**
 * Returns a file guaranteed to be under `MAX_LOGO_BYTES`, or an error sentence
 * the dealer can act on.
 *
 * A file that is already small enough is handed back untouched — re-encoding a
 * clean 30KB PNG only loses crispness.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (file.size === 0) return { ok: false, error: 'That file is empty.' };

  if (/^image\/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
    return {
      ok: false,
      error:
        "We can't accept SVG logos — an SVG can carry scripts, and it would be running on your own " +
        'website. Export it as a PNG (transparent background works best) and upload that.',
    };
  }

  if (file.size <= MAX_LOGO_BYTES && /^image\/(png|jpeg|webp)$/i.test(file.type)) {
    return { ok: true, file, resized: false };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return {
      ok: false,
      error: `We couldn't read that image, and it's ${Math.round(file.size / 1024)}KB — too big to send as it is. Save it as a PNG or JPEG under ${Math.round(MAX_LOGO_BYTES / 1024)}KB and try again.`,
    };
  }

  const alpha = keepsAlpha(file.type, file.name);

  try {
    for (const edge of EDGES) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(bitmap, 0, 0, w, h);

      const attempts: Array<Promise<Blob | null>> = alpha
        ? [toBlob(canvas, 'image/png')]
        : JPEG_QUALITIES.map((q) => toBlob(canvas, 'image/jpeg', q));

      for (const attempt of attempts) {
        const blob = await attempt;
        if (!blob || blob.size > MAX_LOGO_BYTES) continue;
        // Never trade up: an already-valid file that only got bigger stays.
        if (blob.size >= file.size && file.size <= MAX_LOGO_BYTES) {
          return { ok: true, file, resized: false };
        }
        const ext = alpha ? '.png' : '.jpg';
        const type = alpha ? 'image/png' : 'image/jpeg';
        return {
          ok: true,
          file: new File([blob], renamed(file, ext), { type }),
          resized: true,
        };
      }
    }
  } finally {
    bitmap.close?.();
  }

  return {
    ok: false,
    error: `We couldn't get that image under ${Math.round(MAX_LOGO_BYTES / 1024)}KB — it may be a photograph rather than a logo. Try a smaller version, ideally a PNG on a transparent background.`,
  };
}
