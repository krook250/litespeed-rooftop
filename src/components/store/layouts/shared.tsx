/**
 * Primitives every layout composes.
 *
 * Layouts differ by how they arrange these, not by reimplementing them. Keeping
 * the shared pieces here is what stops three layouts becoming three bugs.
 */

import Link from 'next/link';
import type { LiveVehicle } from '@/lib/queries';
import { SORTS, buildHref, pillLabel, type FilterKey, type Filters, type RawSearchParams } from '@/components/store/srp-filters';
import { activePrice, miles, usd, vehicleTitle, BODY_LABEL, DRIVETRAIN_LABEL } from '@/lib/domain';
import { primaryPhoto } from '@/components/store/vehicle-card';

export function ResultCount({ shown, total, filtered }: { shown: number; total: number; filtered: boolean }) {
  return (
    <p className="tnum mt-0.5 text-sm text-[var(--text-2)]">
      {shown} {shown === 1 ? 'vehicle' : 'vehicles'}
      {filtered ? ` of ${total} on the lot` : ' available now'}
    </p>
  );
}

export function SortBar({ basePath, sp, filters }: { basePath: string; sp: RawSearchParams; filters: Filters }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Sort</span>
      {SORTS.map((s) => {
        const active = s.key === filters.sort;
        return (
          <Link
            key={s.key}
            href={buildHref(basePath, sp, { sort: s.key === 'newest' ? null : s.key })}
            className={
              active
                ? 'rounded-md bg-[var(--text)] px-2 py-1 text-xs font-semibold text-[var(--page)]'
                : 'rounded-md px-2 py-1 text-xs font-medium text-[var(--text-2)] hover:bg-[var(--paper-2)]'
            }
            aria-current={active ? 'true' : undefined}
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

export function ActivePills({
  activeKeys, basePath, sp, filters,
}: { activeKeys: FilterKey[]; basePath: string; sp: RawSearchParams; filters: Filters }) {
  if (!activeKeys.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {activeKeys.map((key) => (
        <Link
          key={key}
          href={buildHref(basePath, sp, { [key]: null })}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-1 text-xs font-medium text-[var(--text-2)] hover:border-[var(--text-3)] hover:bg-[var(--paper-2)]"
        >
          {pillLabel(key, filters)}
          <span aria-hidden className="text-[var(--text-3)]">×</span>
          <span className="sr-only">Remove filter</span>
        </Link>
      ))}
      <Link
        href={buildHref(basePath, {}, { sort: filters.sort === 'newest' ? null : filters.sort })}
        className="text-xs font-semibold text-[var(--brand-text)] hover:underline"
      >
        Clear all
      </Link>
    </div>
  );
}

export function EmptyState({ basePath, total, phone }: { basePath: string; total: number; phone: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--paper-2)] px-6 py-16 text-center">
      <p className="text-sm font-semibold text-[var(--text)]">Nothing on the lot matches that search.</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-2)]">
        We turn inventory weekly — widen the price or mileage range, or clear the filters to see all{' '}
        {total} units.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={basePath || '/'}
          className="rounded-md bg-[var(--brand)] px-3.5 py-2 text-sm font-semibold text-[var(--on-brand)] hover:opacity-90"
        >
          Clear all filters
        </Link>
        <a
          href={`tel:+1${phone.replace(/\D/g, '')}`}
          className="rounded-md border border-[var(--line)] px-3.5 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--paper)]"
        >
          Call {phone}
        </a>
      </div>
    </div>
  );
}

/** One dense row. The LOT_LIST layout's whole reason for existing. */
export function VehicleRow({ v, basePath }: { v: LiveVehicle; basePath: string }) {
  const photo = primaryPhoto(v);
  const price = activePrice(v);
  const onSale = v.salePrice != null && v.salePrice < v.price;

  return (
    <Link
      href={`${basePath}/${v.stockNumber}`}
      className="group flex items-center gap-4 border-b border-[var(--line)] px-3 py-3 transition-colors last:border-b-0 hover:bg-[var(--paper-2)]"
    >
      <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-[var(--paper-2)]">
        {photo ? (
          <img src={photo.url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--text)] group-hover:text-[var(--brand-text)]">
          {vehicleTitle(v)}
        </div>
        <div className="tnum mt-0.5 truncate text-xs text-[var(--text-2)]">
          {miles(v.mileage)} · {BODY_LABEL[v.bodyStyle] ?? v.bodyStyle} ·{' '}
          {DRIVETRAIN_LABEL[v.drivetrain] ?? v.drivetrain} · Stock #{v.stockNumber}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="tnum text-base font-bold text-[var(--text)]">{usd(price)}</div>
        {onSale ? (
          <div className="tnum text-xs text-[var(--text-3)] line-through">{usd(v.price)}</div>
        ) : null}
      </div>
    </Link>
  );
}
