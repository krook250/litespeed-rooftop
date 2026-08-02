import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, getSessionUser } from '@/lib/auth';
import { AuthShell, Field, SubmitButton } from '@/components/auth-shell';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await getSessionUser()) redirect('/admin');

  async function submit(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');
    if (!email || !password) redirect('/login?error=1');

    try {
      await auth.api.signInEmail({ body: { email, password } });
    } catch {
      redirect('/login?error=1');
    }
    redirect('/admin');
  }

  return (
    <AuthShell
      title="Sign in to your rooftop"
      subtitle="Inventory, merchandising and syndication in one place."
      error={error ? 'That email and password combination did not match.' : null}
      footer={
        <>
          No account yet?{' '}
          <Link href="/signup" className="font-medium text-emerald-400 hover:text-emerald-300">
            Start a dealership
          </Link>
        </>
      }
    >
      <form action={submit}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton>Sign in</SubmitButton>
      </form>
    </AuthShell>
  );
}
