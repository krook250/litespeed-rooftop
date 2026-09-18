'use client';

/**
 * One group, as a row on the list.
 *
 * The row does exactly three things: say what the group is, say what it has
 * done, and offer the two buttons that matter. Editing happens on the group's
 * own page — the old screen put the editors here and that is what made it
 * unreadable.
 *
 * It opens to show the ads inside it and what each one cost per click, which
 * is the one question a second ad was written to answer. Numbers only: the
 * editors stay on the group's page, or this becomes the old screen again.
 */

/** Cost per click, or null when nothing has been clicked yet. */
const cpc = (spend: number, clicks: number) => (clicks > 0 ? spend / clicks : null);

/**
 * Below this, one ad looking cheaper than another is chance, and a dealer who
 * is told which ad is winning will act on it. So the numbers always show and
 * the verdict waits.
 */
const ENOUGH_CLICKS = 50;

import { LinkButton } from '../link-pending';
import { useActionState, useState } from 'react';
import { Badge, Button } from '../ui';
import { adoptGroupAction, setGroupRunningAction } from '@/lib/meta/demo-actions';
import { dollars, money } from './format';
import type { LotGroup } from '@/lib/meta/campaigns';

export function GroupRow({
  rooftopId,
  group,
  adCount,
  shelfCount,
  adoptable,
  displayName,
  rule,
}: {
  rooftopId: string;
  group: LotGroup;
  /** Saved, switched-on ads for this shelf. */
  adCount: number;
  /** Cars the shelf holds right now, or null when inventory could not be read. */
  shelfCount: number | null;
  /** Shelves with no group yet — what an unmapped ad set may be taken over as. */
  adoptable: { key: string; label: string }[];
  /** What the dealer named it here. The ad set at Meta still carries the shelf label. */
  displayName?: string;
  /** The narrowing, in English. Empty when the group is the whole shelf. */
  rule?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, switching] = useActionState(setGroupRunningAction, null);
  const [adoptState, adoptAction, adopting] = useActionState(adoptGroupAction, null);
  const running = group.effectiveStatus === 'ACTIVE';
  const bucket = group.bucketKey;
  const href = bucket ? `/admin/ad-desk/ads/${rooftopId}/${bucket}` : null;

  const live = group.ads;
  const groupCpc = cpc(group.spend, group.clicks);
  // The verdict needs two ads that have each had a fair run, not one that got
  // lucky on twenty clicks while the other sat at three.
  const judged = live.filter((a) => a.clicks >= ENOUGH_CLICKS);
  const best =
    judged.length >= 2
      ? judged.reduce((a, b) => (cpc(a.spend, a.clicks)! <= cpc(b.spend, b.clicks)! ? a : b)).id
      : null;

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {live.length ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex items-center gap-1.5 text-sm font-semibold text-ink-900 hover:text-ink-600"
              >
                <span
                  aria-hidden
                  className={`text-[10px] text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`}
                >
                  ▶
                </span>
                {displayName || group.name}
              </button>
            ) : (
              <span className="text-sm font-semibold text-ink-900">
                {displayName || group.name}
              </span>
            )}
            {running ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-ink-600">
            {shelfCount !== null ? <span>{shelfCount} cars</span> : null}
            {rule ? <span className="text-ink-900">{rule}</span> : null}
            {group.dailyBudgetUsd !== null ? <span>{money(group.dailyBudgetUsd)} a day</span> : null}
            {group.radiusMiles !== null ? <span>{group.radiusMiles} miles</span> : null}
            <span>
              {adCount} {adCount === 1 ? 'ad' : 'ads'}
            </span>
          </div>
        </div>

        <div className="flex gap-6 tabular-nums">
          <div className="text-right">
            <div className="text-sm font-semibold text-ink-900">{money(group.spend)}</div>
            <div className="text-[11px] text-ink-500">spent</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-ink-900">{group.clicks.toLocaleString()}</div>
            <div className="text-[11px] text-ink-500">clicks</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-ink-900">
              {groupCpc === null ? '—' : dollars(groupCpc)}
            </div>
            <div className="text-[11px] text-ink-500">per click</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {bucket ? (
            <form action={action}>
              <input type="hidden" name="rooftopId" value={rooftopId} />
              <input type="hidden" name="adSetId" value={group.id} />
              <input type="hidden" name="running" value={running ? 'false' : 'true'} />
              <Button
                type="submit"
                variant={running ? 'secondary' : 'primary'}
                size="sm"
                disabled={switching || group.ads.length === 0}
              >
                {switching ? '…' : running ? 'Stop' : 'Start'}
              </Button>
            </form>
          ) : null}
          {href ? (
            <LinkButton href={href} size="sm">
              Edit ›
            </LinkButton>
          ) : null}
        </div>
      </div>

      {open && live.length ? (
        <div className="border-t border-ink-200 bg-ink-50/60 px-4 py-3">
          <table className="w-full text-[11px] tabular-nums">
            <tbody>
              {[...live]
                .sort((a, b) => b.clicks - a.clicks)
                .map((ad) => {
                  const adCpc = cpc(ad.spend, ad.clicks);
                  const off = ad.effectiveStatus !== 'ACTIVE';
                  return (
                    <tr key={ad.id} className={off ? 'text-ink-400' : 'text-ink-700'}>
                      <td className="py-1 pr-3">
                        <span className={off ? '' : 'font-medium text-ink-900'}>{ad.name}</span>
                        {ad.id === best ? (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            Best so far
                          </span>
                        ) : null}
                        {off ? <span className="ml-2 text-[10px]">Off</span> : null}
                      </td>
                      <td className="py-1 pr-3 text-right">{money(ad.spend)} spent</td>
                      <td className="py-1 pr-3 text-right">
                        {ad.clicks.toLocaleString()} clicks
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {adCpc === null ? '—' : `${dollars(adCpc)} per click`}
                      </td>
                      <td className="py-1 text-right">
                        {href ? (
                          <a href={href} className="text-ink-600 underline hover:text-ink-900">
                            Edit copy ›
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-ink-500">
            Since this group started.
            {best === null && live.length > 1
              ? ` Too early to call a winner — each ad needs about ${ENOUGH_CLICKS} clicks first.`
              : ''}
          </p>
        </div>
      ) : null}

      {/*
        A group whose ad set was renamed in Ads Manager no longer maps to a
        shelf, so none of our buttons can safely act on it. Say that, rather
        than showing controls that would build against the wrong thing.
      */}
      {!bucket ? (
        <div className="space-y-2 border-t border-ink-200 bg-amber-50 px-4 py-3">
          <p className="text-[11px] text-amber-900">
            Rooftop can’t tell which shelf this one is — its name at Facebook isn’t one of the shelf
            names. Say which shelf it should be and Rooftop will rename it and put its targeting,
            budget and vehicle list back.
          </p>
          {adoptable.length ? (
            <form action={adoptAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="rooftopId" value={rooftopId} />
              <input type="hidden" name="adSetId" value={group.id} />
              <input type="hidden" name="dailyBudget" value={group.dailyBudgetUsd ?? 25} />
              <input type="hidden" name="radiusMiles" value={group.radiusMiles ?? 25} />
              <select
                name="bucket"
                defaultValue={adoptable[0]!.key}
                className="rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-xs text-ink-900"
              >
                {adoptable.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.label}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" disabled={adopting}>
                {adopting ? 'Taking it over…' : 'Take it over'}
              </Button>
            </form>
          ) : (
            <p className="text-[11px] text-amber-900">
              Every shelf already has a group, so there is nothing left for this one to become.
              Stop it here and delete it in Ads Manager.
            </p>
          )}
          {adoptState && !adoptState.ok ? (
            <p className="rounded bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {adoptState.error}
            </p>
          ) : null}
          {adoptState?.ok ? (
            <p className="rounded bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">
              {adoptState.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {state && !state.ok ? (
        <p className="border-t border-ink-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {state.error}
        </p>
      ) : null}
      {state?.ok && state.message ? (
        <p className="border-t border-ink-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
