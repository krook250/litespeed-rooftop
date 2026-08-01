import Link from 'next/link';
import type { LiveVehicle } from '@/lib/queries';
import {
  BODY_LABEL,
  DRIVETRAIN_LABEL,
  activePrice,
  daysInStock,
  isFreshAir,
  miles,
  usd,
  vehicleTitle,
} from '@/lib/domain';
import { cn } from '@/components/ui';

export function primaryPhoto(v: Pick<LiveVehicle, 'photos'>) {
  return v.photos.find((p) => p.isPrimary) ?? v.photos[0] ?? null;
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-700',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function VehicleCard({ v, basePath }: { v: LiveVehicle; basePath: string }) {
  const photo = primaryPhoto(v);
  const href = `${basePath}/${v.stockNumber}`;
  const price = activePrice(v);
  const onSale = v.salePrice != null && v.salePrice < v.price;
  const underMarket = v.marketValue > 0 ? v.marketValue - price : 0;
  const justArrived = isFreshAir(daysInStock(v));

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm transition hover:shadow-md">
      <Link href={href} className="relative block bg-ink-100">
        {photo ? (
          <img
            src={photo.url}
            alt={photo.alt || vehicleTitle(v)}
            width={1200}
            height={800}
            loading="lazy"
            className="aspect-[3/2] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[3/2] w-full items-center justify-center text-xs text-ink-500">
            Photos coming
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          {v.status === 'PENDING_SALE' ? (
            <span className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-ink-950">
              Sale pending
            </span>
          ) : null}
          {v.status === 'PHOTOS_PENDING' ? (
            <span className="rounded-md bg-ink-900/85 px-2 py-1 text-[11px] font-semibold text-white">
              Photos being shot
            </span>
          ) : null}
          {onSale ? (
            <span
              className="rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white"
              style={{ background: 'var(--accent)' }}
            >
              Price reduced
            </span>
          ) : null}
          {justArrived && !onSale ? (
            <span className="rounded-md bg-white/90 px-2 py-1 text-[11px] font-semibold text-ink-800">
              Just arrived
            </span>
          ) : null}
        </div>

        {v.photos.length ? (
          <span className="tnum absolute bottom-2 right-2 rounded-md bg-ink-950/70 px-2 py-1 text-[11px] font-medium text-white">
            {v.photos.length} photos
          </span>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-[15px] font-semibold leading-snug text-ink-900">
          <Link href={href} className="hover:text-[var(--brand)]">
            {v.year} {v.make} {v.model}
          </Link>
        </h3>
        {v.trim ? <p className="mt-0.5 text-sm text-ink-600">{v.trim}</p> : null}

        <p className="tnum mt-2 text-sm text-ink-700">
          {miles(v.mileage)}
          <span className="text-ink-300"> · </span>
          {DRIVETRAIN_LABEL[v.drivetrain]}
          <span className="text-ink-300"> · </span>
          {BODY_LABEL[v.bodyStyle]}
        </p>

        {v.callouts.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {v.callouts.slice(0, 2).map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        ) : null}

        <div className="mt-auto pt-3.5">
          <div className="flex items-end gap-2">
            <span className="tnum text-2xl font-semibold tracking-tight text-ink-900">
              {usd(price)}
            </span>
            {onSale ? (
              <span className="tnum pb-0.5 text-sm text-ink-400 line-through">{usd(v.price)}</span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            {underMarket > 0 ? (
              <span className="tnum text-xs font-medium text-emerald-700">
                {usd(underMarket)} below market
              </span>
            ) : (
              <span className="tnum text-xs text-ink-500">Stock #{v.stockNumber}</span>
            )}
            <Link href={href} className="text-xs font-semibold text-[var(--brand)] hover:underline">
              View details
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
