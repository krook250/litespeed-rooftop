import 'server-only';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import * as t from '@/db/schema';
import { getSessionUser, type SessionUser } from '@/lib/auth';

/**
 * Rooftop staff, and the one place that decides who counts as one.
 *
 * READ THE COMMENT ON `staff` IN `src/db/schema.ts` BEFORE CHANGING ANYTHING HERE.
 * The short version: a row in `staff` lets one signed-in user read across every
 * dealer group in the database. Everything else in this codebase is arranged so
 * that cross-tenant access cannot happen by accident — `Scope` in
 * `src/lib/scoped-db.ts` literally cannot be constructed outside that file. This
 * module is the sanctioned exception, and it is deliberately small so that the
 * exception stays legible.
 */

export async function isStaff(userId: string): Promise<boolean> {
  if (!userId) return false;
  const rows = await db
    .select({ id: t.staff.id })
    .from(t.staff)
    .where(eq(t.staff.userId, userId))
    .limit(1);
  return rows.length > 0;
}

/**
 * For pages. Renders a 404 for anyone who is not staff — including signed-out
 * visitors and ordinary dealer users.
 *
 * **404 rather than a redirect to /login, and rather than 403.** A redirect
 * would tell an unauthenticated visitor that `/ops` is a real route worth coming
 * back to with credentials, and a 403 would confirm it to a signed-in dealer.
 * Neither of them should learn this surface exists at all.
 */
export async function requireStaff(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) notFound();
  if (!(await isStaff(user.id))) notFound();
  return user;
}

/**
 * For route handlers, which cannot call `notFound()` and need to build their own
 * response. Returns the user or null; the caller decides the status code, and
 * should choose 404 for the same reason as above.
 */
export async function staffSession(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return (await isStaff(user.id)) ? user : null;
}
