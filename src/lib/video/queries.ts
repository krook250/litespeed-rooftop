/**
 * Reading videos. Callers have already scoped the vehicle or the group; these
 * take the id they were handed and filter on it at the database.
 */

import 'server-only';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { toView, type VideoView } from './view';

/** The vehicle's walkaround as the admin sees it: the newest, whatever state it's in. */
export async function walkaroundForAdmin(vehicleId: string): Promise<VideoView | null> {
  const rows = await db
    .select()
    .from(t.videos)
    .where(and(eq(t.videos.vehicleId, vehicleId), eq(t.videos.kind, 'WALKAROUND')))
    .orderBy(desc(t.videos.createdAt))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/** The walkaround a shopper sees: the newest one that plays. */
export async function walkaroundForListing(vehicleId: string) {
  const rows = await db
    .select({ playbackId: t.videos.playbackId, aspectRatio: t.videos.aspectRatio, durationSec: t.videos.durationSec })
    .from(t.videos)
    .where(and(eq(t.videos.vehicleId, vehicleId), eq(t.videos.kind, 'WALKAROUND'), eq(t.videos.status, 'READY')))
    .orderBy(desc(t.videos.createdAt))
    .limit(1);
  const r = rows[0];
  return r?.playbackId ? { playbackId: r.playbackId, aspectRatio: r.aspectRatio, durationSec: r.durationSec } : null;
}

/** Which of these vehicles have a walkaround that plays — for the inventory list badge later. */
export async function vehiclesWithWalkaround(vehicleIds: string[]): Promise<Set<string>> {
  if (!vehicleIds.length) return new Set();
  const rows = await db
    .select({ id: t.videos.vehicleId })
    .from(t.videos)
    .where(and(inArray(t.videos.vehicleId, vehicleIds), eq(t.videos.kind, 'WALKAROUND'), eq(t.videos.status, 'READY')));
  return new Set(rows.map((r) => r.id).filter((x): x is string => Boolean(x)));
}

/** The group's library: everything not tied to a vehicle, newest first. */
export async function libraryVideos(groupId: string): Promise<VideoView[]> {
  const rows = await db
    .select()
    .from(t.videos)
    .where(and(eq(t.videos.groupId, groupId), isNull(t.videos.vehicleId), ne(t.videos.kind, 'WALKAROUND')))
    .orderBy(desc(t.videos.createdAt));
  return rows.map(toView);
}

/** The home page's intro video, when one is set and plays. */
export async function introVideo(videoId: string | null) {
  if (!videoId) return null;
  const rows = await db
    .select({ playbackId: t.videos.playbackId, aspectRatio: t.videos.aspectRatio, title: t.videos.title })
    .from(t.videos)
    .where(and(eq(t.videos.id, videoId), eq(t.videos.status, 'READY')))
    .limit(1);
  const r = rows[0];
  return r?.playbackId ? { playbackId: r.playbackId, aspectRatio: r.aspectRatio, title: r.title } : null;
}
