/**
 * Opening hours for a lot: the shape, the maths, and the two renderings.
 *
 * Pure — no database, no React, no `Date.now()` unless you pass it. Every branch
 * here is unit-testable, which matters more than usual because the failure mode
 * is a dealership website that says OPEN NOW at 2am on a Sunday, and nobody on
 * our side is awake to see it.
 *
 * WHY HOURS LIVE ON `rooftops` AND NOT ON `storefronts`
 * A storefront can consolidate several lots — that is the whole multi-rooftop
 * feature — and two lots forty minutes apart do not share a Saturday. Hours are
 * a fact about a physical place, and so are the address, the phone and the
 * coordinates that sit beside them in that table. It is also the shape Google
 * wants: one `AutoDealer` per location, each with its own
 * `openingHoursSpecification`. A brand-level hours field cannot be expressed in
 * that vocabulary at all.
 *
 * WHY WALL-CLOCK STRINGS AND NOT TIMESTAMPS
 * `"09:00"` is what the dealer means and what Google's spec asks for. A lot that
 * opens at nine opens at nine in March and in November; storing an instant would
 * make us re-derive that across a DST boundary and get it wrong once a year.
 * The rooftop's `timezone` column is what turns wall-clock into "is it open now",
 * and it is only needed for that one question.
 */

/** Sunday-first, matching `Date.getDay()` so no index arithmetic is needed. */
export const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** schema.org spells the days as full URLs' final segment — same words, no abbreviation. */
const SCHEMA_DAYS = DAY_NAMES;

/** `null` means closed that day. Times are `HH:MM`, 24-hour, in the lot's own timezone. */
export type DayHours = { open: string; close: string } | null;

/** Seven entries, Sunday first. */
export type WeekHours = readonly [DayHours, DayHours, DayHours, DayHours, DayHours, DayHours, DayHours];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && TIME.test(v);
}

/**
 * Validates whatever came out of the jsonb column or off a form.
 *
 * The column is `jsonb`, so Postgres guarantees it is *JSON* and nothing more —
 * a row written by an older build, a hand-run UPDATE, or a future migration can
 * hold anything at all. Everything that reads hours goes through this, and a lot
 * with unreadable hours renders as a lot with no hours rather than throwing on a
 * page a buyer is looking at.
 */
export function isWeekHours(v: unknown): v is WeekHours {
  if (!Array.isArray(v) || v.length !== 7) return false;
  return v.every((d) => {
    if (d === null) return true;
    if (typeof d !== 'object' || d === null) return false;
    const { open, close } = d as Record<string, unknown>;
    if (!isTime(open) || !isTime(close)) return false;
    // A close time at or before the open time is not an overnight lot, it is a
    // typo. No used-car lot trades through midnight, and accepting it would make
    // `isOpenNow` answer yes for twenty-three hours.
    return close > open;
  });
}

/** Nine-to-six weekdays, ten-to-five Saturday, closed Sunday. What most lots run. */
export const TYPICAL_HOURS: WeekHours = [
  null,
  { open: '09:00', close: '18:00' },
  { open: '09:00', close: '18:00' },
  { open: '09:00', close: '18:00' },
  { open: '09:00', close: '18:00' },
  { open: '09:00', close: '18:00' },
  { open: '10:00', close: '17:00' },
];

export const CLOSED_ALL_WEEK: WeekHours = [null, null, null, null, null, null, null];

/* ------------------------------------------------------------- formatting */

/**
 * `"09:00"` → `"9 AM"`, `"17:30"` → `"5:30 PM"`.
 *
 * Minutes are dropped when they are zero. "9:00 AM – 6:00 PM" down a seven-row
 * table is a wall of zeroes; "9 AM – 6 PM" is the same information and reads
 * like a sign on a door, which is what it is.
 */
