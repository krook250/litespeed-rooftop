'use client';

import { useCallback, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, cn } from '@/components/ui';
import { IMPORT_FIELDS, type ImportField, type Mapping } from '@/lib/import/mapping';
import type { Issue } from '@/lib/import/plan';

/**
 * Upload a file, agree what the columns mean, look at what would happen, commit.
 *
 * THE PREVIEW IS THE PRODUCT. Anyone can write a CSV importer that succeeds; the
 * failures in this category are all silent, and every one of them is visible on
 * this screen before anything is written — a body style nobody recognised, a
 * transmission that would have defaulted to automatic, a stock number we had to
 * invent, a dealership phone number taken out of the ad copy. A dealer who
 * scrolls this list once trusts the number at the bottom.
 *
 * Re-plans on the server on every mapping change rather than filtering a cached
 * result, so what is on screen is always what the server would actually do.
 */

type PreviewRow = {
  line: number;
  vin: string;
  title: string;
  action: 'create' | 'update' | 'skip';
  price: number | null;
  mileage: number | null;
  stockNumber: string | null;
  bodyStyle: string | null;
  photos: number;
  options: number;
  issues: Issue[];
};

type PlanResponse = {
  vin?: { decoded: number; cached: number; undecoded: number; filled: Record<string, number> };
  headers: string[];
  mapping: Mapping;
  missing: ImportField[];
  ragged: { line: number; got: number; expected: number }[];
  raggedCount: number;
  summary: { total: number; create: number; update: number; skip: number; warnings: number; photos: number };
  rows: PreviewRow[];
};

type CommitResponse = {
  created: number;
  updated: number;
  skipped: number;
  photosAdded: number;
  syncStatesOpened: number;
  failed: { vin: string; error: string }[];
};

const NOT_MAPPED = '';

const FIELD_LABEL: Record<string, string> = {
  drivetrain: 'drivetrain',
  doors: 'doors',
  cylinders: 'cylinders',
  fuelType: 'fuel type',
  bodyStyle: 'body style',
  engine: 'engine',
};
const label = (f: string) => FIELD_LABEL[f] ?? f;

/**
 * What a warning means when it is true of the whole file rather than one car.
 *
 * Three of the four notes on the Malabar file are identical on all twenty-one
 * rows — no stock numbers, a spec-sheet options column, photos on the old
 * provider's CDN. Repeated per row they are eighty lines of noise that bury the
 * two that actually single a vehicle out ("Chassis filed as TRUCK",
 * "Transmission Unspecified"). Said once at the top they are four facts about
 * the export, which is what they are.
 */
const FILE_WIDE: Partial<Record<Issue['code'], string>> = {
  STOCK_NUMBER_DERIVED: 'No stock numbers in this file — using the last six of each VIN.',
  PHOTOS_OFF_SITE: 'Photos are hosted by whoever is syndicating today, not by us. They stay live only as long as that account does.',
  OPTIONS_SPEC_DUMP: 'The options column is a factory spec sheet rather than selling points.',
  CONTACT_INFO_REMOVED: 'Phone numbers and street addresses were taken out of the descriptions — marketplaces object to contact details in ad copy.',
  NO_PHOTOS: 'No photos in this file.',
  VIN_CHECKSUM_FAILED: 'VINs that fail their check digit — one character is wrong.',
};

/** A warning true of this share of the importable rows is a fact about the file. */
const FILE_WIDE_SHARE = 0.8;
const num = (n: number | null) => (n === null ? '—' : n.toLocaleString());

