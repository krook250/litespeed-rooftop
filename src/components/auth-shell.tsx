/**
 * Shared chrome for /login and /signup. Server components — no client JS.
 */

import { RooftopLockup } from './brand';

export function AuthShell({
  title,
  subtitle,
  error,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <RooftopLockup />
        </div>

        <div className="rounded-2xl border border-ink-800 bg-ink-900 p-6">
          <h1 className="text-base font-semibold text-white">{title}</h1>
          {subtitle ? <p className="mt-1 text-xs text-ink-400">{subtitle}</p> : null}

          {error ? (
            <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          ) : null}

          {children}
        </div>

        {footer ? <p className="mt-4 text-center text-xs text-ink-400">{footer}</p> : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-4 block text-xs font-medium text-ink-300">
      {label}
      <input
        {...props}
        className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none placeholder:text-ink-600 focus:border-emerald-500"
      />
      {hint ? <span className="mt-1 block font-normal text-[11px] text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="mt-6 w-full rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-ink-950 hover:bg-emerald-400">
      {children}
    </button>
  );
}
