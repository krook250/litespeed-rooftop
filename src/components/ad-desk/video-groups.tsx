import Link from 'next/link';
import { Badge } from '@/components/ui';
import { money } from '@/components/ad-desk/format';
import { tokenFor } from '@/lib/meta/connect';
import type { ReportWindow } from '@/lib/meta/campaigns';
import { readVideoGroup, videoGroupsForRooftop } from '@/lib/meta/video-groups';
import { deleteVideoGroup } from '@/lib/meta/video-group-actions';
import { posterUrl } from '@/lib/video/urls';
import { db } from '@/db';
import * as t from '@/db/schema';
import { inArray } from 'drizzle-orm';
import { VideoRunButton } from './video-run-button';

/**
 * A lot's video groups on the Ads list. Each row: what it is, whether it is
 * running, what it has done, and the one button that changes that.
 */
export async function VideoGroups({
  rooftopId,
  dealerGroupId,
  window,
  rangeLabel,
}: {
  rooftopId: string;
  dealerGroupId: string;
  window: ReportWindow;
  rangeLabel: string;
}) {
  const groups = await videoGroupsForRooftop(rooftopId);
  if (!groups.length) return null;
  const conn = await tokenFor(dealerGroupId);
  const live = await Promise.all(
    groups.map((g) => (conn && g.adSetId ? readVideoGroup(conn.token, g.adSetId, window) : Promise.resolve(null))),
  );
  const videoIds = groups.flatMap((g) => g.ads.map((a) => a.videoId)).filter((x): x is string => Boolean(x));
  const posters = videoIds.length
    ? await db.select({ id: t.videos.id, playbackId: t.videos.playbackId }).from(t.videos).where(inArray(t.videos.id, videoIds))
    : [];

  return (
    <div className="space-y-2.5">
      {groups.map((g, i) => {
        const l = live[i];
        const running = l?.effectiveStatus === 'ACTIVE';
        const first = posters.find((p) => p.id === g.ads[0]?.videoId)?.playbackId;
        return (
          <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-ink-200 bg-white px-4 py-3.5 shadow-sm">
            <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-black">
              {first ? <img src={posterUrl(first, 240)} alt="" className="h-full w-full object-cover" /> : null}
            </div>
            <div className="min-w-[12rem] flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-ink-900">{g.name}</span>
                <Badge tone="violet">Video</Badge>
                {!g.adSetId ? (
                  <Badge tone="blue">Not built yet</Badge>
                ) : running ? (
                  <Badge tone="green">Running</Badge>
                ) : (
                  <Badge tone="slate">Stopped</Badge>
                )}
              </div>
              <p className="mt-1 text-[11px] text-ink-500">
                {g.ads.length} {g.ads.length === 1 ? 'ad' : 'ads'} · {g.goal === 'CLICKS' ? 'going for clicks' : 'going for views'} · $
                {g.dailyBudgetUsd}/day · {g.radiusMiles} mi
              </p>
              {l ? (
                <p className="tnum mt-1 text-[11px] text-ink-600">
                  {rangeLabel}: {money(l.spend)} spent · {l.reach.toLocaleString()} reached ·{' '}
                  {g.goal === 'CLICKS' ? `${l.linkClicks.toLocaleString()} clicks` : `${l.views.toLocaleString()} watched`}
                </p>
              ) : g.adSetId ? (
                <p className="mt-1 text-[11px] text-ink-500">Facebook couldn’t be reached for numbers just now.</p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-500">Saved here only. Nothing is at Facebook and nothing is spending.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/admin/ad-desk/ads/${rooftopId}/video/${g.id}`}
                className="rounded-md border border-ink-300 px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50"
              >
                {g.adSetId ? 'Edit' : 'Finish setup ›'}
              </Link>
              {g.adSetId && l ? <VideoRunButton groupId={g.id} running={running} /> : null}
              {!running ? (
                <form action={deleteVideoGroup}>
                  <input type="hidden" name="groupId" value={g.id} />
                  <button className="rounded-md px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">Delete</button>
                </form>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
