import Link from 'next/link';
import { Card, CardHeader, Badge, cn, EmptyState } from '@/components/ui';
import { Countdown, PriceQuickEdit, SyncTicker } from '@/components/sync-bits';
import { UnitSyncList, type SyncUnit } from '@/components/syndication/unit-sync-row';
import {
  getChannels,
  getConnections,
  getLiveInventory,
  getRecentEvents,
  getRooftops,
  getSyncMatrix,
  sessionScope,
} from '@/lib/queries';
import {
  SYNC_STATUS_LABEL,
  CONNECTION_STATUS_LABEL,
  activePrice,
  carriesListings,
  relativeTime,
  shortTitle,
  usd,
} from '@/lib/domain';
import { forceRefresh, repairConnection, retryListing } from '@/lib/actions';
import { requireSection } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

const CELL: Record<string, string> = {
  LIVE: 'bg-emerald-500',
  QUEUED: 'bg-blue-400',
  SYNCING: 'bg-blue-500',
  PENDING: 'bg-amber-400',
  ERROR: 'bg-red-500',
  EXCLUDED: 'bg-ink-300',
  NOT_LISTED: 'bg-ink-200',
  REMOVED: 'bg-ink-300',
};

const CELL_RING: Record<string, string> = {
  LIVE: 'ring-emerald-600/20',
  QUEUED: 'ring-blue-500/30',
  SYNCING: 'ring-blue-600/40',
  PENDING: 'ring-amber-500/30',
  ERROR: 'ring-red-600/30',
};

