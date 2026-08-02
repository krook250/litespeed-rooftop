import Link from 'next/link';
import { AgeBadge, Card, CardHeader, EmptyState, cn } from '@/components/ui';
import { Avatar, Composer } from '@/components/feed/bits';
import { FeedPost } from '@/components/feed/card';
import { HomePreference } from '@/components/feed/home-preference';
import { requireSession } from '@/lib/auth';
import { getGroup, getLiveInventory, getRooftops, getSalesSince, sessionScope } from '@/lib/queries';
import { getFeed, sweepDerivedFeedEvents } from '@/lib/feed';
import type { FeedEventKind } from '@/db/schema';
import { db } from '@/db';
import * as t from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  daysInStock,
  isAtRisk,
  isWaterUnit,
  shortRooftopName,
  shortTitle,
  totalCost,
  usd,
} from '@/lib/domain';

export const dynamic = 'force-dynamic';

/**
 * Lot Walk.
 *
 * The home screen is a feed, not a dashboard — section 2 of
 * `claude/data-model-and-decisions.md`. Two things make this work where
 * Chatter failed: the inventory is the author, and every card carries a number.
 * The dashboard still exists at /admin/dashboard and either can be home.
 */

const FILTERS: { key: string; label: string; kinds?: FeedEventKind[] }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'money', label: 'Money', kinds: ['sold', 'price_change', 'water', 'aged', 'at_risk'] },
  { key: 'lot', label: 'The lot', kinds: ['acquired', 'recon_in', 'recon_out', 'photos', 'front_line'] },
  { key: 'channels', label: 'Channels', kinds: ['sync_error', 'vdp_milestone', 'domain'] },
  { key: 'people', label: 'People', kinds: ['team', 'note'] },
];

export default async function LotWalkPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0]!;

  const me = await requireSession();
  const scope = await sessionScope();

  // Threshold events — "crossed 30 days", "became a water unit" — have no write
  // to hang off, so they are swept here. Idempotent by dedupeKey, so a refresh
  // does not duplicate a card. At scale this becomes roadmap item 6's worker.
  await sweepDerivedFeedEvents(scope.rooftopIds);

  const [group, rooftops, inventory, sales, cards] = await Promise.all([
    getGroup(),
    getRooftops(),
    getLiveInventory(),
    getSalesSince(30),
    getFeed({ rooftopIds: scope.rooftopIds, viewerId: me.id, limit: 40, kinds: filter.kinds }),
  ]);

  const staff = await db
    .select({ id: t.users.id, name: t.users.name, role: t.users.role })
    .from(t.users)
    .where(eq(t.users.groupId, me.groupId))
    .orderBy(t.users.name);

  const withDays = inventory.map((v) => ({ ...v, dis: daysInStock(v) }));
  const atRisk = withDays.filter((v) => isAtRisk(v.dis)).sort((a, b) => b.dis - a.dis);
  const inRecon = withDays.filter((v) => v.status === 'IN_RECON' || v.status === 'ARRIVED');
  const water = withDays.filter(isWaterUnit);
  const tiedUp = withDays.reduce((s, v) => s + totalCost(v), 0);
  const grossMtd = sales.reduce((s, v) => s + v.frontGross, 0);
  const soldToday = sales.filter(
    (s) => new Date(s.soldDate).toDateString() === new Date().toDateString(),
  ).length;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">Lot Walk</h1>
          <p className="text-sm text-ink-500">
            {group.name} · {withDays.length} units on the ground across{' '}
            {rooftops.length} rooftop{rooftops.length === 1 ? '' : 's'}
          </p>
        </div>
        <HomePreference current={me.homeView} thisView="FEED" />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* the four numbers the feed is judged against */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Sold today" value={String(soldToday)} />
            <Tile label="Sold 30d" value={String(sales.length)} />
            <Tile label="Front gross 30d" value={usd(grossMtd)} tone={grossMtd > 0 ? 'good' : undefined} />
            <Tile label="Money on the ground" value={usd(tiedUp)} />
          </div>

          <Composer
            me={me.name}
            rooftops={rooftops.map((r) => ({
              id: r.id,
              name: shortRooftopName(r.name, group.name),
            }))}
          />

          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((x) => (
              <Link
                key={x.key}
                href={x.key === 'all' ? '/admin/feed' : `/admin/feed?f=${x.key}`}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors',
                  x.key === filter.key
                    ? 'bg-ink-900 text-white ring-ink-900'
                    : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-100',
                )}
              >
                {x.label}
              </Link>
            ))}
          </div>

          {cards.length === 0 ? (
            <Card>
              <EmptyState
                title="Nothing on the lot yet"
                body="Add a unit and the feed starts writing itself — acquired, into recon, photos up, front-line ready, priced, sold."
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {cards.map((card) => (
                <FeedPost key={card.event.id} card={card} me={me.name} />
              ))}
              <p className="py-2 text-center text-xs text-ink-500">
                That is the last {cards.length} cards. The feed only shows things that moved money.
              </p>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- right rail */}
        <aside className="hidden space-y-4 lg:block">
          <Card>
            <CardHeader title="At-risk list" subtitle="30–45 days. The window where a price move still works." />
            {atRisk.length === 0 ? (
              <EmptyState title="Nothing at risk" body="Every unit is either fresh or already a problem." />
            ) : (
              <div className="divide-y divide-ink-100">
                {atRisk.slice(0, 5).map((v) => (
                  <RailRow key={v.id} v={v} />
                ))}
                <Link
                  href="/admin/inventory?view=at-risk"
                  className="block px-4 py-2.5 text-center text-xs font-semibold text-ink-700 hover:bg-ink-50"
                >
                  See the whole list →
                </Link>
              </div>
            )}
          </Card>

          {water.length ? (
            <Card>
              <CardHeader
                title="Water units"
                subtitle="Into them deeper than the market will pay."
              />
              <div className="divide-y divide-ink-100">
                {water.slice(0, 4).map((v) => (
                  <RailRow key={v.id} v={v} />
                ))}
              </div>
            </Card>
          ) : null}

          {inRecon.length ? (
            <Card>
              <CardHeader title="In the recon bay" subtitle="Target is 5–7 days." />
              <div className="divide-y divide-ink-100">
                {inRecon.slice(0, 5).map((v) => (
                  <RailRow key={v.id} v={v} />
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="On the lot today" />
            <div className="flex flex-wrap gap-3 px-4 py-3.5">
              {staff.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <Avatar name={p.name} size={28} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink-900">{p.name.split(' ')[0]}</div>
                    <div className="text-[10px] text-ink-500">
                      {p.role.toLowerCase().replace('_', ' ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-500">{label}</div>
      <div
        className={cn(
          'tnum mt-0.5 text-lg font-bold tracking-tight',
          tone === 'good' ? 'text-emerald-700' : 'text-ink-900',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RailRow({ v }: { v: { id: string; stockNumber: string; price: number; salePrice: number | null; dis: number; year: number; make: string; model: string } }) {
  return (
    <Link href={`/admin/inventory/${v.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-ink-50">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-ink-900">{shortTitle(v)}</div>
        <div className="tnum truncate text-[11px] text-ink-500">
          STK {v.stockNumber} · {usd(v.salePrice ?? v.price)}
        </div>
      </div>
      <AgeBadge days={v.dis} />
    </Link>
  );
}
