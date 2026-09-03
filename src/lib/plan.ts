/**
 * Rooftop Auto — trial and plan state.
 *
 * WHY THIS EXISTS BEFORE BILLING DOES
 * There is no payment processor wired in. `claude/billing-and-domain-economics.md`
 * settles that it will be Authorize.net (ARB for the recurring $149/$99, CIM for
 * one-offs) and none of it is built. This module is not a cache of a subscription
 * living somewhere else — `dealer_groups.plan` is the authority, and a group is
 * ACTIVE because a human at Litespeed marked it ACTIVE in `/ops`.
 *
 * It shipped the day before self-serve traffic started, for one reason:
 * `purchaseDomain` spends Litespeed's money. Signup is open to the internet, and
 * the domain guardrails cap the damage at `DOMAIN_PRICE_CAP_USD` x
 * `DOMAINS_PER_GROUP_CAP` — about $75 — **per group**. Capping it per group is
 * only a cap if creating groups is expensive, and it is free. The plan gate is
 * what makes the cap mean something.
 *
 * THE ONE RULE: paid is `plan === 'ACTIVE'`, never `plan !== 'TRIALING'`.
 * PAST_DUE and CANCELED exist in the enum and nothing sets them yet. Written the
 * negative way, the day something does set them is the day a canceled dealer can
 * spend our money.
 */

import type { planStatusEnum } from '@/db/schema';

export type PlanStatus = (typeof planStatusEnum.enumValues)[number];

/** The trial, in days. One number, referenced by the copy and the clock alike. */
export const TRIAL_DAYS = 30;

const DAY_MS = 86_400_000;

/** The subset of a dealer group this module needs. Keeps callers from passing a whole row. */
export type PlanBearing = {
  plan: PlanStatus;
  trialEndsAt: Date | null;
};

/** When a trial starting now should end. Used by the signup provisioning hook. */
export function trialEndsAtFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
}

/**
 * Is this group paid?
 *
 * The only question the domain gate asks. Deliberately has no "or the trial is
 * still running" branch: a trial is not a payment method, and the whole point of
 * the gate is that money is not spent on somebody who has not paid.
 */
export function isPaid(g: PlanBearing): boolean {
  return g.plan === 'ACTIVE';
}

/**
 * Whole days left in the trial, or null when there is no clock.
 *
 * Null means **no deadline**, not expired — an ACTIVE group, or a pre-launch
 * group whose `trialEndsAt` the migration left null on purpose. Callers render
 * nothing for null rather than "0 days left", because the two are opposite
 * messages to show a paying dealer.
 *
 * Rounds up, so the last partial day reads "1 day left" rather than "0".
 * Negative clamps to 0 — an expired trial is expired, not minus four days.
 */
export function trialDaysLeft(g: PlanBearing, now: Date = new Date()): number | null {
  if (g.plan !== 'TRIALING' || !g.trialEndsAt) return null;
  const ms = new Date(g.trialEndsAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

/** A trial that has run out. Nothing is switched off today; this is what the banner reads. */
export function trialExpired(g: PlanBearing, now: Date = new Date()): boolean {
  return g.plan === 'TRIALING' && g.trialEndsAt !== null && new Date(g.trialEndsAt).getTime() <= now.getTime();
}

/**
 * What a dealer is told when the plan gate stops them.
 *
 * Lives here rather than in the action so the button's disabled state and the
 * server's refusal say the same sentence — a button explaining one reason and an
 * error giving another is how a support call starts.
 */
export const PAID_ONLY_DOMAIN_MESSAGE =
  'Buying a domain through Rooftop needs an active subscription. ' +
  'Your free trial covers everything else — connect a domain you already own any time, ' +
  'and give us a call when you are ready to switch the plan on.';
