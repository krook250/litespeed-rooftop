'use client';

/**
 * Step 1 of a group: which cars, and how many that is right now.
 *
 * THE COUNT IS THE WHOLE POINT. A dealer cannot picture what "trucks, under
 * $25,000, under 90,000 miles" holds on their lot today, and a rule they cannot
 * picture is a rule they will not trust with money. So the number moves as they
 * type — computed in the browser from the same list the product set is built
 * from, by the same matcher, so it cannot disagree with what Facebook targets.
 *
 * IT IS A RULE, NEVER A LIST. Picking cars by hand would empty as they sell;
 * this keeps itself up to date. Every control here narrows a shelf, and every
 * field left blank adds no clause at all.
 */

import { useMemo, useState } from 'react';
import { CAMPAIGN_BUCKETS, type BucketKey } from '@/lib/meta/buckets';
import {
  BODY_STYLES,
  describeFilters,
  hasAnyFilter,
  suggestName,
  unitMatches,
  type AdGroupFilters,
  type TargetableUnit,
} from '@/lib/meta/group-filter';

const inBucket = (u: TargetableUnit, key: BucketKey) => {
  const b = CAMPAIGN_BUCKETS.find((x) => x.key === key)!;
  if (b.min != null && u.days < b.min) return false;
  if (b.max != null && u.days > b.max) return false;
  return true;
};

const numField =
  'w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm text-ink-900';

