import Link from 'next/link';
import { requireSection } from '@/lib/auth-guard';
import { EmptyState, cn } from '@/components/ui';
import { Composer } from '@/components/social/composer';
import { PostList } from '@/components/social/post-list';
import { loadSocial } from '@/lib/social/screen';

export const dynamic = 'force-dynamic';

/**
 * Social — posting to the lot's own Facebook Page and Instagram.
 *
 * Top to bottom: which accounts this posts as (or what's stopping it), a new
 * post, what's coming up, what went out. Organic posts only; ads are the Ad
 * Desk. One lot at a time, because each lot has its own Page.
 */
export default async function SocialPage({ searchParams }: { searchParams: Promise<{ lot?: string }> }) {
  await requireSection('social');
  const { lot } = await searchParams;
  const data = await loadSocial(lot);
  if (!data) return <EmptyState title="No lots yet" body="Add a lot and its Facebook Page first." />;
  const { accounts } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">Social</h1>
        <p className="mt-0.5 text-sm text-ink-600">Post your cars to your Facebook Page and Instagram.</p>
      </header>

      {data.lots.length > 1 ? (
        <nav className="flex flex-wrap gap-2">
          {data.lots.map((l) => (
            <Link
              key={l.id}
              href={`/admin/social?lot=${l.id}`}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset',
                l.id === data.lotId ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
              )}
            >
              {l.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {accounts.state === 'ready' ? (
        <p className="text-sm text-ink-700">
          Posting as <b>{accounts.pageName}</b> on Facebook
          {accounts.igUsername ? (
            <>
              {' '}
              and <b>@{accounts.igUsername}</b> on Instagram
              {!accounts.instagramAllowed ? ' (Instagram needs one more Connect click on the Ad Desk)' : ''}.
            </>
          ) : (
            <>. No Instagram account is linked to this Page — link one in Meta Business Suite to post there too.</>
          )}
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{accounts.message}</span>
          <Link href="/admin/ad-desk/connect" className="rounded-md bg-ink-900 px-3 py-1.5 text-sm font-medium text-white">
            {accounts.reconnect ? 'Go to Connect' : 'Pick a Page'}
          </Link>
        </div>
      )}

      <Composer key={data.lotId} lotId={data.lotId} accounts={accounts} units={data.units} videos={data.videos} />
      <PostList posts={data.posts} />
    </div>
  );
}
