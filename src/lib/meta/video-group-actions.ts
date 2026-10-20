'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getRooftops } from '@/lib/queries';
import { dealerSiteBase } from '@/lib/storefront-url';
import { COPY_LIMITS, isCallToAction } from './ad-copy-spec';
import { tokenFor } from './connect';
import { graph } from './graph';
import { buildVideoGroup, retireVideoAd, setVideoGroupRunningFor, videoGroupInLot } from './video-groups';

export type VideoGroupInput = {
  rooftopId: string;
  groupId: string | null;
  name: string;
  goal: 'CLICKS' | 'VIEWS';
  dailyBudgetUsd: number;
  radiusMiles: number;
  ads: { videoId: string; message: string; headline: string; callToAction: string }[];
};

export type VideoGroupResult =
  | { ok: true; groupId: string; message: string }
  | { ok: false; groupId: string | null; error: string; pending?: boolean };

async function adDeskUser() {
  const me = await requireSession();
  return can(me.role, 'ad-desk') ? me : null;
}

export async function saveVideoGroup(input: VideoGroupInput, build: boolean): Promise<VideoGroupResult> {
  const me = await adDeskUser();
  if (!me) return { ok: false, groupId: null, error: 'Your role can’t change ads.' };
  const lots = await getRooftops();
  const lot = lots.find((r) => r.id === input.rooftopId);
  if (!lot) return { ok: false, groupId: null, error: 'That lot isn’t yours.' };

  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, groupId: input.groupId, error: 'Give the group a name.' };
  if (!Number.isFinite(input.dailyBudgetUsd) || input.dailyBudgetUsd < 5) return { ok: false, groupId: input.groupId, error: 'Daily budget has to be at least $5.' };
  if (!Number.isFinite(input.radiusMiles) || input.radiusMiles < 5 || input.radiusMiles > 50) {
    return { ok: false, groupId: input.groupId, error: 'Radius has to be between 5 and 50 miles. That’s Facebook’s range, not ours.' };
  }
  if (!input.ads.length) return { ok: false, groupId: input.groupId, error: 'Pick at least one video.' };
  if (input.ads.length > 6) return { ok: false, groupId: input.groupId, error: 'Six videos per group at most.' };

  // The videos, checked against the dealer group, and where each click goes.
  const vids = await db
    .select({ id: t.videos.id, vehicleId: t.videos.vehicleId, mp4Name: t.videos.mp4Name, status: t.videos.status })
    .from(t.videos)
    .where(and(eq(t.videos.groupId, me.groupId), inArray(t.videos.id, input.ads.map((a) => a.videoId))));
  const base = await dealerSiteBase(lot.id);
  const stockOf = new Map<string, string>();
  const vehicleIds = vids.map((v) => v.vehicleId).filter((x): x is string => Boolean(x));
  if (vehicleIds.length) {
    const rows = await db
      .select({ id: t.vehicles.id, stock: t.vehicles.stockNumber, rooftopId: t.vehicles.rooftopId })
      .from(t.vehicles)
      .where(inArray(t.vehicles.id, vehicleIds));
    for (const r of rows) stockOf.set(r.id, r.stock);
  }

  const ads = [];
  for (const [i, a] of input.ads.entries()) {
    const v = vids.find((x) => x.id === a.videoId);
    if (!v || v.status !== 'READY' || !v.mp4Name) return { ok: false, groupId: input.groupId, error: 'One of the videos isn’t ready yet.' };
    const message = a.message.trim();
    const headline = a.headline.trim();
    if (!message) return { ok: false, groupId: input.groupId, error: `Ad ${i + 1} needs primary text.` };
    if (message.length > COPY_LIMITS.message) return { ok: false, groupId: input.groupId, error: `Ad ${i + 1}: primary text stops at ${COPY_LIMITS.message} characters.` };
    if (headline.length > COPY_LIMITS.headline) return { ok: false, groupId: input.groupId, error: `Ad ${i + 1}: headline stops at ${COPY_LIMITS.headline} characters.` };
    const stock = v.vehicleId ? stockOf.get(v.vehicleId) : null;
    ads.push({
      videoId: v.id,
      message,
      headline,
      callToAction: isCallToAction(a.callToAction) ? a.callToAction : 'LEARN_MORE',
      link: stock ? `${base}/${stock.toLowerCase()}` : base,
      sortOrder: i,
    });
  }

  let groupId = input.groupId;
  if (groupId) {
    const g = await videoGroupInLot(groupId, [lot.id]);
    if (!g) return { ok: false, groupId: null, error: 'That group is gone.' };
    // The goal decides the campaign, and a built ad set can't move between campaigns.
    const goal = g.adSetId ? g.goal : input.goal;
    await db
      .update(t.videoAdGroups)
      .set({ name, goal, dailyBudgetUsd: Math.round(input.dailyBudgetUsd), radiusMiles: Math.round(input.radiusMiles), updatedAt: new Date() })
      .where(eq(t.videoAdGroups.id, g.id));
  } else {
    const [g] = await db
      .insert(t.videoAdGroups)
      .values({ rooftopId: lot.id, name, goal: input.goal, dailyBudgetUsd: Math.round(input.dailyBudgetUsd), radiusMiles: Math.round(input.radiusMiles) })
      .returning();
    groupId = g!.id;
  }

  // Ads are matched on the video. Same video keeps its Facebook ad; a dropped one is retired there too.
  const existing = await db.select().from(t.videoAds).where(eq(t.videoAds.groupId, groupId));
  for (const old of existing) {
    if (!ads.some((a) => a.videoId === old.videoId)) {
      await retireVideoAd(me.groupId, old.adId);
      await db.delete(t.videoAds).where(eq(t.videoAds.id, old.id));
    }
  }
  for (const a of ads) {
    const old = existing.find((x) => x.videoId === a.videoId);
    if (old) {
      await db.update(t.videoAds).set({ ...a, updatedAt: new Date() }).where(eq(t.videoAds.id, old.id));
    } else {
      await db.insert(t.videoAds).values({ groupId, ...a });
    }
  }

  revalidatePath('/admin/ad-desk/ads');
  if (!build) return { ok: true, groupId, message: 'Saved' };

  const r = await buildVideoGroup(groupId, me.groupId);
  revalidatePath('/admin/ad-desk/ads');
  return r.ok ? { ok: true, groupId, message: r.message } : { ok: false, groupId, error: r.error, pending: r.pending };
}

