import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, getSessionUser } from '@/lib/auth';
import { AuthShell, Field, SubmitButton } from '@/components/auth-shell';
import { pwaMetadata, pwaViewport } from '@/lib/pwa';

// Installable from the sign-in screen too — otherwise a dealer who adds the
// app before signing in bookmarks /login instead of the app.
export const metadata = pwaMetadata;
export const viewport = pwaViewport;

const ERRORS: Record<string, string> = {
  taken: 'An account already exists for that email address.',
  weak: 'Password needs to be at least 8 characters.',
  missing: 'Fill in every field to continue.',
  failed: 'Something went wrong creating the account. Try again.',
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await getSessionUser()) redirect('/admin');

  async function submit(formData: FormData) {
    'use server';
    const dealershipName = String(formData.get('dealershipName') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');

    /*
     * Honeypot. A hidden field no human can see and no human fills in; a form
     * bot fills every field it finds. Same trick as `site/contact.php`, and the
     * same response — go to the success page. Telling a bot it was caught is
     * how it learns to stop filling that field.
     *
     * Costs a real dealer nothing, which matters: this is the front door of a
     * paid funnel, and every extra step here is signups that do not happen. The
     * rate limit in `auth-config.ts` is the control that has teeth; this one is
     * free.
     */
    if (String(formData.get('company') ?? '').trim()) redirect('/login');

    if (!dealershipName || !name || !email || !password) redirect('/signup?error=missing');
    if (password.length < 8) redirect('/signup?error=weak');

    try {
      // dealershipName rides along in the body and is read by the user-create
      // hook in lib/auth.ts, which provisions the group, rooftop and storefront.
      await auth.api.signUpEmail({
        body: { name, email, password, dealershipName } as never,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message.toLowerCase() : '';
      if (message.includes('exist') || message.includes('unique')) redirect('/signup?error=taken');
      redirect('/signup?error=failed');
    }
    redirect('/admin');
  }

  return (
    <AuthShell
      title="Start a dealership"
      subtitle="Creates your group, first rooftop and storefront. Takes about ten seconds."
      error={error ? (ERRORS[error] ?? ERRORS.failed) : null}
      footer={
        <>
          Already set up?{' '}
          <Link href="/login" className="font-medium text-emerald-400 hover:text-emerald-300">
            Sign in
          </Link>
        </>
      }
    >
      <form action={submit}>
        {/* Honeypot — see the check in `submit`. `aria-hidden` and
            `tabIndex={-1}` keep it away from screen readers and the tab order;
            `autoComplete="off"` keeps a password manager from helpfully filling
            it and locking a real dealer out of their own signup. */}
        <div className="hidden" aria-hidden="true">
          <label>
            Company
            <input name="company" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        <Field
          label="Dealership name"
          name="dealershipName"
          placeholder="Cascade Motors"
          required
          maxLength={120}
        />
        <Field label="Your name" name="name" autoComplete="name" required maxLength={120} />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="At least 8 characters."
        />
        <SubmitButton>Create account</SubmitButton>
      </form>
    </AuthShell>
  );
}
