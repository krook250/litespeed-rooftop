'use client';

/**
 * Watching a video encode. Asks every few seconds while Mux is working, then
 * stops. The MP4 for Facebook trails the stream by a minute or so; that wait is
 * polled more slowly and given up on after ten minutes (the webhook still
 * catches it).
 */

import { useEffect, useState } from 'react';
import { checkVideo } from '@/lib/video/actions';
import type { VideoView } from '@/lib/video/view';

const FAST_MS = 4000;
const SLOW_MS = 15000;
const MP4_GIVE_UP_MS = 10 * 60 * 1000;

export function needsPolling(v: VideoView): boolean {
  return v.status === 'UPLOADING' || v.status === 'PROCESSING' || (v.status === 'READY' && !v.mp4Ready);
}

export function useVideoPoll(initial: VideoView | null): VideoView | null {
  const [video, setVideo] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // A fresh server render (a new upload, a delete) replaces what we were polling.
  if (initial !== seen) {
    setSeen(initial);
    setVideo(initial);
  }

  useEffect(() => {
    if (!video || !needsPolling(video)) return;
    if (video.status === 'UPLOADING') return; // the uploader owns this phase
    const started = Date.now();
    const slow = video.status === 'READY';
    const timer = setInterval(async () => {
      if (slow && Date.now() - started > MP4_GIVE_UP_MS) return clearInterval(timer);
      const next = await checkVideo(video.id).catch(() => null);
      if (!next) return;
      if (next.status !== video.status || next.mp4Ready !== video.mp4Ready || next.playbackId !== video.playbackId) {
        setVideo(next);
      }
    }, slow ? SLOW_MS : FAST_MS);
    return () => clearInterval(timer);
  }, [video]);

  return video;
}
