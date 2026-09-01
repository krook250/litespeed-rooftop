import Link from 'next/link';
import { cn } from '@/components/ui';
import { PriceQuickEdit } from '@/components/sync-bits';
import { SYNC_STATUS_LABEL, relativeTime } from '@/lib/domain';

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

/**
 * One unit's syndication status, as a phone sees it.
 *
 * THE DESKTOP MATRIX IS HOVER-ONLY. Every cell is a 20px colored square whose
 * meaning — which channel, what status, what the error said, when it last
 * synced — lives entirely in a `title` attribute. A touch screen has no hover,
 * so on a phone the whole grid is a wall of anonymous dots, and the one thing a
 * dealer actually needs from this screen ("why is my truck not on CarGurus")
 * is the part that cannot be reached at all.
 *
 * So the phone gets labels instead of colors: channel initials and the status
 * word, and the error message spelled out underneath rather than hidden in a
 * tooltip. Colour is still there, but it is decoration, not the message.
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

export function UnitSyncRow({
  vehicleId,
  title,
  stockNumber,
  city,
  price,
  cells,
  showCity,
}: {
  vehicleId: string;
  title: string;
  stockNumber: string;
  city: string;
  price: number;
  cells: SyncCell[];
  showCity: boolean;
}) {
  const problems = cells.filter((c) => c.errorMessage && (c.status === 'ERROR' || c.stale));
  const inFlight = cells.some((c) => c.status === 'QUEUED' || c.status === 'SYNCING');

  return (
    <div className={cn('border-b border-ink-100 px-4 py-3 last:border-b-0', inFlight && 'bg-blue-50/60')}>
      <div className="flex items-start justify-between gap-3">
        <Link href={`/admin/inventory/${vehicleId}`} className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink-900">{title}</div>
          <div className="tnum truncate text-[11px] text-ink-500">
            {stockNumber}
            {showCity ? ` · ${city}` : ''}
          </div>
        </Link>
        <PriceQuickEdit vehicleId={vehicleId} price={price} compact />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {cells.map((c) => (
          <Chip key={c.channelId} cell={c} />
        ))}
      </div>

      {problems.map((c) => (
        <p key={c.channelId} className="mt-1.5 text-[11px] leading-snug text-red-700">
          <span className="font-semibold">{c.name}:</span> {c.errorMessage}
          {c.lastSyncedAt ? (
            <span className="text-ink-500"> · last synced {relativeTime(c.lastSyncedAt)}</span>
          ) : null}
        </p>
      ))}
    </div>
  );
}
