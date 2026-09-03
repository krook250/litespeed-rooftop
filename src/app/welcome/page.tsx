import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { MetaPixel } from '@/components/meta-pixel';
import { GoogleAnalytics } from '@/components/ga';
import { WelcomeHandoff } from './handoff';

/*
 * The signup conversion hop.
 *
 * `signUpEmail` finishes inside a server action, so the browser never lands on
 * a page that means "an account was just created" — and a conversion event
 * fired from the form's submit handler would count the failures and the
 * duplicates too. This page is that landing: it exists for exactly as long as
 * it takes to fire `CompleteRegistration`, then hands off to /admin.
 *
 * The handoff is a client-side navigation on purpose. The document is never
 * torn down, so `fbevents.js` finishes loading and drains its queued event even
 * though the dealer is already looking at their feed.
 */
export const metadata: Metadata = {
  title: 'Rooftop Auto',
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  // Reachable only with a live session — i.e. only just after a real signup.
  // Without this, anyone could load /welcome and mint a conversion.
  if (!(await getSessionUser())) redirect('/login');

  return (
    <>
      <MetaPixel event="CompleteRegistration" />
      <GoogleAnalytics event="sign_up" />
      <WelcomeHandoff />
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-400">
        Setting up your dealership…
      </main>
    </>
  );
}
