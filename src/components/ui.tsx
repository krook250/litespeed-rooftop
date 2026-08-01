import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AGING_BUCKETS, bucketFor, type AgingTone } from '@/lib/domain';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ badge */

const TONE: Record<AgingTone, string> = {
  fresh: 'bg-age-freshbg text-age-fresh ring-age-fresh/25',
  ok: 'bg-age-okbg text-age-ok ring-age-ok/25',
  warn: 'bg-age-warnbg text-age-warn ring-age-warn/25',
  hot: 'bg-age-hotbg text-age-hot ring-age-hot/25',
  aged: 'bg-age-agedbg text-age-aged ring-age-aged/25',
};

export const AGING_DOT: Record<AgingTone, string> = {
  fresh: 'bg-age-fresh',
  ok: 'bg-age-ok',
  warn: 'bg-age-warn',
  hot: 'bg-age-hot',
  aged: 'bg-age-aged',
};

export function AgeBadge({ days, className }: { days: number; className?: string }) {
  const b = bucketFor(days)!;
  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONE[b.tone],
        className,
      )}
      title={`${days} days in stock — ${b.label} bucket`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', AGING_DOT[b.tone])} />
      {days}d
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700 ring-ink-300/60',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/25',
    amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
    red: 'bg-red-50 text-red-700 ring-red-600/25',
    blue: 'bg-blue-50 text-blue-700 ring-blue-600/25',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/25',
    slate: 'bg-slate-800 text-slate-100 ring-slate-700',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ cards */

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-ink-200 bg-white shadow-sm', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------- stat */

export function Stat({
  label,
  value,
  hint,
  tone,
  benchmark,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'good' | 'bad' | 'flat';
  benchmark?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{label}</div>
      <div
        className={cn(
          'tnum mt-1 text-2xl font-semibold tracking-tight',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-red-700',
          !tone && 'text-ink-900',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-ink-500">{hint}</div> : null}
      {benchmark ? (
        <div className="mt-1.5 border-t border-ink-100 pt-1.5 text-[11px] text-ink-400">{benchmark}</div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- buttons */

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  const variants = {
    primary: 'bg-ink-900 text-white hover:bg-ink-800 disabled:bg-ink-400',
    secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50',
    ghost: 'text-ink-600 hover:bg-ink-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}

/* --------------------------------------------------------------- charting */

/** Horizontal aging distribution bar — the one chart every dealer reads first. */
export function AgingBar({
  counts,
  total,
  className,
}: {
  counts: Record<string, number>;
  total: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
        {AGING_BUCKETS.map((b) => {
          const n = counts[b.key] ?? 0;
          if (!n) return null;
          return (
            <div
              key={b.key}
              className={cn('h-full', AGING_DOT[b.tone])}
              style={{ width: `${(n / Math.max(1, total)) * 100}%` }}
              title={`${b.label} days: ${n} units`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {AGING_BUCKETS.map((b) => (
          <div key={b.key} className="flex items-center gap-1.5 text-xs text-ink-600">
            <span className={cn('h-2 w-2 rounded-full', AGING_DOT[b.tone])} />
            <span>{b.label}</span>
            <span className="tnum font-semibold text-ink-900">{counts[b.key] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-sm text-xs text-ink-500">{body}</p> : null}
    </div>
  );
}
