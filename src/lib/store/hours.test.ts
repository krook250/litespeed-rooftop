/**
 * Hours tests.
 *
 * The failure mode this exists for is a dealership website that says OPEN NOW at
 * 2am on a Sunday. Nobody on our side is awake to catch that, the dealer finds
 * out from a customer, and it is the single most embarrassing thing a small
 * business site can get wrong — so `openState` is tested against a fixed instant
 * from several timezones rather than "it returned a boolean".
 *
 * No database, no network. Run with `npm test`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSED_ALL_WEEK,
  TYPICAL_HOURS,
  formatDay,
  formatTime,
  isWeekHours,
  localNow,
  openLabel,
  openState,
  openingHoursSpecification,
  summarise,
  type WeekHours,
} from './hours';

const NINE_TO_SIX = { open: '09:00', close: '18:00' };

describe('isWeekHours', () => {
  it('accepts a well-formed week', () => {
    assert.equal(isWeekHours(TYPICAL_HOURS), true);
    assert.equal(isWeekHours(CLOSED_ALL_WEEK), true);
  });

  it('rejects anything that is not seven entries', () => {
    assert.equal(isWeekHours(null), false);
    assert.equal(isWeekHours(undefined), false);
    assert.equal(isWeekHours([]), false);
    assert.equal(isWeekHours(Array(6).fill(null)), false);
    assert.equal(isWeekHours(Array(8).fill(null)), false);
    assert.equal(isWeekHours({ monday: '9-5' }), false);
  });

  it('rejects times that are not HH:MM 24-hour', () => {
    const week = (d: unknown) => [d, null, null, null, null, null, null];
    assert.equal(isWeekHours(week({ open: '9:00', close: '18:00' })), false);
    assert.equal(isWeekHours(week({ open: '09:00', close: '6pm' })), false);
    assert.equal(isWeekHours(week({ open: '24:00', close: '25:00' })), false);
    assert.equal(isWeekHours(week({ open: '09:60', close: '18:00' })), false);
    assert.equal(isWeekHours(week({ open: 9, close: 18 })), false);
  });

  /*
   * A close at or before the open is a typo, not an overnight lot. Accepted, it
   * would make `openState` answer "open" for twenty-three hours a day.
   */
  it('rejects a close time at or before the open time', () => {
    const week = (d: unknown) => [d, null, null, null, null, null, null];
    assert.equal(isWeekHours(week({ open: '18:00', close: '09:00' })), false);
    assert.equal(isWeekHours(week({ open: '09:00', close: '09:00' })), false);
  });
});

describe('formatTime', () => {
  it('drops the zero minutes and gets noon and midnight right', () => {
    assert.equal(formatTime('09:00'), '9 AM');
    assert.equal(formatTime('17:30'), '5:30 PM');
    assert.equal(formatTime('12:00'), '12 PM');
    assert.equal(formatTime('00:00'), '12 AM');
    assert.equal(formatTime('00:30'), '12:30 AM');
    assert.equal(formatTime('23:45'), '11:45 PM');
  });

  it('hands back anything it does not recognise rather than inventing a time', () => {
    assert.equal(formatTime('nonsense'), 'nonsense');
  });
});

describe('summarise', () => {
  it('collapses a run of identical days and starts the week on Monday', () => {
    const rows = summarise(TYPICAL_HOURS);
    assert.deepEqual(rows.map((r) => r.label), ['Mon – Fri', 'Sat', 'Sun']);
    assert.equal(rows[0]!.hours, '9 AM – 6 PM');
    assert.equal(rows[1]!.hours, '10 AM – 5 PM');
    assert.equal(rows[2]!.hours, 'Closed');
  });

  /*
   * The run has to be consecutive. A lot shut on Wednesday must not render as
   * "Mon – Sat", which is the bug a naive group-by-value produces.
   */
  it('breaks a run around a closed day in the middle of the week', () => {
    const week: WeekHours = [null, NINE_TO_SIX, NINE_TO_SIX, null, NINE_TO_SIX, NINE_TO_SIX, NINE_TO_SIX];
    const rows = summarise(week);
    assert.deepEqual(rows.map((r) => r.label), ['Mon – Tue', 'Wed', 'Thu – Sat', 'Sun']);
  });

  it('renders a lot that is open every day as a single row', () => {
    const week = Array(7).fill(NINE_TO_SIX) as unknown as WeekHours;
    const rows = summarise(week);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.label, 'Mon – Sun');
  });

  it('always accounts for all seven days', () => {
    const total = summarise(CLOSED_ALL_WEEK).reduce((n, r) => n + r.days.length, 0);
    assert.equal(total, 7);
  });
});

describe('localNow', () => {
  /* 2026-08-27T19:20:00Z — a Thursday. */
  const AT = new Date('2026-08-27T19:20:00Z');

  it('reads the wall clock of the lot, not of the server', () => {
    assert.deepEqual(localNow('America/Los_Angeles', AT), { day: 4, minutes: 12 * 60 + 20 });
    assert.deepEqual(localNow('America/New_York', AT), { day: 4, minutes: 15 * 60 + 20 });
    assert.deepEqual(localNow('UTC', AT), { day: 4, minutes: 19 * 60 + 20 });
  });

  it('rolls the weekday over where the date differs from UTC', () => {
    // 01:20Z Friday is still Thursday evening in Los Angeles.
    const late = new Date('2026-08-28T01:20:00Z');
    assert.deepEqual(localNow('America/Los_Angeles', late), { day: 4, minutes: 18 * 60 + 20 });
    assert.deepEqual(localNow('UTC', late), { day: 5, minutes: 80 });
  });

  it('returns null for a timezone it does not know instead of throwing', () => {
    assert.equal(localNow('Mars/Olympus_Mons', AT), null);
    assert.equal(localNow('', AT), null);
  });
});

