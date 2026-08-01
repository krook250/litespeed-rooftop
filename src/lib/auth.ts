import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Hardcoded demo login. Deliberately not a real auth system — the real one
 * lands with multi-user roles, not before.
 */
export const DEMO_USER = {
  email: 'dave@evergreenmotorswa.com',
  password: 'rooftop',
  name: 'Dave Okafor',
  role: 'Owner',
};

const COOKIE = 'rooftop_demo_session';

export async function isSignedIn() {
  const jar = await cookies();
  return jar.get(COOKIE)?.value === 'ok';
}

export async function requireSession() {
  if (!(await isSignedIn())) redirect('/login');
  return DEMO_USER;
}

export async function signIn() {
  const jar = await cookies();
  jar.set(COOKIE, 'ok', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
