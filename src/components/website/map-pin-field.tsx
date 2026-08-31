'use client';

/**
 * One box for the map pin, because Google puts one string on the clipboard.
 *
 * The screen tells the dealer to right-click their lot in Google Maps and copy
 * the coordinates. What lands on the clipboard is
 * `27.99356110261136, -80.62027053363042` — one string. Two boxes asked them to
 * cut it in half by hand, and the ones who did not pasted the whole thing into
 * Latitude, where it parsed as NaN and the field silently cleared. A lot without
 * coordinates cannot run on Marketplace, and nothing on the page said so.
 *
 * The echoed "Reads as…" line is the whole point of it being a client
 * component: paste is the only interaction, and the dealer needs to see that we
 * understood it before they press Save, not after. `parseLatLng` is the same
 * function the server action uses, so agreement is structural.
 */

import { useState } from 'react';
import { formatLatLng, looksTransposed, parseLatLng } from '@/lib/geo';

export function MapPinField({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  const [value, setValue] = useState(formatLatLng(latitude, longitude));
  const trimmed = value.trim();
  const parsed = trimmed ? parseLatLng(trimmed) : null;

  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">
          Map pin — paste both numbers together
        </span>
        <input
          name="mapPin"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="27.993561, -80.620271"
          spellCheck={false}
          autoComplete="off"
          className={`w-full rounded-lg border px-2.5 py-1.5 font-mono text-sm ${
            trimmed && !parsed ? 'border-red-400 bg-red-50' : 'border-ink-300'
          }`}
        />
      </label>

      {parsed && looksTransposed(parsed) ? (
        <p className="mt-1 text-xs text-amber-800">
          Those two look swapped — as written this pin is not in the United States. Swapping them
          puts it in {formatLatLng(parsed.lng, parsed.lat)}.{' '}
          <button
            type="button"
            onClick={() => setValue(formatLatLng(parsed.lng, parsed.lat))}
            className="font-semibold underline underline-offset-2"
          >
            Swap them
          </button>
        </p>
      ) : parsed ? (
        <p className="mt-1 text-xs text-emerald-700">
          Reads as <b className="tnum">{parsed.lat}</b> north/south,{' '}
          <b className="tnum">{parsed.lng}</b> east/west.
        </p>
      ) : trimmed ? (
        <p className="mt-1 text-xs text-red-700">
          That does not look like a pair of coordinates. Paste both numbers exactly as Google copied
          them — or paste the whole Google Maps link and we&apos;ll pull them out.
        </p>
      ) : (
        <p className="mt-1 text-xs text-ink-500">
          Paste the whole thing, comma and all. A Google Maps link works too.
        </p>
      )}
    </div>
  );
}
