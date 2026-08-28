'use client';

/**
 * Adding photographs to a vehicle, from the phone that took them.
 *
 * WHY THIS IS A CLIENT COMPONENT AT ALL. A plain HTML form posting a camera
 * photo straight to a server action does not work on Vercel — the platform
 * rejects a server action body over roughly 4.5MB before any of our code runs,
 * and a modern phone photo is 3-8MB. The failure arrives as a generic network
 * error with nothing to act on.
 *
 * So each file is downscaled in the browser first, by the same
 * `prepareForUpload` the document intake uses: 1800px long edge, JPEG q0.85,
 * which puts a lot photo in the 200-600KB range. That helper also converts HEIC
 * as a side effect of the canvas round trip, applies the EXIF rotation before
 * discarding EXIF, and so drops the GPS a photo taken on a lot carries — a
 * dealer's coordinates have no business travelling to Meta.
 *
 * WHY THE FILES GO UP ONE REQUEST AT A TIME.
 *
 * The 4.5MB ceiling is per request, so ten prepared photos at ~500KB each would
 * not fit in one. Sequential requests also mean a lot with two bars keeps the
 * eight that made it when the ninth times out, instead of losing the batch —
 * and the count on screen is a real count, not an optimistic one.
 *
 * WHY NOTHING ASKS WHAT THE PHOTO IS OF.
 *
 * Shooting a car is continuous: walk round it, open a door, pop the hood.
 * Stopping to classify each frame in a dropdown before it uploads is the step
 * that makes a porter give up and text the pictures to someone instead. They
 * all land as exterior shots and get retagged from the grid afterwards, where
 * the pictures are actually visible.
 */

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { prepareForUpload } from '@/components/intake/capture';

/**
 * Enough for a full walkaround in one go; small enough that a failure halfway
 * through is not a disaster and the browser is not holding a hundred bitmaps.
 */
const MAX_BATCH = 10;
/** The edge rejects a server action body over ~4.5MB; stay clear of it. */
const MAX_PREPARED_BYTES = 4 * 1024 * 1024;

type Result = { done: number; failed: string[] };

export function PhotoAdd({
  vehicleId,
  action,
}: {
  vehicleId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function upload(files: File[]) {
    setError(null);
    setResult(null);

    const batch = files.slice(0, MAX_BATCH);
    const overflow = files.length - batch.length;
    setProgress({ done: 0, total: batch.length });

    const failed: string[] = [];
    let done = 0;

    for (const file of batch) {
      try {
        if (file.type && !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) {
          failed.push(`${file.name} is not a photo`);
          continue;
        }
        const prepared = await prepareForUpload(file);
        // If the browser could not decode it, the helper hands the original
        // straight back — and a 9MB original fails at the edge with nothing
        // readable in the response. Say so here instead.
        if (prepared.size > MAX_PREPARED_BYTES) {
          failed.push(`${file.name} is too large`);
          continue;
        }
        const fd = new FormData();
        fd.set('vehicleId', vehicleId);
        fd.set('scene', 'EXTERIOR_SIDE');
        fd.set('file', prepared);
        await action(fd);
        done += 1;
      } catch {
        failed.push(file.name);
      }
      setProgress({ done, total: batch.length });
    }

    setProgress(null);
    setResult({ done, failed });
    if (overflow > 0) {
      setError(`${MAX_BATCH} at a time — ${overflow} more still to add.`);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function addTile() {
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.set('vehicleId', vehicleId);
    fd.set('scene', 'EXTERIOR_SIDE');
    start(async () => {
      await action(fd);
    });
  }

  const busy = pending || progress !== null;

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
      {error ? <span className="text-[11px] text-amber-700">{error}</span> : null}
      {result && !error ? (
        <span className="text-[11px] text-ink-500">
          {result.done} added{result.failed.length ? ` · ${result.failed.length} failed` : ''}
        </span>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) void upload(picked);
        }}
      />

      <Button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="w-full sm:w-auto"
      >
        {progress
          ? `Uploading ${progress.done + 1} of ${progress.total}…`
          : `Add photos`}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        type="button"
        onClick={addTile}
        disabled={busy}
        title="Adds a generated placeholder tile, not a photograph. Marketplaces will not carry it."
      >
        {pending ? 'Adding…' : 'Placeholder'}
      </Button>
    </div>
  );
}
