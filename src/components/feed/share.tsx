'use client';

/**
 * Share a Lot Walk card to the dealership's own social feeds.
 *
 * **This does not post anything.** It writes the caption, hands over the photo
 * and opens the network's own composer with the link prefilled — the person
 * hits post. That is deliberate for now: publishing straight to a dealer's
 * Facebook page needs `pages_manage_posts`, which needs App Review, which is
 * tracked separately in `claude/meta-app-review-runbook.md`. When that lands
 * this component grows a "Post it for me" button and everything else here
 * stays; until then a copy-and-paste that takes ten seconds beats a feature
 * that is blocked on a reviewer.
 *
 * The caption is a starting point, not a template to be sent as-is — it is an
 * editable textarea because the person posting knows their own voice and the
 * one thing worse than no dealer social presence is an obviously automated one.
 */

import { useState } from 'react';
import { cn } from '@/components/ui';

export type ShareContent = {
  caption: string;
  url: string | null;
  photo: string | null;
};

export function ShareButton({ content }: { content: ShareContent }) {
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState(content.caption);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        content.url ? `${caption}\n\n${content.url}` : caption,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is permission-gated and refuses in some browsers. The
      // textarea is right there and selectable, so a failure is survivable.
      setCopied(false);
    }
  };

  const fbHref = content.url
    ? `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(content.url)}`
    : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors',
          open ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100',
        )}
      >
        Share
      </button>

      {open ? (
        <div className="order-last mt-1.5 w-full border-t border-ink-100 pt-2.5">
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-lg border border-ink-200 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-ink-400"
          />
          {content.url ? (
            <div className="tnum mt-1 truncate text-[11px] text-ink-500">{content.url}</div>
          ) : (
            <div className="mt-1 text-[11px] text-ink-500">
              No public link — this storefront has no custom domain yet.
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800"
            >
              {copied ? 'Copied' : 'Copy caption'}
            </button>
            {content.photo ? (
              <a
                href={content.photo}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
              >
                Open the photo
              </a>
            ) : null}
            {fbHref ? (
              <a
                href={fbHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
              >
                Open Facebook
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