export function WhichCars({
  units,
  taken,
  bucket,
  onBucket,
  locked,
  filters,
  onFilters,
  name,
  onName,
}: {
  units: TargetableUnit[];
  /** Shelves that already have a group. */
  taken: string[];
  bucket: BucketKey;
  onBucket: (k: BucketKey) => void;
  locked: boolean;
  filters: AdGroupFilters;
  onFilters: (f: AdGroupFilters) => void;
  name: string;
  onName: (s: string) => void;
}) {
  const [open, setOpen] = useState(() => hasAnyFilter(filters));

  const onShelf = useMemo(() => units.filter((u) => inBucket(u, bucket)), [units, bucket]);
  const matched = useMemo(
    () => onShelf.filter((u) => unitMatches(u, filters)),
    [onShelf, filters],
  );

  /** Makes present on this shelf, so the picker never offers an empty option. */
  const makes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const u of onShelf) seen.set(u.make, (seen.get(u.make) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [onShelf]);

  const bodies = useMemo(() => {
    const seen = new Set(onShelf.map((u) => u.body));
    return BODY_STYLES.filter((b) => seen.has(b.key));
  }, [onShelf]);

  const set = (patch: Partial<AdGroupFilters>) => {
    const next = { ...filters, ...patch };
    for (const k of Object.keys(next) as (keyof AdGroupFilters)[]) {
      const v = next[k];
      if (v == null || (Array.isArray(v) && v.length === 0)) delete next[k];
    }
    onFilters(next);
  };

  const toggle = (key: 'bodyStyles' | 'makes', value: string) => {
    const cur = filters[key] ?? [];
    set({ [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] });
  };

  const num = (v: number | null | undefined) => (v == null ? '' : String(v));
  const parse = (raw: string): number | null => {
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? Number(digits) : null;
  };

  const shelfLabel = CAMPAIGN_BUCKETS.find((b) => b.key === bucket)!.label;
  const suggested = suggestName(shelfLabel, filters);
  const described = describeFilters(filters);

  return (
    <div className="space-y-4">
      {/* Hidden inputs are the form's view of this component. Everything the
          server reads is here; the controls above are just how it gets set. */}
      <input type="hidden" name="bucket" value={bucket} />
      <input type="hidden" name="groupName" value={name} />
      <input type="hidden" name="f.bodyStyles" value={(filters.bodyStyles ?? []).join(',')} />
      <input type="hidden" name="f.makes" value={(filters.makes ?? []).join(',')} />
      <input type="hidden" name="f.yearMin" value={num(filters.yearMin)} />
      <input type="hidden" name="f.yearMax" value={num(filters.yearMax)} />
      <input type="hidden" name="f.mileageMax" value={num(filters.mileageMax)} />
      <input type="hidden" name="f.priceMax" value={num(filters.priceMax)} />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="space-y-4">
          <div>
            <span className="text-xs font-medium text-ink-700">Days on the lot</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CAMPAIGN_BUCKETS.map((b) => {
                const on = b.key === bucket;
                const disabled = locked ? !on : taken.includes(b.key) && !on;
                const n = units.filter((u) => inBucket(u, b.key)).length;
                return (
                  <button
                    key={b.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => onBucket(b.key)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors ${
                      on
                        ? 'bg-ink-900 text-white ring-ink-900'
                        : disabled
                          ? 'bg-ink-50 text-ink-400 ring-ink-200'
                          : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50'
                    }`}
                  >
                    {b.label}
                    {!disabled ? (
                      <span className={on ? 'ml-1.5 text-white/70' : 'ml-1.5 text-ink-400'}>{n}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {locked ? null : (
              <p className="mt-2 text-[11px] text-ink-500">
                Greyed-out shelves already have a group. One group per shelf.
              </p>
            )}
          </div>

          {/* ------------------------------------------------- narrowing */}
          <div className="rounded-lg border border-ink-200">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
            >
              <span className="text-xs font-medium text-ink-700">Narrow it down</span>
              {described ? (
                <span className="truncate text-[11px] text-ink-900">{described}</span>
              ) : (
                <span className="text-[11px] text-ink-500">optional</span>
              )}
              <span className="ml-auto text-[11px] text-ink-500">{open ? 'Hide' : 'Edit'}</span>
            </button>

            {open ? (
              <div className="space-y-3.5 border-t border-ink-200 px-3.5 py-3.5">
                {bodies.length ? (
                  <div>
                    <span className="text-[11px] font-medium text-ink-600">Type</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {bodies.map((b) => {
                        const on = (filters.bodyStyles ?? []).includes(b.key);
                        return (
                          <button
                            key={b.key}
                            type="button"
                            onClick={() => toggle('bodyStyles', b.key)}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
                              on
                                ? 'bg-ink-900 text-white ring-ink-900'
                                : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50'
                            }`}
                          >
                            {b.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {makes.length > 1 ? (
                  <div>
                    <span className="text-[11px] font-medium text-ink-600">Make</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {makes.map(([m, n]) => {
                        const on = (filters.makes ?? []).includes(m);
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggle('makes', m)}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${
                              on
                                ? 'bg-ink-900 text-white ring-ink-900'
                                : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50'
                            }`}
                          >
                            {m}
                            <span className={on ? 'ml-1.5 text-white/60' : 'ml-1.5 text-ink-400'}>
                              {n}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-medium text-ink-600">Price up to</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-sm text-ink-500">$</span>
                      <input
                        inputMode="numeric"
                        value={num(filters.priceMax)}
                        onChange={(e) => set({ priceMax: parse(e.target.value) })}
                        placeholder="Any"
                        className={numField}
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="text-[11px] font-medium text-ink-600">Mileage under</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        inputMode="numeric"
                        value={num(filters.mileageMax)}
                        onChange={(e) => set({ mileageMax: parse(e.target.value) })}
                        placeholder="Any"
                        className={numField}
                      />
                      <span className="text-sm text-ink-500">mi</span>
                    </div>
                  </label>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-ink-600">Year</span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      inputMode="numeric"
                      value={num(filters.yearMin)}
                      onChange={(e) => set({ yearMin: parse(e.target.value) })}
                      placeholder="Any"
                      className={`${numField} max-w-[7rem]`}
                    />
                    <span className="text-[11px] text-ink-500">to</span>
                    <input
                      inputMode="numeric"
                      value={num(filters.yearMax)}
                      onChange={(e) => set({ yearMax: parse(e.target.value) })}
                      placeholder="Any"
                      className={`${numField} max-w-[7rem]`}
                    />
                  </div>
                </div>

                {hasAnyFilter(filters) ? (
                  <button
                    type="button"
                    onClick={() => onFilters({})}
                    className="text-[11px] text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
                  >
                    Clear all of it
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-ink-700">Name this group</span>
            <input
              value={name}
              onChange={(e) => onName(e.target.value)}
              maxLength={80}
              placeholder={suggested}
              className="mt-1 w-full max-w-sm rounded-lg border border-ink-300 bg-white px-2.5 py-2 text-sm text-ink-900"
            />
            {name !== suggested ? (
              <button
                type="button"
                onClick={() => onName(suggested)}
                className="mt-1.5 text-[11px] text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline"
              >
                Use “{suggested}”
              </button>
            ) : (
              <span className="mt-1 block text-[11px] text-ink-500">
                Named from the rule. Change it if you like.
              </span>
            )}
          </label>
        </div>

        {/* ------------------------------------------------------- count */}
        <div className="h-fit rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
          <p className="text-sm font-medium text-ink-900">
            <span className="text-2xl font-bold tabular-nums">{matched.length}</span>{' '}
            {matched.length === 1 ? 'car matches' : 'cars match'} right now
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
            {hasAnyFilter(filters)
              ? `Out of ${onShelf.length} on this shelf. `
              : ''}
            Cars join when you take them in and drop out the day they sell — the group keeps running
            either way. Only cars that are front-line ready and Marketplace-clean are counted.
          </p>

          {matched.length === 0 ? (
            <p className="mt-2 rounded bg-amber-100 px-2 py-1.5 text-[11px] font-medium text-amber-900">
              Nothing matches today. Facebook refuses an empty group, so this will not build until
              you widen it or a car lands in it.
            </p>
          ) : matched.length < 5 ? (
            <p className="mt-2 rounded bg-amber-100 px-2 py-1.5 text-[11px] font-medium text-amber-900">
              Thin. Facebook does better with more to pick from — a wider rule usually costs less
              per click.
            </p>
          ) : null}

          {filters.priceMax != null ? (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              The price rule reaches Facebook on the next inventory feed, which runs daily. Until
              then the group targets everything else you set.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
