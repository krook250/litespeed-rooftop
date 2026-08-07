import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgeBadge, Badge, Button, Card, CardHeader, cn } from '@/components/ui';
import { Countdown, PriceQuickEdit, SyncTicker } from '@/components/sync-bits';
import {
  getChannels,
  getGroup,
  getOpenTransfer,
  getOverrides,
  getPriceHistory,
  getRooftops,
  getSyncStatesForVehicle,
  getTransferHistory,
  sessionScope,
  getVehicleById,
  getVehicleTraffic,
} from '@/lib/queries';
import {
  SYNC_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  activePrice,
  daysInStock,
  grossPotential,
  isWaterUnit,
  num,
  priceToMarket,
  relativeTime,
  shortRooftopName,
  totalCost,
  usd,
  vehicleTitle,
} from '@/lib/domain';
import {
  addPhoto,
  cancelTransfer,
  deletePhoto,
  markFrontLineReady,
  markTransferArrived,
  reorderPhoto,
  retryListing,
  saveOverride,
  saveVehicle,
  setPrimaryPhoto,
  startTransfer,
  toggleChannel,
} from '@/lib/actions';
import { VehicleForm } from '@/components/vehicle-form';
import { PhotoAdd } from '@/components/inventory/photo-add';
import { TRANSFER_REFUSAL_MESSAGE, type TransferRefusal } from '@/lib/transfers';

export const dynamic = 'force-dynamic';

const DOT: Record<string, string> = {
  LIVE: 'bg-emerald-500',
  QUEUED: 'bg-blue-400',
  SYNCING: 'bg-blue-500',
  PENDING: 'bg-amber-400',
  ERROR: 'bg-red-500',
  EXCLUDED: 'bg-ink-300',
  NOT_LISTED: 'bg-ink-200',
  REMOVED: 'bg-ink-300',
};

