import Link from 'next/link';
import { trialDaysLeft, trialExpired, TRIAL_DAYS, type PlanBearing } from '@/lib/plan';

/**
 * The trial clock, across the top of every admin page.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: switch anything off. Nothing in the product
 * checks `trialExpired` to deny access, and this banner is the only thing in the
 * app that reads it. A dealer whose trial lapses keeps their inventory, their
 * storefront and their feeds — the cost of wrongly locking out a real dealer on
 * day 31 is far higher than the cost of a few free weeks, and there is no billing
 * system to have taken their money anyway.
 *
 * Renders nothing for a paying group. A persistent bar telling somebody who pays
 * you $149 a month about their trial is worse than no bar at all, so `null` is
 * the common case on purpose.
 */
export function TrialBanner({ group }: { group: PlanBearing }) {
  const left = trialDaysLeft(group);
  if (left === null) return null;

  const expired = trialExpired(group);
  const urgent = expired || left <= 7;

  return (
    <div
      className={
        urgent
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6'
          : 'flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 sm:px-6'
      }
    >
      <span className="font-medium">
        {expired
          ? `Your ${TRIAL_DAYS}-day free trial has ended.`
          : `${left} day${left === 1 ? '' : 's'} left in your free trial.`}
      </span>
      <span className="text-xs opacity-80">
        {expired
          ? 'Nothing has been switched off — give us a call and we will get you on a plan.'
          : 'Everything is switched on. No card on file, nothing to cancel.'}
      </span>
      <Link
        href="mailto:david@litespeedmarketing.com?subject=Rooftop%20Auto%20—%20ready%20to%20subscribe"
        className="ml-auto shrink-0 text-xs font-medium underline underline-offset-2"
      >
        Talk to us
      </Link>
    </div>
  );
}
