'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, cn } from './ui';

/**
 * A submit button that admits it is doing something.
 *
 * THE BUG THIS EXISTS TO KILL. A server action attached to a plain `<form>`
 * gives no feedback of any kind: the click registers, the request goes, the row
 * is written, and nothing on screen moves. On the vehicle form that produced the
 * worst possible outcome — the save worked, the operator could not tell, so they
 * clicked again. And again. Every one of those clicks was a real round trip that
 * re-saved the unit and re-queued the change to every channel carrying it.
 *
 * `useFormStatus` reads the pending state of the form this button sits inside,
 * which is why it has to be its own client component: the hook only reports on
 * an ancestor `<form>`, so putting it in the page would always read false.
 *
 * `disabled` while pending is the load-bearing part. The label change is the
 * courtesy; the disable is what stops the double-submit.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant,
  size,
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      aria-busy={pending}
      className={className}
    >
      {pending ? (
        <svg
          className="animate-spin"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * A save button that says it saved.
 *
 * `SubmitButton` covers the wait; this covers the moment after. A fast save
 * finishes before the spinner is visible, so on its own the button flickers and
 * the dealer cannot tell whether anything happened. When the form stops being
 * pending, a green "Saved" with a check sits beside the button for a few
 * seconds. A server action that throws never gets here — it goes to the error
 * boundary — so reaching the end of `pending` without a throw means it saved.
 */
export function SaveButton({ children, savedLabel = 'Saved' }: { children: React.ReactNode; savedLabel?: string }) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (was.current && !pending) {
      setShown(true);
      const t = setTimeout(() => setShown(false), 4000);
      was.current = pending;
      return () => clearTimeout(t);
    }
    if (pending) setShown(false);
    was.current = pending;
  }, [pending]);

  return (
    <span className="inline-flex items-center gap-3">
      <span
        role="status"
        aria-live="polite"
        className={cn(
          'inline-flex items-center gap-1 text-sm font-medium text-emerald-700 transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
          <path d="M4.5 8.2l2.3 2.3 4.7-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {shown ? savedLabel : ''}
      </span>
      <SubmitButton>{children}</SubmitButton>
    </span>
  );
}

/**
 * The same treatment for the full-width buttons on the credential pages.
 *
 * Those had the identical problem and it matters more there: a dealer signing in
 * on a lot with two bars taps a button that does nothing visible for three
 * seconds, so they tap it again, and the second submit races the first.
 */
export function AuthSubmitButton({
  children,
  pendingLabel,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      aria-busy={pending}
      className={cn(
        'mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-ink-950 transition-colors hover:bg-emerald-400',
        pending && 'cursor-not-allowed opacity-70 hover:bg-emerald-500',
      )}
    >
      {pending ? (
        <svg className="animate-spin" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : null}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