export default async function VehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ move?: string }>;
}) {
  const { id } = await params;
  const { move } = await searchParams;
  const vehicle = await getVehicleById(id);
  if (!vehicle) notFound();

  const moveError = move ? TRANSFER_REFUSAL_MESSAGE[move as TransferRefusal] : undefined;

  const scope = await sessionScope();
  const [syncStates, channels, overrides, prices, traffic, group, rooftops, openTransfer, transfers] =
    await Promise.all([
      getSyncStatesForVehicle(scope, id),
      getChannels(),
      getOverrides(scope, id),
      getPriceHistory(scope, id),
      getVehicleTraffic(scope, id, 30),
      getGroup(),
      getRooftops(),
      getOpenTransfer(scope, id),
      getTransferHistory(scope, id),
    ]);

  const lotName = (rooftopId: string) => {
    const r = rooftops.find((x) => x.id === rooftopId);
    return r ? shortRooftopName(r.name, group.name) : 'another lot';
  };
  /** Sold and wholesaled units are gone; everything on the ground can move. */
  const canMove =
    rooftops.length > 1 && vehicle.status !== 'SOLD' && vehicle.status !== 'WHOLESALED';
  const otherLots = rooftops.filter((r) => r.id !== vehicle.rooftopId);

  const dis = daysInStock(vehicle, 'dateIn');
  const flDays = vehicle.frontLineDate ? daysInStock(vehicle, 'frontLine') : null;
  const reconDays = vehicle.frontLineDate
    ? Math.round(
        (new Date(vehicle.frontLineDate).getTime() - new Date(vehicle.acquiredDate).getTime()) /
          86_400_000,
      )
    : null;
  const water = isWaterUnit(vehicle);
  const ptm = priceToMarket(vehicle);
  const overrideFor = (channelId: string) => overrides.find((o) => o.channelId === channelId);

  return (
    <div className="px-6 py-6 lg:px-8">
      <Link href="/admin/inventory" className="text-xs font-medium text-ink-500 hover:text-ink-900">
        ← Inventory
      </Link>

      <header className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <img
            src={vehicle.photos[0]?.url ?? ''}
            alt=""
            width={160}
            height={107}
            className="h-[86px] w-32 rounded-lg border border-ink-200 bg-ink-100 object-cover"
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-900">
              {vehicleTitle(vehicle)}
            </h1>
            <div className="tnum mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              <span>Stock {vehicle.stockNumber}</span>
              <span className="font-mono">{vehicle.vin}</span>
              <span>{num(vehicle.mileage)} mi</span>
              <span>{vehicle.rooftop.name}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AgeBadge days={dis} />
              <Badge tone={vehicle.status === 'FRONT_LINE_READY' ? 'green' : 'amber'}>
                {VEHICLE_STATUS_LABEL[vehicle.status]}
              </Badge>
              {flDays != null ? (
                <span className="text-[11px] text-ink-500">{flDays}d on the front line</span>
              ) : null}
              {reconDays != null ? (
                <span className="text-[11px] text-ink-500">· recon took {reconDays}d</span>
              ) : null}
              {water ? <Badge tone="red">Water unit</Badge> : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <SyncTicker />
          <div className="flex items-center gap-2">
            {vehicle.status !== 'FRONT_LINE_READY' && vehicle.status !== 'PENDING_SALE' ? (
              <form action={markFrontLineReady}>
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <Button size="sm">Mark front-line ready</Button>
              </form>
            ) : null}
            <Link
              href={`/s/${vehicle.rooftop.slug.includes('battle') ? 'battle-ground' : 'vancouver'}/${vehicle.stockNumber}`}
              target="_blank"
              className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              View VDP ↗
            </Link>
          </div>
        </div>
      </header>

      {/*
        In transit. This banner is the whole reason a transfer is a row rather
        than an UPDATE: between "it left" and "it's here" the unit is somewhere
        neither lot can see it, and that is exactly the window where somebody
        walks the lot looking for a car that isn't there.
      */}
      {openTransfer ? (
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
          <span aria-hidden className="text-lg">🚛</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-violet-900">
              On the way to {lotName(openTransfer.toRooftopId)}
            </div>
            <div className="text-xs text-violet-700">
              Left {lotName(openTransfer.fromRooftopId)} {relativeTime(openTransfer.departedAt)}
              {openTransfer.note ? ` · ${openTransfer.note}` : ''} · still listed at{' '}
              {lotName(openTransfer.fromRooftopId)} until it is marked arrived.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <form action={markTransferArrived}>
              <input type="hidden" name="transferId" value={openTransfer.id} />
              <Button size="sm">Mark arrived</Button>
            </form>
            <form action={cancelTransfer}>
              <input type="hidden" name="transferId" value={openTransfer.id} />
              <Button size="sm" variant="secondary">Call it off</Button>
            </form>
          </div>
        </div>
      ) : null}

      {/* money strip */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Asking', usd(activePrice(vehicle)), vehicle.salePrice ? `was ${usd(vehicle.price)}` : ''],
          ['Cost', usd(vehicle.cost), ''],
          ['Pack', usd(vehicle.pack), ''],
          ['Recon', usd(vehicle.reconCost), ''],
          ['In it', usd(totalCost(vehicle)), water ? 'above market' : ''],
          [
            'Gross potential',
            usd(grossPotential(vehicle)),
            ptm ? `${ptm}% of market` : '',
          ],
        ].map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border border-ink-200 bg-white px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {label}
            </div>
            <div
              className={cn(
                'tnum mt-0.5 text-lg font-semibold',
                label === 'Gross potential' && grossPotential(vehicle) < 0
                  ? 'text-red-600'
                  : 'text-ink-900',
              )}
            >
              {value}
            </div>
            {hint ? <div className="text-[11px] text-ink-500">{hint}</div> : null}
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Vehicle record"
              subtitle="One record. Everything below flows to every channel that carries this unit."
            />
            <VehicleForm vehicle={vehicle} action={saveVehicle} />
          </Card>

          {/* -------------------------------------------------- photos */}
          <Card>
            <CardHeader
              title={`Photos (${vehicle.photos.length})`}
              subtitle="Lead photo drives click-through more than anything else on the listing."
              action={<PhotoAdd vehicleId={vehicle.id} action={addPhoto} />}
            />
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
              {vehicle.photos.map((p, i) => (
                <div key={p.id} className="group relative overflow-hidden rounded-lg border border-ink-200">
                  <img src={p.url} alt={p.alt} width={400} height={267} className="aspect-3/2 w-full object-cover" />
                  {p.isPrimary ? (
                    <span className="absolute left-2 top-2 rounded bg-ink-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      Lead photo
                    </span>
                  ) : null}
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-linear-to-t from-ink-950/85 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <form action={reorderPhoto}>
                      <input type="hidden" name="photoId" value={p.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button disabled={i === 0} className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-40">←</button>
                    </form>
                    <form action={reorderPhoto}>
                      <input type="hidden" name="photoId" value={p.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button disabled={i === vehicle.photos.length - 1} className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-40">→</button>
                    </form>
                    {!p.isPrimary ? (
                      <form action={setPrimaryPhoto}>
                        <input type="hidden" name="photoId" value={p.id} />
                        <button className="rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium">Make lead</button>
                      </form>
                    ) : null}
                    <form action={deletePhoto} className="ml-auto">
                      <input type="hidden" name="photoId" value={p.id} />
                      <button className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white">Delete</button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ------------------------------------ per-channel merchandising */}
          <Card>
            <CardHeader
              title="Per-channel merchandising"
              subtitle="Marketplace copy is not website copy. Override the title, the description or the price on any single channel — or pull the unit off it."
            />
            <div className="divide-y divide-ink-100">
              {channels.map((ch) => {
                const state = syncStates.find((s) => s.channels.id === ch.id);
                const o = overrideFor(ch.id);
                const status = state?.vehicle_sync_states.status ?? 'NOT_LISTED';
                const excluded = status === 'EXCLUDED';
                return (
                  <details key={ch.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-ink-50/60">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                        style={{ background: ch.brandHex }}
                      >
                        {ch.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-ink-900">{ch.shortName}</div>
                        <div className="text-[11px] text-ink-500">
                          {o?.titleOverride || o?.descriptionOverride
                            ? 'Custom copy on this channel'
                            : 'Using the default listing'}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-600">
                        <span className={cn('h-2 w-2 rounded-full', DOT[status])} />
                        {SYNC_STATUS_LABEL[status]}
                      </span>
                      <span className="text-[11px] text-ink-400 group-open:hidden">Edit</span>
                    </summary>

                    <div className="space-y-3 bg-ink-50/60 px-5 py-4">
                      <form action={saveOverride} className="space-y-2">
                        <input type="hidden" name="vehicleId" value={vehicle.id} />
                        <input type="hidden" name="channelId" value={ch.id} />
                        <label className="block text-[11px] font-medium text-ink-600">
                          Title on {ch.shortName}
                          <input
                            name="titleOverride"
                            defaultValue={o?.titleOverride ?? ''}
                            placeholder={vehicleTitle(vehicle)}
                            className="mt-1 w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-ink-900"
                          />
                        </label>
                        <label className="block text-[11px] font-medium text-ink-600">
                          Description on {ch.shortName}
                          <textarea
                            name="descriptionOverride"
                            rows={3}
                            defaultValue={o?.descriptionOverride ?? ''}
                            placeholder={vehicle.description}
                            className="mt-1 w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-ink-900"
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] font-medium text-ink-600">
                            Price override
                            <input
                              name="priceOverride"
                              defaultValue={o?.priceOverride ?? ''}
                              placeholder={String(activePrice(vehicle))}
                              className="tnum ml-2 w-28 rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-ink-900"
                            />
                          </label>
                          <Button size="sm" variant="secondary" className="ml-auto">
                            Save {ch.shortName} copy
                          </Button>
                        </div>
                      </form>

                      <div className="flex items-center justify-between border-t border-ink-200 pt-3">
                        <div className="text-[11px] text-ink-500">
                          {state?.vehicle_sync_states.remoteUrl ? (
                            <Link
                              href={state.vehicle_sync_states.remoteUrl}
                              target="_blank"
                              className="font-medium text-ink-700 hover:underline"
                            >
                              View the live listing ↗
                            </Link>
                          ) : (
                            <span>{ch.blurb}</span>
                          )}
                        </div>
                        <form action={toggleChannel}>
                          <input type="hidden" name="vehicleId" value={vehicle.id} />
                          <input type="hidden" name="channelId" value={ch.id} />
                          <input type="hidden" name="excluded" value={excluded ? 'false' : 'true'} />
                          <button
                            className={cn(
                              'rounded-md px-2.5 py-1 text-[11px] font-semibold',
                              excluded
                                ? 'bg-ink-900 text-white hover:bg-ink-800'
                                : 'border border-ink-300 bg-white text-ink-700 hover:bg-ink-50',
                            )}
                          >
                            {excluded ? `Put back on ${ch.shortName}` : `Remove from ${ch.shortName}`}
                          </button>
                        </form>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------ sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Reprice" subtitle="Goes out to every channel carrying this unit." />
            <div className="px-5 py-4">
              <PriceQuickEdit vehicleId={vehicle.id} price={activePrice(vehicle)} />
              <p className="mt-2 text-[11px] leading-snug text-ink-500">
                Dropping below the list price keeps the original as a strike-through on the VDP.
              </p>
            </div>
          </Card>

          {/*
            Moving a unit between the group's own lots. Only rendered for a
            multi-rooftop dealer, because for a single-lot store there is
            nowhere to move it to and the control would be noise.
          */}
          {canMove && !openTransfer && otherLots.length ? (
            <Card>
              <CardHeader
                title="Move to another lot"
                subtitle="Stays listed here until it's marked arrived, so the unit never goes dark mid-move."
              />
              {moveError ? (
                <p className="border-b border-red-200 bg-red-50 px-5 py-2 text-[11px] font-medium text-red-700">
                  {moveError}
                </p>
              ) : null}
              <form action={startTransfer} className="space-y-3 px-5 py-4">
                <input type="hidden" name="vehicleId" value={vehicle.id} />
                <label className="block text-[11px] font-medium text-ink-600">
                  Sending it to
                  <select
                    name="toRooftopId"
                    className="mt-1 w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-ink-900"
                  >
                    {otherLots.map((r) => (
                      <option key={r.id} value={r.id}>
                        {shortRooftopName(r.name, group.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] font-medium text-ink-600">
                  Why (optional)
                  <input
                    name="note"
                    placeholder="Better traffic for trucks on that lot"
                    className="mt-1 w-full rounded-md border border-ink-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-ink-900"
                  />
                </label>
                <label className="flex items-start gap-2 text-[11px] text-ink-600">
                  <input type="checkbox" name="arriveNow" className="mt-0.5" />
                  <span>
                    It&rsquo;s already there — close the move out now instead of marking it
                    arrived later.
                  </span>
                </label>
                <Button size="sm" className="w-full">
                  Start the move
                </Button>
              </form>
            </Card>
          ) : null}

          {transfers.length ? (
            <Card>
              <CardHeader title="Lot history" />
              <ul className="divide-y divide-ink-100">
                {transfers.map((tr) => (
                  <li key={tr.id} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate text-ink-700">
                        {lotName(tr.fromRooftopId)} → {lotName(tr.toRooftopId)}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-[10px] font-semibold',
                          tr.cancelledAt
                            ? 'text-ink-400'
                            : tr.arrivedAt
                              ? 'text-emerald-700'
                              : 'text-violet-700',
                        )}
                      >
                        {tr.cancelledAt ? 'Called off' : tr.arrivedAt ? 'Arrived' : 'In transit'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-500">
                      Left {relativeTime(tr.departedAt)}
                      {tr.arrivedAt ? ` · arrived ${relativeTime(tr.arrivedAt)}` : ''}
                      {tr.note ? ` · ${tr.note}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Channel status" />
            <ul className="divide-y divide-ink-100">
              {syncStates.map((s) => {
                const st = s.vehicle_sync_states;
                return (
                  <li key={st.id} className="flex items-center gap-2.5 px-5 py-2.5">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[st.status], st.status === 'SYNCING' && 'pulse-ring')} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-ink-900">{s.channels.shortName}</div>
                      <div className="truncate text-[10px] text-ink-500">
                        {st.errorMessage
                          ? st.errorMessage
                          : st.status === 'QUEUED' || st.status === 'SYNCING'
                            ? s.channels.syncMode === 'PUSH_API'
                              ? 'Pushing now'
                              : 'Waiting for next feed fetch'
                            : st.status === 'LIVE' && st.lastSyncedAt
                              ? `synced ${relativeTime(st.lastSyncedAt)}`
                              : SYNC_STATUS_LABEL[st.status]}
                      </div>
                    </div>
                    {st.dueAt ? (
                      <span className="shrink-0 text-[10px]">
                        <Countdown to={st.dueAt.toISOString()} />
                      </span>
                    ) : null}
                    {st.status === 'ERROR' ? (
                      <form action={retryListing}>
                        <input type="hidden" name="syncStateId" value={st.id} />
                        <button className="shrink-0 rounded border border-ink-300 px-1.5 py-0.5 text-[10px] font-medium text-ink-700 hover:bg-ink-50">
                          Retry
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Traffic · 30 days" />
            <div className="grid grid-cols-3 divide-x divide-ink-100">
              {[
                ['VDP views', traffic.vdpViews],
                ['Leads', traffic.leads],
                ['Saves', traffic.saves],
              ].map(([label, value]) => (
                <div key={String(label)} className="px-4 py-3 text-center">
                  <div className="tnum text-lg font-semibold text-ink-900">{num(Number(value))}</div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Price history" />
            {prices.length === 0 ? (
              <p className="px-5 py-4 text-xs text-ink-500">
                No repricing yet. Listed at {usd(vehicle.price)} since day one.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {prices.map((p) => (
                  <li key={p.id} className="px-5 py-2.5">
                    <div className="tnum flex items-center justify-between text-xs">
                      <span className="text-ink-500 line-through">{usd(p.oldPrice)}</span>
                      <span className="text-ink-400">→</span>
                      <span
                        className={cn(
                          'font-semibold',
                          p.newPrice < p.oldPrice ? 'text-emerald-700' : 'text-red-600',
                        )}
                      >
                        {usd(p.newPrice)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-ink-500">
                      <span>{p.reason ?? 'Repriced'}</span>
                      <span>{relativeTime(p.changedAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
