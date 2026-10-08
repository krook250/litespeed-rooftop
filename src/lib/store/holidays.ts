/**
 * Holiday hours: the dates a lot keeps different hours from its usual week.
 *
 * One entry per date — closed, or open/close — with an optional label the
 * buyer sees ("Thanksgiving"). Stored on `rooftops.specialHours`, beside the
 * week they override, for the same reason the week lives there: two lots in
 * one group do not necessarily close for the same days.
 *
 * Three readers: the "Open now" line (so Thanksgiving does not say Open), the
 * lot card's short list of what is coming up, and the AutoDealer node's
 * `specialOpeningHoursSpecification`. Google Maps does NOT read any of this —
 * it reads the Business Profile's own holiday hours — so the dealer still sets
 * them there; the Lots page says so.
 *
 * Dates are the lot's wall-clock calendar date, `YYYY-MM-DD`. Past dates are
 * simply ignored by every reader and dropped on the next save.
 *
 * Pure.
 */

import { isTime, localNow, type DayHours, type OpenState, type WeekHours } from './hours';

export type SpecialDay = { date: string; hours: DayHours; label: string | null };

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MAX_SPECIAL_DAYS = 60;
export const LABEL_MAX = 40;

export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isSpecialDay(v: unknown): v is SpecialDay {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!isDate(o.date)) return false;
  if (o.label !== null && o.label !== undefined && typeof o.label !== 'string') return false;
  if (o.hours === null) return true;
  const h = o.hours as Record<string, unknown> | undefined;
  return !!h && isTime(h.open) && isTime(h.close) && (h.close as string) > (h.open as string);
}

/**
 * Whatever came out of the jsonb column or off the form, as a clean sorted
 * list. Bad entries are dropped, not thrown on — a storefront must render.
 * One entry per date; the last one wins.
 */
export function readSpecialHours(v: unknown): SpecialDay[] {
  if (!Array.isArray(v)) return [];
  const byDate = new Map<string, SpecialDay>();
  for (const e of v) {
    if (!isSpecialDay(e)) continue;
    const label = (e.label ?? '').trim().slice(0, LABEL_MAX) || null;
    byDate.set(e.date, { date: e.date, hours: e.hours ? { open: e.hours.open, close: e.hours.close } : null, label });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_SPECIAL_DAYS);
}

/** The lot's own calendar date. `en-CA` formats as YYYY-MM-DD. */
export function lotDate(timezone: string, now: Date = new Date()): string | null {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return null;
  }
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Today and later, optionally only the next `withinDays`. */
export function upcomingSpecials(list: SpecialDay[], today: string, withinDays?: number): SpecialDay[] {
  const until = withinDays === undefined ? null : addDays(today, withinDays);
  return list.filter((s) => s.date >= today && (until === null || s.date <= until));
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * `openState` with the holidays applied. Walks forward by calendar date rather
 * than weekday, because a holiday can close the lot two days running and the
 * next opening is then further out than the weekly pattern says.
 *
 * `holiday` is today's label when today is a special day — the line under the
 * dealer's name reads "Closed for Thanksgiving", not just "Closed".
 */
export function openStateOn(
  week: WeekHours,
  specials: SpecialDay[],
  timezone: string,
  now: Date = new Date(),
): { state: OpenState | null; today: SpecialDay | null } {
  const local = localNow(timezone, now);
  const date = lotDate(timezone, now);
  if (!local || !date) return { state: null, today: null };

  const byDate = new Map(specials.map((s) => [s.date, s]));
  const hoursOn = (d: string): DayHours => (byDate.has(d) ? byDate.get(d)!.hours : week[dow(d)] ?? null);
  const todaySpecial = byDate.get(date) ?? null;

  const today = hoursOn(date);
  if (today && local.minutes >= toMinutes(today.open) && local.minutes < toMinutes(today.close)) {
    return { state: { open: true, closesAt: today.close }, today: todaySpecial };
  }
  if (today && local.minutes < toMinutes(today.open)) {
    return { state: { open: false, opensDay: local.day, opensAt: today.open }, today: todaySpecial };
  }
  for (let i = 1; i <= 21; i++) {
    const d = addDays(date, i);
    const h = hoursOn(d);
    if (h) return { state: { open: false, opensDay: dow(d), opensAt: h.open }, today: todaySpecial };
  }
  return { state: { open: false, opensDay: null, opensAt: null }, today: todaySpecial };
}

/** "Thu, Nov 26" from `2026-11-26`. */
export function formatSpecialDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/* ------------------------------------------------------------------- SEO */

export type SpecialOpeningHoursSpecification = {
  '@type': 'OpeningHoursSpecification';
  validFrom: string;
  validThrough: string;
  opens: string;
  closes: string;
};

/**
 * `specialOpeningHoursSpecification` for the AutoDealer node, upcoming dates only.
 *
 * Closed is `opens: "00:00", closes: "00:00"`. That is the opposite of the rule
 * for the regular week in `hours.ts`, where a closed day is simply omitted —
 * here omission would mean "usual hours apply", and Google's documentation
 * spells an all-day holiday closure exactly this way.
 */
export function specialOpeningHoursSpecification(list: SpecialDay[], today: string): SpecialOpeningHoursSpecification[] {
  return upcomingSpecials(list, today).map((s) => ({
    '@type': 'OpeningHoursSpecification',
    validFrom: s.date,
    validThrough: s.date,
    opens: s.hours ? s.hours.open : '00:00',
    closes: s.hours ? s.hours.close : '00:00',
  }));
}

/* ---------------------------------------------------- quick-add holidays */

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The `n`th given weekday of a month (n = -1 for the last). */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return ymd(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return ymd(year, month, lastDay - ((last - weekday + 7) % 7));
}

/** The days a car lot is most likely to close or shorten, in a year. */
export function usHolidays(year: number): { date: string; label: string }[] {
  return [
    { date: ymd(year, 1, 1), label: "New Year's Day" },
    { date: nthWeekday(year, 5, 1, -1), label: 'Memorial Day' },
    { date: ymd(year, 7, 4), label: 'Fourth of July' },
    { date: nthWeekday(year, 9, 1, 1), label: 'Labor Day' },
    { date: nthWeekday(year, 11, 4, 4), label: 'Thanksgiving' },
    { date: ymd(year, 12, 24), label: 'Christmas Eve' },
    { date: ymd(year, 12, 25), label: 'Christmas' },
    { date: ymd(year, 12, 31), label: "New Year's Eve" },
  ];
}

/** The next few holidays that are not already on the list. */
export function holidaySuggestions(today: string, taken: string[], n = 4): { date: string; label: string }[] {
  const year = Number(today.slice(0, 4));
  const have = new Set(taken);
  return [...usHolidays(year), ...usHolidays(year + 1)]
    .filter((h) => h.date >= today && !have.has(h.date))
    .slice(0, n);
}
