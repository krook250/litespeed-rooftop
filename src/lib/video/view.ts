/** The browser-safe shape of a `videos` row. No Mux ids leave the server. */

import type * as t from '@/db/schema';

type VideoRow = typeof t.videos.$inferSelect;

export type VideoKind = (typeof t.videoKindEnum.enumValues)[number];

/** What the browser is allowed to know about a video. */
export type VideoView = {
  id: string;
  kind: VideoKind;
  title: string;
  status: VideoRow['status'];
  playbackId: string | null;
  /** True once the MP4 Facebook and Instagram need is written. */
  mp4Ready: boolean;
  durationSec: number | null;
  aspectRatio: string | null;
  error: string | null;
  vehicleId: string | null;
};

export function toView(v: VideoRow): VideoView {
  return {
    id: v.id,
    kind: v.kind,
    title: v.title,
    status: v.status,
    playbackId: v.playbackId,
    mp4Ready: Boolean(v.mp4Name),
    durationSec: v.durationSec,
    aspectRatio: v.aspectRatio,
    error: v.error,
    vehicleId: v.vehicleId,
  };
}

