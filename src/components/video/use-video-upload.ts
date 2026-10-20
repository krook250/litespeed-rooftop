'use client';

/**
 * Sending a video from the browser straight to Mux.
 *
 * Chunked (UpChunk), so a 400MB walkaround over a lot's two bars of LTE
 * retries a failed 8MB piece instead of starting over. The page has to stay
 * open until it reaches 100% — after that Mux has it and the tab can close.
 */

import { useCallback, useRef, useState } from 'react';
import * as UpChunk from '@mux/upchunk';
import { abandonUpload, markUploaded, startVideoUpload } from '@/lib/video/actions';
import type { VideoKind, VideoView } from '@/lib/video/view';

/** Phones shoot big. Anything past this is a mistake, not a walkaround. */
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'sending'; percent: number; name: string }
  | { phase: 'error'; message: string };

export function useVideoUpload(onDone: (v: VideoView) => void) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const active = useRef<{ chunk: UpChunk.UpChunk; videoId: string } | null>(null);

  const upload = useCallback(
    async (file: File, opts: { kind: VideoKind; vehicleId?: string; title?: string }) => {
      if (file.type && !file.type.startsWith('video/')) {
        setState({ phase: 'error', message: `${file.name} isn't a video.` });
        return;
      }
      if (file.size > MAX_VIDEO_BYTES) {
        setState({ phase: 'error', message: `${file.name} is over 4GB. Trim it on the phone first.` });
        return;
      }
      setState({ phase: 'sending', percent: 0, name: file.name });

      const started = await startVideoUpload(opts).catch(() => ({ error: "Couldn't start the upload. Try again." }));
      if ('error' in started) {
        setState({ phase: 'error', message: started.error });
        return;
      }

      const up = UpChunk.createUpload({ endpoint: started.url, file, chunkSize: 8192, dynamicChunkSize: true });
      active.current = { chunk: up, videoId: started.videoId };
      up.on('progress', (e: CustomEvent) => {
        setState({ phase: 'sending', percent: Math.min(99, Math.round(Number(e.detail) || 0)), name: file.name });
      });
      up.on('error', (e: CustomEvent) => {
        active.current = null;
        void abandonUpload(started.videoId);
        const msg = (e.detail as { message?: string } | undefined)?.message;
        setState({ phase: 'error', message: msg ? `Upload stopped: ${msg}` : 'Upload stopped. Check the connection and try again.' });
      });
      up.on('success', async () => {
        active.current = null;
        const view = await markUploaded(started.videoId).catch(() => null);
        setState({ phase: 'idle' });
        if (view) onDone(view);
      });
    },
    [onDone],
  );

  const cancel = useCallback(() => {
    const a = active.current;
    active.current = null;
    if (a) {
      a.chunk.abort();
      void abandonUpload(a.videoId);
    }
    setState({ phase: 'idle' });
  }, []);

  return { state, upload, cancel, reset: () => setState({ phase: 'idle' }) };
}
