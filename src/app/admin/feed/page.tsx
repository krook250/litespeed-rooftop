import Link from 'next/link';
import { AgeBadge, Card, CardHeader, EmptyState, cn } from '@/components/ui';
import { Avatar, Composer } from '@/components/feed/bits';
import { FeedPost, FeedRollup } from '@/components/feed/card';
import { LogRow } from '@/components/feed/log-row';
import { FeedStyleSwitch } from '@/components/feed/feed-style';
import { HomePreference } from '@/components/feed/home-preference';
import { Scoreboard, TodaysBoard } from '@/components/feed/scoreboard';
import { requireSession } from '@/lib/auth';
import {
  getGroup,
  getLiveInventory,
  getOpenTransfers,
  getRooftops,
  getSalesSince,
  getStorefronts,
  getTrafficByDay,
  resolveFeedStyle,
  sessionScope,
} from '@/lib/queries';
import { getFeed, groupFeed, sweepDerivedFeedEvents } from '@/lib/feed';
import { markTransferArrived } from '@/lib/actions';
import type { FeedEventKind } from '@/db/schema';
import { db } from '@/db';
import * as t from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  TURN_BENCHMARK,
  daysInStock,
  daysSupply,
  isAtRisk,
  isWaterUnit,
  relativeTime,
  shortRooftopName,
  shortTitle,
  totalCost,
  turnRate,
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
  {
    key: 'lot',
    label: 'The lot',
    kinds: [
      'acquired', 'recon_in', 'recon_out', 'photos', 'front_line',
      'transfer_out', 'transfer_inbound', 'transfer_in',
    ],
  },
  { key: 'channels', label: 'Channels', kinds: ['sync_error', 'vdp_milestone', 'domain'] },
  { key: 'people', label: 'People', kinds: ['team', 'note', 'bell'] },
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

  /**
   * Lot Walk and the activity log are the same query. Everything below this
   * line — the events, the filters, the numbers, the rail — is shared; only the
   * component that draws a row changes, and `withSocial` drops two queries the
   * log would never render. That is the whole point of the split: a store that
   * grows into the social view flips a setting rather than migrating anything.
   */
  const { style, houseStyle, isOverride } = await resolveFeedStyle(me);
  const isLog = style === 'LOG';

  const [group, rooftops, inventory, sales, cards, inTransit, storefronts, traffic7] =
    await Promise.all([
      getGroup(),
      getRooftops(),
      getLiveInventory(),
      getSalesSince(30),
      getFeed({
        rooftopIds: scope.rooftopIds,
        viewerId: me.id,
        // A log is scanned, a feed is read. Denser rows earn a longer page.
        limit: isLog ? 120 : 40,
        kinds: filter.kinds,
        withSocial: !isLog,
      }),
      getOpenTransfers(scope),
      getStorefronts(),
      // Only the scoreboard reads this, and only Lot Walk draws the scoreboard —
      // but it is one grouped scan of a daily-stats table, so it rides along in
      // the same Promise.all rather than earning a waterfall for the sake of it.
      getTrafficByDay(7, { rooftopIds: scope.rooftopIds }),
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

  /* ------------------------------------------------------------ scoreboard */
  const freshAir = withDays.filter((v) => v.dis < 15).length;
  const aging46to60 = withDays.filter((v) => v.dis >= 46 && v.dis <= 60).length;
  const frontLine = withDays.filter((v) => v.status === 'FRONT_LINE_READY').length;
  const avgDays = withDays.length
    ? Math.round(withDays.reduce((s, v) => s + v.dis, 0) / withDays.length)
    : null;
  /**
   * Only a custom domain makes a shareable address — see `vdpUrl` in the card.
   * First storefront wins: a group with several is choosing which brand it
   * posts under, and that is a setting, not a guess this page should make.
   */
  const shareBase = storefronts.find((sf) => sf.domain)?.domain ?? null;

  const vdpViews7 = traffic7.reduce((s, r) => s + r.vdpViews, 0);
  const leads7 = traffic7.reduce((s, r) => s + r.leads, 0);

  return (
    <div className={cn('mx-auto px-4 py-5 lg:px-6', isLog ? 'max-w-[1650px]' : 'max-w-[1400px]')}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-900">
            {isLog ? 'Activity' : 'Lot Walk'}
          </h1>
          <p className="text-sm text-ink-500">
            {group.name} · {withDays.length} units on the ground across{' '}
            {rooftops.length} rooftop{rooftops.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <FeedStyleSwitch
            style={style}
            houseStyle={houseStyle}
            isOverride={isOverride}
            role={me.role}
          />
          <HomePreference current={me.homeView} thisView="FEED" />
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/*
            Two different jobs, so two different headers. The log wants the four
            money figures it has always had — it is a register, and a register
            is read for what it recorded. Lot Walk wants a scoreboard: how the
            lot is *doing*, with a benchmark under each number. The money moves
            to Today's Board in the rail, so nothing is lost either way.
          */}
          {isLog ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Sold today" value={String(soldToday)} />
              <Tile label="Sold 30d" value={String(sales.length)} />
              <Tile label="Front gross 30d" value={usd(grossMtd)} tone={grossMtd > 0 ? 'good' : undefined} />
              <Tile label="Money on the ground" value={usd(tiedUp)} />
            </div>
          ) : (
            <Scoreboard
              liveCount={withDays.length}
              sold30={sales.length}
              daysSupply={daysSupply(withDays.length, sales.length, 30)}
              turnRate={turnRate(sales.length, 30, withDays.length)}
              turnBenchmark={TURN_BENCHMARK.strong}
              avgDays={avgDays}
              freshAir={freshAir}
              atRisk={atRisk.length}
              aging46to60={aging46to60}
              frontLine={frontLine}
              inRecon={inRecon.length}
              vdpViews7={vdpViews7}
              leads7={leads7}
            />
          )}

          {/* The composer is the social layer, not the record. A log-mode store
              still gets every system event; what it does not get is a box
              inviting people to post to each other. */}
          {isLog ? null : (
            <Composer
              me={me.name}
              rooftops={rooftops.map((r) => ({
                id: r.id,
                name: shortRooftopName(r.name, group.name),
              }))}
            />
          )}

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
                body={
                  isLog
                    ? 'Add a unit and the log starts writing itself — acquired, into recon, photos up, front-line ready, priced, sold.'
                    : 'Add a unit and the feed starts writing itself — acquired, into recon, photos up, front-line ready, priced, sold.'
                }
              />
            </Card>
          ) : isLog ? (
            <Card className="overflow-hidden">
              <div className="divide-y divide-ink-100">
                {cards.map((card) => (
                  <LogRow key={card.event.id} card={card} />
                ))}
              </div>
              <p className="border-t border-ink-100 bg-ink-50 px-4 py-2 text-center text-[11px] text-ink-500">
                Last {cards.length} entries. Same record as Lot Walk — only the layout differs.
              </p>
            </Card>
          ) : (
            <div className="space-y-4">
              {/*
                Grouped only here. The log above draws one row per event on
                purpose — see `groupFeed`. A group of one renders as an ordinary
                card, so nothing about a normal day changes.
              */}
              {groupFeed(cards).map((g) =>
                g.cards.length > 1 ? (
                  <FeedRollup
                    key={g.anchor.event.id}
                    group={g}
                    me={me.name}
                    dealer={group.name}
                    shareBase={shareBase ? `https://${shareBase}` : null}
                  />
                ) : (
                  <FeedPost
                    key={g.anchor.event.id}
                    card={g.anchor}
                    me={me.name}
                    dealer={group.name}
                    shareBase={shareBase ? `https://${shareBase}` : null}
                  />
                ),
              )}
              <p className="py-2 text-center text-xs text-ink-500">
                That is the last {cards.length} cards. The feed only shows things that moved money.
              </p>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- right rail */}
        <aside className="hidden space-y-4 lg:block">
          {isLog ? null : (
            <TodaysBoard
              soldToday={soldToday}
              soldMtd={sales.length}
              grossMtd={usd(grossMtd)}
              inventoryValue={usd(tiedUp)}
            />
          )}

          {/*
            On a truck right now. This is a rail and not a feed card on purpose:
            one move is already two cards (left / arrived) and a third at
            departure would be the activity theater section 2 warns about. But
            the receiving lot needs to know a unit is coming *before* it shows
            up, and this is where a porter finds out.
          */}
          {inTransit.length ? (
            <Card>
              <CardHeader
                title="On the way"
                subtitle="Left one lot, not yet marked arrived at the other."
              />
              <div className="divide-y divide-ink-100">
                {inTransit.map(({ transfer, vehicle, fromName }) => (
                  <div key={transfer.id} className="px-4 py-2.5">
                    <Link href={`/admin/inventory/${vehicle.id}`} className="block hover:opacity-80">
                      <div className="truncate text-xs font-bold text-ink-900">
                        {shortTitle(vehicle)}
                      </div>
                      <div className="tnum truncate text-[11px] text-ink-500">
                        STK {vehicle.stockNumber} · from{' '}
                        {shortRooftopName(fromName, group.name)} ·{' '}
                        {relativeTime(transfer.departedAt)}
                      </div>
                    </Link>
                    <form action={markTransferArrived} className="mt-1.5">
                      <input type="hidden" name="transferId" value={transfer.id} />
                      <button className="rounded-md bg-ink-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-ink-800">
                        Mark arrived
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

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

          {/* Faces are the morale feature, and the morale feature is the thing
              the small store did not ask for. Everything else in this rail —
              at-risk, water, recon, inbound — is management information and
              stays in both views. */}
          {isLog ? null : (
            <Card>
              <CardHeader title="On the lot today" />
              <div className="flex flex-wrap gap-3 px-4 py-3.5">
                {staff.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <Avatar name={p.name} size={28} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink-900">
                        {p.name.split(' ')[0]}
                      </div>
                      <div className="text-[10px] text-ink-500">
                        {p.role.toLowerCase().replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
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
