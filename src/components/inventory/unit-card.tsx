import Link from 'next/link';
import { AgeBadge, Badge, cn } from '@/components/ui';
import {
  VEHICLE_STATUS_LABEL,
  activePrice,
  grossPotential,
  isWaterUnit,
  num,
  shortTitle,
  usd,
} from '@/lib/domain';
import type { getLiveInventory } from '@/lib/queries';

type Unit = Awaited<ReturnType<typeof getLiveInventory>>[number] & { dis: number };

/**
 * One unit, as a phone sees it.
 *
 * The desktop table is eleven columns at `min-w-[1100px]`, which on a phone is
 * a third of a row at a time dragged sideways — and the phone is the device the
 * lot is actually walked with. This is the same data, ranked: what the unit is,
 * how long it has been here, what it is worth.
 *
 * **Cost, pack, recon, market % and VDP views are deliberately not here.** They
 * are desk numbers, and the phone is held in front of customers. Gross stays
 * because "should I move on this" is the question being asked on the lot;
 * everything that would let someone reconstruct what we paid does not.
 *
 * The whole card is the link. A tap target that is the row rather than the
 * title is the difference between this working with a thumb and not.
 */
export function UnitCard({
  unit: v,
  live,
  errs,
  showCity,
}: {
  unit: Unit;
  live: number;
  errs: number;
  showCity: boolean;
}) {
  const gross = grossPotential(v);
  const photo = v.photos[0]?.url;

  return (
    <Link
      href={`/admin/inventory/${v.id}`}
      className="block border-b border-ink-100 px-4 py-3 last:border-b-0 active:bg-ink-50"
    >
      <div className="flex gap-3">
        {photo ? (
          <img
            src={photo}
            alt=""
            width={88}
            height={64}
            className="h-16 w-22 shrink-0 rounded-md border border-ink-200 bg-ink-100 object-cover"
          />
        ) : (
          // An empty `src` renders a broken-image glyph, which on an imported
          // lot with no photos yet is every single row.
          <div className="flex h-16 w-22 shrink-0 items-center justify-center rounded-md border border-dashed border-ink-300 bg-ink-50 text-[10px] font-medium text-ink-400">
            No photo
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink-900">
            {shortTitle(v)} <span className="font-normal text-ink-500">{v.trim}</span>
          </div>

          <div className="tnum mt-0.5 truncate text-xs text-ink-500">
            {v.stockNumber} · {num(v.mileage)} mi{showCity ? ` · ${v.rooftop.city}` : ''}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <AgeBadge days={v.dis} />
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
            {isWaterUnit(v) ? (
              <span className="text-[11px] font-semibold text-red-600">water</span>
            ) : null}
          </div>

          <div className="tnum mt-2 flex items-baseline gap-2">
            <span className="text-base font-semibold text-ink-900">
              {v.salePrice ? (
                <>
                  <span className="mr-1 text-xs font-normal text-ink-400 line-through">
                    {usd(v.price)}
                  </span>
                  {usd(v.salePrice)}
                </>
              ) : (
                usd(v.price)
              )}
            </span>
            <span
              className={cn(
                'text-xs font-semibold',
                gross < 0 ? 'text-red-600' : gross < 1200 ? 'text-amber-700' : 'text-emerald-700',
              )}
            >
              {usd(gross)} gross
            </span>
          </div>

          <div className="mt-1.5 text-[11px] text-ink-500">
            <span className="tnum font-semibold text-ink-700">{live}</span> live
            {errs ? (
              <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                {errs} err
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
