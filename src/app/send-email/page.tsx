import type { Metadata } from 'next';
import { AuthShell, Field, SubmitButton } from '@/components/auth-shell';
import { salesUnlocked, SALES_FROM, SALES_REPLY_TO } from '@/lib/sales-gate';
import { SALES_SUBJECT } from '@/lib/sales-email-template';
import { lock, unlock } from './actions';
import { Compose } from './compose';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Send info email · Rooftop Auto',
  robots: { index: false, follow: false },
};

export default async function SendEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (!(await salesUnlocked())) {
    return (
      <AuthShell
        title="Sales email"
        subtitle="Rooftop Auto sales team only."
        error={error ? 'Wrong password.' : null}
      >
        <form action={unlock}>
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <SubmitButton>Open</SubmitButton>
        </form>
      </AuthShell>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-white">Send the info email</h1>
          <form action={lock}>
            <button className="text-xs text-ink-400 hover:text-ink-200">Lock</button>
          </form>
        </div>
        <Compose from={SALES_FROM} replyTo={SALES_REPLY_TO} subject={SALES_SUBJECT} />
      </div>
    </div>
  );
}
