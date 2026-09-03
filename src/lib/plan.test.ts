import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planStatusEnum } from '@/db/schema';
import {
  TRIAL_DAYS,
  isPaid,
  trialDaysLeft,
  trialEndsAtFrom,
  trialExpired,
  type PlanStatus,
} from '@/lib/plan';

/**
 * `isPaid` is a money gate: `purchaseDomain` spends Litespeed's card on the
 * strength of it. What is worth testing is not the happy path but that it stays
 * closed as the enum grows — the failure that costs money is a new plan value
 * accidentally reading as paid.
 */
describe('plan', () => {
  const NOW = new Date('2026-09-03T12:00:00Z');
  const DAY = 86_400_000;
  const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow);

  it('only ACTIVE is paid — every other status in the enum is not', () => {
    // Written as a sweep over the enum rather than a list of cases on purpose.
    // Add PAST_DUE handling, or a new SUSPENDED value, and this test covers it
    // the day the enum does.
    for (const plan of planStatusEnum.enumValues) {
      assert.equal(
        isPaid({ plan, trialEndsAt: null }),
        plan === 'ACTIVE',
        `${plan} answered the wrong thing to isPaid`,
      );
    }
  });

  it('a trial with days left on the clock is still not paid', () => {
    // The tempting bug: treating a live trial as entitlement. A trial is not a
    // payment method, and the gate exists precisely for people mid-trial.
    assert.equal(isPaid({ plan: 'TRIALING', trialEndsAt: at(29 * DAY) }), false);
  });

  it('trialEndsAtFrom is TRIAL_DAYS out, to the day', () => {
    assert.equal(trialEndsAtFrom(NOW).getTime() - NOW.getTime(), TRIAL_DAYS * DAY);
  });

  it('counts whole days left, rounding a partial day up', () => {
    // 7.5 days left reads as 8, not 7. Rounding down would tell a dealer their
    // trial ends a day before it does, which is the direction that generates a
    // support call.
    assert.equal(trialDaysLeft({ plan: 'TRIALING', trialEndsAt: at(7.5 * DAY) }, NOW), 8);
    assert.equal(trialDaysLeft({ plan: 'TRIALING', trialEndsAt: at(0.1 * DAY) }, NOW), 1);
  });

  it('an overrun trial clamps to zero rather than going negative', () => {
    assert.equal(trialDaysLeft({ plan: 'TRIALING', trialEndsAt: at(-4 * DAY) }, NOW), 0);
  });

  it('no clock means null, not zero — a paying dealer is not an expired one', () => {
    // The banner renders nothing for null and "your trial has ended" for 0. A
    // paying group and a pre-launch group both have a null trialEndsAt, and
    // showing either of them an expiry notice is the bug this guards.
    assert.equal(trialDaysLeft({ plan: 'ACTIVE', trialEndsAt: null }, NOW), null);
    assert.equal(trialDaysLeft({ plan: 'ACTIVE', trialEndsAt: at(-99 * DAY) }, NOW), null);
    assert.equal(trialDaysLeft({ plan: 'TRIALING', trialEndsAt: null }, NOW), null);
  });

  it('only a TRIALING group with a past deadline is expired', () => {
    assert.equal(trialExpired({ plan: 'TRIALING', trialEndsAt: at(-DAY) }, NOW), true);
    assert.equal(trialExpired({ plan: 'TRIALING', trialEndsAt: at(DAY) }, NOW), false);
    assert.equal(trialExpired({ plan: 'TRIALING', trialEndsAt: null }, NOW), false);
    // Never for a payer, whatever stale date is sitting on the row.
    assert.equal(trialExpired({ plan: 'ACTIVE', trialEndsAt: at(-99 * DAY) }, NOW), false);
  });

  it('PlanStatus stays in step with the database enum', () => {
    const fromEnum: PlanStatus = planStatusEnum.enumValues[0];
    assert.equal(fromEnum, 'TRIALING');
  });
});
