'use client';

/**
 * Ad Desk — inventory health.
 *
 * `FeedHealthPanel` answers the question every dealer eventually asks their
 * vendor — "why does Facebook show 34 cars when I have 41?" — before they have
 * to ask it, and with a fix attached to each reason. Every competitor in this
 * category drops those seven units silently; that is the complaint
 * `claude/meta-marketplace.md` §3 is about, and this panel is the answer to it.
 *
 * The campaign builder and the running-campaigns list that used to live here
 * moved to `ad-groups-panel.tsx` when copy became per ad and the build became
 * one campaign per lot with a group per shelf. This file is now one panel.
 */

import { Badge, Card, CardHeader } from './ui';
import type { FeedPreview } from '@/lib/meta/feed-preview';

/* ------------------------------------------------------------ feed health */

export function FeedHealthPanel({
  preview,
  metaProductCount,
}: {
  preview: FeedPreview;
  /**
   * What Facebook has ACCEPTED, against this panel's count of what we are
   * SENDING. Null when we could not ask.
   *
   * These two numbers side by side are the entire point of the addition. This
   * panel has always reported intent — `claude/meta-catalog-creation-blocker.md`
   * says so outright: "'What Facebook is getting' reports intent, not
   * acceptance. It counted 7 of 13 while Meta held zero." A dealer reading
   * "22 of 23" reasonably concluded 22 cars were on Facebook. Nobody could see
   * otherwise without leaving the product.
   */
  metaProductCount: number | null;
}) {
  const { total, included, excluded, marketplaceHeld, reasons } = preview;
  const mismatch = metaProductCount !== null && metaProductCount !== included;

  return (
    <Card>
      <CardHeader
        title="What Facebook is getting"
        subtitle={`${preview.rooftopName} — the inventory feed, unit by unit`}
        action={
          excluded === 0 && marketplaceHeld === 0 ? (
            <Badge tone="green">All {total} units</Badge>
          ) : (
            <Badge tone="amber">
              {included} of {total}
            </Badge>
          )
        }
      />

      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tally n={included} label="in the catalog" tone="ink" />
          <Tally n={marketplaceHeld} label="held off Marketplace" tone="amber" />
          <Tally n={excluded} label="not advertised" tone="red" />
        </div>

        {metaProductCount !== null ? (
          <p
            className={`rounded-lg px-3 py-2 text-xs ${
              metaProductCount === 0
                ? 'bg-amber-50 text-amber-900'
                : mismatch
                  ? 'bg-amber-50 text-amber-900'
                  : 'bg-emerald-50 text-emerald-800'
            }`}
          >
            Rooftop is sending <strong>{included}</strong> · Facebook has accepted{' '}
            <strong>{metaProductCount}</strong>
            {metaProductCount === 0
              ? '. Nothing can run until that second number moves.'
              : mismatch
                ? '. Facebook rejected the difference — contact us and we will read the reason back from them.'
                : '.'}
          </p>
        ) : null}

        {reasons.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Every unit on this lot is eligible for every placement, including Marketplace.
          </p>
        ) : (
          <ul className="space-y-2">
            {reasons.map((r) => (
              <li
                key={r.code}
                className={`rounded-lg px-3 py-2.5 text-xs ${
                  r.scope === 'FEED' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{r.reason}</span>
                  <span className="shrink-0 tabular-nums opacity-70">
                    {r.count} {r.count === 1 ? 'unit' : 'units'}
                  </span>
                </div>
                {r.fix ? <p className="mt-1 opacity-80">{r.fix}</p> : null}
                {r.examples.length ? (
                  <p className="mt-1 font-mono text-[10px] opacity-60">
                    e.g. {r.examples.join(', ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-ink-500">
          &ldquo;Held off Marketplace&rdquo; means the unit still runs in Facebook and Instagram feeds
          — it just can&apos;t appear in the Marketplace surface until the reason above is cleared.
          These are Facebook&apos;s rules, not ours.
        </p>
      </div>
    </Card>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: 'ink' | 'amber' | 'red' }) {
  const color =
    tone === 'red' && n > 0
      ? 'text-red-700'
      : tone === 'amber' && n > 0
        ? 'text-amber-700'
        : 'text-ink-900';
  return (
    <div className="rounded-lg bg-ink-50 px-2 py-2.5">
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{n}</div>
      <div className="text-[11px] text-ink-600">{label}</div>
    </div>
  );
}
