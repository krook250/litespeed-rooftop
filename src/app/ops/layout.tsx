import Link from 'next/link';
import { requireStaff } from '@/lib/ops/guard';

/**
 * Deliberately does not look like the dealer admin.
 *
 * Same browser, same session, same database — and every number on these screens
 * is somebody else's business. The dark bar is not decoration; it is the only
 * thing distinguishing "I am looking at my own lot" from "I am looking at all of
 * them" at a glance, and getting that wrong is how an operator edits the wrong
 * dealer's connection.
 */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff();

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-amber-700 bg-ink-950">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <Link href="/ops" className="text-sm font-semibold text-white">
            Rooftop Ops
          </Link>
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            every dealer
          </span>
          <Link href="/ops" className="text-xs text-ink-300 hover:text-white">
            Onboarding
          </Link>
          <Link href="/ops/accounts" className="text-xs text-ink-300 hover:text-white">
            Accounts
          </Link>
          <span className="ml-auto text-xs text-ink-400">{me.email}</span>
          {/* An operator's own dealer group is a real (and empty) lot of their
              own, not an admin view of somebody else's -- see
              src/lib/ops/guard.ts. Signing in now lands here rather than there,
              so the label says which lot it means. */}
          <Link href="/admin" className="text-xs text-ink-300 hover:text-white">
            My dealership
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
