import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, getSessionUser } from '@/lib/auth';
import { AuthShell, Field, SubmitButton } from '@/components/auth-shell';
import { findLiveInvite } from '@/lib/invites';
import { ROLE_LABEL, ROLE_BLURB } from '@/lib/permissions';
import type { UserRole } from '@/db/schema';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  weak: 'Password needs to be at least 8 characters.',
  missing: 'Fill in every field to continue.',
  taken: 'An account already exists for that email address. Try signing in instead.',
  stale: 'This invitation is no longer valid. Ask for a new one.',
  failed: 'Something went wrong creating the account. Try again.',
};

/**
 * Accept an invitation.
 *
 * The email is **shown, not editable**. It is what the token was issued
 * against and what the create hook checks, so an editable field could only ever
 * produce a confusing failure. The role is shown too — someone should know what
 * they are being handed before they set a password, and "why can't I see the
 * ad account" is a worse first day than being told up front.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  // Already signed in as somebody: sending them to /admin is right, because
  // accepting would mean creating a second account they did not ask for.
  if (await getSessionUser()) redirect('/admin');

  const invite = await findLiveInvite(token);

  if (!invite) {
    return (
      <AuthShell
        title="That invitation has expired"
        subtitle="Invitations last seven days, and can be cancelled by whoever sent them."
        footer={
          <>
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
              Sign in
            </Link>
          </>
        }
      >
        <p className="text-sm text-ink-400">
          Ask whoever invited you to send another one — it takes them about ten seconds.
        </p>
      </AuthShell>
    );
  }

  const role = invite.role as UserRole;

  async function submit(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const back = `/invite/${token}`;

    if (!name || !password) redirect(`${back}?error=missing`);
    if (password.length < 8) redirect(`${back}?error=weak`);

    try {
      // `inviteToken` rides in the body and is read by the user-create hook in
      // auth-config.ts, which validates it, resolves the group and role, and
      // marks the invite accepted. The email comes from the invite rather than
      // the form — see the note above.
      await auth.api.signUpEmail({
        body: { name, email: invite!.email, password, inviteToken: token } as never,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message.toLowerCase() : '';
      if (message.includes('no longer valid')) redirect(`${back}?error=stale`);
      if (message.includes('exist') || message.includes('unique')) redirect(`${back}?error=taken`);
      redirect(`${back}?error=failed`);
    }
    redirect('/admin');
  }

  return (
    <AuthShell
      title={`Join ${invite.groupName}`}
      subtitle={`You have been set up as ${ROLE_LABEL[role]}. Pick a password and you are in.`}
      error={error ? (ERRORS[error] ?? ERRORS.failed) : null}
      footer={
        <>
          Not you?{' '}
          <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
            Sign in to a different account
          </Link>
        </>
      }
    >
      <div className="mb-5 rounded-lg border border-ink-700 bg-ink-900/60 px-3.5 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Signing up as
        </div>
        <div className="mt-1 text-sm font-medium text-white">{invite.email}</div>
        <div className="mt-2 text-xs text-ink-400">
          <span className="font-semibold text-ink-300">{ROLE_LABEL[role]}</span> —{' '}
          {ROLE_BLURB[role]}
        </div>
      </div>

      <form action={submit}>
        <Field label="Your name" name="name" autoComplete="name" required maxLength={120} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <SubmitButton>Join {invite.groupName}</SubmitButton>
      </form>
    </AuthShell>
  );
}
