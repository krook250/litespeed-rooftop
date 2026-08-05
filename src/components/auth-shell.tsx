/**
 * Shared chrome for /login and /signup. Server components — no client JS.
 *
 * WHY THERE IS AN IDENTITY BLOCK UNDER THE FORM
 *
 * On 5 Aug 2026 Google Safe Browsing flagged rooftopauto.com under "Deceptive
 * pages" (social engineering). Nothing on the site was deceptive: the marketing
 * site, the demo and the storefronts were all clean, and /admin is behind auth
 * so it was never crawled. What was public was this — an email-and-password
 * form, on a domain registered days earlier, carrying no statement of who
 * operates it or what it belongs to. That is the shape the classifier scores as
 * credential harvesting, and there is no way to argue with it except to stop
 * looking like it.
 *
 * Google's own social-engineering guidance asks a site to display the operating
 * brand clearly and state relationships with informational links. The block
 * below is that, and it is load-bearing for the Search Console review — do not
 * remove it to tidy the layout.
 */

import { RooftopLockup } from './brand';

const LEGAL = [
  { href: 'https://rooftopauto.com/legal/privacy.html', label: 'Privacy' },
  { href: 'https://rooftopauto.com/legal/terms.html', label: 'Terms' },
  { href: 'https://rooftopauto.com/legal/support.html', label: 'Support' },
] as const;

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

        <div className="mt-8 border-t border-ink-800 pt-5 text-center">
          <p className="text-[11px] leading-relaxed text-ink-500">
            Rooftop Auto is inventory, merchandising and advertising software for
            independent used-car dealerships, operated by{' '}
            <span className="text-ink-400">Litespeed Marketing LLC</span>, Vancouver,
            Washington.
          </p>

          <p className="mt-3 text-[11px] text-ink-500">
            <a
              href="https://rooftopauto.com"
              className="text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
            >
              rooftopauto.com
            </a>
            {LEGAL.map((l) => (
              <span key={l.href}>
                <span className="px-1.5 text-ink-700">·</span>
                <a
                  href={l.href}
                  className="text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
                >
                  {l.label}
                </a>
              </span>
            ))}
          </p>

          <p className="mt-3 text-[11px] text-ink-600">
            This is the sign-in page for Rooftop Auto customers. We will never ask for
            your password by email or phone.
          </p>
        </div>
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
