/**
 * Turning three partial views of a car into one record.
 *
 * The inputs disagree, and that is the point. A window sticker says "Deep
 * Crystal Blue Mica"; vPIC says nothing about color. vPIC says the body is an
 * SUV; the reader guessed "wagon" from the silhouette in the photo. The reader
 * read 84,213 miles; the regex over the same transcript read 2019. Merging is
 * where those get adjudicated, and the rule is fixed rather than heuristic:
 *
 *     barcode  >  vin (vPIC)  >  document  >  derived
 *
 * within the fields each layer owns, plus one exception — a VIN candidate that
 * satisfies its check digit beats one that does not, whatever produced it.
 *
 * Disagreements are not silently resolved. When the paperwork says 2019 Camry
 * and the VIN decodes to a 2018 Corolla, that is worth telling somebody: either
 * the read is wrong or the paperwork belongs to a different car, and both of
 * those are things a person wants to know before the unit goes live.
 */

import {
  VIN_OWNED_FIELDS,
  field,
  type Extraction,
  type ExtractionKey,
  type ScanWarning,
} from './types';
import type { DocClaims } from './read-document';
import { hexForColor, normaliseVin, parseText, resolveColor, type VinCandidate } from './parse';

/** Above this many miles per year, something is wrong with the reading. */
const MILES_PER_YEAR_CEILING = 60_000;
const KM_TO_MILES = 0.621371;

export type MergeInput = {
  /** VIN read straight off a machine-readable code. Outranks everything. */
  barcodeVin?: string | null;
  claims: DocClaims | null;
  /** Transcript or OCR text, for the deterministic cross-check. */
  text: string;
  /** Result of `decodeVin`, already fetched by the caller. */
  vinDecoded?: Extraction | null;
  vinDecodeFailed?: boolean;
};

export type MergeOutput = {
  extraction: Extraction;
  warnings: ScanWarning[];
  /** The VIN we settled on, if any. */
  vin: VinCandidate | null;
};

/* --------------------------------------------------------------------- VIN */

/**
 * Pick the VIN.
 *
 * Sources are tried in trust order but a failed check digit demotes a source
 * below a source that passes — a barcode is more trustworthy than a photo right
 * up until the barcode read produces something that is arithmetically not a VIN,
 * at which point it is just noise with good manners.
 */
export function chooseVin(input: {
  barcodeVin?: string | null;
  claimedVin?: string | null;
  text: string;
}): { candidate: VinCandidate | null; source: 'barcode' | 'document'; alternatives: VinCandidate[] } {
  const ranked: Array<{ c: VinCandidate; source: 'barcode' | 'document' }> = [];

  if (input.barcodeVin) {
    const c = normaliseVin(input.barcodeVin);
    if (c) ranked.push({ c, source: 'barcode' });
  }
  if (input.claimedVin) {
    const c = normaliseVin(input.claimedVin);
    if (c && !ranked.some((r) => r.c.vin === c.vin)) ranked.push({ c, source: 'document' });
  }
  for (const c of parseTextVins(input.text)) {
    if (!ranked.some((r) => r.c.vin === c.vin)) ranked.push({ c, source: 'document' });
  }

  if (!ranked.length) return { candidate: null, source: 'document', alternatives: [] };

  // Stable sort: checksum first, then original trust order.
  const ordered = ranked
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => Number(b.c.checksums) - Number(a.c.checksums) || a.i - b.i);

  const best = ordered[0]!;
  return {
    candidate: best.c,
    source: best.source,
    alternatives: ordered.slice(1).map((r) => r.c),
  };
}

function parseTextVins(text: string): VinCandidate[] {
  const parsed = parseText(text);
  if (!parsed.vin) return [];
  return [normaliseVin(parsed.vin.value)].filter((c): c is VinCandidate => c !== null);
}

/* ------------------------------------------------------------------- merge */

