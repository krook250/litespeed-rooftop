import { notFound } from 'next/navigation';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { requireSection } from '@/lib/auth-guard';
import { activePrice, num, usd, vehicleTitle } from '@/lib/domain';
import { dealerSiteBase } from '@/lib/storefront-url';
import { posterUrl } from '@/lib/video/urls';
import { videoGroupsForRooftop } from '@/lib/meta/video-groups';
import { VideoGroupEditor, type PickableVideo } from '@/components/ad-desk/video-group-editor';
import { loadAdDesk } from '../../../../shared';

export const dynamic = 'force-dynamic';

/** `ads/<lot>/video/<group>`, or `ads/<lot>/video/new`. */
export default async function VideoGroupPage({ params }: { params: Promise<{ rooftopId: string; groupId: string }> }) {
  const me = await requireSection('ad-desk');
  const { rooftopId, groupId } = await params;
  const data = await loadAdDesk();
  const rooftop = data.rooftops.find((r) => r.id === rooftopId);
  if (!rooftop || !data.connected) notFound();

  const groups = await videoGroupsForRooftop(rooftopId);
  const group = groupId === 'new' ? null : (groups.find((g) => g.id === groupId) ?? null);
  if (groupId !== 'new' && !group) notFound();

  const base = await dealerSiteBase(rooftopId);
  const host = base.replace(/^https?:\/\//, '');

  // Walkarounds on this lot's cars, newest first, then the dealership's own videos.
  const walks = await db
    .select({ video: t.videos, vehicle: t.vehicles })
    .from(t.videos)
    .innerJoin(t.vehicles, eq(t.videos.vehicleId, t.vehicles.id))
    .where(
      and(
        eq(t.videos.groupId, me.groupId),
        eq(t.videos.kind, 'WALKAROUND'),
        eq(t.videos.status, 'READY'),
        isNotNull(t.videos.mp4Name),
        eq(t.vehicles.rooftopId, rooftopId),
        inArray(t.vehicles.status, ['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE']),
      ),
    )
    .orderBy(desc(t.videos.createdAt));
  const library = await db
    .select()
    .from(t.videos)
    .where(and(eq(t.videos.groupId, me.groupId), isNull(t.videos.vehicleId), eq(t.videos.status, 'READY'), isNotNull(t.videos.mp4Name)))
    .orderBy(desc(t.videos.createdAt));

  const seenVehicle = new Set<string>();
  const pickable: PickableVideo[] = [
    ...walks
      .filter(({ vehicle }) => (seenVehicle.has(vehicle.id) ? false : (seenVehicle.add(vehicle.id), true)))
      .map(({ video, vehicle }) => {
        const title = vehicleTitle(vehicle);
        return {
          id: video.id,
          kind: 'WALKAROUND' as const,
          label: title,
          poster: posterUrl(video.playbackId!, 480),
          goesTo: `${host}/${vehicle.stockNumber.toLowerCase()}`,
          message: `${title} — ${usd(activePrice(vehicle))}, ${num(vehicle.mileage)} miles. Watch the walkaround, then come drive it.`,
          headline: title,
        };
      }),
    ...library.map((v) => ({
      id: v.id,
      kind: v.kind === 'INTRO' ? ('INTRO' as const) : ('LOT' as const),
      label: v.title || 'Untitled',
      poster: posterUrl(v.playbackId!, 480),
      goesTo: host,
      message: `Come see what’s on the lot at ${rooftop.name}.`,
      headline: rooftop.name,
    })),
  ];

  return (
    <VideoGroupEditor
      rooftopId={rooftopId}
      rooftopName={rooftop.name}
      pageName={data.assets.get(rooftopId)?.pageName ?? rooftop.name}
      videos={pickable}
      initial={
        group
          ? {
              id: group.id,
              name: group.name,
              goal: group.goal,
              dailyBudgetUsd: group.dailyBudgetUsd,
              radiusMiles: group.radiusMiles,
              built: Boolean(group.adSetId),
              ads: group.ads
                .filter((a) => a.videoId)
                .map((a) => ({ videoId: a.videoId!, message: a.message, headline: a.headline, callToAction: a.callToAction })),
            }
          : null
      }
    />
  );
}