export default async function SyndicationPage({
  searchParams,
}: {
  searchParams: Promise<{ rooftop?: string }>;
}) {
  await requireSection('syndication');
  const { rooftop: rooftopSlug } = await searchParams;

  const [channels, connections, rooftops, events] = await Promise.all([
    getChannels(),
    getConnections(),
    getRooftops(),
    getRecentEvents(24),
  ]);

  const activeRooftop = rooftops.find((r) => r.slug === rooftopSlug) ?? null;
  const inventory = await getLiveInventory(
    activeRooftop ? { rooftopIds: [activeRooftop.id] } : {},
  );
  const matrix = await getSyncMatrix(await sessionScope(), inventory.map((v) => v.id));

  // vehicleId -> channelId -> state
  const grid = new Map<string, Map<string, (typeof matrix)[number]>>();
  for (const row of matrix) {
    const v = grid.get(row.vehicle_sync_states.vehicleId) ?? new Map();
    v.set(row.channels.id, row);
    grid.set(row.vehicle_sync_states.vehicleId, v);
  }

  const shownConnections = connections.filter(
    (c) => !activeRooftop || c.channel_connections.rooftopId === activeRooftop.id,
  );

  /**
   * Only channels this dealer actually has a connection to.
   *
   * `getChannels()` returns the platform's whole catalogue — every destination
   * Rooftop supports, whether or not this dealer has asked for any of them.
   * Rendering that list unfiltered is how a freshly onboarded lot with zero
   * connections sees nine cards reading "0 live" and concludes the product is
   * broken. It is not broken; nothing has been set up. Those are very different
   * sentences and the screen was telling the wrong one.
   *
   * (It cost a real debugging session: nine cards at zero read as nine failing
   * connections, when the truth was that the connections did not exist.)
   *
   * A channel appears once ANY shown rooftop is connected to it, so the
   * "All rooftops" view is the union rather than the intersection — a channel one
   * lot uses should not vanish because the other lot does not.
   */
  const connectedChannelIds = new Set(shownConnections.map((c) => c.channels.id));
  const visibleChannels = channels.filter((ch) => connectedChannelIds.has(ch.id));

  /**
   * The same grid, flattened for the phone. Built here rather than in the JSX
   * so the mobile list and the desktop matrix are visibly reading one source —
   * two shapes of the same data drifting apart is exactly how a screen starts
   * telling two different stories about the same lot.
   */
  const syncUnits: SyncUnit[] = inventory.map((v) => {
    const row = grid.get(v.id);
    return {
      vehicleId: v.id,
      title: shortTitle(v),
      stockNumber: v.stockNumber,
      city: v.rooftop.city,
      price: activePrice(v),
      cells: visibleChannels.map((ch) => {
        const cell = row?.get(ch.id);
        const st = cell?.vehicle_sync_states;
        const status = st?.status ?? 'NOT_LISTED';
        return {
          channelId: ch.id,
          name: ch.name,
          initials: ch.initials,
          brandHex: ch.brandHex,
          status,
          stale: status === 'LIVE' && cell?.channel_connections.status === 'ERROR',
          remoteUrl: st?.remoteUrl ?? null,
          errorMessage: st?.errorMessage ?? null,
          lastSyncedAt: st?.lastSyncedAt ?? null,
        };
      }),
    };
  });

  const tally = (channelId: string) => {
    const counts: Record<string, number> = {};
    for (const v of inventory) {
      const s = grid.get(v.id)?.get(channelId)?.vehicle_sync_states.status ?? 'NOT_LISTED';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  };

  const inFlight = matrix.filter((m) =>
    ['QUEUED', 'SYNCING', 'PENDING'].includes(m.vehicle_sync_states.status),
  ).length;
  const errored = matrix.filter((m) => m.vehicle_sync_states.status === 'ERROR');
  const brokenConnections = shownConnections.filter(
    (c) => c.channel_connections.status === 'ERROR',
  );

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Syndication</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            One inventory record, every channel. Change a price here and it goes out to every
            destination that is carrying the unit — instantly where the channel accepts a push,
            at the next fetch where the channel pulls a feed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SyncTicker />
        </div>
      </header>

      {/* rooftop filter */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500">Rooftop</span>
        <Link
          href="/admin/syndication"
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset',
            !activeRooftop ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
          )}
        >
          All rooftops
        </Link>
        {rooftops.map((r) => (
          <Link
            key={r.id}
            href={`/admin/syndication?rooftop=${r.slug}`}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset',
              activeRooftop?.id === r.id
                ? 'bg-ink-900 text-white ring-ink-900'
                : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
            )}
          >
            {r.name}
          </Link>
        ))}
        <span className="ml-auto text-xs text-ink-500">
          <span className="tnum font-semibold text-ink-900">{inventory.length}</span> units ·{' '}
          <span className="tnum font-semibold text-ink-900">{inFlight}</span> changes in flight ·{' '}
          <span className={cn('tnum font-semibold', errored.length ? 'text-red-600' : 'text-ink-900')}>
            {errored.length}
          </span>{' '}
          listing errors
        </span>
      </div>

      {brokenConnections.length ? (
        <div className="mb-5 space-y-2">
          {brokenConnections.map((c) => (
            <div
              key={c.channel_connections.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
            >
              <span className="text-sm font-semibold text-red-800">
                {c.channels.name} — {c.rooftops.name}
              </span>
              <span className="text-xs text-red-700">{c.channel_connections.errorMessage}</span>
              <form action={repairConnection} className="ml-auto">
                <input type="hidden" name="connectionId" value={c.channel_connections.id} />
                <button className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                  Reconnect
                </button>
              </form>
            </div>
          ))}
        </div>
      ) : null}

      {/* ------------------------------------------------------- channels */}
      {visibleChannels.length === 0 ? (
        <div className="mb-6">
          <EmptyState
            title="No channels connected yet"
            body={
              inventory.length > 0
                ? `Your ${inventory.length} ${inventory.length === 1 ? 'vehicle is' : 'vehicles are'} on your own website. Nothing is going out to a marketplace until we connect one — we do that for you, so ask and we will set it up.`
                : 'Add inventory first, then we will connect the marketplaces you want to appear on.'
            }
          />
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleChannels.map((ch) => {
          const counts = tally(ch.id);
          const conns = shownConnections.filter((c) => c.channels.id === ch.id);
          const anyError = conns.some((c) => c.channel_connections.status === 'ERROR');
          const anyOffline = conns.some(
            (c) => !carriesListings(c.channel_connections.status),
          );
          const feedConn = conns.find(
            (c) => c.channel_connections.status === 'CONNECTED' && ch.syncMode === 'FEED_PULL',
          );
          // Feed channels fetch on a fixed cadence. If the stored fetch time has
          // already passed, roll forward to the next real boundary.
          const nextFetch = feedConn
            ? (() => {
                const cadence = Math.max(15, ch.cadenceMinutes) * 60_000;
                const stored = feedConn.channel_connections.nextSyncAt?.getTime();
                let next = stored ?? Date.now() + cadence;
                while (next <= Date.now()) next += cadence;
                return new Date(next).toISOString();
              })()
            : null;

          return (
            <Card key={ch.id} className="p-4">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                  style={{ background: ch.brandHex }}
                >
                  {ch.initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-ink-900">{ch.shortName}</h3>
                    {ch.syncMode === 'PUSH_API' ? (
                      <Badge tone="green">Push</Badge>
                    ) : (
                      <Badge tone="blue">
                        Feed · {ch.cadenceMinutes >= 60 ? `${Math.round(ch.cadenceMinutes / 60)}h` : `${ch.cadenceMinutes}m`}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-ink-500">{ch.blurb}</p>
                </div>
              </div>

              <div className="tnum mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="font-semibold text-ink-900">{counts.LIVE ?? 0}</span>
                  <span className="text-ink-500">live</span>
                </span>
                {(counts.QUEUED ?? 0) + (counts.SYNCING ?? 0) + (counts.PENDING ?? 0) > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="font-semibold text-ink-900">
                      {(counts.QUEUED ?? 0) + (counts.SYNCING ?? 0) + (counts.PENDING ?? 0)}
                    </span>
                    <span className="text-ink-500">in flight</span>
                  </span>
                ) : null}
                {counts.ERROR ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    <span className="font-semibold text-red-600">{counts.ERROR}</span>
                    <span className="text-ink-500">error</span>
                  </span>
                ) : null}
                {counts.EXCLUDED ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-ink-300" />
                    <span className="font-semibold text-ink-700">{counts.EXCLUDED}</span>
                    <span className="text-ink-500">excluded</span>
                  </span>
                ) : null}
              </div>

              <div className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
                {conns.map((c) => (
                  // The whole row is the target rather than a trailing chevron:
                  // on a phone in a dealership office this is the difference
                  // between the setup screen being reachable and not.
                  <Link
                    key={c.channel_connections.id}
                    href={`/admin/syndication/${c.channel_connections.id}`}
                    className="-mx-1 flex items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-ink-50"
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        c.channel_connections.status === 'CONNECTED' && 'bg-emerald-500',
                        c.channel_connections.status === 'ERROR' && 'bg-red-500',
                        c.channel_connections.status === 'DISCONNECTED' && 'bg-ink-300',
                        c.channel_connections.status === 'PENDING_SETUP' && 'bg-amber-400',
                        // Amber-500 rather than 400: this is the one state where
                        // nothing moves unless somebody picks up the phone.
                        c.channel_connections.status === 'AWAITING_DEALER' && 'bg-amber-500',
                        c.channel_connections.status === 'SUBMITTED' && 'bg-sky-400',
                      )}
                    />
                    <span className="truncate text-ink-600">
                      {c.rooftops.name}
                    </span>
                    <span className="ml-auto shrink-0 text-ink-400">
                      {c.channel_connections.status === 'CONNECTED'
                        ? `synced ${relativeTime(c.channel_connections.lastSyncAt)}`
                        : CONNECTION_STATUS_LABEL[c.channel_connections.status]}
                    </span>
                  </Link>
                ))}
              </div>

              {feedConn ? (
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
                  <span className="text-[11px] text-ink-500">
                    Next fetch <Countdown to={nextFetch} prefix="in " />
                  </span>
                  <form action={forceRefresh}>
                    <input type="hidden" name="connectionId" value={feedConn.channel_connections.id} />
                    <button className="rounded-md border border-ink-300 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-50">
                      Rebuild feed now
                    </button>
                  </form>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {/* --------------------------------------------------------- matrix */}
      {/* A grid of "every unit against every channel" with no channels is a
          table of two columns and a promise nobody kept. Hidden until there is
          at least one connection to be a column. */}
      {visibleChannels.length === 0 ? null : (
      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Per-VIN sync status"
          subtitle="Every unit against every channel. Edit a price on the left and watch the row move."
          action={
            <div className="hidden flex-wrap items-center gap-3 text-[11px] text-ink-500 md:flex">
              {[
                ['LIVE', 'Live'],
                ['SYNCING', 'In flight'],
                ['PENDING', 'Waiting'],
                ['ERROR', 'Error'],
                ['EXCLUDED', 'Excluded'],
                ['NOT_LISTED', 'Not listed'],
              ].map(([k, label]) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className={cn('h-2.5 w-2.5 rounded-sm', CELL[k]!)} />
                  {label}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 opacity-45 ring-1 ring-red-500" />
                Live but stale
              </span>
            </div>
          }
        />
        {/* The matrix is a hover surface: every cell's meaning is in a title
            attribute, and a touch screen has no hover. The phone gets labelled
            chips, collapsed per unit, with the error text spelled out. */}
        <div className="md:hidden">
          <UnitSyncList units={syncUnits} showCity={rooftops.length > 1} />
        </div>

        <div className="scroll-thin hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1000px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50/60">
                <th className="sticky left-0 z-10 bg-ink-50 px-4 py-2.5 text-left text-xs font-semibold text-ink-600">
                  Unit
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-ink-600">Price</th>
                {visibleChannels.map((ch) => (
                  <th key={ch.id} className="px-2 py-2.5 text-center">
                    <div
                      className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold text-white"
                      style={{ background: ch.brandHex }}
                      title={`${ch.name} — ${ch.syncMode === 'PUSH_API' ? 'real-time push' : `feed pull every ${ch.cadenceMinutes} min`}`}
                    >
                      {ch.initials}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inventory.map((v) => {
                const row = grid.get(v.id);
                const rowInFlight = channels.some((ch) =>
                  ['QUEUED', 'SYNCING'].includes(row?.get(ch.id)?.vehicle_sync_states.status ?? ''),
                );
                return (
                  <tr
                    key={v.id}
                    className={cn(
                      'border-b border-ink-100 transition-colors',
                      rowInFlight ? 'bg-blue-50/60' : 'hover:bg-ink-50/60',
                    )}
                  >
                    <td className="sticky left-0 z-10 bg-white px-4 py-2">
                      <Link href={`/admin/inventory/${v.id}`} className="block group">
                        <div className="text-xs font-semibold text-ink-900 group-hover:underline">
                          {shortTitle(v)}
                        </div>
                        <div className="tnum text-[11px] text-ink-500">
                          {v.stockNumber} · {v.rooftop.city}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <PriceQuickEdit vehicleId={v.id} price={activePrice(v)} compact />
                    </td>
                    {visibleChannels.map((ch) => {
                      const cell = row?.get(ch.id);
                      const status = cell?.vehicle_sync_states.status ?? 'NOT_LISTED';
                      const s = cell?.vehicle_sync_states;
                      // The listing is up, but the connection is broken, so
                      // nothing we change here is reaching it. Say so.
                      const stale =
                        status === 'LIVE' && cell?.channel_connections.status === 'ERROR';
                      const title = [
                        `${ch.name}: ${SYNC_STATUS_LABEL[status]}`,
                        stale ? 'listing is live but stale — the connection needs attention' : '',
                        s?.errorMessage ?? '',
                        s?.lastSyncedAt ? `last synced ${relativeTime(s.lastSyncedAt)}` : '',
                      ]
                        .filter(Boolean)
                        .join(' — ');
                      const dot = (
                        <span
                          className={cn(
                            'mx-auto block h-5 w-5 rounded-md ring-2 transition-all',
                            CELL[status],
                            stale ? 'opacity-45 ring-red-500' : CELL_RING[status] ?? 'ring-transparent',
                            status === 'SYNCING' && 'pulse-ring',
                          )}
                          title={title}
                        />
                      );
                      return (
                        <td key={ch.id} className="px-2 py-2 text-center">
                          {status === 'LIVE' && s?.remoteUrl ? (
                            <Link href={s.remoteUrl} target="_blank" title={title}>
                              {dot}
                            </Link>
                          ) : (
                            dot
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ------------------------------------------------------- errors */}
        <Card>
          <CardHeader
            title="Listings needing attention"
            subtitle="A channel rejected these. Nothing is live until they clear."
          />
          {errored.length === 0 ? (
            <EmptyState title="Nothing rejected" body="Every listing on every connected channel is current." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {errored.map((e) => {
                const v = inventory.find((x) => x.id === e.vehicle_sync_states.vehicleId);
                return (
                  <li key={e.vehicle_sync_states.id} className="flex items-start gap-3 px-5 py-3">
                    <div
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                      style={{ background: e.channels.brandHex }}
                    >
                      {e.channels.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-ink-900">
                        {v ? shortTitle(v) : 'Unit'}{' '}
                        <span className="tnum font-normal text-ink-500">
                          {v?.stockNumber}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-red-700">
                        {e.vehicle_sync_states.errorMessage}
                      </p>
                    </div>
                    <form action={retryListing}>
                      <input type="hidden" name="syncStateId" value={e.vehicle_sync_states.id} />
                      <button className="shrink-0 rounded-md border border-ink-300 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-50">
                        Retry
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ----------------------------------------------------- activity */}
        <Card>
          <CardHeader
            title="Activity log"
            subtitle="Append-only. Every push, pull and rejection, per unit per channel."
          />
          <ul className="scroll-thin max-h-[28rem] divide-y divide-ink-100 overflow-y-auto">
            {events.map((e) => (
              <li key={e.sync_events.id} className="flex items-start gap-3 px-5 py-2.5">
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    CELL[e.sync_events.status] ?? 'bg-ink-300',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-900">
                    <span className="font-semibold">{e.channels.shortName}</span>{' '}
                    <span className="text-ink-500">·</span>{' '}
                    {e.vehicles.year} {e.vehicles.make} {e.vehicles.model}{' '}
                    <span className="tnum text-ink-500">{e.vehicles.stockNumber}</span>
                  </div>
                  <div className="text-[11px] leading-snug text-ink-500">
                    {e.sync_events.message}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-ink-400">
                  {relativeTime(e.sync_events.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <p className="mt-6 max-w-3xl text-xs leading-relaxed text-ink-500">
        <strong className="font-semibold text-ink-700">On timing:</strong> push channels accept a
        change over their API and it lands in seconds. Feed channels fetch on their own schedule —
        rebuilding the feed does not make them read it any sooner, and any tool that shows you an
        instant green check on a feed channel is showing you its own queue, not the listing.
      </p>
    </div>
  );
}
