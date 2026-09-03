import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { getSessionUser } from '@/lib/auth';
import { isStaff } from '@/lib/ops/guard';

/**
 * Where a signed-in person belongs the moment they arrive.
 *
 * Every entry point into the product used to hard-code `/admin`: the login
 * action, the root route, signup, invite accept, and the "you are already
 * signed in" guard on all four auth screens. That is correct for a dealer and
 * wrong for an operator. Rooftop staff are also, necessarily, the owner of
 * their own (empty) dealer group -- `users.groupId` is NOT NULL, see the
 * comment in `src/lib/ops/guard.ts` -- so signing in dropped them into a lot
 * with nothing in it and left `/ops` reachable only by editing the address bar.
 *
 * `/admin` stays the dealer home and `/ops` is not a "more powerful admin": it
 * is a different surface over every tenant. This module is only about which of
 * the two you land on, and nothing here grants anything. `requireStaff()` is
 * still the only thing that lets anyone through the door.
 */

export const DEALER_HOME = '/admin';
export const OPS_HOME = '/ops';

export async function landingFor(userId: string): Promise<string> {
  return (await isStaff(userId)) ? OPS_HOME : DEALER_HOME;
}

/** For the "already signed in, bounce them onward" guards on the auth screens. */
export async function landingForSession(): Promise<string> {
  const me = await getSessionUser();
  return me ? landingFor(me.id) : DEALER_HOME;
}

/**
 * For the login action specifically. The session cookie Better Auth just set is
 * on the *response*; the request headers this render is reading are the ones
 * that arrived signed-out, so `getSessionUser()` here would still say null.
 * Resolve the user by the email that was just authenticated instead.
 *
 * `users.email` is unique and the caller lowercases before it authenticates, so
 * this is the same row the sign-in matched.
 */
export async function landingForEmail(email: string): Promise<string> {
  const rows = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(eq(t.users.email, email))
    .limit(1);
  return rows[0] ? landingFor(rows[0].id) : DEALER_HOME;
}
