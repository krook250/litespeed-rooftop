/**
 * Rooftop Auto — host routing for dealer custom domains.
 *
 * NOTE ON THE FILENAME: this is `proxy.ts`, not `middleware.ts`. Next 16 renamed
 * the convention and deprecated the `middleware` export
 * (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`).
 * The `edge` runtime is **not** supported in `proxy` — it always runs on Node,
 * and that cannot be configured.
 *
 * WHAT THIS DOES
 * A dealer's storefront lives at `/s/[slug]`. When a request arrives on their own
 * domain we rewrite it into that tree, so `cascademotorswa.com/inventory` serves
 * `/s/cascademotorswa.com/inventory` without the dealer ever seeing `/s/` in the
 * address bar.
 *
 * WHY THERE IS NO DATABASE CALL HERE
 * Next's own guidance is that proxy runs separately from render code and may be
 * deployed to the CDN, so it should not rely on shared modules. A domain→slug
 * lookup on every request would also put a database round-trip in front of every
 * page load on every storefront.
 *
 * Instead we pass the **host itself** as the slug segment and let the page
 * resolve it. That is safe because the two key spaces are disjoint by
 * construction: a slug never contains a dot, and a domain always does. So
 * `getStorefrontByKey()` can match `slug = key OR domain = key` with no
 * ambiguity and no collision, ever. `storefronts.domain` is unique, so at most
 * one storefront can answer for a given host.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Hosts that serve the application itself rather than a dealer storefront.
 * Anything not in here is treated as a dealer domain.
 */
function isApplicationHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '127.0.0.1' || hostname === '[::1]') return true;
  // Preview deployments and the production app host.
  if (hostname.endsWith('.vercel.app')) return true;

  const appHost = (process.env.NEXT_PUBLIC_APP_HOST ?? 'app.rooftopauto.com').toLowerCase();
  if (hostname === appHost) return true;

  // The marketing site and anything under it stays on Bluehost, but guard anyway.
  if (hostname === 'rooftopauto.com' || hostname === 'www.rooftopauto.com') return true;

  return false;
}

export function proxy(request: NextRequest) {
  const hostHeader = request.headers.get('host') ?? '';
  // Strip the port so `:3000` in local testing doesn't look like a dealer domain.
  const hostname = hostHeader.split(':')[0]!.toLowerCase().replace(/\.$/, '');

  if (!hostname || isApplicationHost(hostname)) return NextResponse.next();

  const url = request.nextUrl.clone();

  /*
   * `www.` is normalised away rather than redirected here. The dealer is told to
   * add a CNAME on `www`, both hostnames get added to the Vercel project, and a
   * visitor who types either one lands on the same storefront. Doing the
   * canonical redirect in the page keeps this file free of policy.
   */
  const apex = hostname.startsWith('www.') ? hostname.slice(4) : hostname;

  // Already rewritten (or someone hand-typed /s/ on a custom domain) — leave it.
  if (url.pathname.startsWith('/s/')) return NextResponse.next();

  /*
   * The admin is not reachable on a dealer's domain. A dealer's customers should
   * never see a login screen on the dealership's own website, and it keeps the
   * auth cookie scoped to one origin.
   */
  if (
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/signup')
  ) {
    const appHost = process.env.NEXT_PUBLIC_APP_HOST ?? 'app.rooftopauto.com';
    return NextResponse.redirect(new URL(url.pathname + url.search, `https://${appHost}`));
  }

  url.pathname = `/s/${apex}${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  /*
   * Without a matcher, proxy runs on every request including `_next/static` and
   * `public/` assets — which would rewrite the CSS and JS of a storefront into a
   * path that does not exist. Excluding them is not an optimisation, it is what
   * keeps the page from rendering unstyled.
   *
   * `/api` is excluded so auth and photo routes keep working on every host.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
