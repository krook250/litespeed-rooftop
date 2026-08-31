/**
 * Reading a map pin out of whatever the dealer pasted.
 *
 * WHY THIS EXISTS
 * The Lots screen tells a dealer to right-click their lot in Google Maps and
 * copy the coordinates. Google puts **one string** on the clipboard —
 * `27.99356110261136, -80.62027053363042` — and the form had two boxes, so the
 * instruction we gave and the form we gave did not match. A dealer following
 * our own directions had to cut the string in half by hand, and the ones who
 * did not simply pasted the whole thing into Latitude, where `Number()` returns
 * NaN and the field silently cleared. A lot without coordinates cannot run on
 * Marketplace at all, which makes this a quiet, total failure.
 *
 * Pure, and deliberately generous about format: this parses what people
 * actually have on their clipboard, not what a spec says they should.
 */

export type LatLng = { lat: number; lng: number };

const DECIMAL = /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i;

/** 27°59'36.7"N 80°37'15.2"W — what the Google Maps info panel shows. */
const DMS = new RegExp(
  String.raw`^\s*(\d+)\s*[°d]\s*(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*([NS])` +
  String.raw`[,;\s]+` +
  String.raw`(\d+)\s*[°d]\s*(\d+)\s*['′]\s*([\d.]+)\s*["″]?\s*([EW])\s*$`,
  'i',
);

/**
 * A Google Maps URL. Dealers paste the address bar at least as often as they
 * use the right-click menu, and the coordinates are right there in it.
 *
 * `@lat,lng,zoom` is the map centre — which is where the pin is when they
 * right-clicked. `!3dLAT!4dLNG` appears on a place URL and is the *place's* own
 * coordinate, so it is preferred when both are present: the map centre drifts
 * as you scroll, the place does not.
 */
const URL_PLACE = /!3d([+-]?\d+(?:\.\d+)?)!4d([+-]?\d+(?:\.\d+)?)/;
const URL_AT = /@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/;
const URL_Q = /[?&](?:q|query|ll|center|destination)=([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?)/i;

const inRange = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;

function fromDms(d: string, m: string, s: string, hemi: string): number {
  const v = Number(d) + Number(m) / 60 + Number(s) / 3600;
  return /[SW]/i.test(hemi) ? -v : v;
}

/**
 * Parse a pasted map pin. Returns null rather than a guess.
 *
 * Handles, in order: a Google Maps URL, degrees-minutes-seconds, and a decimal
 * pair separated by a comma, a semicolon or whitespace — with or without `°`
 * and an N/S/E/W suffix.
 */
export function parseLatLng(raw: string): LatLng | null {
  const text = raw.trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text) || text.includes('google.com/maps')) {
    for (const re of [URL_PLACE, URL_AT, URL_Q]) {
      const m = text.match(re);
      if (m) {
        const hit = inRange(Number(m[1]), Number(m[2]));
        if (hit) return hit;
      }
    }
    return null;
  }

  const dms = text.match(DMS);
  if (dms) {
    return inRange(
      fromDms(dms[1]!, dms[2]!, dms[3]!, dms[4]!),
      fromDms(dms[5]!, dms[6]!, dms[7]!, dms[8]!),
    );
  }

  const dec = text.match(DECIMAL);
  if (dec) {
    let lat = Number(dec[1]);
    let lng = Number(dec[3]);
    /* An explicit hemisphere letter wins over the sign, because "27.99 S" and
       "-27.99" mean the same thing and "-27.99 S" is somebody being thorough,
       not somebody meaning the northern hemisphere. */
    if (dec[2]) lat = Math.abs(lat) * (/S/i.test(dec[2]) ? -1 : 1);
    if (dec[4]) lng = Math.abs(lng) * (/W/i.test(dec[4]) ? -1 : 1);
    return inRange(lat, lng);
  }

  return null;
}

/**
 * How a stored pin is shown back — the same shape Google puts on the clipboard,
 * so a dealer can compare the two without translating.
 *
 * Six decimal places is about 11cm. Storing more (the column holds seven) is
 * free; showing eighteen is noise on a form.
 */
export function formatLatLng(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '';
  const trim = (n: number) => String(Number(n.toFixed(6)));
  return `${trim(lat)}, ${trim(lng)}`;
}

/**
 * Does this pair look like it was pasted the wrong way round?
 *
 * Transposition cannot be detected in general — both numbers are in range for
 * each other over most of the world. It *can* be detected for a US dealership,
 * which is every dealer this app serves: `state`, ZIP, USD and `tel:+1` are all
 * over the data model. A pin at 27.99 lat / -80.62 lng is Florida; the same
 * numbers swapped are 27.99 **east**, which is the Libyan desert.
 *
 * Deliberately a warning and not a rejection. The bounds below are generous
 * (they cover Alaska, Hawaii and Puerto Rico) but they are still a guess about
 * where a dealership can be, and refusing to save a pin because it is unusual
 * would be worse than the mistake it prevents. The screen offers the swap; the
 * dealer decides.
 *
 * This matters more since the two boxes became one: a single box makes the
 * order the dealer's problem in a way two labelled fields did not.
 */
const US_LAT = [17.5, 71.5] as const;
const US_LNG = [-180, -64.5] as const;

const inUs = ({ lat, lng }: LatLng) =>
  lat >= US_LAT[0] && lat <= US_LAT[1] && lng >= US_LNG[0] && lng <= US_LNG[1];

export function looksTransposed(pin: LatLng): boolean {
  if (inUs(pin)) return false;
  const swapped = { lat: pin.lng, lng: pin.lat };
  return Math.abs(swapped.lat) <= 90 && Math.abs(swapped.lng) <= 180 && inUs(swapped);
}
