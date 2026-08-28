'use client';

import { useTransition } from 'react';

/**
 * What a photo is of, changed from the grid where the photo is visible.
 *
 * A select rather than a form with a save button, because the correction is one
 * glance and one tap and anything more gets skipped. Submits on change, in a
 * transition so the row stays interactive while the server revalidates.
 */
const TAGS: Array<[string, string]> = [
  ['EXTERIOR_SIDE', 'Exterior · side'],
  ['EXTERIOR_FRONT', 'Exterior · front'],
  ['EXTERIOR_REAR', 'Exterior · rear'],
  ['INTERIOR', 'Interior'],
  ['ENGINE', 'Engine'],
  ['ODOMETER', 'Odometer'],
  ['DAMAGE', 'Damage'],
  ['OTHER', 'Other'],
];

export function PhotoTag({
  photoId,
  tag,
  action,
}: {
  photoId: string;
  tag: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [pending, start] = useTransition();

  return (
    <select
      value={tag}
      disabled={pending}
      aria-label="What this photo shows"
      onChange={(e) => {
        const fd = new FormData();
        fd.set('photoId', photoId);
        fd.set('tag', e.target.value);
        start(async () => {
          await action(fd);
        });
      }}
      className="w-full rounded-md border border-ink-300 bg-white px-2 py-1.5 text-xs text-ink-700 disabled:opacity-60"
    >
      {TAGS.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
