/**
 * Posting to a lot's Page and its Instagram. Ported from just.diy's
 * `src/lib/posts.ts`, which has been doing this in production; the shape is
 * the same, the media is ours (vehicle photo sets and Mux MP4s).
 *
 *   queued ──(due)──> processing ──> posted
 *                         └──────────> failed
 *
 * Facebook posts in one call — or N+1 for several photos (each uploaded
 * unpublished, then one feed post that attaches them). Instagram is always
 * container → wait until FINISHED → publish, and a Reel or a carousel can take
 * a few minutes, which is why `processing` spans cron ticks.
 *
 * Every step claims its row with a conditional update first, so the cron and a
 * "Post now" click running together can't post the same thing twice.
 */

import 'server-only';
import { and, eq, inArray, lt, lte } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { graph, MetaApiError } from '@/lib/meta/graph';
import { appOrigin } from '@/lib/meta/connect';
import { mp4Url } from '@/lib/video/urls';
import { pageIdentity, type PageIdentity } from './page';

type Target = typeof t.socialPostTargets.$inferSelect;
type Post = typeof t.socialPosts.$inferSelect;

/** Instagram containers get this long to finish before we stop waiting. */
const IG_GIVE_UP_MS = 20 * 60 * 1000;

/* ------------------------------------------------------------------ media */

/** Absolute and fetchable by Meta. Generated placeholder tiles (SVG) are not photos. */
export function postablePhoto(url: string): string | null {
  if (!url || url.includes('/api/photo')) return null;
  const abs = url.startsWith('/') ? `${appOrigin().replace(/\/$/, '')}${url}` : url;
  if (!/^https:\/\//i.test(abs)) return null;
  if (/\.svg(\?|$)/i.test(abs)) return null;
  return abs;
}

/** Instagram takes JPEG and nothing else. */
export const instagramReadyPhoto = (url: string) => /\.jpe?g(\?|$)/i.test(url);

type Media =
  | { kind: 'video'; url: string }
  | { kind: 'photos'; urls: string[] }
  | { kind: 'none' };

async function mediaFor(post: Post): Promise<Media | { error: string }> {
  if (post.videoId) {
    const rows = await db
      .select({ playbackId: t.videos.playbackId, mp4Name: t.videos.mp4Name, status: t.videos.status })
      .from(t.videos)
      .where(eq(t.videos.id, post.videoId))
      .limit(1);
    const v = rows[0];
    if (!v) return { error: 'The video was deleted.' };
    if (!v.playbackId || !v.mp4Name) return { error: 'The video is still processing. Try again in a few minutes.' };
    return { kind: 'video', url: mp4Url(v.playbackId, v.mp4Name) };
  }
  const urls = post.photoUrls.map(postablePhoto).filter((u): u is string => Boolean(u)).slice(0, 10);
  return urls.length ? { kind: 'photos', urls } : { kind: 'none' };
}

/* ------------------------------------------------------------------ words */

/** Meta's error, said so a dealer knows what to do. */
function plain(err: unknown): string {
  if (!(err instanceof MetaApiError)) return 'Facebook didn’t answer. Try again.';
  const m = err.message ?? '';
  if (/publishing authorization|page publishing/i.test(m)) {
    return 'Facebook wants this Page’s publishing authorization finished first. Do it in Meta Business Suite, then try again.';
  }
  if (err.kind === 'reauth') return 'The Facebook connection was lost. Click Connect again on the Ad Desk.';
  if (err.kind === 'permission' || err.code === 10 || err.code === 200) {
    return 'Facebook hasn’t given Rooftop permission to post here. Click Connect again on the Ad Desk and allow posting.';
  }
  if (err.code === 9 || (/limit/i.test(m) && /instagram/i.test(m))) return 'Instagram’s daily posting limit is reached. Try again tomorrow.';
  if (/aspect ratio/i.test(m)) return 'Instagram won’t take this photo’s shape. Feed photos must be between tall 4:5 and wide 1.91:1.';
  return m ? `Facebook said: ${m}` : 'Facebook didn’t answer. Try again.';
}

async function setTarget(id: string, patch: Partial<Target>) {
  await db
    .update(t.socialPostTargets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(t.socialPostTargets.id, id));
}

/* --------------------------------------------------------------- facebook */

async function postFacebook(page: PageIdentity, post: Post, media: Media) {
  const token = page.pageToken;
  const message = post.caption;

  if (media.kind === 'video') {
    const r = await graph<{ id: string }>(`/${page.pageId}/videos`, {
      method: 'POST',
      token,
      params: { file_url: media.url, description: message },
      timeoutMs: 60_000,
    });
    return { externalId: r.id, permalink: `https://www.facebook.com/${page.pageId}/videos/${r.id}` };
  }

  if (media.kind === 'photos' && media.urls.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`/${page.pageId}/photos`, {
      method: 'POST',
      token,
      params: { url: media.urls[0], message },
      timeoutMs: 40_000,
    });
    const id = r.post_id ?? r.id;
    return { externalId: id, permalink: `https://www.facebook.com/${id}` };
  }

  const attached: Record<string, string> = {};
  if (media.kind === 'photos') {
    for (const [i, url] of media.urls.entries()) {
      const p = await graph<{ id: string }>(`/${page.pageId}/photos`, {
        method: 'POST',
        token,
        params: { url, published: false },
        timeoutMs: 40_000,
      });
      attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: p.id });
    }
  }
  const r = await graph<{ id: string }>(`/${page.pageId}/feed`, {
    method: 'POST',
    token,
    params: { message, ...(post.link && media.kind === 'none' ? { link: post.link } : {}), ...attached },
  });
  return { externalId: r.id, permalink: `https://www.facebook.com/${r.id}` };
}