export function merge(input: MergeInput): MergeOutput {
  const warnings: ScanWarning[] = [];
  const claims = input.claims;

  /* 1. The deterministic pass over the transcript is the floor. It is the only
        layer that exists in every configuration, including OCR-only. */
  const out: Extraction = parseText(input.text);

  /* 2. Overlay what the reader claims. It outranks the regexes on claim fields
        because it read the layout — it knows which number sat under the word
        ODOMETER — but it stays at the same confidence, because reading a label
        correctly and reading the digits correctly are different skills. */
  if (claims) {
    const ev = (k: string) => claims.evidence[k];

    if (claims.mileage !== null) {
      const raw = claims.mileage;
      const miles = claims.odometerUnit === 'km' ? Math.round(raw * KM_TO_MILES) : raw;
      const note =
        claims.odometerUnit === 'km'
          ? `${raw.toLocaleString()} km converted to ${miles.toLocaleString()} mi${ev('mileage') ? ` — ${ev('mileage')}` : ''}`
          : ev('mileage');
      if (miles > 0 && miles <= 600_000) out.mileage = field(miles, 'document', 'medium', note);
    }

    // Price is always low confidence. See the note in parse.ts — it reaches the
    // public faster than any other field and it is the one worth a human glance.
    if (claims.askingPrice) out.price = field(claims.askingPrice, 'document', 'low', ev('asking_price'));
    if (claims.msrp) out.msrp = field(claims.msrp, 'document', 'low', ev('msrp'));
    if (claims.purchasePrice) out.cost = field(claims.purchasePrice, 'document', 'low', ev('purchase_price'));

    const ext = resolveColor(claims.exteriorColor) ?? claims.exteriorColor;
    if (ext) {
      out.exteriorColor = field(ext, 'document', 'medium', ev('exterior_color'));
      const hex = hexForColor(ext);
      if (hex) out.exteriorColorHex = field(hex, 'derived', 'low', `swatch for ${ext}`);
    }
    const int = resolveColor(claims.interiorColor) ?? claims.interiorColor;
    if (int) out.interiorColor = field(int, 'document', 'medium', ev('interior_color'));

    if (claims.titleBrand) {
      out.titleStatus = field(claims.titleBrand, 'document', 'medium', ev('title_brand'));
    }
    if (claims.stockNumber && claims.stockNumber.replace(/-/g, '').length !== 17) {
      out.stockNumber = field(claims.stockNumber.toUpperCase(), 'document', 'medium', ev('stock_number'));
    }
    if (claims.keysCount && claims.keysCount > 0 && claims.keysCount <= 6) {
      out.keysCount = field(claims.keysCount, 'document', 'medium', ev('keys_count'));
    }
    if (claims.options.length) {
      out.options = field(dedupeLines(claims.options), 'document', 'medium', `${claims.options.length} lines read`);
    }
    if (claims.callouts.length) {
      out.callouts = field(dedupeLines(claims.callouts).slice(0, 5), 'document', 'low', 'reader-suggested');
    }

    // Specs from the document are provisional: they exist only so that a scan
    // with an unreadable VIN still produces something usable. vPIC overwrites
    // every one of them below when the VIN decodes.
    if (claims.year && claims.year >= 1900 && claims.year <= new Date().getFullYear() + 2) {
      out.year = field(claims.year, 'document', 'medium', ev('year'));
    }
    if (claims.make) out.make = field(claims.make, 'document', 'medium', ev('make'));
    if (claims.model) out.model = field(claims.model, 'document', 'medium', ev('model'));
    if (claims.trim) out.trim = field(claims.trim, 'document', 'medium', ev('trim'));
  }

  /* 3. The VIN. */
  const { candidate, source, alternatives } = chooseVin({
    barcodeVin: input.barcodeVin,
    claimedVin: claims?.vin,
    text: input.text,
  });

  if (!candidate) {
    delete out.vin;
    warnings.push({
      code: 'NO_VIN',
      message:
        'No VIN found. Photograph the doorjamb label or the plate at the base of the windscreen — that one shot fills in most of this by itself.',
    });
  } else {
    out.vin = field(
      candidate.vin,
      source === 'barcode' ? 'barcode' : 'document',
      candidate.checksums ? 'high' : 'low',
      candidate.repairedFrom
        ? `read as ${candidate.repairedFrom}; I, O and Q are not VIN characters, so corrected to ${candidate.vin}`
        : claims?.evidence.vin,
    );

    if (!candidate.checksums) {
      warnings.push({
        code: 'VIN_CHECKSUM_FAILED',
        message:
          `${candidate.vin} does not pass its own check digit, so at least one character is misread. ` +
          (alternatives.length ? `Other candidates on the page: ${alternatives.map((a) => a.vin).join(', ')}. ` : '') +
          'Retake the photo or type the VIN in.',
      });
    }
    if (claims?.vinLegibility === 'guessed' || claims?.vinLegibility === 'partial') {
      warnings.push({
        code: 'PARTIAL_READ',
        message: 'The VIN was only partly legible. Worth checking against the car before saving.',
      });
    }
  }

  /* 4. vPIC wins the fields it owns, outright. */
  if (input.vinDecoded) {
    const disagreements: string[] = [];
    for (const key of VIN_OWNED_FIELDS) {
      const decoded = input.vinDecoded[key];
      if (!decoded) continue;
      const claimed = out[key];
      if (claimed && !sameValue(claimed.value, decoded.value)) {
        disagreements.push(`${label(key)}: paperwork says ${fmt(claimed.value)}, VIN says ${fmt(decoded.value)}`);
      }
      assign(out, key, decoded);
    }
    // Trim is vPIC's weakest column, so the document keeps it when it has one.
    if (input.vinDecoded.trim && !out.trim) assign(out, 'trim', input.vinDecoded.trim);

    if (disagreements.length) {
      warnings.push({
        code: 'DOC_DISAGREES_WITH_VIN',
        message:
          `The VIN and the paperwork describe different vehicles — ${disagreements.join('; ')}. ` +
          'The VIN was used. If the VIN is right, the document belongs to another car.',
      });
    }
  } else if (candidate && input.vinDecodeFailed) {
    warnings.push({
      code: 'VIN_DECODE_FAILED',
      message:
        'NHTSA could not decode that VIN, so the specs below came off the document rather than from the manufacturer. Worth a second look.',
    });
  }

  /* 5. Plausibility, last, so it can see the merged result. */
  const year = out.year?.value;
  const miles = out.mileage?.value;
  if (year && miles) {
    const age = Math.max(1, new Date().getFullYear() - year + 1);
    if (miles / age > MILES_PER_YEAR_CEILING) {
      warnings.push({
        code: 'MILEAGE_IMPLAUSIBLE',
        message: `${miles.toLocaleString()} miles on a ${year} works out to about ${Math.round(miles / age).toLocaleString()} a year. Check the odometer reading.`,
      });
      if (out.mileage) out.mileage = { ...out.mileage, confidence: 'low' };
    }
  }
  const price = out.price?.value;
  if (price && (price < 500 || price > 300_000)) {
    warnings.push({
      code: 'PRICE_IMPLAUSIBLE',
      message: `$${price.toLocaleString()} looks off for an asking price. It may be a fee, a payment, or the wrong line on the page.`,
    });
    if (out.price) out.price = { ...out.price, confidence: 'low' };
  }

  /**
   * Deliberately not generated: the description.
   *
   * The vehicle form already tells dealers, in as many words, that the ones who
   * write their own descriptions outsell the ones who paste the window sticker.
   * Auto-filling a concatenation of specs here would contradict the product's
   * own advice and would fill the field with something nobody then bothers to
   * replace. The options list is populated; the sentence is the dealer's.
   */

  return { extraction: out, warnings, vin: candidate };
}

/* ----------------------------------------------------------------- helpers */

function assign<K extends ExtractionKey>(target: Extraction, key: K, value: Extraction[K]) {
  target[key] = value;
}

function sameValue(a: unknown, b: unknown) {
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a === b;
}

function fmt(v: unknown) {
  return typeof v === 'string' ? v : String(v);
}

const LABELS: Partial<Record<ExtractionKey, string>> = {
  year: 'year',
  make: 'make',
  model: 'model',
  bodyStyle: 'body style',
  drivetrain: 'drivetrain',
  fuelType: 'fuel',
  engine: 'engine',
  cylinders: 'cylinders',
  doors: 'doors',
  mileage: 'mileage',
  price: 'asking price',
  titleStatus: 'title',
  vin: 'VIN',
};

export function label(key: ExtractionKey): string {
  return LABELS[key] ?? key;
}

/**
 * Window stickers repeat themselves — the same package appears under both
 * "Standard Equipment" and "Included Features" — and a listing with the same
 * line three times looks like a broken feed rather than a well-equipped car.
 */
function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/^[•\-*·–]\s*/, '').trim();
    if (line.length < 3 || line.length > 90) continue;
    const key = line.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
