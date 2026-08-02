/**
 * Rooftop Auto — small binary storage, behind a seam.
 *
 * WHY THIS EXISTS RATHER THAN R2
 * Roadmap item 3 is the vehicle photo pipeline: R2, a CDN, variant generation,
 * and a patched `sharp` because that is where untrusted image input starts being
 * processed at volume. A dealer *logo* is one small image, uploaded once and
 * changed almost never — it exercises none of that. Building R2 to hold it would
 * pay item 3's cost without item 3's benefit, and the interface would likely be
 * reshaped anyway once real photo requirements land.
 *
 * So: the seam is the deliverable, not the backend. Everything above this module
 * deals in opaque keys. When item 3 lands, `put`/`get`/`del` grow an R2
 * implementation, keys are migrated, and no caller changes.
 *
 * Sizing sanity check, since "images in Postgres" deserves one: a logo capped at
 * 600px wide is ~40–100KB. Four hundred dealers is under 40MB. That is nothing
 * on Neon — and it is fine *because it is logos only*. The same arithmetic is
 * exactly why vehicle photos must not come here.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';

/** 512KB. A logo bigger than this is a scan of a business card, not a logo. */
export const MAX_LOGO_BYTES = 512 * 1024;

export type SniffResult =
  | { ok: true; contentType: string; width: number | null; height: number | null }
  | { ok: false; error: string };

/**
 * Identify the image from its magic bytes rather than trusting the filename or
 * the browser-supplied MIME type, both of which are attacker-controlled.
 *
 * SVG IS DELIBERATELY REJECTED. An SVG is a document, not a bitmap: served from
 * our own origin with `image/svg+xml` it can carry `<script>`, and a dealer
 * uploading one would be running code on their own storefront's origin. Until
 * there is a sanitiser in the pipeline, PNG/JPEG/WebP only.
 */
export function sniffImage(buf: Buffer): SniffResult {
  if (buf.length === 0) return { ok: false, error: 'That file is empty.' };
  if (buf.length > MAX_LOGO_BYTES) {
    return {
      ok: false,
      error: `That image is ${Math.round(buf.length / 1024)}KB. Please use one under ${Math.round(MAX_LOGO_BYTES / 1024)}KB.`,
    };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A, then IHDR at offset 16.
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      ok: true,
      contentType: 'image/png',
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }

  // JPEG: FF D8 FF. Walk the segment table for a SOF marker to get dimensions.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let off = 2;
    let width: number | null = null;
    let height: number | null = null;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) break;
      const marker = buf[off + 1]!;
      const len = buf.readUInt16BE(off + 2);
      // SOF0–SOF15, excluding the non-frame markers DHT (C4), JPG (C8), DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = buf.readUInt16BE(off + 5);
        width = buf.readUInt16BE(off + 7);
        break;
      }
      off += 2 + len;
    }
    return { ok: true, contentType: 'image/jpeg', width, height };
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length > 16 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ok: true, contentType: 'image/webp', width: null, height: null };
  }

  const head = buf.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) {
    return {
      ok: false,
      error:
        "We can't accept SVG logos — an SVG can carry scripts, and it would be running on your own " +
        'website. Export it as a PNG (transparent background works best) and upload that.',
    };
  }

  return { ok: false, error: "That doesn't look like a PNG, JPEG or WebP image." };
}

/* ------------------------------------------------------------ the seam */

export type StoredBlob = { key: string; contentType: string; bytes: number; data: Buffer };

/**
 * Store bytes and return an opaque key.
 *
 * Content-addressed by sha256, which gets three things for free: uploading the
 * same logo twice is a no-op, the key can be cached `immutable` because the
 * bytes behind it can never change, and a changed logo is a different URL so no
 * cache anywhere needs busting.
 */
export async function put(groupId: string, data: Buffer, contentType: string, dims?: { width: number | null; height: number | null }): Promise<string> {
  const key = createHash('sha256').update(data).digest('hex').slice(0, 32);

  await db
    .insert(t.blobs)
    .values({
      key,
      groupId,
      contentType,
      bytes: data.length,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      data: data.toString('base64'),
    })
    .onConflictDoNothing({ target: t.blobs.key });

  return key;
}

/**
 * Fetch by key. Takes no scope on purpose: the key is a sha256 of the content,
 * so it is unguessable, and a dealer's logo is served on a public storefront to
 * anonymous visitors anyway. There is nothing here to leak across tenants that
 * is not already public — but note `blobs.groupId` still records the owner, so
 * a deletion sweep can be scoped.
 */
export async function get(key: string): Promise<StoredBlob | null> {
  if (!/^[a-f0-9]{32}$/.test(key)) return null;
  const rows = await db.select().from(t.blobs).where(eq(t.blobs.key, key)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    key: row.key,
    contentType: row.contentType,
    bytes: row.bytes,
    data: Buffer.from(row.data, 'base64'),
  };
}

/** Scoped by group, so a stray key from another tenant cannot delete anything. */
export async function del(groupId: string, key: string): Promise<void> {
  await db.delete(t.blobs).where(and(eq(t.blobs.key, key), eq(t.blobs.groupId, groupId)));
}
