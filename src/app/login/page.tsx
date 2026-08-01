import { redirect } from 'next/navigation';
import { DEMO_USER, isSignedIn, signIn } from '@/lib/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await isSignedIn()) redirect('/admin');

  async function submit(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');
    if (email !== DEMO_USER.email || password !== DEMO_USER.password) {
      redirect('/login?error=1');
    }
    await signIn();
    redirect('/admin');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-lg font-black text-ink-950">
            R
          </div>
          <div>
            <div className="text-lg font-semibold leading-tight text-white">Rooftop Auto</div>
            <div className="text-[11px] uppercase tracking-widest text-ink-400">
              Inventory · Merchandising · Syndication
            </div>
          </div>
        </div>

        <form action={submit} className="rounded-2xl border border-ink-800 bg-ink-900 p-6">
          <h1 className="text-base font-semibold text-white">Sign in to your rooftop</h1>
          <p className="mt-1 text-xs text-ink-400">Demo environment — Evergreen Motors Group</p>

          {error ? (
            <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
              That email and password combination did not match.
            </p>
          ) : null}

          <label className="mt-5 block text-xs font-medium text-ink-300">
            Email
            <input
              name="email"
              type="email"
              defaultValue={DEMO_USER.email}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>

          <label className="mt-3 block text-xs font-medium text-ink-300">
            Password
            <input
              name="password"
              type="password"
              defaultValue={DEMO_USER.password}
              className="mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>

          <button className="mt-5 w-full rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-ink-950 hover:bg-emerald-400">
            Sign in
          </button>

          <p className="mt-4 text-center text-[11px] text-ink-500">
            Credentials are pre-filled for the demo.
          </p>
        </form>
      </div>
    </div>
  );
}
