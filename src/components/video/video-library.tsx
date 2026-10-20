'use client';

/**
 * Website → Videos. Top to bottom: the home page intro, adding a video, and
 * the videos themselves. Each card says what it is and does one or two things.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardHeader, cn } from '@/components/ui';
import { deleteVideo, renameVideo, setIntroVideo } from '@/lib/video/actions';
import { clock, posterUrl } from '@/lib/video/urls';
import type { VideoKind, VideoView } from '@/lib/video/view';
import { VideoPlayer } from './player';
import { useVideoPoll } from './use-video-poll';
import { useVideoUpload } from './use-video-upload';

const KIND_WORDS: Record<VideoKind, string> = {
  LOT: 'Lot tour',
  INTRO: 'Intro',
  OTHER: 'Other',
  WALKAROUND: 'Walkaround',
};
const PICKABLE: VideoKind[] = ['LOT', 'INTRO', 'OTHER'];

export function VideoLibrary({ videos, introVideoId }: { videos: VideoView[]; introVideoId: string | null }) {
  const router = useRouter();
  const all = videos;
  const intro = all.find((v) => v.id === introVideoId) ?? null;

  return (
    <>
      <Card>
        <CardHeader
          title="Home page intro"
          subtitle="Plays at the top of your home page. The one where you point at the camera and tell people to come on down."
        />
        <div className="p-5">
          {intro && intro.playbackId ? (
            <div className="space-y-3">
              <VideoPlayer
                playbackId={intro.playbackId}
                title={intro.title || 'Intro'}
                aspectRatio={intro.aspectRatio}
                className="max-h-[60vh] w-full max-w-xl overflow-hidden rounded-lg bg-black"
              />
              <form action={setIntroVideo}>
                <input type="hidden" name="videoId" value="" />
                <Button variant="secondary" size="sm">
                  Take it off the home page
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-ink-600">
              None yet. Upload one below, then press <b>Use as intro</b> on it.
            </p>
          )}
        </div>
      </Card>

      <AddVideo onAdded={() => router.refresh()} />

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Your videos</h2>
        {all.length ? (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {all.map((v) => (
              <VideoCard key={v.id} initial={v} isIntro={v.id === introVideoId} />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">Nothing here yet.</p>
        )}
      </section>
    </>
  );
}

function AddVideo({ onAdded }: { onAdded: () => void }) {
  const [kind, setKind] = useState<VideoKind>('LOT');
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { state, upload, cancel, reset } = useVideoUpload(() => {
    setTitle('');
    onAdded();
  });

  return (
    <Card>
      <CardHeader title="Add a video" subtitle="Straight from your phone is fine. Big files are fine too." />
      <div className="space-y-4 p-5">
        {state.phase === 'sending' ? (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink-800">Uploading {state.name}</span>
              <span className="tnum font-semibold text-ink-900">{state.percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full rounded-full bg-ink-900 transition-[width]" style={{ width: `${state.percent}%` }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-ink-500">Keep this page open until it reaches 100%.</p>
              <Button variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-800">What is it?</span>
              <div className="flex flex-wrap gap-2">
                {PICKABLE.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-inset',
                      kind === k ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-700 ring-ink-300 hover:bg-ink-50',
                    )}
                  >
                    {KIND_WORDS[k]}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-800">Name it (only you see this)</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'INTRO' ? 'Roy, take 3' : kind === 'LOT' ? 'Saturday lot tour' : ''}
                maxLength={120}
                className="w-full max-w-sm rounded-md border border-ink-300 px-3 py-2 text-sm"
              />
            </label>
            {state.phase === 'error' ? <p className="text-sm text-red-700">{state.message}</p> : null}
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f, { kind, title: title || f.name.replace(/\.[^.]+$/, '') });
              }}
            />
            <Button
              onClick={() => {
                reset();
                fileRef.current?.click();
              }}
            >
              Choose video
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function VideoCard({ initial, isIntro }: { initial: VideoView; isIntro: boolean }) {
  const v = useVideoPoll(initial);
  const [editing, setEditing] = useState(false);
  if (!v) return null;

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-ink-100">
        {v.status === 'READY' && v.playbackId ? (
          <img src={posterUrl(v.playbackId, 640)} alt="" className="h-full w-full bg-black object-contain" />
        ) : v.status === 'FAILED' ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-red-700">
            {v.error ?? "Couldn't process this video."}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-600">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-400 border-t-transparent" />
            Processing…
          </div>
        )}
        {isIntro ? (
          <span className="absolute left-2 top-2 rounded bg-ink-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Home page intro
          </span>
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        {editing ? (
          <form action={renameVideo} onSubmit={() => setEditing(false)} className="flex gap-2">
            <input type="hidden" name="videoId" value={v.id} />
            <input
              name="title"
              defaultValue={v.title}
              maxLength={120}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-ink-300 px-2 py-1 text-sm"
            />
            <Button size="sm">Save</Button>
          </form>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="block text-left text-sm font-medium text-ink-900 hover:underline">
            {v.title || 'Untitled'}
          </button>
        )}
        <div className="text-xs text-ink-500">
          {KIND_WORDS[v.kind]}
          {clock(v.durationSec) ? ` · ${clock(v.durationSec)}` : ''}
          {v.status === 'READY' ? (v.mp4Ready ? ' · Ready for Facebook and Instagram' : ' · Getting it ready for Facebook…') : ''}
        </div>
        <div className="flex items-center gap-2">
          {v.status === 'READY' && !isIntro ? (
            <form action={setIntroVideo}>
              <input type="hidden" name="videoId" value={v.id} />
              <Button variant="secondary" size="sm">
                Use as intro
              </Button>
            </form>
          ) : null}
          <form action={deleteVideo} className="ml-auto">
            <input type="hidden" name="videoId" value={v.id} />
            <button className="rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
              Delete
            </button>
          </form>
        </div>
      </div>
    </Card>
  );
}
