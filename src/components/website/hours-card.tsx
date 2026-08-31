'use client';

/**
 * Setting a lot's hours.
 *
 * WHY IT OPENS PREFILLED
 * Seven blank rows of time pickers is how a setup step gets abandoned. The
 * overwhelming majority of used-car lots run nine-to-six weekdays, ten-to-five
 * Saturday, closed Sunday — so that is what an unset lot shows, unsaved, with
 * the buttons above it saying so. A dealer whose hours match presses Save and is
 * done in one click; one whose hours differ is editing something rather than
 * building it from nothing, which is a much easier thing to ask.
 *
 * Nothing is written until they press Save. The prefill is a suggestion on
 * screen, never a value in the database — a lot that has genuinely never had
 * hours set must read as unset, because that is what keeps a guess out of the
 * `openingHoursSpecification`.
 *
 * The same component is rendered on `/admin/lots` and on `/admin/website`.
 * Hours belong to a lot, but the dealer who cares about them is the one building
 * their website and will not think to go looking under Lots.
 */

import { useActionState, useState } from 'react';
import { Button, cn } from '@/components/ui';
import { saveRooftopHours } from '@/lib/store/actions';
import {
  CLOSED_ALL_WEEK,
  DAY_NAMES,
  TYPICAL_HOURS,
  isWeekHours,
  openLabel,
  openState,
  localNow,
  type DayHours,
  type WeekHours,
} from '@/lib/store/hours';

/* Monday first on screen; the array itself stays Sunday-first to match Date.getDay(). */
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function HoursCard({
  rooftopId,
  rooftopName,
  timezone,
  hours,
}: {
  rooftopId: string;
  rooftopName: string;
  timezone: string;
  hours: unknown;
}) {
  const saved = isWeekHours(hours) ? (hours as WeekHours) : null;
  const [week, setWeek] = useState<DayHours[]>([...(saved ?? TYPICAL_HOURS)]);
  const [state, save, saving] = useActionState(saveRooftopHours, null);
  const [clear, setClear] = useState(false);

  function setDay(i: number, next: DayHours) {
    setWeek((prev) => prev.map((d, j) => (j === i ? next : d)));
  }

  const local = localNow(timezone);
  const preview = openLabel(openState(week as unknown as WeekHours, timezone), local?.day);

  return (
    <form action={save} className="space-y-4">
      <input type="hidden" name="rooftopId" value={rooftopId} />
      {clear ? <input type="hidden" name="clear" value="on" /> : null}
      {week.map((d, i) =>
        d ? (
          <span key={i}>
            <input type="hidden" name={`open-${i}`} value={d.open} />
            <input type="hidden" name={`close-${i}`} value={d.close} />
          </span>
        ) : (
          <input key={i} type="hidden" name={`closed-${i}`} value="on" />
        ),
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink-900">{rooftopName}</h3>
          <p className="text-xs text-ink-500">
            {saved ? 'Shown on your website and sent to Google.' : 'Not set yet — these are the usual hours for a lot. Change what does not match.'}
          </p>
        </div>
        {preview ? <span className="text-xs font-medium text-ink-600">{preview}</span> : null}
      </div>

      <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
        {ROW_ORDER.map((i) => {
          const d = week[i]!;
          return (
            <div key={i} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="w-24 text-sm font-medium text-ink-800">{DAY_NAMES[i]}</span>
              {d ? (
                <>
                  <input
                    type="time"
                    value={d.open}
                    step={900}
                    onChange={(e) => setDay(i, { ...d, open: e.target.value })}
                    className="rounded-md border border-ink-300 px-2 py-1 text-sm"
                    aria-label={`${DAY_NAMES[i]} opening time`}
                  />
                  <span className="text-ink-400">to</span>
                  <input
                    type="time"
                    value={d.close}
                    step={900}
                    onChange={(e) => setDay(i, { ...d, close: e.target.value })}
                    className="rounded-md border border-ink-300 px-2 py-1 text-sm"
                    aria-label={`${DAY_NAMES[i]} closing time`}
                  />
                  {/* Warned inline rather than blocked on save — a dealer mid-edit
                      has a half-typed time for a moment and should not be shouted at. */}
                  {d.close <= d.open ? (
                    <span className="text-xs text-red-700">Closing time must be later</span>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-ink-400">Closed</span>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-600">
                <input
                  type="checkbox"
                  checked={d === null}
                  onChange={(e) => setDay(i, e.target.checked ? null : { open: '09:00', close: '18:00' })}
                />
                Closed
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save hours'}</Button>
        <button
          type="button"
          onClick={() => { setClear(false); setWeek([...TYPICAL_HOURS]); }}
          className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-800"
        >
          Reset to usual hours
        </button>
        <button
          type="button"
          onClick={() => { setClear(false); setWeek([...CLOSED_ALL_WEEK]); }}
          className="text-sm text-ink-500 hover:text-ink-800"
        >
          All closed
        </button>
        {state?.ok ? <span className="text-sm text-emerald-700">{state.message}</span> : null}
        {state && !state.ok ? <span className="text-sm text-red-700">{state.error}</span> : null}
      </div>

      <p className={cn('text-xs text-ink-400')}>
        Times are local to this lot ({timezone.replace('_', ' ')}). Daylight saving is handled for
        you — nine o&apos;clock stays nine o&apos;clock.
      </p>
    </form>
  );
}