/* -------------------------------------------------------------- instagram */

async function startInstagram(page: PageIdentity, post: Post, media: Media): Promise<string> {
  const token = page.pageToken;
  const ig = page.igId!;
  if (media.kind === 'video') {
    const r = await graph<{ id: string }>(`/${ig}/media`, {
      method: 'POST',
      token,
      params: { media_type: 'REELS', video_url: media.url, caption: post.caption, share_to_feed: true },
    });
    return r.id;
  }
  if (media.kind !== 'photos') throw new Error('instagram needs media');
  const jpegs = media.urls.filter(instagramReadyPhoto);
  if (jpegs.length === 1) {
    const r = await graph<{ id: string }>(`/${ig}/media`, {
      method: 'POST',
      token,
      params: { image_url: jpegs[0], caption: post.caption },
    });
    return r.id;
  }
  const children: string[] = [];
  for (const url of jpegs) {
    const c = await graph<{ id: string }>(`/${ig}/media`, {
      method: 'POST',
      token,
      params: { image_url: url, is_carousel_item: true },
    });
    children.push(c.id);
  }
  const r = await graph<{ id: string }>(`/${ig}/media`, {
    method: 'POST',
    token,
    params: { media_type: 'CAROUSEL', children: children.join(','), caption: post.caption },
  });
  return r.id;
}

/** Instagram, step two: publish once Meta says the container is ready. */
async function finishInstagram(target: Target, page: PageIdentity) {
  if (!target.containerId || !page.igId) return;
  const s = await graph<{ status_code?: string; status?: string }>(`/${target.containerId}`, {
    token: page.pageToken,
    params: { fields: 'status_code,status' },
  });
  if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
    return setTarget(target.id, { status: 'FAILED', error: `Instagram couldn’t use this file (${s.status ?? s.status_code}).` });
  }
  if (s.status_code !== 'FINISHED') {
    const since = target.startedAt ? Date.now() - target.startedAt.getTime() : 0;
    if (since > IG_GIVE_UP_MS) {
      return setTarget(target.id, { status: 'FAILED', error: 'Instagram took too long to process this. Try again.' });
    }
    return; // still cooking; the next pass looks again
  }
  const p = await graph<{ id: string }>(`/${page.igId}/media_publish`, {
    method: 'POST',
    token: page.pageToken,
    params: { creation_id: target.containerId },
  });
  const link = await graph<{ permalink?: string }>(`/${p.id}`, {
    token: page.pageToken,
    params: { fields: 'permalink' },
  }).catch(() => ({ permalink: undefined }));
  return setTarget(target.id, { status: 'POSTED', externalId: p.id, permalink: link.permalink ?? null, error: null });
}

/* ------------------------------------------------------------------ steps */

async function loadPost(postId: string): Promise<Post | null> {
  const rows = await db.select().from(t.socialPosts).where(eq(t.socialPosts.id, postId)).limit(1);
  return rows[0] ?? null;
}

async function start(target: Target) {
  const post = await loadPost(target.postId);
  if (!post) return;
  const page = await pageIdentity(post.groupId, post.rooftopId);
  if ('error' in page) return setTarget(target.id, { status: 'FAILED', error: page.error });
  const media = await mediaFor(post);
  if ('error' in media) return setTarget(target.id, { status: 'FAILED', error: media.error });

  try {
    if (target.platform === 'FACEBOOK') {
      const r = await postFacebook(page, post, media);
      return setTarget(target.id, { status: 'POSTED', externalId: r.externalId, permalink: r.permalink, error: null });
    }

    if (!page.igId) return setTarget(target.id, { status: 'FAILED', error: 'No Instagram account is linked to this Facebook Page.' });
    if (media.kind === 'none') return setTarget(target.id, { status: 'FAILED', error: 'Instagram needs a photo or a video.' });
    if (media.kind === 'photos' && !media.urls.some(instagramReadyPhoto)) {
      return setTarget(target.id, { status: 'FAILED', error: 'Instagram only takes JPEG photos, and none of these are.' });
    }
    const containerId = await startInstagram(page, post, media);
    const now = new Date();
    await setTarget(target.id, { containerId });
    // Photos are usually ready at once; try publishing now rather than on the next pass.
    return finishInstagram({ ...target, containerId, startedAt: target.startedAt ?? now }, page);
  } catch (err) {
    console.error('[social]', target.platform, err instanceof Error ? err.message : err);
    return setTarget(target.id, { status: 'FAILED', error: plain(err) });
  }
}

