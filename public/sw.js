/*
 * Rooftop Auto service worker.
 *
 * IT EXISTS TO MAKE THE APP INSTALLABLE, NOT TO MAKE IT FAST. Chrome will not
 * offer "Install" without a service worker that has a fetch handler, so there
 * has to be one. What it must not do is cache the app itself.
 *
 * Every /admin screen is `force-dynamic`, signed in, and scoped to one dealer
 * group. A cached HTML response here is a lot's inventory served to whoever
 * opens the phone next, and a stale price shown to a salesperson standing in
 * front of the customer. So: HTML is never cached, /api is never touched, and
 * anything that is not a same-origin GET goes straight to the network.
 *
 * The only things in the cache are the icons and the offline card — files with
 * no dealer data in them at all.
 */

const VERSION = 'v1';
const SHELL = `rooftop-shell-${VERSION}`;
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // A navigation gets the network, always. If the phone is in a dead spot on
  // the back lot, it gets a card that says so rather than a browser error page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Icons and the manifest: cache-first, they never change within a version.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req)),
    );
    return;
  }

  // Everything else — Next's own static chunks, photos — network, no caching.
  event.respondWith(fetch(req));
});
