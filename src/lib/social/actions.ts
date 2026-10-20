'use server';

/**
 * Social, from the dealer's side: compose, post now or later, cancel, retry.
 *
 * Every input from the browser is re-checked here against what the group owns:
 * the lot, the vehicle, the video, and the photo URLs (a vehicle post may only
 * use that vehicle's photos; a custom post only photos uploaded for it).
 */

import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { put } from '@vercel/blob';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { assertVehicleInScope, getRooftops, sessionScope } from '@/lib/queries';
import { CAPTION_MAX } from './caption';
import { runSocial, settlePost } from './publish';
import { postView, type SocialPostView } from './view';

type Kind = (typeof t.socialPostKindEnum.enumValues)[number];

export type ComposeInput = {
  rooftopId: string;
  kind: Kind;
  vehicleId?: string | null;
  videoId?: string | null;
  photoUrls?: string[];
  caption: string;
  facebook: boolean;
  instagram: boolean;
  /** Null posts now. Otherwise an ISO time. */
  scheduledFor: string | null;
};

async function me() {
  const user = await requireSession();
  if (!can(user.role, 'social')) return null;
  return user;
}

/** Where custom-post photos live. Matching this prefix is how a URL proves it was uploaded by this group. */
const customPrefix = (groupId: string) => `social/${groupId}/`;

export async function uploadSocialPhoto(formData: FormData): Promise<{ url: string } | { error: string }> {
  const user = await me();
  if (!user) return { error: 'Your role can’t post to social.' };
  const file = formData.get('file');
  if (!(file instanceof File) || !file.size) return { error: 'No photo.' };
  if (file.type !== 'image/jpeg') return { error: 'Photos go up as JPEG.' };
  if (file.size > 4 * 1024 * 1024) return { error: 'That photo is too large.' };
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  const blob = await put(`${customPrefix(user.groupId)}${sha}.jpg`, bytes, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/jpeg',
  });
  return { url: blob.url };
}

