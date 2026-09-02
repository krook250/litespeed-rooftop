import Link from 'next/link';
import { requireSession, signOut } from '@/lib/auth';
import { getGroup, getStorefronts, resolveFeedStyle } from '@/lib/queries';
import { redirect } from 'next/navigation';
import { AdminNav } from '@/components/admin-nav';
import { AdminMobileNav } from '@/components/admin-mobile-nav';
import { RooftopWordmark } from '@/components/brand';
import { PwaRegister } from '@/components/pwa-register';
import { InstallButton } from '@/components/install-app';
import { pwaMetadata, pwaViewport } from '@/lib/pwa';

/**
 * The installable-app head lives here and on the auth screens, never in the
 * root layout — a dealer storefront shares that root. See src/lib/pwa.ts.
 */
export const metadata = pwaMetadata;
export const viewport = pwaViewport;

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  SALES: 'Sales',
  LOT_PORTER: 'Lot porter',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const [group, storefronts, feed] = await Promise.all([
    getGroup(),
    getStorefronts(),
    resolveFeedStyle(user),
  ]);

  async function doSignOut() {
    'use server';
    await signOut();
    redirect('/login');
  }

  /**
   * Built once and rendered twice — into the desktop sidebar and into the
   * mobile drawer. Two copies of a link list is how a menu quietly goes stale
   * on the platform nobody on the team is testing on.
   */
  const sidebar = (
    <>
      <AdminNav feedLabel={feed.style === 'LOG' ? 'Activity' : 'Lot Walk'} />

      <div className="mt-auto border-t border-ink-800 px-3 py-4">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Storefronts
          </div>
          {storefronts.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-ink-500">None yet</div>
          ) : (
            storefronts.map((s) => (
              <Link
                key={s.id}
                href={`/s/${s.slug}`}
                target="_blank"
                className="block rounded-md px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 hover:text-white"
              >
                {s.name.replace(`${group.name} `, '')} ↗
              </Link>
            ))
          )}
          {/* Renders nothing inside the installed app, and nothing on a
              browser that cannot install. Only a dealer who could act on it
              ever sees it. */}
          <InstallButton />

          <form action={doSignOut} className="mt-3 border-t border-ink-800 pt-3">
            <div className="px-2 text-xs font-medium text-white">{user.name}</div>
            <div className="px-2 text-[11px] text-ink-400">
              {ROLE_LABEL[user.role] ?? user.role} · {group.name}
            </div>
            <button className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-400 hover:bg-ink-800 hover:text-white">
              Sign out
            </button>
          </form>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-ink-50">
      <PwaRegister />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 pt-[env(safe-area-inset-top)] lg:flex">
        <div className="px-5 py-5">
          <RooftopWordmark height={17} />
        </div>
        {sidebar}
      </aside>

      <div className="min-w-0 flex-1 pb-[env(safe-area-inset-bottom)] lg:pt-[env(safe-area-inset-top)]">
        {/* Wordmark only inside the console — the house/car mark and the
            "A Litespeed company" line are for signed-out chrome and the
            marketing site, not for every page a dealer works on. */}
        <AdminMobileNav brand={<RooftopWordmark height={17} />}>{sidebar}</AdminMobileNav>
        {children}
      </div>
    </div>
  );
}
