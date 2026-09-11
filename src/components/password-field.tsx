'use client';

/**
 * A password input with a show/hide toggle.
 *
 * Delegated to from `Field` in `auth-shell.tsx` whenever `type="password"`, the
 * same way `SubmitButton` delegates to `AuthSubmitButton` — the credential pages
 * stay server components and none of their call sites change.
 *
 * THE BUTTON IS NOT INSIDE A WRAPPING LABEL, which is why this does not reuse
 * `Field`'s markup. `Field` wraps its input in a `<label>`, and a `<button>`
 * inside a label is activated by the label as well as by itself — so on some
 * browsers a single tap toggles twice and lands back where it started. The label
 * here is a sibling tied by `htmlFor`, with the id from `useId` so two password
 * fields on one page (reset-password has exactly that) cannot collide.
 *
 * `type="button"` is load-bearing. A bare `<button>` inside a form defaults to
 * submit, so without it, revealing the password submits the sign-in.
 */

import { useId, useState } from 'react';

export function PasswordField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-xs font-medium text-ink-300">
        {label}
      </label>

      <div className="relative mt-1">
        <input
          {...props}
          id={id}
          type={shown ? 'text' : 'password'}
          className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 pr-10 text-sm text-white outline-none placeholder:text-ink-600 focus:border-emerald-500"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          // The label changes with the state because a screen reader user needs
          // to know what pressing it will do next, not what it did last.
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-500 hover:text-ink-300 focus:text-emerald-400 focus:outline-none"
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>

      {hint ? <span className="mt-1 block text-[11px] text-ink-500">{hint}</span> : null}
    </div>
  );
}

/* Drawn inline rather than pulled from an icon package: two glyphs is not worth
   a dependency on a sign-in page, which is the one page that must render for a
   dealer on a bad connection. */

function Eye() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.7 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
