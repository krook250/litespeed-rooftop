'use client';

/**
 * One group, as a row on the list.
 *
 * The row does exactly three things: say what the group is, say what it has
 * done, and offer the two buttons that matter. Editing happens on the group's
 * own page — the old screen put the editors here and that is what made it
 * unreadable.
 *
 * It opens to the group's report, top to bottom: each ad side by side, the
 * funnel from shown to lead, and the cars this group's shoppers looked at.
 * Numbers only: the editors stay on the group's page, or this becomes the old
 * screen again.
 *
 * "Clicks" here are LINK clicks — a tap through to a car. Meta's plain
 * `clicks` also counts likes, profile taps and carousel swipes, which made
 * the cost per click look better than what the dealer was actually buying.
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
import { GroupVehicles } from './group-vehicles';
import type { LotGroup } from '@/lib/meta/campaigns';
import { adState, AD_STATE_LABEL } from '@/lib/meta/ad-status';
import type { SiteCounts, SiteReport } from '@/lib/meta/ad-report';

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(n / d < 0.1 ? 1 : 0)}%` : '—');

export function GroupRow({
  rooftopId,
  group,
  adCount,
  shelfCount,
  adoptable,
  displayName,
  rule,
  rangeLabel,
  site,
  adSite,
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
  /** "Last 7 days" — what every number in the row covers. */
  rangeLabel: string;
  /** Visits and leads on the dealer's site credited to this group. Null when none. */
  site: SiteReport | null;
  /** The same, per ad id. */
  adSite: Record<string, SiteCounts>;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, switching] = useActionState(setGroupRunningAction, null);
  const [adoptState, adoptAction, adopting] = useActionState(adoptGroupAction, null);
  const running = group.effectiveStatus === 'ACTIVE';
  const bucket = group.bucketKey;
  const href = bucket ? `/admin/ad-desk/ads/${rooftopId}/${bucket}` : null;

  const live = group.ads;
  const groupCpc = cpc(group.spend, group.linkClicks);
  // The verdict needs two ads that have each had a fair run, not one that got
  // lucky on twenty clicks while the other sat at three.
  const judged = live.filter((a) => a.linkClicks >= ENOUGH_CLICKS);
  const best =
    judged.length >= 2
      ? judged.reduce((a, b) =>
          cpc(a.spend, a.linkClicks)! <= cpc(b.spend, b.linkClicks)! ? a : b,
        ).id
      : null;
  // Site numbers are only credited to a group whose ads carry the tag. Some
  // untagged means the per-ad and funnel site figures undercount, so say so.
  const tagged = live.some((a) => a.tagged);
  const allTagged = live.length > 0 && live.every((a) => a.tagged);
  const visitors = site?.visitors ?? 0;
  const leads = site?.leads ?? 0;
  const name = displayName || group.name;
  const meta = (
    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-ink-600">
      {shelfCount !== null ? <span>{shelfCount} cars</span> : null}
      {rule ? <span className="text-ink-900">{rule}</span> : null}
      {group.dailyBudgetUsd !== null ? <span>{money(group.dailyBudgetUsd)} a day</span> : null}
      {group.radiusMiles !== null ? <span>{group.radiusMiles} miles</span> : null}
      <span>
        {adCount} {adCount === 1 ? 'ad' : 'ads'}
      </span>
    </div>
  );

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
        {live.length ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="group -my-1.5 -ml-2 min-w-[12rem] flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-ink-50"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                aria-hidden
                className={`inline-block text-[10px] text-ink-400 transition-transform group-hover:text-ink-700 ${open ? 'rotate-90' : ''}`}
              >
                ▶
              </span>
              <span className="text-sm font-semibold text-ink-900">{name}</span>
              {running ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
              <span className="text-[11px] text-ink-500 group-hover:text-ink-700">
                {open ? 'Hide report' : 'Show report'}
              </span>
            </div>
            <div className="pl-4">{meta}</div>
          </button>
        ) : (
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink-900">{name}</span>
              {running ? <Badge tone="green">Running</Badge> : <Badge tone="slate">Stopped</Badge>}
            </div>
            {meta}
          </div>
        )}

        <div className="flex gap-6 tabular-nums">
          <div className="text-right">
            <div className="text-sm font-semibold text-ink-900">{money(group.spend)}</div>
            <div className="text-[11px] text-ink-500">spent</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-ink-900">{group.linkClicks.toLocaleString()}</div>
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
        <div className="space-y-5 border-t border-ink-200 bg-ink-50/60 px-4 py-4">
          {/* ------------------------------------------------ the ads */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-ink-900">The ads</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[11px] tabular-nums">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-ink-500">
                    <th className="pb-1 pr-3 font-medium">Ad</th>
                    <th className="pb-1 pr-3 text-right font-medium">Spent</th>
                    <th className="pb-1 pr-3 text-right font-medium">Reached</th>
                    <th className="pb-1 pr-3 text-right font-medium">Clicks</th>
                    <th className="pb-1 pr-3 text-right font-medium" title="Clicks ÷ times shown">
                      Click rate
                    </th>
                    <th className="pb-1 pr-3 text-right font-medium">Per click</th>
                    <th className="pb-1 pr-3 text-right font-medium">Site visitors</th>
                    <th className="pb-1 pr-3 text-right font-medium">Leads</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200/70">
                  {[...live]
                    .sort((a, b) => b.linkClicks - a.linkClicks)
                    .map((ad) => {
                      const adCpc = cpc(ad.spend, ad.linkClicks);
                      const off = ad.effectiveStatus !== 'ACTIVE';
                      const onSite = adSite[ad.id];
                      return (
                        <tr key={ad.id} className={off ? 'text-ink-400' : 'text-ink-700'}>
                          <td className="py-1.5 pr-3">
                            <span className={off ? '' : 'font-medium text-ink-900'}>{ad.name}</span>
                            {ad.id === best ? (
                              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                                Best so far
                              </span>
                            ) : null}
                            {off ? (
                              <span
                                className={`ml-2 text-[10px] ${
                                  adState(ad.effectiveStatus) === 'rejected'
                                    ? 'font-medium text-red-700'
                                    : adState(ad.effectiveStatus) === 'off'
                                      ? ''
                                      : 'font-medium text-amber-700'
                                }`}
                                title={ad.review ?? undefined}
                              >
                                {AD_STATE_LABEL[adState(ad.effectiveStatus)]}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-3 text-right">{money(ad.spend)}</td>
                          <td className="py-1.5 pr-3 text-right">{ad.reach.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right">{ad.linkClicks.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right">{pct(ad.linkClicks, ad.impressions)}</td>
                          <td className="py-1.5 pr-3 text-right">{adCpc === null ? '—' : dollars(adCpc)}</td>
                          <td className="py-1.5 pr-3 text-right">
                            {ad.tagged ? (onSite?.visitors ?? 0).toLocaleString() : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right">
                            {ad.tagged ? (onSite?.leads ?? 0).toLocaleString() : '—'}
                          </td>
                          <td className="py-1.5 text-right">
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
            </div>
            <p className="mt-1.5 text-[10px] text-ink-500">
              {rangeLabel}.
              {best === null && live.length > 1
                ? ` Too early to call a winner — each ad needs about ${ENOUGH_CLICKS} clicks first.`
                : ''}
            </p>
          </div>

          {/* ---------------------------------------------- the funnel */}
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-ink-900">Shown to lead</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Step value={group.impressions} label="times shown" />
              <Step
                value={group.linkClicks}
                label="clicks to a car"
                rate={pct(group.linkClicks, group.impressions)}
                rateLabel="of times shown"
              />
              <Step
                value={tagged ? visitors : null}
                label="visitors on the site"
                rate={tagged ? pct(visitors, group.linkClicks) : undefined}
                rateLabel="of clicks"
              />
              <Step
                value={tagged ? leads : null}
                label={leads === 1 ? 'lead' : 'leads'}
                rate={tagged ? pct(leads, visitors) : undefined}
                rateLabel="of visitors"
                extra={tagged && leads ? `${money(group.spend / leads)} per lead` : undefined}
              />
            </div>
            {!tagged ? (
              <p className="mt-2 rounded bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                This group’s ads were built before Rooftop tagged ad links, so the site can’t tell its
                visitors apart from other Facebook traffic yet. Open Edit and build the group again to
                start counting — Facebook will re-review the ads, usually within a few hours.
              </p>
            ) : !allTagged ? (
              <p className="mt-2 text-[10px] text-ink-500">
                Some ads here predate the tag, so visitors and leads are counted only for the tagged
                ones. Building the group again tags the rest.
              </p>
            ) : visitors < group.linkClicks * 0.5 && group.linkClicks >= 20 ? (
              <p className="mt-2 text-[10px] text-ink-500">
                Fewer visitors than clicks is normal: some people tap and leave before the page loads,
                and one person can click twice.
              </p>
            ) : null}
          </div>

          {/* ------------------------------------------------ the cars */}
          {site?.cars.length ? (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-ink-900">
                Cars this group’s shoppers looked at
              </h3>
              <table className="w-full text-[11px] tabular-nums">
                <tbody className="divide-y divide-ink-200/70">
                  {site.cars.map((c) => (
                    <tr key={c.vehicleId} className="text-ink-700">
                      <td className="py-1.5 pr-3">
                        <span className="font-medium text-ink-900">{c.title}</span>
                        <span className="ml-2 text-ink-500">#{c.stockNumber}</span>
                        {c.status === 'SOLD' || c.status === 'WHOLESALED' ? (
                          <span className="ml-2 text-[10px] font-medium text-ink-500">Sold</span>
                        ) : c.status === 'PENDING_SALE' ? (
                          <span className="ml-2 text-[10px] font-medium text-amber-700">Pending sale</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        {c.visitors} {c.visitors === 1 ? 'visitor' : 'visitors'}
                      </td>
                      <td className="py-1.5 text-right">
                        {c.leads ? (
                          <span className="font-medium text-emerald-800">
                            {c.leads} {c.leads === 1 ? 'lead' : 'leads'}
                          </span>
                        ) : (
                          <span className="text-ink-400">no leads</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <GroupVehicles rooftopId={rooftopId} adSetId={group.id} />
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

/** One box in the funnel. A null value is a number we cannot honestly give yet. */
function Step({
  value,
  label,
  rate,
  rateLabel,
  extra,
}: {
  value: number | null;
  label: string;
  rate?: string;
  rateLabel?: string;
  extra?: string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2.5">
      <div className="text-base font-semibold tabular-nums text-ink-900">
        {value === null ? '—' : value.toLocaleString()}
      </div>
      <div className="text-[11px] text-ink-600">{label}</div>
      {rate ? (
        <div className="mt-1 text-[10px] tabular-nums text-ink-500">
          {rate} {rateLabel}
        </div>
      ) : null}
      {extra ? <div className="text-[10px] font-medium tabular-nums text-ink-700">{extra}</div> : null}
    </div>
  );
}
