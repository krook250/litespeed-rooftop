/** A GA4 measurement ID. It is interpolated into a script tag, so nothing else gets through. */
export function parseGaId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return /^G-[A-Z0-9]{4,15}$/.test(v) ? v : null;
}