export async function setVideoGroupRunning(_prev: unknown, formData: FormData): Promise<{ error: string | null }> {
  const me = await adDeskUser();
  if (!me) return { error: 'Your role can’t change ads.' };
  const lots = await getRooftops();
  const g = await videoGroupInLot(String(formData.get('groupId') ?? ''), lots.map((l) => l.id));
  if (!g) return { error: 'That group is gone.' };
  const r = await setVideoGroupRunningFor(me.groupId, g, formData.get('running') === '1');
  revalidatePath('/admin/ad-desk/ads');
  return { error: r.ok ? null : r.error };
}

/** Stops it at Facebook and forgets it here. */
export async function deleteVideoGroup(formData: FormData): Promise<void> {
  const me = await adDeskUser();
  if (!me) return;
  const lots = await getRooftops();
  const g = await videoGroupInLot(String(formData.get('groupId') ?? ''), lots.map((l) => l.id));
  if (!g) return;
  if (g.adSetId) {
    const conn = await tokenFor(me.groupId);
    if (conn) await graph(`/${g.adSetId}`, { method: 'POST', token: conn.token, params: { status: 'DELETED' } }).catch(() => null);
  }
  await db.delete(t.videoAdGroups).where(eq(t.videoAdGroups.id, g.id));
  revalidatePath('/admin/ad-desk/ads');
}