export function formatTime(hhmm: string): string {
  if (!isTime(hhmm)) return hhmm;
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDay(d: DayHours): string {
  return d ? `${formatTime(d.open)} – ${formatTime(d.close)}` : 'Closed';
}

export type HoursRow = { label: string; hours: string; days: number[] };

/**
 * Collapse the week into the rows a human would write.
 *
 * `Mon – Fri · 9 AM – 6 PM` beats five identical rows, and it is how every sign
 * and every Google listing states it. Runs must be *consecutive*, so a lot that
 * is shut on Wednesday gets `Mon – Tue`, `Wed Closed`, `Thu – Sat` rather than a
 * misleading `Mon – Sat` with a footnote.
 *
 * Monday-first for display, because a week that starts on Sunday reads as a
 * mistake on a business's own page — even though the array is Sunday-first to
 * match `Date.getDay()`.
 */
export function summarise(week: WeekHours): HoursRow[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows: HoursRow[] = [];
  for (const day of order) {
    const text = formatDay(week[day]!);
    const last = rows[rows.length - 1];
    if (last && last.hours === text) {
      last.days.push(day);
    } else {
      rows.push({ label: '', hours: text, days: [day] });
    }
  }
  for (const r of rows) {
    const first = DAY_SHORT[r.days[0]!]!;
    const final = DAY_SHORT[r.days[r.days.length - 1]!]!;
    r.label = r.days.length === 1 ? first : `${first} – ${final}`;
  }
  return rows;
}

/* ------------------------------------------------------------ open or not */

/**
 * The lot's own wall-clock time, as a weekday and minutes-since-midnight.
 *
 * `Intl.DateTimeFormat` with a `timeZone` is the only way to do this correctly
 * without shipping a timezone database: it knows whether that lot is currently
 * on daylight time, and hard-coding an offset does not. An unrecognised timezone
 * string throws, so it is caught — a bad value in one column must not take down
 * a storefront.
 */
export function localNow(timezone: string, now: Date = new Date()): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const day = (DAY_SHORT as readonly string[]).indexOf(get('weekday'));
    // `hour12: false` renders midnight as "24" in some ICU versions.
    const hour = Number(get('hour')) % 24;
    const minute = Number(get('minute'));
    if (day < 0 || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { day, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

export type OpenState =
  | { open: true; closesAt: string }
  | { open: false; opensDay: number; opensAt: string }
  | { open: false; opensDay: null; opensAt: null };

/**
 * Open right now? And either when it shuts or when it next opens.
 *
 * "Opens Monday at 9 AM" is worth more to a buyer standing in a parking lot than
 * "Closed", so the closed branch walks forward up to seven days to find the next
 * open day. A week with no open days at all returns the third shape rather than
 * looping — a lot can genuinely be marked closed everywhere while a dealer is
 * mid-setup, and that must render as plain "Closed" and not crash.
 */
export function openState(week: WeekHours, timezone: string, now: Date = new Date()): OpenState | null {
  const local = localNow(timezone, now);
  if (!local) return null;

  const today = week[local.day]!;
  if (today && local.minutes >= toMinutes(today.open) && local.minutes < toMinutes(today.close)) {
    return { open: true, closesAt: today.close };
  }

  // Later today counts as the next opening — before 9 AM on a weekday, the
  // useful sentence is "opens at 9", not "opens tomorrow".
  if (today && local.minutes < toMinutes(today.open)) {
    return { open: false, opensDay: local.day, opensAt: today.open };
  }

  for (let i = 1; i <= 7; i++) {
    const day = (local.day + i) % 7;
    const d = week[day];
    if (d) return { open: false, opensDay: day, opensAt: d.open };
  }
  return { open: false, opensDay: null, opensAt: null };
}

/** One short sentence for the header and the location card. */
export function openLabel(state: OpenState | null, todayIndex?: number): string | null {
  if (!state) return null;
  if (state.open) return `Open now · closes ${formatTime(state.closesAt)}`;
  if (state.opensDay === null) return 'Closed';
  const sameDay = todayIndex !== undefined && state.opensDay === todayIndex;
  const when = sameDay ? '' : ` ${DAY_SHORT[state.opensDay]!}`;
  return `Closed · opens${when} ${formatTime(state.opensAt)}`;
}

/* ------------------------------------------------------------------- SEO */

export type OpeningHoursSpecification = {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string[];
  opens: string;
  closes: string;
};

/**
 * The `openingHoursSpecification` array for an `AutoDealer` node.
 *
 * Days with identical hours are grouped into one entry with a `dayOfWeek` array,
 * which is the form Google's own examples use. **Closed days are omitted**, not
 * emitted with equal opens and closes — the spec reads an absent day as closed,
 * and `opens: "00:00", closes: "00:00"` has been read as *open all day* by more
 * than one consumer over the years. Silence is unambiguous.
 */
export function openingHoursSpecification(week: WeekHours): OpeningHoursSpecification[] {
  const groups = new Map<string, { days: string[]; opens: string; closes: string }>();
  week.forEach((d, i) => {
    if (!d) return;
    const key = `${d.open}-${d.close}`;
    const g = groups.get(key);
    if (g) g.days.push(SCHEMA_DAYS[i]!);
    else groups.set(key, { days: [SCHEMA_DAYS[i]!], opens: d.open, closes: d.close });
  });
  return [...groups.values()].map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: g.days,
    opens: g.opens,
    closes: g.closes,
  }));
}
