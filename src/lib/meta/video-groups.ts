/**
 * Video groups: a Group whose ads are dealer videos rather than catalog cards.
 *
 * THE SHAPE: per lot, one campaign per goal (`Rooftop Video — <lot> — Clicks`
 * / `— Views`), one ad set per video group, one ad per video. The campaign is
 * named so it can never be mistaken for the catalog campaign or its legacy
 * prefix (`Rooftop — <lot> — `), which `listLotGroups` would list as legacy.
 *
 * Everything is created PAUSED, like the catalog groups. Building never spends;
 * Start does, and that is a separate click.
 *
 * The video itself is copied into the ad account from Mux's MP4
 * (`POST /act_x/advideos` with `file_url`). Facebook encodes it again before a
 * creative can use it, which can take a minute or two — longer than a click
 * should wait. So a build that finds a video still processing stops there,
 * says so, and the next Build carries on from the saved `fbVideoId`.
 */

import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { graph, graphEdge, MetaApiError } from './graph';
import { noteFailure, tokenFor } from './connect';
import {
  AD_NEEDS_PAYMENT,
  ADSET_BUDGET_SHARING,
  AD_URL_TAGS,
  DEAD_STATUSES,
  instagramIdForPage,
  setGroupRunning,
  type ReportWindow,
  type RunOutcome,
} from './campaigns';
import { mp4Url, posterUrl } from '@/lib/video/urls';

export type VideoGroupRow = typeof t.videoAdGroups.$inferSelect;
export type VideoAdRow = typeof t.videoAds.$inferSelect;
type Goal = VideoGroupRow['goal'];

export function videoCampaignName(lotName: string, goal: Goal): string {
  return `Rooftop Video — ${lotName} — ${goal === 'CLICKS' ? 'Clicks' : 'Views'}`.slice(0, 100);
}

const OBJECTIVE: Record<Goal, string> = { CLICKS: 'OUTCOME_TRAFFIC', VIEWS: 'OUTCOME_AWARENESS' };

function actPath(id: string) {
  return `/${id.startsWith('act_') ? id : `act_${id}`}`;
}

/* ------------------------------------------------------------------ reads */

export async function videoGroupsForRooftop(rooftopId: string) {
  const groups = await db
    .select()
    .from(t.videoAdGroups)
    .where(eq(t.videoAdGroups.rooftopId, rooftopId))
    .orderBy(asc(t.videoAdGroups.createdAt));
  if (!groups.length) return [];
  const ads = await db
    .select()
    .from(t.videoAds)
    .where(inArray(t.videoAds.groupId, groups.map((g) => g.id)))
    .orderBy(asc(t.videoAds.sortOrder));
  return groups.map((g) => ({ ...g, ads: ads.filter((a) => a.groupId === g.id) }));
}

export type VideoGroupLive = {
  effectiveStatus: string;
  spend: number;
  reach: number;
  linkClicks: number;
  views: number;
};

