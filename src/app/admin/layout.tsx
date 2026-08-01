import Link from 'next/link';
import { requireSession, signOut } from '@/lib/auth';
import { getStorefronts } from '@/lib/queries';
import { redirect } from 'next/navigation';
import { AdminNav } from '@/components/admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  const storefronts = await getStorefronts();

  async function doSignOut() {
    'use server';
    await signOut();
    redirect('/login');
  }

  return (
    <div className="flex min-h-screen bg-ink-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-sm font-black text-ink-950">
            R
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-white">Rooftop</div>
            <div className="text-[10px] uppercase tracking-widest text-ink-400">Auto</div>
          </div>
        </div>

        <AdminNav />

        <div className="mt-auto border-t border-ink-800 px-3 py-4">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-500">
            Storefronts
          </div>
          {storefronts.map((s) => (
            <Link
              key={s.id}
              href={`/s/${s.slug}`}
              target="_blank"
              className="block rounded-md px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800 hover:text-white"
            >
              {s.name.replace('Evergreen Motors ', '')} ↗
            </Link>
          ))}
          <form action={doSignOut} className="mt-3 border-t border-ink-800 pt-3">
            <div className="px-2 text-xs font-medium text-white">{user.name}</div>
            <div className="px-2 text-[11px] text-ink-400">{user.role} · Evergreen Motors</div>
            <button className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-ink-400 hover:bg-ink-800 hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
