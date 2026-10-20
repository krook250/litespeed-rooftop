'use server';

/**
 * Video uploads, from the dealer's side.
 *
 * The file never comes through here. `startVideoUpload` makes a row and asks
 * Mux for a one-time upload URL; the browser sends the file straight to Mux in
 * chunks (`VideoUpload`); `checkVideo` is polled while it encodes. A Vercel
 * function would refuse the file at 4.5MB, and a walkaround is a hundred times
 * that.
 *
 * Scoping: a walkaround is checked against the vehicle (`assertVehicleInScope`),
 * anything else against the signed-in group plus the Website section, which is
 * where the library lives. Every read and delete matches `groupId` too.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { assertVehicleInScope, sessionScope } from '@/lib/queries';
import { createUpload, muxConfigured } from './mux';
import { removeVideo, syncVideo, type VideoRow } from './sync';
import { toView, type VideoKind, type VideoView } from './view';

async function ownVideo(videoId: string): Promise<VideoRow | null> {
  const me = await requireSession();
  const rows = await db
    .select()
    .from(t.videos)
    .where(and(eq(t.videos.id, videoId), eq(t.videos.groupId, me.groupId)))
    .limit(1);
  return rows[0] ?? null;
}

async function uploadOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.rooftopauto.com';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const KINDS: readonly VideoKind[] = t.videoKindEnum.enumValues;

export async function startVideoUpload(input: {
  vehicleId?: string;
  kind: VideoKind;
  title?: string;
}): Promise<{ videoId: string; url: string } | { error: string }> {
  const me = await requireSession();
  if (!muxConfigured()) return { error: "Video uploads aren't switched on yet. MUX_TOKEN_ID and MUX_TOKEN_SECRET need setting." };
  if (!KINDS.includes(input.kind)) return { error: 'Unknown kind of video.' };

  let rooftopId: string | null = null;
  let vehicleId: string | null = null;
  if (input.kind === 'WALKAROUND') {
    if (!input.vehicleId) return { error: 'A walkaround needs a vehicle.' };
    const v = await assertVehicleInScope(await sessionScope(), input.vehicleId);
    if (!v) return { error: "That vehicle isn't on your lots." };
    rooftopId = v.rooftopId;
    vehicleId = v.id;
  } else if (!can(me.role, 'website')) {
    return { error: "Your role can't add videos to the website." };
  }

  const [row] = await db
    .insert(t.videos)
    .values({
      groupId: me.groupId,
      rooftopId,
      vehicleId,
      kind: input.kind,
      title: (input.title ?? '').trim().slice(0, 120),
      createdBy: me.id,
    })
    .returning();
  if (!row) return { error: "Couldn't start the upload. Try again." };

  const up = await createUpload(row.id, await uploadOrigin());
  if (!up) {
    await db.delete(t.videos).where(eq(t.videos.id, row.id));
    return { error: "Mux didn't answer. Try again in a minute." };
  }
  await db.update(t.videos).set({ muxUploadId: up.id }).where(eq(t.videos.id, row.id));
  return { videoId: row.id, url: up.url };
}

/** The browser finished sending. Mux takes it from here. */
export async function markUploaded(videoId: string): Promise<VideoView | null> {
  const v = await ownVideo(videoId);
  if (!v) return null;
  const moved =
    v.status === 'UPLOADING'
      ? ((
          await db
            .update(t.videos)
            .set({ status: 'PROCESSING', updatedAt: new Date() })
            .where(and(eq(t.videos.id, v.id), eq(t.videos.status, 'UPLOADING')))
            .returning()
        )[0] ?? v)
      : v;
  return toView(await syncVideo(moved));
}

/** The browser gave up. The row goes; there is nothing at Mux to keep. */
export async function abandonUpload(videoId: string): Promise<void> {
  const v = await ownVideo(videoId);
  if (v && v.status === 'UPLOADING') await removeVideo(v);
}

/** Polled while a video encodes. */
export async function checkVideo(videoId: string): Promise<VideoView | null> {
  const v = await ownVideo(videoId);
  if (!v) return null;
  const synced = await syncVideo(v);
  if (synced.status !== v.status) {
    if (synced.vehicleId) revalidatePath(`/admin/inventory/${synced.vehicleId}`);
    revalidatePath('/admin/website/videos');
  }
  return toView(synced);
}

export async function deleteVideo(formData: FormData): Promise<void> {
  const v = await ownVideo(String(formData.get('videoId') ?? ''));
  if (!v) return;
  if (v.kind !== 'WALKAROUND') {
    const me = await requireSession();
    if (!can(me.role, 'website')) return;
  }
  await removeVideo(v);
  if (v.vehicleId) revalidatePath(`/admin/inventory/${v.vehicleId}`);
  revalidatePath('/admin/website/videos');
}

export async function renameVideo(formData: FormData): Promise<void> {
  const me = await requireSession();
  if (!can(me.role, 'website')) return;
  const v = await ownVideo(String(formData.get('videoId') ?? ''));
  if (!v) return;
  await db
    .update(t.videos)
    .set({ title: String(formData.get('title') ?? '').trim().slice(0, 120), updatedAt: new Date() })
    .where(eq(t.videos.id, v.id));
  revalidatePath('/admin/website/videos');
}

/** The video at the top of the home page. An empty `videoId` takes it down. */
export async function setIntroVideo(formData: FormData): Promise<void> {
  const me = await requireSession();
  if (!can(me.role, 'website')) return;
  const raw = String(formData.get('videoId') ?? '');
  let videoId: string | null = null;
  if (raw) {
    const v = await ownVideo(raw);
    if (!v || v.status !== 'READY') return;
    videoId = v.id;
  }
  await db.update(t.storefronts).set({ introVideoId: videoId }).where(eq(t.storefronts.groupId, me.groupId));
  revalidatePath('/admin/website/videos');
}
