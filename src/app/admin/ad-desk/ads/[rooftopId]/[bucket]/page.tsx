/**
 * One group: `ads/<lot>/<shelf>`, or `ads/<lot>/new` to build one.
 *
 * A group's identity is its shelf — that is what Meta knows it by, what the ad
 * set is named, and what `meta_ad_copy.bucket` keys on. So the shelf is the
 * route segment, and a built group cannot change it. When a group is a row of
 * its own rather than a bucket key, this is the route that changes.
 */

import { notFound } from 'next/navigation';
import { requireSection } from '@/lib/auth-guard';
import { CAMPAIGN_BUCKETS, isBucketKey, type BucketKey } from '@/lib/meta/buckets';
import { allAdCopyForRooftop } from '@/lib/meta/ad-copy';
import { defaultAdCopy } from '@/lib/meta/ad-copy-spec';
import { previewFeed } from '@/lib/meta/feed-preview';
import { GroupEditor, NewGroupEditor, type Shelf } from '@/components/ad-desk/group-editor';
import type { AdCopyRow } from '@/components/ad-desk/ad-fields';
import { blockerFor, loadAdDesk, loadLotGroups } from '../../../shared';

export const dynamic = 'force-dynamic';

export default async function GroupPage({
  params,
}: {
  params: Promise<{ rooftopId: string; bucket: string }>;
}) {
  await requireSection('ad-desk');
  const { rooftopId, bucket: param } = await params;

  const data = await loadAdDesk({ withDiscovery: true });
  // `rooftops` is already scoped to the session, so finding it here IS the
  // authorization check — an id off the URL never reaches a query unchecked.
  const rooftop = data.rooftops.find((r) => r.id === rooftopId);
  if (!rooftop || !data.connected) notFound();
  if (param !== 'new' && !isBucketKey(param)) notFound();

  const [{ groups: byRooftop }, copyRows, preview] = await Promise.all([
    loadLotGroups(data, rooftopId),
    allAdCopyForRooftop(rooftopId),
    previewFeed(rooftopId),
  ]);

  const groups = byRooftop.get(rooftopId)?.groups ?? [];
  const taken = new Set(groups.map((g) => g.bucketKey).filter(Boolean) as string[]);

  const rows: AdCopyRow[] = copyRows.map((r) => ({
    id: r.id,
    bucket: r.bucket,
    name: r.name,
    message: r.message,
    headline: r.headline,
    description: r.description,
    callToAction: r.callToAction,
    active: r.active,
  }));

  const shelves: Shelf[] = CAMPAIGN_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    count: preview ? preview.shelfCounts[b.key] : null,
    taken: taken.has(b.key),
  }));

  const fallback = defaultAdCopy(rooftop.name);
  const city = [rooftop.city, rooftop.state].filter(Boolean).join(', ') || null;

  if (param === 'new') {
    const first = CAMPAIGN_BUCKETS.find((b) => !taken.has(b.key));
    // Every shelf already has a group. Nothing to build; the list says so.
    if (!first) notFound();
    return (
      <NewGroupEditor
        rooftopId={rooftopId}
        rooftopName={rooftop.name}
        city={city}
        shelves={shelves}
        initialBucket={first.key}
        saved={rows}
        fallback={fallback}
        blocker={blockerFor(data, rooftopId)}
      />
    );
  }

  const bucket = param as BucketKey;
  const group = groups.find((g) => g.bucketKey === bucket) ?? null;

  /*
   * A shelf with no group at Facebook is the "not built yet" case — saved ads
   * and nothing running. It is the same screen as New, opened on that shelf.
   */
  if (!group) {
    return (
      <NewGroupEditor
        rooftopId={rooftopId}
        rooftopName={rooftop.name}
        city={city}
        shelves={shelves}
        initialBucket={bucket}
        saved={rows}
        fallback={fallback}
        blocker={blockerFor(data, rooftopId)}
      />
    );
  }

  return (
    <GroupEditor
      rooftopId={rooftopId}
      rooftopName={rooftop.name}
      city={city}
      bucket={bucket}
      shelves={shelves}
      group={group}
      rows={rows.filter((r) => r.bucket === bucket)}
      fallback={fallback}
    />
  );
}
