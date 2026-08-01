'use client';

import { useCallback, useRef, useState } from 'react';
import { cn } from '@/components/ui';

export type GalleryPhoto = { url: string; alt: string; tag: string };

const TAG_LABEL: Record<string, string> = {
  EXTERIOR_FRONT: 'Front',
  EXTERIOR_SIDE: 'Side',
  EXTERIOR_REAR: 'Rear',
  INTERIOR: 'Interior',
  ODOMETER: 'Odometer',
  ENGINE: 'Engine',
  DAMAGE: 'Damage disclosure',
  OTHER: 'Other',
};

function Arrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={dir === 'left' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'}
      />
    </svg>
  );
}

export function Gallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const [index, setIndex] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);

  const count = photos.length;
  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  if (!count) {
    return (
      <div className="flex aspect-[3/2] w-full items-center justify-center rounded-xl border border-ink-200 bg-ink-100 text-sm text-ink-500">
        Photos are being shot today — call for a walkaround.
      </div>
    );
  }

  const current = photos[index]!;

  return (
    <div>
      <div
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={`${title} photos`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(index - 1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(index + 1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            go(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            go(count - 1);
          }
        }}
        className="relative overflow-hidden rounded-xl border border-ink-200 bg-ink-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        <img
          key={current.url}
          src={current.url}
          alt={current.alt || `${title} — photo ${index + 1} of ${count}`}
          width={1200}
          height={800}
          className="aspect-[3/2] w-full object-cover"
        />

        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous photo"
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-ink-800 shadow-sm transition hover:bg-white"
        >
          <Arrow dir="left" />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next photo"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-ink-800 shadow-sm transition hover:bg-white"
        >
          <Arrow dir="right" />
        </button>

        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <span className="tnum rounded-md bg-ink-950/75 px-2 py-1 text-xs font-semibold text-white">
            {index + 1} / {count}
          </span>
          {TAG_LABEL[current.tag] ? (
            <span className="rounded-md bg-ink-950/55 px-2 py-1 text-xs font-medium text-white">
              {TAG_LABEL[current.tag]}
            </span>
          ) : null}
        </div>
      </div>

      <div className="scroll-thin mt-2 flex gap-2 overflow-x-auto pb-1">
        {photos.map((p, i) => (
          <button
            key={p.url}
            type="button"
            onClick={() => {
              go(i);
              stageRef.current?.focus();
            }}
            aria-label={`Show photo ${i + 1}: ${TAG_LABEL[p.tag] ?? 'photo'}`}
            aria-current={i === index ? 'true' : undefined}
            className={cn(
              'shrink-0 overflow-hidden rounded-lg border-2 transition',
              i === index
                ? 'border-[var(--brand)]'
                : 'border-transparent opacity-75 hover:opacity-100',
            )}
          >
            <img
              src={p.url}
              alt=""
              width={1200}
              height={800}
              loading="lazy"
              className="aspect-[3/2] w-24 object-cover sm:w-28"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
