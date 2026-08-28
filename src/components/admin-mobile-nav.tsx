'use client';

import { useState } from 'react';

/**
 * Navigation on a phone.
 *
 * The desktop sidebar is `hidden … lg:flex`, which below 1024px meant there was
 * no navigation at all — the admin was reachable only by typing URLs. That is
 * awkward on any screen and absurd on this one in particular: the VIN scanner
 * exists to be used standing next to a car, holding a phone, and until now the
 * only way to reach it from a phone was to know the path by heart.
 *
 * Takes the *same* rendered sidebar the desktop layout uses rather than a
 * second copy of the link list. A mobile menu that drifts out of step with the
 * desktop one is a bug that ships quietly and gets found by a dealer.
 *
 * The drawer closes on any link click via delegation on the container, rather
 * than an effect watching the pathname. That is deliberate: `useEffect` +
 * `setState` is one of the React Compiler rules this codebase already trips
 * eight times, and there is no reason to add a ninth for something a click
 * handler does directly and synchronously.
 */
export function AdminMobileNav({
  brand,
  children,
}: {
  brand: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-800 bg-ink-950 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-ml-1 rounded-md p-2 text-ink-300 hover:bg-ink-800 hover:text-white"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
        <div className="min-w-0 [&_svg]:max-h-9 [&_svg]:w-auto">{brand}</div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Tapping away closes it — the expected gesture, and the only one
              that works when the drawer is taller than the screen. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-ink-950/60"
          />
          <div
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto border-r border-ink-800 bg-ink-950"
            onClick={(e) => {
              // Any link inside the drawer navigates, so the drawer should go.
              if ((e.target as HTMLElement).closest('a,button[type="submit"]')) setOpen(false);
            }}
          >
            <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
              <div className="min-w-0 [&_svg]:max-h-9 [&_svg]:w-auto">{brand}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1.5 text-ink-400 hover:bg-ink-800 hover:text-white"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {children}
          </div>
        </div>
      ) : null}
    </>
  );
}