/** What Meta says about a built video group. Null when it can't be read. */
export async function readVideoGroup(token: string, adSetId: string, window: ReportWindow): Promise<VideoGroupLive | null> {
  try {
    const set = await graph<{ effective_status?: string; status?: string }>(`/${adSetId}`, {
      token,
      params: { fields: 'effective_status,status' },
    });
    const rows = await graphEdge<{
      spend?: string;
      reach?: string;
      inline_link_clicks?: string;
      video_thruplay_watched_actions?: { value?: string }[];
    }>(`/${adSetId}/insights`, {
      token,
      fields: 'spend,reach,inline_link_clicks,video_thruplay_watched_actions',
      params: window ? { time_range: JSON.stringify(window) } : { date_preset: 'maximum' },
      maxPages: 1,
    }).catch(() => []);
    const r = rows[0] ?? {};
    return {
      effectiveStatus: set.effective_status ?? set.status ?? 'UNKNOWN',
      spend: Number(r.spend ?? 0),
      reach: Number(r.reach ?? 0),
      linkClicks: Number(r.inline_link_clicks ?? 0),
      views: Number(r.video_thruplay_watched_actions?.[0]?.value ?? 0),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ build */

export type VideoBuildOutcome =
  | { ok: true; message: string }
  | { ok: false; error: string; pending?: boolean };

/** Poll Facebook's copy of the video for up to `waitMs`. */
async function videoReady(token: string, fbVideoId: string, waitMs: number): Promise<'ready' | 'processing' | 'error'> {
  const until = Date.now() + waitMs;
  for (;;) {
    const v = await graph<{ status?: { video_status?: string } }>(`/${fbVideoId}`, {
      token,
      params: { fields: 'status' },
    }).catch(() => null);
    const s = v?.status?.video_status;
    if (s === 'ready') return 'ready';
    if (s === 'error') return 'error';
    if (Date.now() > until) return 'processing';
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function ensureCampaign(token: string, act: string, name: string, goal: Goal): Promise<string> {
  const found = await graphEdge<{ id: string; name?: string; status?: string }>(`${act}/campaigns`, {
    token,
    fields: 'id,name,status',
    maxPages: 3,
  });
  const live = found.find((c) => c.name === name && !DEAD_STATUSES.has(c.status ?? ''));
  if (live) return live.id;
  const created = await graph<{ id: string }>(`${act}/campaigns`, {
    method: 'POST',
    token,
    params: {
      name,
      objective: OBJECTIVE[goal],
      status: 'PAUSED',
      special_ad_categories: JSON.stringify(['NONE']),
      is_adset_budget_sharing_enabled: ADSET_BUDGET_SHARING,
    },
  });
  return created.id;
}

export async function buildVideoGroup(groupId: string, dealerGroupId: string): Promise<VideoBuildOutcome> {
  const conn = await tokenFor(dealerGroupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected.' };
  const token = conn.token;

  const [group] = await db.select().from(t.videoAdGroups).where(eq(t.videoAdGroups.id, groupId)).limit(1);
  if (!group) return { ok: false, error: 'That group is gone.' };
  const [rooftop] = await db.select().from(t.rooftops).where(eq(t.rooftops.id, group.rooftopId)).limit(1);
  const [asset] = await db.select().from(t.metaRooftopAssets).where(eq(t.metaRooftopAssets.rooftopId, group.rooftopId)).limit(1);
  if (!rooftop) return { ok: false, error: 'That lot is gone.' };
  if (!asset?.adAccountId) return { ok: false, error: 'Pick an ad account for this lot on Connect first.' };
  if (!asset.pageId) return { ok: false, error: 'Pick this lot’s Facebook Page on Connect first.' };
  if (rooftop.latitude === null || rooftop.longitude === null) {
    return { ok: false, error: 'This lot has no map coordinates, and without them the ad would target the whole country. Set them on the lot first.' };
  }

  const ads = await db.select().from(t.videoAds).where(eq(t.videoAds.groupId, group.id)).orderBy(asc(t.videoAds.sortOrder));
  if (!ads.length) return { ok: false, error: 'Add at least one video to the group.' };

  const act = actPath(asset.adAccountId);
  const radius = Math.min(50, Math.max(5, group.radiusMiles));
  const budgetMinor = String(Math.min(1000, Math.max(5, group.dailyBudgetUsd)) * 100);

  try {
    /* 1. the videos, copied into the ad account — all sent first, then waited on together */
    for (const ad of ads) {
      if (!ad.videoId || ad.fbVideoId) continue;
      const [v] = await db.select().from(t.videos).where(eq(t.videos.id, ad.videoId)).limit(1);
      if (!v?.playbackId || !v.mp4Name) return { ok: false, error: 'One of these videos is still processing on our side. Try again in a few minutes.' };
      const up = await graph<{ id: string }>(`${act}/advideos`, {
        method: 'POST',
        token,
        params: { file_url: mp4Url(v.playbackId, v.mp4Name), name: (v.title || 'Rooftop video').slice(0, 100) },
        timeoutMs: 60_000,
      });
      ad.fbVideoId = up.id;
      await db.update(t.videoAds).set({ fbVideoId: up.id, updatedAt: new Date() }).where(eq(t.videoAds.id, ad.id));
    }
    const deadline = Date.now() + 50_000;
    let pending = 0;
    for (const ad of ads) {
      if (!ad.fbVideoId) continue;
      const state = await videoReady(token, ad.fbVideoId, Math.max(0, deadline - Date.now()));
      if (state === 'error') {
        await db.update(t.videoAds).set({ fbVideoId: null }).where(eq(t.videoAds.id, ad.id));
        return { ok: false, error: 'Facebook couldn’t process one of the videos. Press Build again to resend it.' };
      }
      if (state === 'processing') pending += 1;
    }
    if (pending) {
      return {
        ok: false,
        pending: true,
        error: `Facebook is still processing ${pending === 1 ? 'the video' : `${pending} videos`}. Your words are saved — press Build again in a minute or two.`,
      };
    }

    /* 2. campaign (one per lot and goal) */
    const campaignId = group.campaignId ?? (await ensureCampaign(token, act, videoCampaignName(rooftop.name, group.goal), group.goal));

    /* 3. the ad set — the group */
    const instagramId = await instagramIdForPage(token, asset.pageId);
    const targeting = {
      geo_locations: {
        custom_locations: [{ latitude: rooftop.latitude, longitude: rooftop.longitude, radius, distance_unit: 'mile' }],
      },
      publisher_platforms: instagramId ? ['facebook', 'instagram'] : ['facebook'],
      // Same placements the catalog groups have proven on v25.0. Add others one at a time — see campaigns.ts.
      facebook_positions: ['feed'],
      ...(instagramId ? { instagram_positions: ['stream'] } : {}),
    };
    let adSetId = group.adSetId;
    if (adSetId) {
      await graph(`/${adSetId}`, {
        method: 'POST',
        token,
        params: { name: group.name.slice(0, 100), daily_budget: budgetMinor, targeting: JSON.stringify(targeting) },
      });
    } else {
      const set = await graph<{ id: string }>(`${act}/adsets`, {
        method: 'POST',
        token,
        params: {
          name: group.name.slice(0, 100),
          campaign_id: campaignId,
          billing_event: 'IMPRESSIONS',
          optimization_goal: group.goal === 'CLICKS' ? 'LINK_CLICKS' : 'THRUPLAY',
          ...(group.goal === 'CLICKS' ? { destination_type: 'WEBSITE' } : {}),
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          daily_budget: budgetMinor,
          targeting: JSON.stringify(targeting),
          status: 'PAUSED',
        },
      });
      adSetId = set.id;
    }
    await db
      .update(t.videoAdGroups)
      .set({ campaignId, adSetId, builtAt: new Date(), updatedAt: new Date() })
      .where(eq(t.videoAdGroups.id, group.id));

    const setState = await graph<{ status?: string }>(`/${adSetId}`, { token, params: { fields: 'status' } }).catch(() => ({ status: 'PAUSED' }));

    /* 4. one creative and one ad per video */
    let made = 0;
    for (const ad of ads) {
      if (!ad.fbVideoId || !ad.videoId) continue;
      const [v] = await db.select({ playbackId: t.videos.playbackId }).from(t.videos).where(eq(t.videos.id, ad.videoId)).limit(1);
      const creative = await graph<{ id: string }>(`${act}/adcreatives`, {
        method: 'POST',
        token,
        params: {
          name: `Rooftop video — ${rooftop.name} — ${group.name}`.slice(0, 100),
          object_story_spec: JSON.stringify({
            page_id: asset.pageId,
            ...(instagramId ? { instagram_user_id: instagramId } : {}),
            video_data: {
              video_id: ad.fbVideoId,
              ...(v?.playbackId ? { image_url: posterUrl(v.playbackId, 1200) } : {}),
              message: ad.message,
              title: ad.headline,
              call_to_action: { type: ad.callToAction, value: { link: ad.link } },
            },
          }),
          url_tags: AD_URL_TAGS,
        },
      });
      const name = (ad.headline || `Video ${ad.sortOrder + 1}`).slice(0, 100);
      let adId = ad.adId;
      if (adId) {
        await graph(`/${adId}`, { method: 'POST', token, params: { creative: JSON.stringify({ creative_id: creative.id }), name } });
      } else {
        const created = await graph<{ id: string }>(`${act}/ads`, {
          method: 'POST',
          token,
          params: {
            name,
            adset_id: adSetId,
            creative: JSON.stringify({ creative_id: creative.id }),
            status: setState.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
          },
        });
        adId = created.id;
      }
      await db.update(t.videoAds).set({ creativeId: creative.id, adId, updatedAt: new Date() }).where(eq(t.videoAds.id, ad.id));
      made += 1;
    }

    return {
      ok: true,
      message:
        setState.status === 'ACTIVE'
          ? `Updated on Facebook — ${made} ${made === 1 ? 'ad' : 'ads'}, still running.`
          : `Built on Facebook — ${made} ${made === 1 ? 'ad' : 'ads'}. Nothing spends until you press Start.`,
    };
  } catch (err) {
    await noteFailure(dealerGroupId, err);
    if (err instanceof MetaApiError) {
      if (err.subcode === AD_NEEDS_PAYMENT) {
        return { ok: false, error: 'This ad account has no payment method, so Facebook won’t create the ad. Add a card in Facebook’s billing settings, then Build again.' };
      }
      console.error('[video-groups] build', err.message, err.code, err.subcode);
      return { ok: false, error: err.dealerMessage };
    }
    console.error('[video-groups] build', err);
    return { ok: false, error: 'Something went wrong talking to Facebook. Try again.' };
  }
}

/** An ad the dealer took out of the group goes at Facebook too. */
export async function retireVideoAd(dealerGroupId: string, adId: string | null) {
  if (!adId) return;
  const conn = await tokenFor(dealerGroupId);
  if (!conn) return;
  await graph(`/${adId}`, { method: 'POST', token: conn.token, params: { status: 'DELETED' } }).catch(() => null);
}

export async function setVideoGroupRunningFor(dealerGroupId: string, group: VideoGroupRow, running: boolean): Promise<RunOutcome> {
  if (!group.campaignId || !group.adSetId) return { ok: false, error: 'Build the group on Facebook first.' };
  const conn = await tokenFor(dealerGroupId);
  if (!conn) return { ok: false, error: 'Facebook is not connected.' };
  return setGroupRunning(conn.token, group.campaignId, group.adSetId, running);
}

export async function videoGroupInLot(groupId: string, rooftopIds: string[]) {
  const [g] = await db.select().from(t.videoAdGroups).where(eq(t.videoAdGroups.id, groupId)).limit(1);
  return g && rooftopIds.includes(g.rooftopId) ? g : null;
}

