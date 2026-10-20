'use client';

/**
 * The walkaround slot on a vehicle. One video per unit: it plays on the
 * website listing, and Social and the Ad Desk pick it up from here.
 *
 * Shot on the phone, uploaded from the phone — the file input takes the
 * camera roll or the camera itself. No trimming, no title, no questions; the
 * vehicle is the title.
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { deleteVideo } from '@/lib/video/actions';
import { clock } from '@/lib/video/urls';
import type { VideoView } from '@/lib/video/view';
import { VideoPlayer } from './player';
import { useVideoPoll } from './use-video-poll';
import { useVideoUpload } from './use-video-upload';

export function WalkaroundCard({
  vehicleId,
  title,
  initial,
  listingUrl,
}: {
  vehicleId: string;
  /** "2019 Ram 1500 Laramie" — the player's title. */
  title: string;
  initial: VideoView | null;
  /** The unit's page on the dealer's website, when it is public. */
  listingUrl: string | null;
}) {
  const [local, setLocal] = useState<VideoView | null>(null);
  const video = useVideoPoll(local ?? initial);
  const { state, upload, cancel, reset } = useVideoUpload(setLocal);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = () => {
    reset();
    fileRef.current?.click();
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="video/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void upload(f, { kind: 'WALKAROUND', vehicleId });
      }}
    />
  );

  if (state.phase === 'sending') {
    return (
      <div className="space-y-3 p-5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="truncate font-medium text-ink-800">Uploading {state.name}</span>
          <span className="tnum font-semibold text-ink-900">{state.percent}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink-100">
          <div className="h-full rounded-full bg-ink-900 transition-[width]" style={{ width: `${state.percent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">Keep this page open until it reaches 100%. After that you can leave.</p>
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const error = state.phase === 'error' ? state.message : null;

  if (!video) {
    return (
      <div className="space-y-3 p-5">
        {input}
        <p className="text-sm text-ink-700">
          One slow lap around the car, phone held sideways, about a minute. It goes on the website listing, and you can post it
          or run it as an ad.
        </p>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button onClick={pick}>Upload walkaround</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-5">
      {input}

      {video.status === 'READY' && video.playbackId ? (
        <VideoPlayer
          playbackId={video.playbackId}
          title={title}
          aspectRatio={video.aspectRatio}
          className="max-h-[70vh] w-full max-w-xl overflow-hidden rounded-lg bg-black"
        />
      ) : video.status === 'FAILED' ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {video.error ?? "Couldn't process this video."}
        </p>
      ) : (
        <div className="flex aspect-video w-full max-w-xl items-center justify-center rounded-lg bg-ink-100 text-sm text-ink-600">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-400 border-t-transparent" />
            Processing — about a minute for every minute of video.
          </span>
        </div>
      )}

      {video.status === 'READY' ? (
        <p className="text-xs text-ink-500">
          {clock(video.durationSec) ? `${clock(video.durationSec)} · ` : ''}
          {listingUrl ? (
            <a href={listingUrl} target="_blank" rel="noreferrer" className="font-medium text-ink-700 underline">
              On the website listing
            </a>
          ) : (
            'Shows on the website listing once the unit is public'
          )}
          {video.mp4Ready ? ' · Ready for Facebook and Instagram' : ' · Getting it ready for Facebook…'}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex items-center gap-2">
        {video.status === 'READY' || video.status === 'FAILED' ? (
          <Button variant="secondary" size="sm" onClick={pick}>
            {video.status === 'FAILED' ? 'Try another video' : 'Replace'}
          </Button>
        ) : null}
        <form action={deleteVideo} onSubmit={() => setLocal(null)} className="ml-auto">
          <input type="hidden" name="videoId" value={video.id} />
          <button className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
            Delete
          </button>
        </form>
      </div>
      {video.status === 'READY' ? (
        <p className="text-xs text-ink-400">A replacement takes over once it has processed, so the listing is never without one.</p>
      ) : null}
    </div>
  );
}
