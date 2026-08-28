'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, and nothing else.
 *
 * Mounted from the admin layout rather than the root layout on purpose: the
 * worker's scope is `/`, so registering it from a dealer storefront would put
 * a Rooftop worker on the dealer's own domain. See the note in `src/lib/pwa.ts`.
 *
 * No state, no render — deliberately. An effect that also sets state is the
 * React Compiler rule this codebase already trips eight times, and an install
 * prompt is not worth a ninth.
 */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registration races nothing and blocks nothing; failures are not the
    // dealer's problem and must never surface as an error in the UI.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);

  return null;
}