export async function createPost(input: ComposeInput): Promise<{ post: SocialPostView } | { error: string }> {
  const user = await me();
  if (!user) return { error: 'Your role can’t post to social.' };

  const lots = await getRooftops();
  if (!lots.some((r) => r.id === input.rooftopId)) return { error: 'That lot isn’t yours.' };
  if (!input.facebook && !input.instagram) return { error: 'Pick Facebook, Instagram or both.' };

  const caption = input.caption.trim();
  if (caption.length > CAPTION_MAX) return { error: `Captions stop at ${CAPTION_MAX} characters.` };

  let vehicleId: string | null = null;
  let videoId: string | null = null;
  let photoUrls: string[] = [];

  if (input.vehicleId) {
    const v = await assertVehicleInScope(await sessionScope(), input.vehicleId);
    if (!v) return { error: 'That vehicle isn’t on your lots.' };
    vehicleId = v.id;
  }

  if (input.kind === 'WALKAROUND' || input.kind === 'VIDEO') {
    if (!input.videoId) return { error: 'Pick a video.' };
    const rows = await db
      .select()
      .from(t.videos)
      .where(and(eq(t.videos.id, input.videoId), eq(t.videos.groupId, user.groupId)))
      .limit(1);
    const v = rows[0];
    if (!v) return { error: 'That video is gone.' };
    if (!v.mp4Name) return { error: 'That video is still being readied for Facebook. Give it a minute.' };
    videoId = v.id;
  } else {
    const wanted = (input.photoUrls ?? []).slice(0, 10);
    if (input.kind === 'VEHICLE') {
      if (!vehicleId) return { error: 'Pick a vehicle.' };
      const own = await db
        .select({ url: t.vehiclePhotos.url })
        .from(t.vehiclePhotos)
        .where(and(eq(t.vehiclePhotos.vehicleId, vehicleId), inArray(t.vehiclePhotos.url, wanted.length ? wanted : [''])));
      const ok = new Set(own.map((r) => r.url));
      photoUrls = wanted.filter((u) => ok.has(u));
      if (!photoUrls.length) return { error: 'Pick at least one photo.' };
    } else {
      photoUrls = wanted.filter((u) => {
        try {
          return new URL(u).pathname.replace(/^\//, '').startsWith(customPrefix(user.groupId));
        } catch {
          return false;
        }
      });
      if (!photoUrls.length && !caption) return { error: 'Write something or add a photo.' };
    }
  }

  const instagram = input.instagram && (videoId !== null || photoUrls.length > 0);
  if (input.instagram && !instagram && !input.facebook) return { error: 'Instagram needs a photo or a video.' };

  let scheduledFor = new Date();
  if (input.scheduledFor) {
    const d = new Date(input.scheduledFor);
    if (Number.isNaN(d.getTime())) return { error: 'That time doesn’t read as a time.' };
    if (d.getTime() > Date.now() + 75 * 86_400_000) return { error: 'Schedule within the next 75 days.' };
    scheduledFor = d.getTime() < Date.now() ? new Date() : d;
  }

  const [post] = await db
    .insert(t.socialPosts)
    .values({
      groupId: user.groupId,
      rooftopId: input.rooftopId,
      kind: input.kind,
      vehicleId,
      videoId,
      photoUrls,
      caption,
      scheduledFor,
      createdBy: user.id,
    })
    .returning();
  if (!post) return { error: 'Couldn’t save the post. Try again.' };

  const platforms: (typeof t.socialPlatformEnum.enumValues)[number][] = [];
  if (input.facebook) platforms.push('FACEBOOK');
  if (instagram) platforms.push('INSTAGRAM');
  await db.insert(t.socialPostTargets).values(platforms.map((platform) => ({ postId: post.id, platform })));

  if (!input.scheduledFor) await runSocial(post.id);
  revalidatePath('/admin/social');
  const view = await postView(post.id);
  return view ? { post: view } : { error: 'Saved, but couldn’t read it back. Refresh.' };
}

async function ownPost(postId: string) {
  const user = await me();
  if (!user) return null;
  const rows = await db
    .select()
    .from(t.socialPosts)
    .where(and(eq(t.socialPosts.id, postId), eq(t.socialPosts.groupId, user.groupId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Polled while a post is going out (Instagram video takes a few minutes). */
export async function checkPost(postId: string): Promise<SocialPostView | null> {
  const post = await ownPost(postId);
  if (!post) return null;
  if (post.status === 'POSTING' || (post.status === 'SCHEDULED' && post.scheduledFor <= new Date())) {
    await runSocial(post.id);
  }
  return postView(post.id);
}

export async function cancelPost(formData: FormData): Promise<void> {
  const post = await ownPost(String(formData.get('postId') ?? ''));
  if (!post || post.status !== 'SCHEDULED') return;
  await db
    .update(t.socialPosts)
    .set({ status: 'CANCELED', updatedAt: new Date() })
    .where(and(eq(t.socialPosts.id, post.id), eq(t.socialPosts.status, 'SCHEDULED')));
  revalidatePath('/admin/social');
}

/** Failed platforms only. A platform that already posted is never posted twice. */
export async function retryPost(formData: FormData): Promise<void> {
  const post = await ownPost(String(formData.get('postId') ?? ''));
  if (!post || (post.status !== 'FAILED' && post.status !== 'PARTIAL')) return;
  await db
    .update(t.socialPostTargets)
    .set({ status: 'QUEUED', error: null, containerId: null, startedAt: null, updatedAt: new Date() })
    .where(and(eq(t.socialPostTargets.postId, post.id), eq(t.socialPostTargets.status, 'FAILED')));
  await db.update(t.socialPosts).set({ scheduledFor: new Date(), updatedAt: new Date() }).where(eq(t.socialPosts.id, post.id));
  await settlePost(post.id);
  await runSocial(post.id);
  revalidatePath('/admin/social');
}
