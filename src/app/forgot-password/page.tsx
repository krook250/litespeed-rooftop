/**
 * Ask for a reset link.
 *
 * THE CONFIRMATION IS THE SAME WHETHER OR NOT THE ADDRESS EXISTS, and that is
 * the entire security property of this screen. Better Auth already does its half
 * — an unknown email still generates an id and does a decoy lookup so the timing
 * matches — and this page must not undo it by rendering a different message. So
 * there is no "no account found" branch anywhere below, on purpose.
 *
 * Uses `AuthShell` like /login and /signup, which is not just consistency: the
 * identity block it carries is what got this domain out of a Google Safe
 * Browsing "deceptive page" flag on 5 Aug, and a bare password form on a new
 * domain is precisely the shape that got flagged. See `auth-shell.tsx`.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, getSessionUser } from '@/lib/auth';
import { landingFor } from '@/lib/landing';
import { AuthShell, Field, SubmitButton } from '@/components/auth-shell';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  // Already signed in: operators go to /ops, dealers to /admin. See
  // src/lib/landing.ts.
  const signedIn = await getSessionUser();
  if (signedIn) redirect(await landingFor(signedIn.id));

  async function submit(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    if (email) {
      try {
        await auth.api.requestPasswordReset({
          body: { email, redirectTo: '/reset-password' },
        });
      } catch {
        // Swallowed for the same reason the send failure is: a thrown error
        // here would distinguish a real address from an unknown one.
      }
    }
    redirect('/forgot-password?sent=1');
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="If that address is on file, a reset link is on its way."
        footer={
          <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
            Back to sign in
          </Link>
        }
      >
        <p className="mt-4 text-xs text-ink-400">
          The link works once and expires in an hour. If it does not arrive within a few
          minutes, check spam — and if it still is not there, the address may not be the one
          your account uses.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
          Back to sign in
        </Link>
      }
    >
      <form action={submit}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton>Send reset link</SubmitButton>
      </form>
    </AuthShell>
  );
}
