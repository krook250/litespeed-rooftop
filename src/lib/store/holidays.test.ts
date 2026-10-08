import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TYPICAL_HOURS } from './hours';
import {
  addDays, formatSpecialDate, holidaySuggestions, lotDate, openStateOn, readSpecialHours,
  specialOpeningHoursSpecification, upcomingSpecials, usHolidays,
} from './holidays';

const TZ = 'America/New_York';
// Thanksgiving 2026 is Thu Nov 26. 15:00Z = 10:00 AM Eastern.
const THANKSGIVING_10AM = new Date('2026-11-26T15:00:00Z');

describe('readSpecialHours', () => {
  it('keeps good rows, drops bad ones, sorts, last write per date wins', () => {
    const got = readSpecialHours([
      { date: '2026-12-25', hours: null, label: 'Christmas' },
      { date: '2026-11-26', hours: null, label: '  Thanksgiving  ' },
      { date: '2026-02-30', hours: null, label: 'not a date' },
      { date: '2026-12-24', hours: { open: '14:00', close: '09:00' }, label: 'backwards' },
      { date: '2026-12-25', hours: { open: '10:00', close: '14:00' }, label: '' },
      'junk',
    ]);
    assert.deepEqual(got, [
      { date: '2026-11-26', hours: null, label: 'Thanksgiving' },
      { date: '2026-12-25', hours: { open: '10:00', close: '14:00' }, label: null },
    ]);
  });
  it('reads a non-array as nothing', () => {
    assert.deepEqual(readSpecialHours(null), []);
    assert.deepEqual(readSpecialHours({}), []);
  });
});

describe('openStateOn', () => {
  const specials = readSpecialHours([{ date: '2026-11-26', hours: null, label: 'Thanksgiving' }]);

  it('is closed on the holiday and names it, opening the next usual day', () => {
    const { state, today } = openStateOn(TYPICAL_HOURS, specials, TZ, THANKSGIVING_10AM);
    assert.equal(today?.label, 'Thanksgiving');
    assert.equal(state?.open, false);
    assert.equal(state && !state.open ? state.opensDay : null, 5); // Friday
  });

  it('uses short hours when the holiday has them', () => {
    const short = readSpecialHours([{ date: '2026-11-26', hours: { open: '09:00', close: '12:00' }, label: null }]);
    const { state } = openStateOn(TYPICAL_HOURS, short, TZ, THANKSGIVING_10AM);
    assert.deepEqual(state, { open: true, closesAt: '12:00' });
  });

  it('skips a holiday that would have been the next opening', () => {
    // Wed Nov 25, 11 PM Eastern: next usual opening is Thu, which is closed.
    const { state } = openStateOn(TYPICAL_HOURS, specials, TZ, new Date('2026-11-26T04:00:00Z'));
    assert.equal(state && !state.open ? state.opensDay : null, 5);
  });

  it('behaves like the plain week with no specials', () => {
    const { state, today } = openStateOn(TYPICAL_HOURS, [], TZ, THANKSGIVING_10AM);
    assert.equal(today, null);
    assert.equal(state?.open, true);
  });
});

describe('dates', () => {
  it('reads the lot calendar date, not UTC', () => {
    // 2 AM UTC Nov 27 is still Nov 26 in New York.
    assert.equal(lotDate(TZ, new Date('2026-11-27T02:00:00Z')), '2026-11-26');
  });
  it('adds days across a month', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  });
  it('formats a date for the card', () => {
    assert.equal(formatSpecialDate('2026-11-26'), 'Thu, Nov 26');
  });
  it('lists upcoming only, within a window', () => {
    const list = readSpecialHours([
      { date: '2026-10-01', hours: null, label: 'past' },
      { date: '2026-11-26', hours: null, label: 'soon' },
      { date: '2027-01-01', hours: null, label: 'later' },
    ]);
    assert.deepEqual(upcomingSpecials(list, '2026-11-01', 30).map((s) => s.label), ['soon']);
  });
});

describe('specialOpeningHoursSpecification', () => {
  it('spells closed as 00:00–00:00 and drops past dates', () => {
    const list = readSpecialHours([
      { date: '2026-10-01', hours: null, label: 'past' },
      { date: '2026-11-26', hours: null, label: 'Thanksgiving' },
      { date: '2026-12-24', hours: { open: '09:00', close: '13:00' }, label: 'Christmas Eve' },
    ]);
    assert.deepEqual(specialOpeningHoursSpecification(list, '2026-10-08'), [
      { '@type': 'OpeningHoursSpecification', validFrom: '2026-11-26', validThrough: '2026-11-26', opens: '00:00', closes: '00:00' },
      { '@type': 'OpeningHoursSpecification', validFrom: '2026-12-24', validThrough: '2026-12-24', opens: '09:00', closes: '13:00' },
    ]);
  });
});

describe('holidays', () => {
  it('computes the floating ones', () => {
    const h = Object.fromEntries(usHolidays(2026).map((x) => [x.label, x.date]));
    assert.equal(h['Thanksgiving'], '2026-11-26');
    assert.equal(h['Memorial Day'], '2026-05-25');
    assert.equal(h['Labor Day'], '2026-09-07');
  });
  it('suggests the next ones not already added, into next year', () => {
    const s = holidaySuggestions('2026-10-08', ['2026-11-26']);
    assert.deepEqual(s.map((x) => x.label), ['Christmas Eve', 'Christmas', "New Year's Eve", "New Year's Day"]);
    assert.equal(s[3]!.date, '2027-01-01');
  });
});
