'use client';

/**
 * The photo control on a vehicle page: pick a scene, optionally pick a file.
 *
 * WHY THIS IS A CLIENT COMPONENT AT ALL. A plain HTML form posting a camera
 * photo straight to a server action does not work on Vercel — the platform
 * rejects a server action body over roughly 4.5MB before any of our code runs,
 * and a modern phone photo is 3-8MB. The failure arrives as a generic network
 * error with nothing to act on.
 *
 * So the file is downscaled in the browser first, by the same `prepareForUpload`
 * the document intake already uses: 1800px long edge, JPEG q0.85, which puts a
 * lot photo in the 200-600KB range. That helper also converts HEIC as a side
 * effect of the canvas round trip, so an iPhone upload does not arrive in a
 * format nothing downstream can open, and it drops EXIF — a photo taken on a
 * lot carries GPS, and a dealer's coordinates have no business travelling to
 * Meta.
 */

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { prepareForUpload } from '@/components/intake/capture';

const SCENES = [
  'EXTERIOR_SIDE',
  'EXTERIOR_FRONT',
  'EXTERIOR_REAR',
  'INTERIOR',
  'ODOMETER',
  'ENGINE',
] as const;

export function PhotoAdd({
  vehicleId,
  action,
}: {
  vehicleId: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [scene, setScene] = useState<string>('EXTERIOR_SIDE');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function submit() {
    setError(null);
    const picked = fileRef.current?.files?.[0] ?? null;

    const fd = new FormData();
    fd.set('vehicleId', vehicleId);
    fd.set('scene', scene);

    if (picked) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(picked.type) && picked.type !== '') {
        setError('That file is not a photo. JPEG, PNG or WEBP.');
        return;
      }
      const prepared = await prepareForUpload(picked);
      // Belt and braces: if the browser could not decode the image, the helper
      // hands the original straight back, and a 9MB original would fail at the
      // edge with nothing readable. Say so here instead.
      if (prepared.size > 4 * 1024 * 1024) {
        setError('That photo is too large to upload. Try a smaller one.');
        return;
      }
      fd.set('file', prepared);
    }

    start(async () => {
      await action(fd);
      if (fileRef.current) fileRef.current.value = '';
      setFileName(null);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? <span className="text-[11px] text-red-700">{error}</span> : null}

      <select
        value={scene}
        onChange={(e) => setScene(e.target.value)}
        className="rounded-md border border-ink-300 bg-white px-2 py-1 text-[11px]"
      >
        {SCENES.map((s) => (
          <option key={s} value={s}>
            {s.replace('_', ' ').toLowerCase()}
          </option>
        ))}
      </select>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          setError(null);
          setFileName(e.target.files?.[0]?.name ?? null);
        }}
      />

      <Button
        size="sm"
        variant="secondary"
        type="button"
        onClick={() => fileRef.current?.click()}
      >
        {fileName ? truncate(fileName) : 'Choose photo'}
      </Button>

      <Button size="sm" variant="secondary" type="button" onClick={submit} disabled={pending}>
        {pending ? 'Adding…' : fileName ? 'Upload' : 'Add tile'}
      </Button>
    </div>
  );
}

function truncate(name: string): string {
  return name.length > 18 ? `${name.slice(0, 15)}…` : name;
}
