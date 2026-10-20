/**
 * Mux's public URLs. Safe on the client: a public playback id is meant to be
 * seen, and every video here is marketing the dealer wants seen.
 */

export const streamUrl = (playbackId: string) => `https://stream.mux.com/${playbackId}.m3u8`;
export const mp4Url = (playbackId: string, mp4Name: string) => `https://stream.mux.com/${playbackId}/${mp4Name}`;
export const posterUrl = (playbackId: string, width = 960) =>
  `https://image.mux.com/${playbackId}/thumbnail.jpg?width=${width}&fit_mode=preserve`;

/** 83 → "1:23". */
export function clock(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
