'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Tells `/api/t` a page was seen. One call per route change.
 *
 * `basePath` is always `/s/<slug>` and is stripped when present, so a page
 * counts as the same page on the dealer's domain (where the browser never shows
 * the prefix) and at `/s/<slug>`. `keepalive` lets the request finish if the shopper
 * taps away immediately; it is a fetch rather than `sendBeacon` so the response
 * can set the first-party visitor cookie.
 */
export function TrackView({ storefrontId, basePath }: { storefrontId: string; basePath: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    let p = pathname || '/';
    if (p === basePath || p.startsWith(`${basePath}/`)) p = p.slice(basePath.length) || '/';
    fetch('/api/t', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ s: storefrontId, p, q: window.location.search, r: document.referrer }),
    }).catch(() => {});
  }, [pathname, storefrontId, basePath]);

  return null;
}
