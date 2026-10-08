'use client';

/**
 * Holiday hours for one lot: a short list of dates, each Closed or open/close,
 * with one-click rows for the next few holidays.
 *
 * Its own form, beside the weekly hours rather than inside them, for the same
 * reason the weekly hours are not in the address form: a half-entered holiday
 * must not cost the dealer a saved week. The list posts as one JSON field and
 * `saveRooftopSpecialHours` validates the whole thing.
 */

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui';
import { saveRooftopSpecialHours } from '@/lib/store/actions';
import {
  LABEL_MAX,
  formatSpecialDate,
  holidaySuggestions,
  lotDate,
  readSpecialHours,
  upcomingSpecials,
  type SpecialDay,
} from '@/lib/store/holidays';

type Row = { key: number; date: string; label: string; closed: boolean; open: string; close: string };

let nextKey = 1;
const toRow = (s: SpecialDay): Row => ({
  key: nextKey++,
  date: s.date,
  label: s.label ?? '',
  closed: s.hours === null,
  open: s.hours?.open ?? '09:00',
  close: s.hours?.close ?? '13:00',
});

export function HolidayHoursCard({
  rooftopId,
  timezone,
  specialHours,
}: {
  rooftopId: string;
  timezone: string;
  specialHours: unknown;
}) {
  const today = lotDate(timezone) ?? new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<Row[]>(() =>
    upcomingSpecials(readSpecialHours(specialHours), today).map(toRow),
  );
  const [state, save, saving] = useActionState(saveRooftopSpecialHours, null);

  const set = (key: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((prev) => prev.filter((r) => r.key !== key));
  const add = (date: string, label: string) =>
    setRows((prev) =>
      [...prev, { key: nextKey++, date, label, closed: true, open: '09:00', close: '13:00' }].sort((a, b) =>
        (a.date || '9999').localeCompare(b.date || '9999'),
      ),
    );

  const suggestions = holidaySuggestions(today, rows.map((r) => r.date));
  const payload = JSON.stringify(
    rows.map((r) => ({
      date: r.date,
      label: r.label.trim() || null,
      hours: r.closed ? null : { open: r.open, close: r.close },
    })),
  );
  const dupes = new Set(rows.map((r) => r.date).filter((d, i, a) => d && a.indexOf(d) !== i));

  return (
    <form action={save} className="space-y-3">
      <input type="hidden" name="rooftopId" value={rooftopId} />
      <input type="hidden" name="specials" value={payload} />

      <div>
        <h3 className="text-base font-semibold text-ink-900">Holiday hours</h3>
        <p className="text-xs text-ink-500">
          Days you close or keep short hours. Your website shows them and stops saying
          &ldquo;Open now&rdquo; on those days. Past dates clear themselves.
        </p>
      </div>

      {suggestions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-500">Add:</span>
          {suggestions.map((h) => (
            <button
              key={h.date}
              type="button"
              onClick={() => add(h.date, h.label)}
              className="rounded-full border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              + {h.label} · {formatSpecialDate(h.date)}
            </button>
          ))}
        </div>
      ) : null}

      {rows.length ? (
        <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <input
                type="date"
                value={r.date}
                min={today}
                onChange={(e) => set(r.key, { date: e.target.value })}
                className="rounded-md border border-ink-300 px-2 py-1.5 text-sm"
                aria-label="Date"
              />
              <input
                value={r.label}
                maxLength={LABEL_MAX}
                placeholder="Label, e.g. Thanksgiving"
                onChange={(e) => set(r.key, { label: e.target.value })}
                className="min-w-0 flex-1 rounded-md border border-ink-300 px-2 py-1.5 text-sm"
                aria-label="Label"
              />
              <label className="flex items-center gap-1.5 text-xs text-ink-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={r.closed}
                  onChange={(e) => set(r.key, { closed: e.target.checked })}
                />
                Closed
              </label>
              {!r.closed ? (
                <span className="flex items-center gap-2">
                  <input
                    type="time"
                    step={900}
                    value={r.open}
                    onChange={(e) => set(r.key, { open: e.target.value })}
                    className="rounded-md border border-ink-300 px-2 py-1.5 text-sm"
                    aria-label="Opens"
                  />
                  <span className="text-ink-400">to</span>
                  <input
                    type="time"
                    step={900}
                    value={r.close}
                    onChange={(e) => set(r.key, { close: e.target.value })}
                    className="rounded-md border border-ink-300 px-2 py-1.5 text-sm"
                    aria-label="Closes"
                  />
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => remove(r.key)}
                className="ml-auto text-xs text-ink-500 hover:text-red-700"
              >
                Remove
              </button>
              {!r.date ? <span className="w-full text-xs text-red-700">Pick a date</span> : null}
              {dupes.has(r.date) ? <span className="w-full text-xs text-red-700">This date is already on the list</span> : null}
              {!r.closed && r.close <= r.open ? (
                <span className="w-full text-xs text-red-700">Closing time must be later</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-400">None set. Your usual hours apply every day.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save holiday hours'}</Button>
        <button
          type="button"
          onClick={() => add('', '')}
          className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-800"
        >
          Add another date
        </button>
        {state?.ok ? <span className="text-sm text-emerald-700">✓ {state.message}</span> : null}
        {state && !state.ok ? <span className="text-sm text-red-700">{state.error}</span> : null}
      </div>

      <p className="text-xs text-ink-400">
        Google Maps doesn&rsquo;t read these. Set the same dates in your Google Business Profile
        under <b>Edit profile → Hours → Holiday hours</b>.
      </p>
    </form>
  );
}
