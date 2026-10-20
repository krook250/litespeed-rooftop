'use client';

/**
 * A Mux video, played. The lazy build: the player's script loads when it
 * scrolls near the screen, so a VDP with a walkaround below the fold pays
 * nothing for it up front.
 */

import MuxPlayer from '@mux/mux-player-react/lazy';
import { posterUrl } from '@/lib/video/urls';

export function VideoPlayer({
  playbackId,
  title,
  aspectRatio,
  accentColor,
  className,
}: {
  playbackId: string;
  title: string;
  /** Mux's `16:9` / `9:16`. A vertical phone video is shown tall, not letterboxed into a wide box. */
  aspectRatio?: string | null;
  accentColor?: string;
  className?: string;
}) {
  const [w, h] = (aspectRatio ?? '16:9').split(':').map(Number);
  const ratio = w && h ? `${w} / ${h}` : '16 / 9';
  return (
    <div className={className} style={{ aspectRatio: ratio }}>
      <MuxPlayer
        playbackId={playbackId}
        streamType="on-demand"
        poster={posterUrl(playbackId)}
        accentColor={accentColor}
        metadata={{ video_title: title }}
        style={{ width: '100%', height: '100%', aspectRatio: ratio }}
      />
    </div>
  );
}
