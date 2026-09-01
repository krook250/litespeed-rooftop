'use client';

import { useState } from 'react';
import Link from 'next/link';
import { cn } from '@/components/ui';
import { PriceQuickEdit } from '@/components/sync-bits';
import { SYNC_STATUS_LABEL, relativeTime, usd } from '@/lib/domain';

export type SyncCell = {
  channelId: string;
  name: string;
  initials: string;
  brandHex: string;
  status: string;
  /** Listing is up but the connection is broken, so nothing we send reaches it. */
  stale: boolean;
  remoteUrl: string | null;
  errorMessage: string | null;
  lastSyncedAt: Date | null;
};

export type SyncUnit = {
  vehicleId: string;
  title: string;
  stockNumber: string;
  city: string;
  price: number;
  cells: SyncCell[];
};

/**
 * Per-VIN sync status, as a phone sees it.
 *
 * THE DESKTOP MATRIX IS HOVER-ONLY. Every cell there is a 20px colored square
 * whose meaning — which channel, what status, what the error said, when it last
 * synced — lives entirely in a `title` attribute. A touch screen has no hover,
 * so on a phone that grid is a wall of anonymous dots and the one question this
 * screen exists to answer ("why is my truck not on CarGurus") cannot be reached
 * at all. The phone gets words instead of colors.
 *
 * Collapsed by default because twenty-one open rows is not a list you can scan,
 * **except any unit with an error, which opens itself.** The screen's job is
 * surfacing what is broken; making the dealer tap twenty-one times to find it
 * would be the same failure in a new shape.
 */

const TEXT: Record<string, string> = {
  LIVE: 'text-emerald-700',
  QUEUED: 'text-blue-700',
  SYNCING: 'text-blue-700',
  PENDING: 'text-amber-700',
  ERROR: 'text-red-700',
  EXCLUDED: 'text-ink-500',
  NOT_LISTED: 'text-ink-500',
  REMOVED: 'text-ink-500',
};

const RING: Record<string, string> = {
  LIVE: 'ring-emerald-600/25 bg-emerald-50',
  QUEUED: 'ring-blue-600/25 bg-blue-50',
  SYNCING: 'ring-blue-600/25 bg-blue-50',
  PENDING: 'ring-amber-600/25 bg-amber-50',
  ERROR: 'ring-red-600/25 bg-red-50',
  EXCLUDED: 'ring-ink-300 bg-ink-50',
  NOT_LISTED: 'ring-ink-300 bg-ink-50',
  REMOVED: 'ring-ink-300 bg-ink-50',
};

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

function isProblem(c: SyncCell) {
  return c.status === 'ERROR' || c.stale;
}

/** What the collapsed row says. Errors first — they are why anyone is here. */
function summarize(cells: SyncCell[]) {
  const errors = cells.filter(isProblem).length;
  const live = cells.filter((c) => c.status === 'LIVE' && !c.stale).length;
  const flight = cells.filter((c) => c.status === 'QUEUED' || c.status === 'SYNCING').length;

  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors > 1 ? 's' : ''}`);
  if (flight) parts.push(`${flight} in flight`);
  if (live) parts.push(`${live} live`);
  if (!parts.length) parts.push('not listed');
  return { text: parts.join(' · '), errors };
}

function Chip({ cell }: { cell: SyncCell }) {
  const label = cell.stale ? 'Live · stale' : SYNC_STATUS_LABEL[cell.status] ?? cell.status;

  const inner = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-2.5 text-xs font-medium ring-1 ring-inset',
        cell.stale ? 'bg-red-50 ring-red-600/25' : RING[cell.status] ?? 'ring-ink-300 bg-ink-50',
      )}
    >
      <span
        className="flex h-5 w-7 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-white"
        style={{ background: cell.brandHex }}
      >
        {cell.initials}
      </span>
      <span className={cn(cell.stale ? 'text-red-700' : TEXT[cell.status] ?? 'text-ink-600')}>
        {label}
      </span>
    </span>
  );

  // A live listing is worth opening. Everything else has nowhere to go.
  return cell.status === 'LIVE' && cell.remoteUrl ? (
    <Link href={cell.remoteUrl} target="_blank">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function Row({
  unit,
  showCity,
  open,
  onToggle,
}: {
  unit: SyncUnit;
  showCity: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { text, errors } = summarize(unit.cells);
  const inFlight = unit.cells.some((c) => c.status === 'QUEUED' || c.status === 'SYNCING');
  const problems = unit.cells.filter((c) => c.errorMessage && isProblem(c));

  return (
    <div className={cn('border-b border-ink-100 last:border-b-0', inFlight && 'bg-blue-50/60')}>
      {/* The whole header is the toggle. A link nested inside a button is
          invalid markup and, worse, a coin flip about what a thumb just did —
          so the vehicle link lives in the panel instead. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-ink-50"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className={cn('shrink-0 text-ink-400 transition-transform', open && 'rotate-90')}
        >
          <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink-900">{unit.title}</div>
          <div className="tnum truncate text-[11px] text-ink-500">
            {unit.stockNumber} · {usd(unit.price)}
            {showCity ? ` · ${unit.city}` : ''}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="flex gap-1">
            {unit.cells.map((c) => (
              <span
                key={c.channelId}
                className={cn(
                  'h-2 w-2 rounded-sm',
                  c.stale ? 'bg-emerald-500 opacity-45 ring-1 ring-red-500' : DOT[c.status],
                )}
              />
            ))}
          </div>
          <span className={cn('text-[11px] font-medium', errors ? 'text-red-700' : 'text-ink-500')}>
            {text}
          </span>
        </div>
      </button>

      {open ? (
        <div className="px-4 pb-3 pl-11">
          <div className="flex flex-wrap gap-1.5">
            {unit.cells.map((c) => (
              <Chip key={c.channelId} cell={c} />
            ))}
          </div>

          {problems.map((c) => (
            <p key={c.channelId} className="mt-2 text-[11px] leading-snug text-red-700">
              <span className="font-semibold">{c.name}:</span> {c.errorMessage}
              {c.lastSyncedAt ? (
                <span className="text-ink-500"> · last synced {relativeTime(c.lastSyncedAt)}</span>
              ) : null}
            </p>
          ))}

          <div className="mt-3 flex items-center justify-between gap-3">
            <PriceQuickEdit vehicleId={unit.vehicleId} price={unit.price} compact />
            <Link
              href={`/admin/inventory/${unit.vehicleId}`}
              className="shrink-0 text-xs font-semibold text-ink-700 underline underline-offset-2"
            >
              Open vehicle →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function UnitSyncList({ units, showCity }: { units: SyncUnit[]; showCity: boolean }) {
  // Anything broken starts open. Everything else starts out of the way.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(units.filter((u) => u.cells.some(isProblem)).map((u) => u.vehicleId)),
  );

  const allOpen = open.size === units.length && units.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-2">
        <span className="text-[11px] font-medium text-ink-500">
          {units.length} unit{units.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() =>
            setOpen(allOpen ? new Set() : new Set(units.map((u) => u.vehicleId)))
          }
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-300 active:bg-ink-100"
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {units.map((u) => (
        <Row
          key={u.vehicleId}
          unit={u}
          showCity={showCity}
          open={open.has(u.vehicleId)}
          onToggle={() =>
            setOpen((prev) => {
              const next = new Set(prev);
              if (next.has(u.vehicleId)) next.delete(u.vehicleId);
              else next.add(u.vehicleId);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}
