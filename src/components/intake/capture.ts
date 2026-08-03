/**
 * Browser-side capture helpers.
 *
 * Two jobs, both of which exist to avoid work rather than to do it:
 *
 *   1. Read a VIN barcode locally, so the common case never uploads anything.
 *   2. Shrink what does get uploaded, so a lot with two bars of signal is not
 *      pushing 4MB per page over LTE.
 *
 * Both are progressive enhancement. Every path here degrades to "upload the
 * original file and let the server deal with it", which is what an older phone
 * or a locked-down browser will do.
 */

import { isValidVin } from '@/lib/vin';

/** Longest edge after downscaling. Enough for small print on a title. */
const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.85;
/** Below this, resizing costs more than it saves. */
const SKIP_RESIZE_UNDER = 400 * 1024;

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format: string }>>;
};
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

function detectorCtor(): BarcodeDetectorCtor | null {
  const w = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === 'function' ? w.BarcodeDetector : null;
}

export function barcodeSupported(): boolean {
  return detectorCtor() !== null;
}

/**
 * Look for a VIN in any machine-readable code on the image.
 *
 * Format notes, because the wrong list finds nothing:
 *   - `code_39` is the strip on a doorjamb certification label. This is the one
 *     that matters and the one nearly every dealer sticker uses too.
 *   - `data_matrix` turns up on newer OEM labels and on auction tags.
 *   - `pdf417` is a driver's licence, not a car — but it is worth detecting so a
 *     mis-aimed shot fails as "that's a licence" rather than as silence. It also
 *     lands us most of the way to trade-in capture later.
 *
 * A VIN barcode sometimes encodes a prefix ("I" for ISO, or a leading "*" from
 * Code 39's start character), so the payload is scanned for a valid 17-character
 * run rather than compared whole. Validity here means the check digit, not the
 * length — a barcode read can drop a character and still be seventeen long.
 */
export async function readVinBarcode(file: File): Promise<string | null> {
  const Ctor = detectorCtor();
  if (!Ctor) return null;
  if (!file.type.startsWith('image/')) return null;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const detector = new Ctor({ formats: ['code_39', 'data_matrix', 'qr_code', 'code_128', 'pdf417'] });
    const codes = await detector.detect(bitmap);
    for (const code of codes) {
      const vin = vinIn(code.rawValue);
      if (vin) return vin;
    }
    return null;
  } catch {
    // Unsupported format list, a decode failure, an image the browser cannot
    // bitmap — all of them just mean "no barcode", and the upload path runs.
    return null;
  } finally {
    bitmap?.close?.();
  }
}

function vinIn(payload: string): string | null {
  const s = payload.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let i = 0; i + 17 <= s.length; i++) {
    const slice = s.slice(i, i + 17);
    if (isValidVin(slice)) return slice;
  }
  return null;
}

/**
 * Downscale and re-encode to JPEG.
 *
 * Also, incidentally, the HEIC fix: an iPhone photo drawn onto a canvas comes
 * back out as whatever `toBlob` is asked for, so the server never sees a format
 * the reader cannot open. That conversion is the reason this runs even on files
 * small enough not to need resizing, when they are not already a JPEG or PNG.
 *
 * EXIF is dropped as a side effect of the canvas round trip, which is the right
 * outcome — a photo taken on a lot carries GPS, and there is no reason for a
 * dealer's coordinates to travel to a third-party reader.
 */
export async function prepareForUpload(file: File): Promise<File> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) return file;

  const alreadyFine =
    file.size < SKIP_RESIZE_UNDER && /^image\/(jpeg|png|webp)$/.test(file.type);
  if (alreadyFine) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return file;

    // Never trade up. A tiny screenshot re-encoded can come out larger.
    if (blob.size >= file.size && /^image\/(jpeg|png)$/.test(file.type)) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Object URLs for the on-screen thumbnails. Caller revokes. */
export function previewUrl(file: File): string | null {
  return file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
}
