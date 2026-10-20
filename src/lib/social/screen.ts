/**
 * Everything the Social screen needs for one lot, loaded once.
 */

import 'server-only';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { getLiveInventory, getRooftops } from '@/lib/queries';
import { dealerSiteBase } from '@/lib/storefront-url';
import { activePrice, num, usd, vehicleTitle } from '@/lib/domain';
import { PUBLIC_STATUSES } from '@/components/store/build-view';
import { posterUrl } from '@/lib/video/urls';
import { vehicleCaption } from './caption';
import { lotPageId, pageIdentity, postingGrant } from './page';
import { instagramReadyPhoto, postablePhoto } from './publish';
import { postsForLot, type SocialPostView } from './view';

export type ComposerPhoto = { url: string; igOk: boolean };

export type ComposerUnit = {
  id: string;
  title: string;
  line: string;
  photos: ComposerPhoto[];
  caption: string;
  walkaround: { videoId: string; poster: string; caption: string } | null;
};

export type ComposerVideo = { id: string; title: string; poster: string };

export type Accounts =
  | { state: 'ready'; pageName: string; igUsername: string | null; instagramAllowed: boolean }
  | { state: 'problem'; message: string; reconnect: boolean };

export type SocialScreen = {
  lots: { id: string; name: string }[];
  lotId: string;
  accounts: Accounts;
  units: ComposerUnit[];
  videos: ComposerVideo[];
  posts: SocialPostView[];
};

export async function loadSocial(lotParam: string | undefined): Promise<SocialScreen | null> {
  const me = await requireSession();
  const rooftops = await getRooftops();
  if (!rooftops.length) return null;
  const lot = rooftops.find((r) => r.id === lotParam) ?? rooftops[0]!;

  const [accounts, units, videos, posts] = await Promise.all([
    accountsFor(me.groupId, lot.id),
    unitsFor(lot),
    libraryFor(me.groupId),
    postsForLot(me.groupId, lot.id),
  ]);

  return {
    lots: rooftops.map((r) => ({ id: r.id, name: r.name })),
    lotId: lot.id,
    accounts,
    units,
    videos,
    posts,
  };
}

async function accountsFor(groupId: string, rooftopId: string): Promise<Accounts> {
  const grant = await postingGrant(groupId);
  if (!grant.connected) return { state: 'problem', message: 'Facebook isn’t connected yet.', reconnect: true };
  if (!(await lotPageId(groupId, rooftopId))) {
    return { state: 'problem', message: 'No Facebook Page is picked for this lot yet.', reconnect: false };
  }
  if (!grant.facebook) {
    return {
      state: 'problem',
      message: 'Facebook hasn’t given Rooftop permission to post yet. Click Connect again and allow posting — your ads keep running.',
      reconnect: true,
    };
  }
  const page = await pageIdentity(groupId, rooftopId);
  if ('error' in page) return { state: 'problem', message: page.error, reconnect: page.reconnect };
  return { state: 'ready', pageName: page.pageName, igUsername: page.igUsername, instagramAllowed: grant.instagram };
}

async function unitsFor(lot: { id: string; phone: string }): Promise<ComposerUnit[]> {
  const inventory = (await getLiveInventory({ rooftopIds: [lot.id] }))
    .filter((v) => PUBLIC_STATUSES.has(v.status))
    .sort((a, b) => +new Date(b.acquiredDate) - +new Date(a.acquiredDate));
  if (!inventory.length) return [];

  const base = await dealerSiteBase(lot.id);
  const walks = await db
    .select({ id: t.videos.id, vehicleId: t.videos.vehicleId, playbackId: t.videos.playbackId, createdAt: t.videos.createdAt })
    .from(t.videos)
    .where(
      and(
        inArray(t.videos.vehicleId, inventory.map((v) => v.id)),
        eq(t.videos.kind, 'WALKAROUND'),
        eq(t.videos.status, 'READY'),
        isNotNull(t.videos.mp4Name),
      ),
    )
    .orderBy(desc(t.videos.createdAt));

  return inventory.map((v) => {
    const url = `${base}/${v.stockNumber.toLowerCase()}`;
    const walk = walks.find((w) => w.vehicleId === v.id && w.playbackId);
    const photos = v.photos
      .map((p) => postablePhoto(p.url) && { url: p.url, igOk: instagramReadyPhoto(postablePhoto(p.url)!) })
      .filter((p): p is ComposerPhoto => Boolean(p));
    return {
      id: v.id,
      title: vehicleTitle(v),
      line: `${usd(activePrice(v))} · ${num(v.mileage)} mi · Stock ${v.stockNumber}`,
      photos,
      caption: vehicleCaption(v, { url, phone: lot.phone || null }),
      walkaround: walk
        ? {
            videoId: walk.id,
            poster: posterUrl(walk.playbackId!, 320),
            caption: vehicleCaption(v, { url, phone: lot.phone || null, walkaround: true }),
          }
        : null,
    };
  });
}

async function libraryFor(groupId: string): Promise<ComposerVideo[]> {
  const rows = await db
    .select({ id: t.videos.id, title: t.videos.title, kind: t.videos.kind, playbackId: t.videos.playbackId })
    .from(t.videos)
    .where(
      and(eq(t.videos.groupId, groupId), isNull(t.videos.vehicleId), eq(t.videos.status, 'READY'), isNotNull(t.videos.mp4Name)),
    )
    .orderBy(desc(t.videos.createdAt));
  return rows
    .filter((r) => r.playbackId)
    .map((r) => ({ id: r.id, title: r.title || 'Untitled', poster: posterUrl(r.playbackId!, 320) }));
}
