'use client';

import Link, { useLinkStatus } from 'next/link';
import { cn } from './ui';

/**
 * Feedback on the thing that was actually clicked.
 *
 * `loading.tsx` tells you the page is coming. It does not tell you WHICH link
 * you hit, and on a nav of ten items that matters — a dealer who is not sure
 * the click landed clicks the same item again, and on a slow connection the
 * second click is a second round trip.
 *
 * `useLinkStatus` reports the pending state of the `<Link>` this sits inside,
 * so it has to be a child of one. That is the whole reason these are two
 * components rather than a prop.
 */
export function LinkSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <svg
      className={cn('animate-spin', className)}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A link that looks like a button and admits it is loading.
 *
 * For the links that a dealer reads as actions — "New group", "Edit", "Finish
 * setup". Those are the ones where nothing happening looks like nothing
 * happened, because the surrounding buttons all respond instantly.
 */
export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary'
          ? 'bg-ink-900 text-white hover:bg-ink-800'
          : 'bg-white text-ink-800 ring-1 ring-inset ring-ink-300 hover:bg-ink-50',
        className,
      )}
    >
      <LinkSpinner />
      {children}
    </Link>
  );
}