async function finish(target: Target) {
  const post = await loadPost(target.postId);
  if (!post) return;
  const page = await pageIdentity(post.groupId, post.rooftopId);
  if ('error' in page) return setTarget(target.id, { status: 'FAILED', error: page.error });
  try {
    await finishInstagram(target, page);
  } catch (err) {
    console.error('[social] instagram finish', err instanceof Error ? err.message : err);
    await setTarget(target.id, { status: 'FAILED', error: plain(err) });
  }
}

/** The post's status, read off its targets. */
export async function settlePost(postId: string) {
  const rows = await db
    .select({ status: t.socialPostTargets.status })
    .from(t.socialPostTargets)
    .where(eq(t.socialPostTargets.postId, postId));
  const s = rows.map((r) => r.status);
  if (!s.length) return;
  const status: Post['status'] = s.every((x) => x === 'POSTED')
    ? 'POSTED'
    : s.every((x) => x === 'QUEUED')
      ? 'SCHEDULED'
      : s.some((x) => x === 'QUEUED' || x === 'PROCESSING')
        ? 'POSTING'
        : s.every((x) => x === 'FAILED')
          ? 'FAILED'
          : 'PARTIAL';
  await db
    .update(t.socialPosts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(t.socialPosts.id, postId), inArray(t.socialPosts.status, ['SCHEDULED', 'POSTING', 'POSTED', 'PARTIAL', 'FAILED'])));
}

/**
 * One pass: start whatever is due, finish whatever Instagram has ready.
 * `postId` narrows it to one post (Post now, and the screen's poll).
 */
export async function runSocial(postId?: string): Promise<number> {
  const now = new Date();
  const touched = new Set<string>();

  // 1. Due and waiting.
  const due = await db
    .select({ target: t.socialPostTargets })
    .from(t.socialPostTargets)
    .innerJoin(t.socialPosts, eq(t.socialPostTargets.postId, t.socialPosts.id))
    .where(
      and(
        eq(t.socialPostTargets.status, 'QUEUED'),
        lte(t.socialPosts.scheduledFor, now),
        inArray(t.socialPosts.status, ['SCHEDULED', 'POSTING', 'PARTIAL', 'FAILED']),
        postId ? eq(t.socialPosts.id, postId) : undefined,
      ),
    )
    .limit(25);

  for (const { target } of due) {
    const [claimed] = await db
      .update(t.socialPostTargets)
      .set({ status: 'PROCESSING', startedAt: now, updatedAt: now })
      .where(and(eq(t.socialPostTargets.id, target.id), eq(t.socialPostTargets.status, 'QUEUED')))
      .returning();
    if (!claimed) continue;
    touched.add(claimed.postId);
    await start(claimed);
  }

  // 2. Instagram containers still cooking. Claimed by bumping updatedAt, so a
  //    parallel pass skips anything touched in the last 20 seconds.
  const cooking = await db
    .select()
    .from(t.socialPostTargets)
    .where(
      and(
        eq(t.socialPostTargets.status, 'PROCESSING'),
        lt(t.socialPostTargets.updatedAt, new Date(now.getTime() - 20_000)),
        postId ? eq(t.socialPostTargets.postId, postId) : undefined,
      ),
    )
    .limit(25);

  for (const row of cooking) {
    const [claimed] = await db
      .update(t.socialPostTargets)
      .set({ updatedAt: now })
      .where(
        and(
          eq(t.socialPostTargets.id, row.id),
          eq(t.socialPostTargets.status, 'PROCESSING'),
          eq(t.socialPostTargets.updatedAt, row.updatedAt),
        ),
      )
      .returning();
    if (!claimed) continue;
    touched.add(claimed.postId);
    if (claimed.containerId) {
      await finish(claimed);
    } else if (claimed.startedAt && now.getTime() - claimed.startedAt.getTime() > 10 * 60 * 1000) {
      // Started and never heard back. Don't guess whether it went out.
      await setTarget(claimed.id, {
        status: 'FAILED',
        error: 'We lost track of this one. Check the Page before trying again — it may have posted.',
      });
    }
  }

  for (const id of touched) await settlePost(id);
  return touched.size;
}
