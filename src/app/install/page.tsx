import Link from 'next/link';
import { RooftopLockup } from '@/components/brand';
import { InstallPanel } from '@/components/install-app';
import { PwaRegister } from '@/components/pwa-register';
import { pwaMetadata, pwaViewport } from '@/lib/pwa';

/**
 * The link you send a dealer.
 *
 * PUBLIC ON PURPOSE, AND IT HOLDS NOTHING. No inventory, no dealer names, no
 * session — a button and some instructions. That is the whole security story:
 * texting someone this link exposes strictly less than texting them a link to
 * any signed-in screen, which is what the alternative would have been.
 *
 * It is also why installing does not require an account. The manifest is on
 * `/login` and `/signup` as well, so a dealer installs first and signs in once,
 * inside the app, rather than signing in twice around it.
 *
 * `PwaRegister` matters here specifically: Chrome will not fire
 * `beforeinstallprompt` without a registered service worker, and the admin
 * layout that normally registers it is behind auth. Without this line the
 * Install button on this page would never appear for a signed-out dealer,
 * which is the only person it exists for.
 */

export const metadata = { ...pwaMetadata, title: 'Install Rooftop Auto' };
export const viewport = pwaViewport;

export default function InstallPage() {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <PwaRegister />

      <header className="bg-ink-950 px-5 py-4">
        <RooftopLockup />
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          Put Rooftop on your phone
        </h1>
        <p className="mt-2 mb-6 text-sm leading-relaxed text-ink-600">
          Your inventory, your leads and your listings, one tap from the home screen. It installs
          like an app but there is nothing to download — no app store, no updates to chase.
        </p>

        <InstallPanel />

        <div className="mt-8 border-t border-ink-200 pt-5 text-sm text-ink-600">
          <p className="font-medium text-ink-800">Then sign in once, inside the app.</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            You do not need an account to install it. Already set up?{' '}
            <Link href="/login" className="font-medium text-ink-800 underline underline-offset-2">
              Sign in
            </Link>
            {' · '}
            New lot?{' '}
            <Link href="/signup" className="font-medium text-ink-800 underline underline-offset-2">
              Start a dealership
            </Link>
          </p>
        </div>
      </main>

      <footer className="px-5 py-6 text-center text-xs text-ink-400">
        Rooftop Auto — a Litespeed company
      </footer>
    </div>
  );
}