export function ImportPanel({ rooftops }: { rooftops: { id: string; name: string }[] }) {
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [rooftopId, setRooftopId] = useState(rooftops[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CommitResponse | null>(null);
  const [showAll, setShowAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const runPlan = useCallback(async (text: string, mapping?: Mapping) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/import/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv: text, mapping }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Could not read that file.');
        setPlan(null);
      } else {
        setPlan(json as PlanResponse);
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setDone(null);
    setPlan(null);
    const text = await file.text();
    setCsv(text);
    await runPlan(text);
  }

  function remap(field: ImportField, header: string) {
    if (!plan) return;
    const next: Mapping = { ...plan.mapping };
    // A header may only feed one field, so taking it releases it elsewhere.
    for (const k of Object.keys(next) as ImportField[]) {
      if (next[k] === header) delete next[k];
    }
    if (header === NOT_MAPPED) delete next[field];
    else next[field] = header;
    setPlan({ ...plan, mapping: next });
    void runPlan(csv, next);
  }

  async function commit() {
    if (!plan || !rooftopId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, mapping: plan.mapping, rooftopId }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'Import failed.');
      else {
        setDone(json as CommitResponse);
        setPlan(null);
        setCsv('');
        if (fileInput.current) fileInput.current.value = '';
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const importable = plan ? plan.summary.create + plan.summary.update : 0;

  // Codes carried by nearly every row get said once, above, instead of 21 times.
  const counts = new Map<string, number>();
  for (const r of plan?.rows ?? []) {
    for (const code of new Set(r.issues.map((i) => i.code))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const hoisted = new Set(
    [...counts.entries()]
      .filter(([code, n]) =>
        code in FILE_WIDE && n >= Math.max(2, Math.ceil((plan?.rows.length ?? 0) * FILE_WIDE_SHARE)))
      .map(([code]) => code),
  );
  const blocked = !plan || plan.missing.length > 0 || importable === 0 || !rooftopId || busy;
  const visibleRows = plan ? (showAll ? plan.rows : plan.rows.slice(0, 25)) : [];

  return (
    <div className="space-y-5">
      {done ? (() => {
        /**
         * The panel reports what happened, and it has three outcomes rather than
         * one.
         *
         * It used to have a single green treatment: a run where every row failed
         * still announced itself in success colours, with "0 added, 0 updated"
         * as the headline and twenty-one red errors nested underneath. That is a
         * failure wearing a success costume, and a screen that congratulates you
         * for writing nothing is worse than one that says nothing at all.
         */
        const wrote = done.created + done.updated;
        const tone =
          wrote === 0 ? 'bad' : done.failed.length > 0 ? 'mixed' : 'good';

        const box = {
          good: 'border-emerald-300 bg-emerald-50/50',
          mixed: 'border-amber-300 bg-amber-50/60',
          bad: 'border-red-300 bg-red-50/60',
        }[tone];
        const head = {
          good: 'text-emerald-900',
          mixed: 'text-amber-900',
          bad: 'text-red-900',
        }[tone];
        const body = {
          good: 'text-emerald-800',
          mixed: 'text-amber-900',
          bad: 'text-red-800',
        }[tone];

        return (
          <Card className={cn('px-5 py-4', box)}>
            <p className={cn('text-sm font-semibold', head)}>
              {wrote === 0
                ? done.failed.length > 0
                  ? `Nothing was imported — all ${done.failed.length} rows failed.`
                  : 'Nothing was imported.'
                : `${done.created} added, ${done.updated} updated, ${done.photosAdded.toLocaleString()} photos attached.`}
            </p>

            {wrote > 0 && done.failed.length > 0 ? (
              <p className={cn('mt-1 text-xs font-medium', body)}>
                {done.failed.length} row{done.failed.length === 1 ? '' : 's'} failed and{' '}
                {done.failed.length === 1 ? 'was' : 'were'} not written.
              </p>
            ) : null}

            {done.skipped > 0 ? (
              <p className={cn('mt-1 text-xs', body)}>{done.skipped} rows were skipped.</p>
            ) : null}

            {done.failed.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {done.failed.map((f) => (
                  <li key={f.vin} className="text-xs text-red-700">
                    {f.vin} — {f.error}
                  </li>
                ))}
              </ul>
            ) : null}

            {/* Only worth saying when something actually landed. */}
            {wrote > 0 ? (
              <p className={cn('mt-2 text-xs', body)}>
                A unit that arrived with photographs is set to{' '}
                <strong>front-line ready</strong>; one that arrived without any is{' '}
                <strong>photos pending</strong>, which the marketplaces hold back until it has
                pictures. Check the prices before connecting a channel.
                {done.syncStatesOpened > 0
                  ? ` They are now tracked against every connected channel on the syndication screen (${done.syncStatesOpened.toLocaleString()} rows).`
                  : ''}
              </p>
            ) : null}
          </Card>
        );
      })() : null}

      <Card>
        <CardHeader
          title="Inventory file"
          subtitle="A CSV export from a DMS, a website provider, or whoever is syndicating for them today. Nothing is written until you have looked at the preview."
        />
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="block text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-ink-800"
          />
          {busy ? <span className="text-xs text-ink-500">Reading…</span> : null}
        </div>
      </Card>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-800 ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      ) : null}

      {plan ? (
        <>
          <Card>
            <CardHeader
              title="Columns"
              subtitle="Guessed from the header row. Anything wrong here is wrong in every vehicle, so it is worth ten seconds."
            />
            <div className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-2">
              {IMPORT_FIELDS.map((f) => {
                const value = plan.mapping[f.key] ?? NOT_MAPPED;
                const missing = plan.missing.includes(f.key);
                return (
                  <label key={f.key} className="flex items-center gap-2 text-sm">
                    <span className={cn('w-32 shrink-0', missing ? 'font-semibold text-red-700' : 'text-ink-600')}>
                      {f.label}
                      {f.required ? <span className="text-red-500"> *</span> : null}
                    </span>
                    <select
                      value={value}
                      onChange={(e) => remap(f.key, e.target.value)}
                      className={cn(
                        'min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm',
                        missing ? 'border-red-400 bg-red-50' : 'border-ink-300 bg-white',
                      )}
                    >
                      <option value={NOT_MAPPED}>— not mapped —</option>
                      {plan.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            {plan.missing.length ? (
              <p className="border-t border-red-200 bg-red-50 px-5 py-2.5 text-xs text-red-800">
                Nothing can be imported until every starred column is mapped.
              </p>
            ) : null}
            {plan.raggedCount ? (
              <p className="border-t border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
                {plan.raggedCount} row{plan.raggedCount === 1 ? ' has' : 's have'} a different number of
                columns than the header — usually a stray comma. Those rows still import; check them below.
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="What this would do"
              subtitle={`${plan.summary.create} new · ${plan.summary.update} updated · ${plan.summary.skip} skipped · ${plan.summary.photos.toLocaleString()} photos`}
              action={
                <div className="flex shrink-0 items-center gap-2">
                  {rooftops.length > 1 ? (
                    <select
                      value={rooftopId}
                      onChange={(e) => setRooftopId(e.target.value)}
                      className="rounded-lg border border-ink-300 bg-white px-2 py-1.5 text-sm"
                    >
                      {rooftops.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  ) : null}
                  <Button onClick={() => void commit()} disabled={blocked}>
                    {busy ? 'Working…' : `Import ${importable}`}
                  </Button>
                </div>
              }
            />

            <p className="border-b border-ink-200 bg-ink-50 px-5 py-2.5 text-xs text-ink-600">
              An update changes <strong>price and mileage</strong> and fills in blanks. It will not
              overwrite a description, a trim or photos somebody has already edited here.
            </p>

            {plan.vin && plan.vin.decoded > 0 && Object.keys(plan.vin.filled).length > 0 ? (
              <p className="border-b border-emerald-200 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-900">
                <span className="font-semibold">
                  {plan.vin.decoded} VIN{plan.vin.decoded === 1 ? '' : 's'} decoded
                </span>{' '}
                — the manufacturer&rsquo;s own encoding filled{' '}
                {Object.entries(plan.vin.filled)
                  .sort((a, b) => b[1] - a[1])
                  .map(([field, n]) => `${label(field)} on ${n}`)
                  .join(', ')}
                .
                {plan.vin.undecoded > 0
                  ? ` ${plan.vin.undecoded} VIN${plan.vin.undecoded === 1 ? '' : 's'} could not be decoded; those rows keep the file's values.`
                  : ''}
              </p>
            ) : null}

            {hoisted.size > 0 ? (
              <ul className="space-y-1 border-b border-amber-200 bg-amber-50 px-5 py-3">
                {[...hoisted].map((code) => (
                  <li key={code} className="text-xs text-amber-900">
                    <span className="font-semibold">
                      {counts.get(code) === plan.rows.length ? 'Every row' : `${counts.get(code)} rows`}
                    </span>{' '}
                    — {FILE_WIDE[code as Issue['code']]}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr className="border-b border-ink-200">
                    <th className="px-5 py-2 font-medium">Row</th>
                    <th className="py-2 pr-3 font-medium">Vehicle</th>
                    <th className="py-2 pr-3 font-medium">Stock</th>
                    <th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 text-right font-medium">Miles</th>
                    <th className="py-2 pr-3 text-right font-medium">Photos</th>
                    <th className="px-5 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr key={r.line} className={cn('border-b border-ink-100 align-top', r.action === 'skip' && 'bg-red-50/40')}>
                      <td className="whitespace-nowrap px-5 py-2.5">
                        <Badge tone={r.action === 'create' ? 'green' : r.action === 'update' ? 'blue' : 'red'}>
                          {r.action}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-ink-900">{r.title}</div>
                        <div className="font-mono text-xs text-ink-400">{r.vin || '—'}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-ink-600">{r.stockNumber ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-800">
                        {r.price === null ? '—' : `$${num(r.price)}`}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-600">{num(r.mileage)}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-ink-600">{r.photos || '—'}</td>
                      <td className="px-5 py-2.5">
                        {r.issues.filter((i) => !hoisted.has(i.code)).length === 0 ? (
                          <span className="text-xs text-ink-400">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {r.issues.filter((i) => !hoisted.has(i.code)).map((i, n) => (
                              <li
                                key={n}
                                className={cn('text-xs', i.severity === 'error' ? 'text-red-700' : 'text-amber-700')}
                              >
                                {i.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {plan.rows.length > visibleRows.length ? (
              <button
                onClick={() => setShowAll(true)}
                className="w-full border-t border-ink-200 px-5 py-2.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
              >
                Show the other {plan.rows.length - visibleRows.length}
              </button>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
