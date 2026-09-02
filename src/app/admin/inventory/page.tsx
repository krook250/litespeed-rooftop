import Link from 'next/link';
import { AgeBadge, AgingBar, Badge, Card, CardHeader, EmptyState, cn } from '@/components/ui';
import { UnitCard } from '@/components/inventory/unit-card';
import {
  agingCounts,
  getLiveInventory,
  getRooftops,
  getSyncMatrix,
  sessionScope,
  getTrafficPerVehicle,
} from '@/lib/queries';
import {
  AGING_BUCKETS,
  VEHICLE_STATUS_LABEL,
  activePrice,
  bucketFor,
  daysInStock,
  grossPotential,
  hasCost,
  isAtRisk,
  isWaterUnit,
  num,
  shortTitle,
  totalCost,
  usd,
  type DisMode,
} from '@/lib/domain';
import { requireSection } from '@/lib/auth-guard';
import { can } from '@/lib/permissions';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SP = {
  view?: string;
  rooftop?: string;
  bucket?: string;
  status?: string;
  q?: string;
  clock?: string;
  sort?: string;
};

function qs(base: SP, patch: Partial<SP>) {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base, ...patch })) {
    if (v) merged[k] = String(v);
  }
  const s = new URLSearchParams(merged).toString();
  return s ? `/admin/inventory?${s}` : '/admin/inventory';
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireSection('inventory');
  const sp = await searchParams;

  /*
   * The at-risk view is its own section. Everyone who can open the inventory
   * can look a unit up; the aging list is a management screen and is gated
   * separately — so the guard has to be on the *view*, not just the route.
   */
  if (sp.view === 'at-risk' && !can(me.role, 'at-risk')) redirect('/admin/inventory');
  const clock: DisMode = sp.clock === 'frontLine' ? 'frontLine' : 'dateIn';

  const [rooftops, all] = await Promise.all([getRooftops(), getLiveInventory()]);
  const traffic = await getTrafficPerVehicle(30);
  const matrix = await getSyncMatrix(await sessionScope(), all.map((v) => v.id));

  const liveCount = new Map<string, number>();
  const errCount = new Map<string, number>();
  for (const m of matrix) {
    const id = m.vehicle_sync_states.vehicleId;
    if (m.vehicle_sync_states.status === 'LIVE') liveCount.set(id, (liveCount.get(id) ?? 0) + 1);
    if (m.vehicle_sync_states.status === 'ERROR') errCount.set(id, (errCount.get(id) ?? 0) + 1);
  }

  const activeRooftop = rooftops.find((r) => r.slug === sp.rooftop) ?? null;

  let rows = all.map((v) => ({ ...v, dis: daysInStock(v, clock) }));

  if (activeRooftop) rows = rows.filter((v) => v.rooftopId === activeRooftop.id);
  if (sp.view === 'at-risk') rows = rows.filter((v) => isAtRisk(v.dis));
  if (sp.view === 'water') rows = rows.filter(isWaterUnit);
  if (sp.view === 'recon') rows = rows.filter((v) => v.status === 'IN_RECON' || v.status === 'ARRIVED' || v.status === 'PHOTOS_PENDING');
  if (sp.bucket) rows = rows.filter((v) => bucketFor(v.dis)!.key === sp.bucket);
  if (sp.status) rows = rows.filter((v) => v.status === sp.status);
  if (sp.q) {
    const q = sp.q.toLowerCase();
    rows = rows.filter((v) =>
      [v.year, v.make, v.model, v.trim, v.stockNumber, v.vin, v.exteriorColor]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }

  const sort = sp.sort ?? 'age';
  rows.sort((a, b) => {
    switch (sort) {
      case 'price': return activePrice(b) - activePrice(a);
      case 'priceAsc': return activePrice(a) - activePrice(b);
      case 'gross': return grossPotential(b) - grossPotential(a);
      case 'vdp': return (traffic.get(b.id)?.vdpViews ?? 0) - (traffic.get(a.id)?.vdpViews ?? 0);
      case 'miles': return a.mileage - b.mileage;
      default: return b.dis - a.dis;
    }
  });

  const totalMoney = rows.reduce((s, v) => s + totalCost(v), 0);
  const totalRetail = rows.reduce((s, v) => s + activePrice(v), 0);

  const VIEWS: Array<[string, string, number]> = [
    ['', 'All units', all.length],
    ['at-risk', 'At risk (30–45d)', all.filter((v) => isAtRisk(daysInStock(v, clock))).length],
    ['recon', 'In recon', all.filter((v) => ['IN_RECON', 'ARRIVED', 'PHOTOS_PENDING'].includes(v.status)).length],
    ['water', 'Water units', all.filter(isWaterUnit).length],
  ];

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-900">Inventory</h1>
          <p className="mt-1 text-sm text-ink-600">
            {rows.length} of {all.length} units · {usd(totalMoney)} in ·{' '}
            {usd(totalRetail)} at retail
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-300 bg-white text-xs">
            <Link
              href={qs(sp, { clock: undefined })}
              className={cn('px-3 py-1.5 font-medium', clock === 'dateIn' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50')}
              title="Days since the unit was acquired. Slow recon shows up as aging."
            >
              Days in stock
            </Link>
            <Link
              href={qs(sp, { clock: 'frontLine' })}
              className={cn('px-3 py-1.5 font-medium', clock === 'frontLine' ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50')}
              title="Days since the unit went front-line ready."
            >
              Days front line
            </Link>
          </div>
          <Link
            href="/admin/inventory/import"
            className="rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50"
          >
            Import
          </Link>
          <Link
            href="/admin/inventory/new"
            className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-ink-800"
          >
            Add vehicle
          </Link>
        </div>
      </header>

      <Card className="mb-5 px-5 py-4">
        <AgingBar counts={agingCounts(rows, clock)} total={rows.length} />
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {VIEWS.map(([key, label, n]) => (
          <Link
            key={label}
            href={qs(sp, { view: key || undefined, bucket: undefined })}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset',
              (sp.view ?? '') === key
                ? 'bg-ink-900 text-white ring-ink-900'
                : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
            )}
          >
            {label} <span className="tnum opacity-60">{n}</span>
          </Link>
        ))}

        {rooftops.length > 1 ? (
          <>
        <span className="mx-1 h-5 w-px bg-ink-200" />

        <Link
          href={qs(sp, { rooftop: undefined })}
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
            href={qs(sp, { rooftop: r.slug })}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset',
              activeRooftop?.id === r.id
                ? 'bg-ink-900 text-white ring-ink-900'
                : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
            )}
          >
            {r.city}
          </Link>
        ))}
          </>
        ) : null}

        <form className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto" action="/admin/inventory">
          {sp.clock ? <input type="hidden" name="clock" value={sp.clock} /> : null}
          {sp.view ? <input type="hidden" name="view" value={sp.view} /> : null}
          {sp.rooftop ? <input type="hidden" name="rooftop" value={sp.rooftop} /> : null}
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Search year, make, stock #, VIN…"
            className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm outline-none focus:border-ink-900 sm:w-64 sm:py-1.5 sm:text-xs"
          />
          <button className="shrink-0 rounded-lg border border-ink-300 bg-white px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 sm:py-1.5 sm:text-xs">
            Search
          </button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          Bucket
        </span>
        {AGING_BUCKETS.map((b) => (
          <Link
            key={b.key}
            href={qs(sp, { bucket: sp.bucket === b.key ? undefined : b.key })}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset',
              sp.bucket === b.key
                ? 'bg-ink-900 text-white ring-ink-900'
                : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50',
            )}
          >
            {b.label}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title={clock === 'dateIn' ? 'Units by days in stock' : 'Units by days on the front line'}
          subtitle={
            clock === 'dateIn'
              ? 'Clock starts the day the unit was acquired — recon time counts against you.'
              : 'Clock starts when the unit went front-line ready.'
          }
          action={
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-ink-500">Sort</span>
              {[
                ['age', 'Age'],
                ['price', 'Price'],
                ['gross', 'Gross'],
                ['vdp', 'VDP'],
                ['miles', 'Miles'],
              ].map(([k, label]) => (
                <Link
                  key={k}
                  href={qs(sp, { sort: k })}
                  className={cn(
                    'rounded px-2 py-1.5 font-medium sm:py-0.5',
                    sort === k ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100',
                  )}
                >
                  {label}
                </Link>
              ))}
            </div>
          }
        />

        {rows.length === 0 ? (
          <EmptyState title="No units match" body="Clear a filter to see the rest of the lot." />
        ) : (
          <>
            {/* The phone gets cards. The table is eleven columns at 1100px —
                on a 390px screen that is a third of a row dragged sideways,
                and the phone is the device the lot is walked with. */}
            <div className="md:hidden">
              {rows.map((v) => (
                <UnitCard
                  key={v.id}
                  unit={v}
                  live={liveCount.get(v.id) ?? 0}
                  errs={errCount.get(v.id) ?? 0}
                  showCity={rooftops.length > 1}
                />
              ))}
            </div>

            <div className="scroll-thin hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50/60 text-xs text-ink-600">
                  <th className="px-5 py-2.5 text-left font-semibold">Unit</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Days</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Price</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Pack</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Recon</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Gross</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Mkt</th>
                  <th className="px-3 py-2.5 text-right font-semibold">VDP 30d</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Channels</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const gross = grossPotential(v);
                  const costKnown = hasCost(v);
                  const water = isWaterUnit(v);
                  const pct = v.marketValue
                    ? Math.round((activePrice(v) / v.marketValue) * 100)
                    : null;
                  const errs = errCount.get(v.id) ?? 0;
                  return (
                    <tr key={v.id} className="border-b border-ink-100 hover:bg-ink-50/60">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-3">
                          <img
                            src={v.photos[0]?.url ?? ''}
                            alt=""
                            width={56}
                            height={38}
                            className="h-10 w-14 shrink-0 rounded-md border border-ink-200 bg-ink-100 object-cover"
                          />
                          <div className="min-w-0">
                            <Link
                              href={`/admin/inventory/${v.id}`}
                              className="block truncate text-xs font-semibold text-ink-900 hover:underline"
                            >
                              {shortTitle(v)}{' '}
                              <span className="font-normal text-ink-500">{v.trim}</span>
                            </Link>
                            <div className="tnum truncate text-[11px] text-ink-500">
                              {v.stockNumber} · {num(v.mileage)} mi · {v.rooftop.city}
                              {water ? <span className="ml-1.5 font-semibold text-red-600">water</span> : null}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <AgeBadge days={v.dis} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          tone={
                            v.status === 'FRONT_LINE_READY'
                              ? 'green'
                              : v.status === 'PENDING_SALE'
                                ? 'violet'
                                : v.status === 'PHOTOS_PENDING'
                                  ? 'amber'
                                  : 'blue'
                          }
                        >
                          {VEHICLE_STATUS_LABEL[v.status]}
                        </Badge>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right font-semibold text-ink-900">
                        {v.salePrice ? (
                          <>
                            <span className="mr-1 text-[11px] font-normal text-ink-400 line-through">
                              {usd(v.price)}
                            </span>
                            {usd(v.salePrice)}
                          </>
                        ) : (
                          usd(v.price)
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-600">{usd(v.cost)}</td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-500">{usd(v.pack)}</td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-500">{usd(v.reconCost)}</td>
                      <td
                        className={cn(
                          'tnum px-3 py-2.5 text-right font-semibold',
                          !costKnown
                            ? 'font-normal text-ink-400'
                            : gross < 0
                              ? 'text-red-600'
                              : gross < 1200
                                ? 'text-amber-700'
                                : 'text-emerald-700',
                        )}
                        title={costKnown ? undefined : 'No cost, pack or recon recorded on this unit.'}
                      >
                        {costKnown ? usd(gross) : '—'}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {pct == null ? '—' : (
                          <span className={cn(pct <= 98 ? 'text-emerald-700' : pct >= 103 ? 'text-red-600' : 'text-ink-600')}>
                            {pct}%
                          </span>
                        )}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-ink-600">
                        {num(traffic.get(v.id)?.vdpViews ?? 0)}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <span className="tnum text-xs font-semibold text-ink-900">
                          {liveCount.get(v.id) ?? 0}
                        </span>
                        <span className="text-[11px] text-ink-400"> live</span>
                        {errs ? (
                          <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            {errs} err
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Card>

      <p className="mt-4 text-xs text-ink-500">
        Cost, pack and recon are internal. They are never included in a syndication payload — the
        channels receive price, mileage, description, options and photos only.
      </p>
    </div>
  );
}
