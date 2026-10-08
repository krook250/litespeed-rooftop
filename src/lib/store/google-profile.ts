/**
 * Rooftop Auto — the link to a lot's Google Business Profile.
 *
 * "near me" searches are answered from Business Profiles, not web pages. The
 * site's part is to say, unambiguously, "this is the business on that map
 * listing": `hasMap` and `sameAs` on the lot's `AutoDealer` node, pointing at
 * the profile. The coordinates alone don't do that — they say where, not which.
 *
 * Accepted: the links Google itself hands out from Maps and Search ("Share" →
 * "Copy link"). Anything else is dropped rather than published as structured
 * data claiming to be the dealer's Google listing.
 *
 * Pure.
 */

const HOSTS = new Set([
  'www.google.com', 'google.com', 'maps.google.com',
  'maps.app.goo.gl', 'goo.gl', 'g.page', 'share.google', 'g.co',
]);

/** The same rule as `parseGoogleProfileUrl`, as an `<input pattern>`. */
export const GOOGLE_PROFILE_PATTERN =
  'https://((www\\.)?google\\.com/maps|maps\\.google\\.com|maps\\.app\\.goo\\.gl|goo\\.gl/maps|g\\.page|share\\.google|g\\.co/kgs)/.*';

export function parseGoogleProfileUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return null;
  const path = u.pathname;
  const ok =
    ((u.hostname === 'www.google.com' || u.hostname === 'google.com') && path.startsWith('/maps')) ||
    u.hostname === 'maps.google.com' ||
    (u.hostname === 'maps.app.goo.gl' && path.length > 1) ||
    (u.hostname === 'goo.gl' && path.startsWith('/maps/')) ||
    (u.hostname === 'g.page' && path.length > 1) ||
    (u.hostname === 'share.google' && path.length > 1) ||
    (u.hostname === 'g.co' && path.startsWith('/kgs/'));
  if (!ok) return null;
  u.hash = '';
  return u.toString().slice(0, 500);
}
