import type { Metadata, Viewport } from 'next';

/**
 * The installable-app half of the page head.
 *
 * DELIBERATELY NOT IN THE ROOT LAYOUT, and not `src/app/manifest.ts` either.
 * Next injects a manifest declared either of those ways into *every* route
 * under the app root — and `src/proxy.ts` rewrites a dealer's own domain into
 * `/s/[slug]`, which shares that root layout. A shopper on
 * `cascademotorswa.com` would be offered "Install Rooftop Auto", a dealer
 * console they have no business seeing. So the manifest is a static file in
 * `public/` and is linked only from the screens a dealer signs in to.
 *
 * Spread `pwaMetadata` into the `metadata` export of any such screen. Anything
 * that renders under `/s/` must never get it.
 */
export const pwaMetadata = {
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    // The mobile header is `bg-ink-950`; a translucent bar lets that dark
    // header run up under the clock instead of leaving a light seam above it.
    // The header pays for this with a safe-area top pad — see admin-mobile-nav.
    statusBarStyle: 'black-translucent',
    title: 'Rooftop',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
} satisfies Metadata;

/**
 * `viewportFit: 'cover'` is what makes `env(safe-area-inset-*)` report anything
 * other than zero. Without it the insets are all 0 and every safe-area pad in
 * the app silently does nothing on a notched phone.
 */
export const pwaViewport = {
  themeColor: '#0e141d',
  viewportFit: 'cover',
} satisfies Viewport;
