import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSection } from '@/lib/auth-guard';
import { CAMPAIGN_BUCKETS } from '@/lib/meta/buckets';
import { loadAdDesk, loadLotGroups } from '../../../shared';

export const dynamic = 'force-dynamic';

/**
 * New group, step zero: cars or a video. Two different things at Facebook —
 * catalog ads read the inventory, video ads play one of the dealer's videos —
 * so the question comes before either editor.
 */
export default async function ChooseGroupPage({ params }: { params: Promise<{ rooftopId: string }> }) {
  await requireSection('ad-desk');
  const { rooftopId } = await params;
  const data = await loadAdDesk();
  const rooftop = data.rooftops.find((r) => r.id === rooftopId);
  if (!rooftop || !data.connected) notFound();
  const { groups } = await loadLotGroups(data, rooftopId);
  const taken = new Set((groups.get(rooftopId)?.groups ?? []).map((g) => g.bucketKey).filter(Boolean));
  const shelvesLeft = CAMPAIGN_BUCKETS.some((b) => !taken.has(b.key));

  const option = 'block rounded-xl border border-ink-200 bg-white p-5 shadow-sm transition hover:border-ink-900';

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <Link href="/admin/ad-desk/ads" className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Ads
      </Link>
      <div>
        <h1 className="text-lg font-semibold text-ink-900">New group for {rooftop.name}</h1>
        <p className="mt-1 text-sm text-ink-600">What should the ads show?</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {shelvesLeft ? (
          <Link href={`/admin/ad-desk/ads/${rooftopId}/new`} className={option}>
            <div className="text-base font-semibold text-ink-900">Cars from your inventory</div>
            <p className="mt-1 text-sm text-ink-600">
              Pick a shelf of cars. Facebook shows each person the cars they&apos;re most likely to want, with photos and price.
            </p>
          </Link>
        ) : (
          <div className="rounded-xl border border-dashed border-ink-300 p-5">
            <div className="text-base font-semibold text-ink-500">Cars from your inventory</div>
            <p className="mt-1 text-sm text-ink-500">Every shelf already has a group. Edit one of those instead.</p>
          </div>
        )}
        <Link href={`/admin/ad-desk/ads/${rooftopId}/video/new`} className={option}>
          <div className="text-base font-semibold text-ink-900">A video</div>
          <p className="mt-1 text-sm text-ink-600">
            A walkaround, a lot tour or your intro. Each video you pick becomes an ad.
          </p>
        </Link>
      </div>
    </div>
  );
}
