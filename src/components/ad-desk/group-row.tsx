'use client';

/**
 * One group, as a row on the list.
 *
 * The row does exactly three things: say what the group is, say what it has
 * done, and offer the two buttons that matter. Editing happens on the group's
 * own page — the old screen put the editors here and that is what made it
 * unreadable.
 */

import { LinkButton } from '../link-pending';
import { useActionState } from 'react';
import { Badge, Button } from '../ui';
import { adoptGroupAction, setGroupRunningAction } from '@/lib/meta/demo-actions';
import { money } from './format';
import type { LotGroup } from '@/lib/meta/campaigns';

export function GroupRow({
  rooftopId,
  group,
  adCount,
  shelfCount,
  adoptable,
}: {
  rooftopId: string;
  group: LotGroup;
  /** Saved, switched-on ads for this shelf. */
  adCount: number;
  /** Cars the shelf holds right now, or null when inventory could not be read. */
  shelfCount: number | null;
  /** Shelves with no group yet — what an unmapped ad set may be taken over as. */
  adoptable: { key: string; label: string }[];
}) {
  const [state, action, switching] = useActionState(setGroupRunningAction, null);
  const [adoptState, adoptAction, adopting] = useActionState(adoptGroupAction, null);
  const running = group.effectiveStatus === 'ACTIVE';
  const bucket = group.bucketKey;
  const href = bucket ? `/admin/ad-desk/ads/${rooftopId}/${bucket}` : null;

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-ink-900">{group.name}</span>
            {running ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-ink-600">
            {shelfCount !== null ? <span>{shelfCount} cars</span> : null}
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
