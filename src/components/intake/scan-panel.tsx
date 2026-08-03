'use client';

/**
 * Add a vehicle by pointing a camera at its paperwork.
 *
 * THE INTERACTION THIS IS BUILT AROUND
 * Someone is standing next to a car holding a phone in one hand and a title in
 * the other. They get one tap before the interaction is worse than typing. So
 * the primary control is a camera button, there is no upload dialog in the way,
 * the result appears as a filled-in form rather than as a wizard step, and the
 * only thing asked of them afterwards is to glance at four numbers.
 *
 * THE THREE PATHS, FASTEST FIRST
 *   1. Barcode. If the phone can read the Code 39 strip on the doorjamb label,
 *      nothing is uploaded at all — it is a cached VIN lookup, well under a
 *      second, and it costs nothing.
 *   2. Document. The photo is downscaled locally and read on the server.
 *   3. VIN box. Seventeen characters, for when the paperwork is in the office
 *      and the car is not.
 *
 * WHY THE FORM IS ALWAYS VISIBLE UNDERNEATH
 * A scan-first page that hides the form until the scan succeeds punishes the bad
 * read twice: it failed, and now there is a mode to escape. Here the scan fills
 * a form that was already there, so a failure costs exactly what it would have
 * cost to type it in the first place, which is the honest price of trying.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Rooftop } from '@/db/schema';
import { Button, Card, CardHeader, cn } from '@/components/ui';
import { VehicleForm } from '@/components/vehicle-form';
import { isValidVin } from '@/lib/vin';
import { plainValues, type Extraction, type ScanResult, type ScanWarning } from '@/lib/intake/types';
import { barcodeSupported, prepareForUpload, previewUrl, readVinBarcode } from './capture';

type Phase = 'idle' | 'busy' | 'done';

const REVIEW: Array<{ key: keyof Extraction; label: string; format?: (v: unknown) => string }> = [
  { key: 'vin', label: 'VIN' },
  { key: 'mileage', label: 'Mileage', format: (v) => Number(v).toLocaleString() },
  { key: 'price', label: 'Asking price', format: (v) => `$${Number(v).toLocaleString()}` },
  { key: 'titleStatus', label: 'Title' },
];

export function ScanPanel({
  rooftops,
  action,
}: {
  rooftops: Rooftop[];
  /** `saveVehicle`, handed down from the server component. */
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [rooftopId, setRooftopId] = useState(rooftops[0]?.id ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<File[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [vinInput, setVinInput] = useState('');
  const [canBarcode, setCanBarcode] = useState(false);

  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Feature-detected after mount, never during render — the server has no
  // BarcodeDetector and a mismatch here is a hydration error.
  useEffect(() => setCanBarcode(barcodeSupported()), []);

  useEffect(() => () => thumbs.forEach((t) => URL.revokeObjectURL(t)), [thumbs]);

  const runScan = useCallback(
    async (nextPages: File[]) => {
      setPhase('busy');
      setError(null);

      try {
        /* --- path 1: the barcode, before anything leaves the phone --- */
        if (nextPages.length === 1) {
          setStep('Looking for a VIN barcode…');
          const vin = await readVinBarcode(nextPages[0]!);
          if (vin) {
            setStep('VIN found — decoding…');
            const decoded = await decodeOnly(vin);
            if (decoded) {
              setResult(decoded);
              setPhase('done');
              return;
            }
          }
        }

        /* --- path 2: upload and read --- */
        setStep(nextPages.length > 1 ? `Preparing ${nextPages.length} pages…` : 'Preparing the photo…');
        const prepared = await Promise.all(nextPages.map(prepareForUpload));

        setStep('Reading the document…');
        const fd = new FormData();
        fd.append('rooftopId', rooftopId);
        for (const p of prepared) fd.append('pages', p, p.name);

        /**
         * A clean read is around five seconds. Past that, the usual cause is the
         * server escalating because the VIN it read failed its check digit —
         * which roughly doubles the time. Saying so beats an unchanging spinner:
         * twenty silent seconds on a phone reads as broken, and the person walks
         * away before the answer arrives.
         */
        const slowTimer = setTimeout(() => setStep('Still reading — double-checking the VIN…'), 7_000);
        let res: Response;
        try {
          res = await fetch('/api/intake/extract', { method: 'POST', body: fd });
        } finally {
          clearTimeout(slowTimer);
        }

        const json = (await res.json()) as ScanResult & { error?: string };
        if (!res.ok) throw new Error(json.error || `Upload failed (${res.status}).`);

        setResult(json);
        setPhase('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That did not work.');
        setPhase(result ? 'done' : 'idle');
      } finally {
        setStep('');
      }
    },
    [rooftopId, result],
  );

  const onFiles = useCallback(
    (list: FileList | null, replace: boolean) => {
      const picked = Array.from(list ?? []);
      if (!picked.length) return;
      const next = replace ? picked : [...pages, ...picked];
      setPages(next);
      setThumbs((old) => {
        old.forEach((t) => URL.revokeObjectURL(t));
        return next.map(previewUrl).filter((u): u is string => u !== null);
      });
      void runScan(next);
    },
    [pages, runScan],
  );

  const decodeOnly = useCallback(async (vin: string): Promise<ScanResult | null> => {
    const res = await fetch(`/api/intake/vin/${encodeURIComponent(vin)}`);
    const json = (await res.json()) as {
      ok: boolean;
      vin?: string;
      extraction?: Extraction;
      error?: string;
    };
    if (!json.ok) {
      setError(json.error ?? 'That VIN did not decode.');
      return null;
    }
    return {
      ok: true,
      scanId: null,
      documentKind: 'VIN_PLATE',
      reader: 'barcode',
      extraction: json.extraction ?? {},
      warnings: [],
      blobKeys: [],
      timings: { readMs: 0, decodeMs: 0, totalMs: 0 },
    };
  }, []);

  const onVinSubmit = useCallback(async () => {
    const vin = vinInput.trim().toUpperCase();
    setPhase('busy');
    setStep('Decoding…');
    setError(null);
    const decoded = await decodeOnly(vin);
    if (decoded) {
      setResult(decoded);
      setPhase('done');
    } else {
      setPhase(result ? 'done' : 'idle');
    }
    setStep('');
  }, [vinInput, decodeOnly, result]);

  const reset = () => {
    thumbs.forEach((t) => URL.revokeObjectURL(t));
    setPages([]);
    setThumbs([]);
    setResult(null);
    setError(null);
    setVinInput('');
    setPhase('idle');
  };

  const values = result ? plainValues(result.extraction) : {};
  const busy = phase === 'busy';
  const vinTyped = vinInput.replace(/[^A-Za-z0-9]/g, '');

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Scan it in"
          subtitle="Window sticker, title, auction sheet, or just the VIN plate. One photo does most of the work."
          action={
            result ? (
              <Button variant="ghost" size="sm" onClick={reset} type="button">
                Start over
              </Button>
            ) : null
          }
        />

        <div className="space-y-4 px-5 py-5">
          {rooftops.length > 1 ? (
            <label className="block max-w-xs">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Which lot
              </span>
              <select
                value={rooftopId}
                onChange={(e) => setRooftopId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-ink-900"
              >
                {rooftops.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5">
            {/* `capture` asks the OS for the camera directly rather than the
                photo library — one tap instead of three on a phone, and it is
                simply ignored on a desktop browser. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onFiles(e.target.files, true)}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => onFiles(e.target.files, true)}
            />

            <Button type="button" disabled={busy} onClick={() => cameraRef.current?.click()}>
              <CameraIcon />
              Take a photo
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <FileIcon />
              Choose a file
            </Button>

            {result ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                title="Front and back of a title, or a second sticker page"
              >
                + Another page
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-end gap-2.5">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Or type the VIN
              </span>
              <input
                value={vinInput}
                onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isValidVin(vinTyped)) void onVinSubmit();
                }}
                maxLength={20}
                spellCheck={false}
                autoCapitalize="characters"
                inputMode="text"
                placeholder="1FTFW1E53KFA12345"
                className="mt-1 w-[19rem] max-w-full rounded-lg border border-ink-300 bg-white px-2.5 py-1.5 font-mono text-sm tracking-wide outline-none focus:border-ink-900"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !isValidVin(vinTyped)}
              onClick={() => void onVinSubmit()}
            >
              Decode
            </Button>
            {/* The check digit turns "invalid VIN" into a live, character-level
                hint while someone is still typing, rather than a rejection
                after they have finished. */}
            {vinTyped.length === 17 && !isValidVin(vinTyped) ? (
              <p className="pb-1.5 text-xs text-amber-700">
                That VIN fails its check digit — one character is off.
              </p>
            ) : null}
          </div>

          {canBarcode ? (
            <p className="text-[11px] text-ink-500">
              This phone can read VIN barcodes. A photo of the doorjamb label fills the form
              without uploading anything.
            </p>
          ) : null}

          {thumbs.length ? (
            <div className="flex flex-wrap gap-2">
              {thumbs.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt={`Page ${i + 1}`}
                  className="h-16 w-16 rounded-lg border border-ink-200 object-cover"
                />
              ))}
            </div>
          ) : null}

          {busy ? (
            <div className="flex items-center gap-2.5 rounded-lg bg-ink-100 px-3 py-2.5 text-sm text-ink-700">
              <span className="h-2 w-2 shrink-0 rounded-full bg-ink-900 pulse-ring" />
              {step || 'Working…'}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-inset ring-red-600/20">
              {error}
            </p>
          ) : null}
        </div>
      </Card>

      {result ? (
        <ReviewCard result={result} />
      ) : null}

      <Card className="max-w-5xl">
        <CardHeader
          title={result ? 'Check it and save' : 'Or fill it in by hand'}
          subtitle={
            result
              ? 'Everything below came off the scan. Anything the VIN proved is already right.'
              : 'Nothing scanned yet — this works the same way it always did.'
          }
        />
        {/* Keyed on the scan so a fresh read re-seeds the uncontrolled inputs.
            Without this, React keeps the first scan's defaultValues forever and
            the second scan silently appears to do nothing. */}
        <VehicleForm
          key={result?.scanId ?? String(Object.keys(values).length) + rooftopId}
          rooftops={rooftops}
          action={action}
          prefill={{ ...values, rooftopId }}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ review card */

function ReviewCard({ result }: { result: ScanResult }) {
  const e = result.extraction;
  const filled = Object.keys(e).length;
  const evidence = Object.entries(e)
    .map(([k, v]) => [k, (v as { evidence?: string }).evidence] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]));

  return (
    <Card>
      <CardHeader
        title="What the scan found"
        subtitle={`${filled} field${filled === 1 ? '' : 's'} · read by ${readerLabel(result.reader)}${
          result.timings.totalMs ? ` in ${(result.timings.totalMs / 1000).toFixed(1)}s` : ''
        }`}
      />
      <div className="space-y-4 px-5 py-5">
        {result.warnings.map((w) => (
          <WarningRow key={w.code + w.message} warning={w} vehicleId={result.existingVehicleId} />
        ))}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REVIEW.map(({ key, label, format }) => {
            const f = e[key] as { value: unknown; confidence: string } | undefined;
            return (
              <div
                key={key}
                className={cn(
                  'rounded-xl border px-3.5 py-3',
                  !f
                    ? 'border-dashed border-ink-200 bg-ink-50'
                    : f.confidence === 'low'
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-ink-200 bg-white',
                )}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  {label}
                </div>
                <div className="tnum mt-1 truncate font-mono text-sm font-semibold text-ink-900">
                  {f ? (format ? format(f.value) : String(f.value)) : '—'}
                </div>
                <div className="mt-1 text-[11px] text-ink-500">
                  {!f ? 'not on the document' : f.confidence === 'low' ? 'worth a look' : 'looks right'}
                </div>
              </div>
            );
          })}
        </div>

        {evidence.length ? (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-ink-600 hover:text-ink-900">
              Where did each of these come from?
            </summary>
            <dl className="mt-3 space-y-1.5 rounded-lg bg-ink-50 px-3.5 py-3">
              {evidence.map(([k, v]) => (
                <div key={k} className="flex gap-3 text-[11px]">
                  <dt className="w-28 shrink-0 font-semibold text-ink-600">{k}</dt>
                  <dd className="min-w-0 flex-1 font-mono text-ink-700">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}

        {result.scanId ? (
          <p className="text-[11px] text-ink-400">
            Scan <span className="font-mono">{result.scanId.slice(0, 8)}</span> — quote this if a
            read comes out wrong.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function WarningRow({ warning, vehicleId }: { warning: ScanWarning; vehicleId?: string }) {
  const severe = warning.code === 'DUPLICATE_VIN' || warning.code === 'DOC_DISAGREES_WITH_VIN';
  return (
    <div
      className={cn(
        'rounded-lg px-3.5 py-2.5 text-sm ring-1 ring-inset',
        severe
          ? 'bg-red-50 text-red-900 ring-red-600/20'
          : 'bg-amber-50 text-amber-900 ring-amber-600/20',
      )}
    >
      {warning.message}
      {warning.code === 'DUPLICATE_VIN' && vehicleId ? (
        <>
          {' '}
          <a href={`/admin/inventory/${vehicleId}`} className="font-semibold underline">
            Open that unit instead
          </a>
        </>
      ) : null}
    </div>
  );
}

function readerLabel(reader: ScanResult['reader']) {
  return { barcode: 'the barcode', claude: 'the document reader', ocr: 'OCR', none: 'nothing' }[reader];
}

/* ---------------------------------------------------------------- icons */

function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
