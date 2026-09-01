/**
 * The "Just arrived" badge, and when it must stay quiet.
 *
 * Found on Malabar's live storefront: every unit wore "Just arrived", including
 * trucks that had been on the lot for months. Not a rendering bug — the import
 * stamps `acquiredDate` with the moment of the import, on purpose, because a
 * syndication export does not say when the dealer bought the car and a made-up
 * date would put fake numbers on the aging report.
 *
 * The consequence only surfaces on the public site, which is why nobody caught
 * it in the admin: a false claim to a buyer, on a badge that means nothing
 * because it is on everything.
 *
 * No database, no network. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FRESH_AIR_BADGE_CEILING, isFreshAir, shouldBadgeFreshAir } from './domain';

describe('isFreshAir', () => {
  it('is the first aging bucket and nothing else', () => {
    assert.equal(isFreshAir(0), true);
    assert.equal(isFreshAir(15), true);
    assert.equal(isFreshAir(16), false);
  });
});

describe('shouldBadgeFreshAir', () => {
  /* The import signature: everything arrived at the same instant. */
  it('stays quiet when the whole lot looks new', () => {
    assert.equal(shouldBadgeFreshAir(21, 21), false, 'a fresh migration');
    assert.equal(shouldBadgeFreshAir(19, 21), false);
  });

  it('badges normally when only a few units are new', () => {
    assert.equal(shouldBadgeFreshAir(2, 25), true);
    assert.equal(shouldBadgeFreshAir(0, 25), true, 'nothing to badge is not a reason to disable');
  });

  it('turns over exactly at the ceiling', () => {
    assert.equal(shouldBadgeFreshAir(40, 100), true, 'at the ceiling, still worth saying');
    assert.equal(shouldBadgeFreshAir(41, 100), false);
    assert.equal(FRESH_AIR_BADGE_CEILING, 0.4);
  });

  /*
   * It heals itself. A dealer imports 21 units — badge off — and over the next
   * weeks those age out of fresh air while real arrivals come in, at which
   * point the badge starts working with nobody doing anything.
   */
  it('comes back on as the lot ages and real arrivals appear', () => {
    assert.equal(shouldBadgeFreshAir(21, 21), false, 'import day');
    assert.equal(shouldBadgeFreshAir(3, 24), true, 'three weeks later, three real arrivals');
  });

  it('does not divide by zero on an empty lot', () => {
    assert.equal(shouldBadgeFreshAir(0, 0), false);
  });

  /* A one-car lot with one new car is not "most of the lot is wallpaper" in any
     useful sense, but it is 100% — and staying quiet is the safe answer. */
  it('treats a single fresh unit on a single-unit lot as not worth badging', () => {
    assert.equal(shouldBadgeFreshAir(1, 1), false);
  });
});
