'use client';

import { useCallback, useRef, useState } from 'react';
import { cn } from '@/components/ui';
import { VideoPlayer } from '@/components/video/player';
import { clock, posterUrl } from '@/lib/video/urls';

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

export type GalleryVideo = { playbackId: string; aspectRatio: string | null; durationSec: number | null };

function Play({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5.5v13a.5.5 0 0 0 .77.42l10-6.5a.5.5 0 0 0 0-.84l-10-6.5A.5.5 0 0 0 8 5.5z" />
    </svg>
  );
}

/**
 * The walkaround sits in the stage, not in a section further down: a shopper
 * looking at photos is exactly the shopper who wants to see it move. It is the
 * first thumbnail and a button on the stage, and it never autoplays.
 */
function WalkaroundStage({ video, title }: { video: GalleryVideo; title: string }) {
  return (
    <div className="flex aspect-[3/2] w-full items-center justify-center bg-black">
      <VideoPlayer
        playbackId={video.playbackId}
        title={`${title} walkaround`}
        aspectRatio={video.aspectRatio}
        accentColor="var(--brand)"
        className="h-full max-w-full"
      />
    </div>
  );
}

export function Gallery({
  photos,
  title,
  video,
}: {
  photos: GalleryPhoto[];
  title: string;
  video?: GalleryVideo | null;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const count = photos.length;
  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setPlaying(false);
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  if (!count && video) {
    return (
      <div className="overflow-hidden rounded-xl border border-[var(--line)]">
        <WalkaroundStage video={video} title={title} />
      </div>
    );
  }

  if (!count) {
    return (
      <div className="flex aspect-[3/2] w-full items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--paper-2)] text-sm text-[var(--text-3)]">
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
        className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      >
        {playing && video ? (
          <WalkaroundStage video={video} title={title} />
        ) : (
          <img
            key={current.url}
            src={current.url}
            alt={current.alt || `${title} — photo ${index + 1} of ${count}`}
            width={1200}
            height={800}
            className="aspect-[3/2] w-full object-cover"
          />
        )}

        {video && !playing ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-[var(--scrim)]/80 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[var(--scrim)]"
          >
            <Play className="h-3.5 w-3.5" />
            Watch walkaround{clock(video.durationSec) ? ` · ${clock(video.durationSec)}` : ''}
          </button>
        ) : null}

        {playing ? null : (<>
        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous photo"
          className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-[var(--paper)]/90 p-2 text-[var(--text)] shadow-sm transition hover:bg-[var(--paper)]"
        >
          <Arrow dir="left" />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next photo"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[var(--paper)]/90 p-2 text-[var(--text)] shadow-sm transition hover:bg-[var(--paper)]"
        >
          <Arrow dir="right" />
        </button>

        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <span className="tnum rounded-md bg-[var(--scrim)]/75 px-2 py-1 text-xs font-semibold text-white">
            {index + 1} / {count}
          </span>
          {TAG_LABEL[current.tag] ? (
            <span className="rounded-md bg-[var(--scrim)]/55 px-2 py-1 text-xs font-medium text-white">
              {TAG_LABEL[current.tag]}
            </span>
          ) : null}
        </div>
        </>)}
      </div>

      <div className="scroll-thin mt-2 flex gap-2 overflow-x-auto pb-1">
        {video ? (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label="Play the walkaround video"
            aria-current={playing ? 'true' : undefined}
            className={cn(
              'relative shrink-0 overflow-hidden rounded-lg border-2 transition',
              playing ? 'border-[var(--brand)]' : 'border-transparent opacity-90 hover:opacity-100',
            )}
          >
            <img
              src={posterUrl(video.playbackId, 240)}
              alt=""
              width={240}
              height={160}
              loading="lazy"
              className="aspect-[3/2] w-24 bg-black object-cover sm:w-28"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/60 p-1.5 text-white">
                <Play className="h-4 w-4" />
              </span>
            </span>
          </button>
        ) : null}
        {photos.map((p, i) => (
          <button
            key={p.url}
            type="button"
            onClick={() => {
              go(i);
              stageRef.current?.focus();
            }}
            aria-label={`Show photo ${i + 1}: ${TAG_LABEL[p.tag] ?? 'photo'}`}
            aria-current={i === index && !playing ? 'true' : undefined}
            className={cn(
              'shrink-0 overflow-hidden rounded-lg border-2 transition',
              i === index && !playing
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
