'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { tickSyncs, updatePrice } from '@/lib/actions';
import { cn } from './ui';

/* --------------------------------------------------------------- ticker */

/**
 * Advances in-flight syncs on an interval. In production this is a worker;
 * here the screen drives it so a demo has something honest to watch.
 */
export function SyncTicker({ intervalMs = 1500 }: { intervalMs?: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(true);
  const [lastLanded, setLastLanded] = useState(0);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await tickSyncs();
        if (!alive) return;
        if (r?.landed) {
          setLastLanded(r.landed);
          router.refresh();
        }
      } catch {
        /* demo poller — a dropped tick is not worth surfacing */
      }
    }, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running, intervalMs, router]);

  return (
    <button
      onClick={() => setRunning((r) => !r)}
      className="inline-flex items-center gap-2 rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
      title="The sync worker. Pause it if you want to talk over a screen without it moving."
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          running ? 'bg-emerald-500 pulse-ring' : 'bg-ink-300',
        )}
      />
      {running ? 'Sync worker running' : 'Sync worker paused'}
      {lastLanded ? <span className="text-ink-400">· last landed {lastLanded}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------- countdown */

export function Countdown({ to, prefix = '' }: { to: string | null; prefix?: string }) {
  // Rendered client-side only: a server-rendered clock and a client-rendered
  // clock disagree by a second and React calls that a hydration error.
  const [mounted, setMounted] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  if (!mounted) return <span className="tnum text-ink-400">·</span>;
  if (!to) return <span className="text-ink-400">—</span>;
  const ms = new Date(to).getTime() - Date.now();
  if (ms <= 0) return <span className="text-ink-500">{prefix}any moment</span>;
  const s = Math.floor(ms / 1000);
  const label =
    s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return (
    <span className="tnum text-ink-600">
      {prefix}
      {label}
    </span>
  );
}

/* ----------------------------------------------------------- price edit */

export function PriceQuickEdit({
  vehicleId,
  price,
  compact = false,
}: {
  vehicleId: string;
  price: number;
  compact?: boolean;
}) {
  const [value, setValue] = useState(String(price));
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = Number(value.replace(/[^0-9]/g, '')) !== price;

  useEffect(() => setValue(String(price)), [price]);

  function submit() {
    const next = Number(value.replace(/[^0-9]/g, ''));
    if (!next || next === price) return;
    const fd = new FormData();
    fd.set('vehicleId', vehicleId);
    fd.set('price', String(next));
    fd.set('reason', 'Repriced from syndication screen');
    start(async () => {
      await updatePrice(fd);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-400">
          $
        </span>
        <input
          value={Number(value.replace(/[^0-9]/g, '')).toLocaleString('en-US')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          inputMode="numeric"
          className={cn(
            'tnum rounded-md border border-ink-300 bg-white py-1 pl-5 pr-2 text-right text-xs font-semibold text-ink-900 outline-none focus:border-ink-900',
            compact ? 'w-24' : 'w-28',
          )}
        />
      </div>
      <button
        onClick={submit}
        disabled={!dirty || pending}
        className={cn(
          'rounded-md px-2 py-1 text-xs font-semibold transition-colors',
          dirty && !pending
            ? 'bg-ink-900 text-white hover:bg-ink-800'
            : 'cursor-not-allowed bg-ink-100 text-ink-400',
        )}
      >
        {pending ? '…' : 'Push'}
      </button>
    </div>
  );
}
