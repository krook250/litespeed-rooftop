/**
 * Choose a new password.
 *
 * Reached only by following the emailed link, which lands on Better Auth's
 * `/api/auth/reset-password/{token}` first. That endpoint checks the token
 * exists and has not expired, then redirects here with it on the query string —
 * so a stale link fails there and never renders this form, and by the time this
 * page draws, the token was valid a moment ago.
 *
 * The token is still re-checked on submit, because "valid when the page loaded"
 * is not the same as "valid now": it is single-use and consumed by
 * `resetPassword`, so a back-button resubmit or a double-click must fail rather
 * than appear to succeed.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, getSessionUser } from '@/lib/auth';
import { landingFor } from '@/lib/landing';
import { AuthShell, Field, SubmitButton } from '@/components/auth-shell';

const MIN_PASSWORD = 8;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  // Already signed in: operators go to /ops, dealers to /admin. See
  // src/lib/landing.ts.
  const signedIn = await getSessionUser();
  if (signedIn) redirect(await landingFor(signedIn.id));

  // No token means the link was mangled, already used, or somebody typed the
  // URL. Nothing to do here but send them round again.
  if (!token) {
    return (
      <AuthShell
        title="That link has expired"
        subtitle="Reset links work once and last an hour."
        footer={
          <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
            Back to sign in
          </Link>
        }
      >
        <p className="mt-4 text-xs text-ink-400">
          <Link href="/forgot-password" className="font-medium text-emerald-400 hover:text-emerald-300">
            Ask for a new link
          </Link>{' '}
          and we&rsquo;ll send another.
        </p>
      </AuthShell>
    );
  }

  async function submit(formData: FormData) {
    'use server';
    const newPassword = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');
    const t = String(formData.get('token') ?? '');

    if (newPassword.length < MIN_PASSWORD) redirect(`/reset-password?token=${t}&error=short`);
    if (newPassword !== confirm) redirect(`/reset-password?token=${t}&error=match`);

    try {
      await auth.api.resetPassword({ body: { newPassword, token: t } });
    } catch {
      // The token is consumed on a successful reset, so the common cause of a
      // failure here is a second submit of a form that already worked.
      redirect('/reset-password?error=token');
    }
    // Deliberately not auto-signed-in. Typing the new password once, straight
    // away, is what makes it stick — and it proves the reset actually took.
    redirect('/login?reset=1');
  }

  const message =
    error === 'short'
      ? `Pick a password of at least ${MIN_PASSWORD} characters.`
      : error === 'match'
        ? 'Those two passwords do not match.'
        : error === 'token'
          ? 'That link has already been used. Ask for a new one.'
          : null;

  return (
    <AuthShell
      title="Choose a new password"
      error={message}
      footer={
        <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
          Back to sign in
        </Link>
      }
    >
      <form action={submit}>
        <input type="hidden" name="token" value={token} />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
        />
        <Field
          label="Confirm new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
        />
        <SubmitButton>Set new password</SubmitButton>
      </form>
    </AuthShell>
  );
}
