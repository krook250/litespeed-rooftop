/**
 * OAuth callback for Facebook Login for Business.
 *
 * Facebook sends the dealer back here with `?code=&state=`, or with
 * `?error=access_denied` if they closed the dialog. Everything this handler does
 * is verification and hand-off: the real work is in `completeConnection`.
 *
 * THE THREE CHECKS, none of which are optional:
 *
 *   1. `state` carries a valid HMAC — proves we minted it.
 *   2. The nonce inside it matches the httpOnly cookie — proves it was minted
 *      for this browser, so a state lifted from a log or a shared link is dead.
 *   3. The group in the state matches the *signed-in* group — proves the dealer
 *      who started the flow is the dealer finishing it. This is the one that
 *      matters most: without it, a dealer talked into clicking a crafted
 *      callback would bind someone else's Meta business, and every ad we then
 *      ran would spend a stranger's money.
 *
 * A GET that mutates is not ideal, but the OAuth redirect gives us no choice.
 * The state check is what makes it safe, which is why all three run before any
 * write and why the cookie is cleared on every path out of here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { STATE_COOKIE, completeConnection, verifyState } from '@/lib/meta/connect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL('/admin/ad-desk', req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;

  // The dealer closed the dialog or declined. Not an error worth alarming them about.
  const denied = q.get('error');
  if (denied) {
    return back(req, {
      err:
        denied === 'access_denied'
          ? 'Facebook connection cancelled. Nothing changed.'
          : q.get('error_description') ?? 'Facebook could not complete the connection.',
    });
  }

  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) return back(req, { err: 'Facebook sent us back without a credential. Try again.' });

  const nonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!nonce) {
    return back(req, {
      err: 'That connection attempt expired or was started in a different browser. Try again.',
    });
  }

  const stateGroupId = verifyState(state, nonce);
  if (!stateGroupId) return back(req, { err: 'That connection link could not be verified. Try again.' });

  const user = await getSessionUser();
  if (!user) return back(req, { err: 'Your session ended while you were on Facebook. Sign in and try again.' });
  if (user.groupId !== stateGroupId) {
    return back(req, { err: 'That connection was started by a different account. Try again from this one.' });
  }

  const result = await completeConnection({ code, groupId: user.groupId, userId: user.id });
  if (!result.ok) return back(req, { err: result.error });

  // Surfaced rather than swallowed: a narrower grant than we asked for still
  // "works" at connect time and then fails days later when someone tries to
  // build a campaign. Better to say so while the dealer is still on the screen.
  return back(
    req,
    result.missingScopes.length
      ? { ok: '1', partial: result.missingScopes.join(',') }
      : { ok: '1' },
  );
}