describe('openState', () => {
  const TZ = 'America/Los_Angeles';
  /** Thursday 12:20 local. */
  const MIDDAY = new Date('2026-08-27T19:20:00Z');

  it('is open inside the window and says when it shuts', () => {
    const s = openState(TYPICAL_HOURS, TZ, MIDDAY);
    assert.deepEqual(s, { open: true, closesAt: '18:00' });
    assert.equal(openLabel(s, 4), 'Open now · closes 6 PM');
  });

  it('is closed before opening, and points at later today rather than tomorrow', () => {
    const early = new Date('2026-08-27T14:00:00Z'); // 07:00 Thursday local
    const s = openState(TYPICAL_HOURS, TZ, early);
    assert.deepEqual(s, { open: false, opensDay: 4, opensAt: '09:00' });
    assert.equal(openLabel(s, 4), 'Closed · opens 9 AM');
  });

  it('is closed at the closing minute, not a minute past it', () => {
    const atSix = new Date('2026-08-28T01:00:00Z'); // 18:00 Thursday local
    assert.equal(openState(TYPICAL_HOURS, TZ, atSix)!.open, false);
    const justBefore = new Date('2026-08-28T00:59:00Z'); // 17:59
    assert.equal(openState(TYPICAL_HOURS, TZ, justBefore)!.open, true);
  });

  /*
   * The 2am-Sunday case this file exists for. Sunday is closed in TYPICAL_HOURS,
   * so the answer has to be "closed, opens Mon 9 AM" — never "open".
   */
  it('does not claim to be open at 2am on a closed Sunday', () => {
    const sundayNight = new Date('2026-08-30T09:00:00Z'); // 02:00 Sunday local
    const s = openState(TYPICAL_HOURS, TZ, sundayNight);
    assert.deepEqual(s, { open: false, opensDay: 1, opensAt: '09:00' });
    assert.equal(openLabel(s, 0), 'Closed · opens Mon 9 AM');
  });

  it('skips over closed days to find the next opening', () => {
    // Open Saturday only. Asked on a Sunday, the answer is next Saturday.
    const week: WeekHours = [null, null, null, null, null, null, NINE_TO_SIX];
    const sunday = new Date('2026-08-30T19:00:00Z'); // 12:00 Sunday local
    assert.deepEqual(openState(week, TZ, sunday), { open: false, opensDay: 6, opensAt: '09:00' });
  });

  it('does not loop forever on a lot that is closed all week', () => {
    const s = openState(CLOSED_ALL_WEEK, TZ, MIDDAY);
    assert.deepEqual(s, { open: false, opensDay: null, opensAt: null });
    assert.equal(openLabel(s), 'Closed');
  });

  it('returns null on an unknown timezone so the caller can render nothing', () => {
    assert.equal(openState(TYPICAL_HOURS, 'Nowhere/Atlantis', MIDDAY), null);
    assert.equal(openLabel(null), null);
  });

  /*
   * The reason hours are stored as wall-clock strings. Nine o'clock is nine
   * o'clock on both sides of the DST boundary, and nothing has to be re-derived.
   */
  it('holds across a daylight-saving change', () => {
    const beforeDst = new Date('2026-10-29T16:30:00Z'); // 09:30 PDT Thursday
    const afterDst = new Date('2026-11-12T17:30:00Z');  // 09:30 PST Thursday
    assert.equal(openState(TYPICAL_HOURS, TZ, beforeDst)!.open, true);
    assert.equal(openState(TYPICAL_HOURS, TZ, afterDst)!.open, true);
  });
});

describe('openingHoursSpecification', () => {
  it('groups identical days into one entry', () => {
    const spec = openingHoursSpecification(TYPICAL_HOURS);
    assert.equal(spec.length, 2);
    assert.deepEqual(spec[0]!.dayOfWeek, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    assert.equal(spec[0]!.opens, '09:00');
    assert.equal(spec[0]!.closes, '18:00');
    assert.deepEqual(spec[1]!.dayOfWeek, ['Saturday']);
  });

  /*
   * Closed days are OMITTED, never emitted as opens === closes. The spec reads
   * an absent day as closed, and `opens: "00:00", closes: "00:00"` has been read
   * as open-all-day by more than one consumer.
   */
  it('omits closed days rather than emitting a zero-length window', () => {
    const spec = openingHoursSpecification(TYPICAL_HOURS);
    assert.equal(spec.some((s) => s.dayOfWeek.includes('Sunday')), false);
    assert.equal(spec.some((s) => s.opens === s.closes), false);
    assert.deepEqual(openingHoursSpecification(CLOSED_ALL_WEEK), []);
  });

  it('uses full day names, which is what schema.org expects', () => {
    const spec = openingHoursSpecification(TYPICAL_HOURS);
    assert.equal(spec.every((s) => s.dayOfWeek.every((d) => /^[A-Z][a-z]+day$/.test(d))), true);
  });

  it('emits 24-hour times, not the display format', () => {
    for (const s of openingHoursSpecification(TYPICAL_HOURS)) {
      assert.match(s.opens, /^\d{2}:\d{2}$/);
      assert.match(s.closes, /^\d{2}:\d{2}$/);
    }
  });
});

describe('formatDay', () => {
  it('says Closed for a null day', () => {
    assert.equal(formatDay(null), 'Closed');
    assert.equal(formatDay(NINE_TO_SIX), '9 AM – 6 PM');
  });
});
