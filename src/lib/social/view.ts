/**
 * Posts as the Social screen shows them. Server-only reads; the shape is safe
 * to hand the browser (no tokens, no container ids).
 */

import 'server-only';
import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { vehicleTitle } from '@/lib/domain';
import { posterUrl } from '@/lib/video/urls';

type Post = typeof t.socialPosts.$inferSelect;
type Target = typeof t.socialPostTargets.$inferSelect;

export type SocialPostView = {
  id: string;
  kind: Post['kind'];
  source: Post['source'];
  status: Post['status'];
  caption: string;
  scheduledFor: string;
  thumb: string | null;
  isVideo: boolean;
  vehicle: string | null;
  targets: { platform: Target['platform']; status: Target['status']; permalink: string | null; error: string | null }[];
};

async function hydrate(posts: Post[]): Promise<SocialPostView[]> {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const vehicleIds = posts.map((p) => p.vehicleId).filter((x): x is string => Boolean(x));
  const videoIds = posts.map((p) => p.videoId).filter((x): x is string => Boolean(x));
  const [targets, vehicles, videos] = await Promise.all([
    db.select().from(t.socialPostTargets).where(inArray(t.socialPostTargets.postId, ids)),
    vehicleIds.length
      ? db
          .select({ id: t.vehicles.id, year: t.vehicles.year, make: t.vehicles.make, model: t.vehicles.model, trim: t.vehicles.trim })
          .from(t.vehicles)
          .where(inArray(t.vehicles.id, vehicleIds))
      : Promise.resolve([]),
    videoIds.length
      ? db.select({ id: t.videos.id, playbackId: t.videos.playbackId }).from(t.videos).where(inArray(t.videos.id, videoIds))
      : Promise.resolve([]),
  ]);
  return posts.map((p) => {
    const v = vehicles.find((x) => x.id === p.vehicleId);
    const vid = videos.find((x) => x.id === p.videoId);
    return {
      id: p.id,
      kind: p.kind,
      source: p.source,
      status: p.status,
      caption: p.caption,
      scheduledFor: p.scheduledFor.toISOString(),
      thumb: vid?.playbackId ? posterUrl(vid.playbackId, 240) : (p.photoUrls[0] ?? null),
      isVideo: Boolean(p.videoId),
      vehicle: v ? vehicleTitle(v) : null,
      targets: targets
        .filter((x) => x.postId === p.id)
        .sort((a, b) => a.platform.localeCompare(b.platform))
        .map((x) => ({ platform: x.platform, status: x.status, permalink: x.permalink, error: x.error })),
    };
  });
}

export async function postView(postId: string): Promise<SocialPostView | null> {
  const rows = await db.select().from(t.socialPosts).where(eq(t.socialPosts.id, postId)).limit(1);
  return (await hydrate(rows))[0] ?? null;
}

/** Everything upcoming, plus the last 30 days of what went out or failed. */
export async function postsForLot(groupId: string, rooftopId: string): Promise<SocialPostView[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select()
    .from(t.socialPosts)
    .where(
      and(
        eq(t.socialPosts.groupId, groupId),
        eq(t.socialPosts.rooftopId, rooftopId),
        or(inArray(t.socialPosts.status, ['SCHEDULED', 'POSTING']), gte(t.socialPosts.scheduledFor, since)),
      ),
    )
    .orderBy(desc(t.socialPosts.scheduledFor))
    .limit(150);
  return hydrate(rows);
}
