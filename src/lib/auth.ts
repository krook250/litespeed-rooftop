import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth-config';
import * as t from '@/db/schema';

export { auth };

export type SessionUser = typeof t.users.$inferSelect;

/** Current user, or null. Safe to call from anywhere on the server. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const res = await auth.api.getSession({ headers: await headers() });
  if (!res?.user) return null;
  return res.user as unknown as SessionUser;
}

/** Current user, or bounce to /login. Use at the top of every admin screen. */
export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** The tenant the request belongs to. Every admin query scopes on this. */
export async function requireGroupId(): Promise<string> {
  return (await requireSession()).groupId;
}

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
}
