'use client';

/**
 * Upcoming and recent posts. Each row says what it was, when, and per
 * platform whether it went out — with a link to it when it did.
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader, cn } from '@/components/ui';
import { cancelPost, checkPost, retryPost } from '@/lib/social/actions';
import type { SocialPostView } from '@/lib/social/view';

const SOURCE_WORDS: Record<SocialPostView['source'], string | null> = {
  MANUAL: null,
  AUTO_RANDOM: 'Auto',
  NEW_ARRIVAL: 'New arrival',
  PRICE_DROP: 'Price drop',
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function PostList({ posts }: { posts: SocialPostView[] }) {
  const upcoming = posts.filter((p) => p.status === 'SCHEDULED' || p.status === 'POSTING').reverse();
  const recent = posts.filter((p) => p.status !== 'SCHEDULED' && p.status !== 'POSTING');

  return (
    <>
      <Card>
        <CardHeader title="Coming up" subtitle={upcoming.length ? undefined : 'Nothing scheduled.'} />
        {upcoming.length ? (
          <ul className="divide-y divide-ink-100">
            {upcoming.map((p) => (
              <Row key={p.id} initial={p} />
            ))}
          </ul>
        ) : null}
      </Card>
      <Card>
        <CardHeader title="Posted · last 30 days" subtitle={recent.length ? undefined : 'Nothing yet.'} />
        {recent.length ? (
          <ul className="divide-y divide-ink-100">
            {recent.map((p) => (
              <Row key={p.id} initial={p} />
            ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}

function Row({ initial }: { initial: SocialPostView }) {
  const [p, setP] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setP(initial);
  }

  // Instagram video publishes minutes after the click; keep asking until it lands.
  useEffect(() => {
    if (p.status !== 'POSTING') return;
    const timer = setInterval(async () => {
      const next = await checkPost(p.id).catch(() => null);
      if (next && next.status !== 'POSTING') setP(next);
    }, 6000);
    return () => clearInterval(timer);
  }, [p.id, p.status]);

  const headline = p.vehicle ?? (p.caption.split('\n')[0] || (p.isVideo ? 'Video' : 'Post'));
  const tag = SOURCE_WORDS[p.source];

  return (
    <li className="flex gap-3 px-5 py-3">
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md bg-ink-100">
        {p.thumb ? <img src={p.thumb} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="truncate font-medium text-ink-900">{headline}</span>
          {p.isVideo ? <span className="text-xs text-ink-500">video</span> : null}
          {tag ? <span className="rounded bg-ink-100 px-1.5 text-[11px] font-medium text-ink-600">{tag}</span> : null}
        </div>
        <div className="text-xs text-ink-500">
          {p.status === 'CANCELED' ? 'Canceled · ' : ''}
          {when(p.scheduledFor)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {p.targets.map((x) => (
            <span key={x.platform} className="flex items-baseline gap-1">
              <span className="font-medium text-ink-700">{x.platform === 'FACEBOOK' ? 'Facebook' : 'Instagram'}</span>
              {x.status === 'POSTED' ? (
                x.permalink ? (
                  <a href={x.permalink} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline">
                    Posted ↗
                  </a>
                ) : (
                  <span className="text-emerald-700">Posted</span>
                )
              ) : x.status === 'FAILED' ? (
                <span className="text-red-700">Failed — {x.error}</span>
              ) : x.status === 'PROCESSING' ? (
                <span className="text-ink-500">Posting…</span>
              ) : (
                <span className="text-ink-500">Waiting</span>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0 self-center">
        {p.status === 'SCHEDULED' ? (
          <form action={cancelPost}>
            <input type="hidden" name="postId" value={p.id} />
            <button className="rounded-md border border-ink-300 px-2 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50">
              Cancel
            </button>
          </form>
        ) : p.status === 'FAILED' || p.status === 'PARTIAL' ? (
          <form action={retryPost}>
            <input type="hidden" name="postId" value={p.id} />
            <button className={cn('rounded-md border border-ink-300 px-2 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50')}>
              Try again
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
