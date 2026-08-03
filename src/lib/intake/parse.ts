/**
 * The deterministic pass over whatever text came out of a document.
 *
 * This runs in both directions: it is the whole extractor when the OCR fallback
 * is in play, and it is the cross-check when the model reader is. A model that
 * hallucinates one character of a VIN produces something that looks perfect and
 * is a different car; running the same check-digit arithmetic over the model's
 * answer catches that for free.
 *
 * Nothing in this file talks to the network or the database. It is pure text in,
 * candidate values out, which is why it is also the only part of intake that is
 * cheap to unit-test — and given how much debugging these features take, that
 * matters more than it looks.
 */

import { checkDigit, isValidVin } from '@/lib/vin';
import { field, type Extraction, type Field } from './types';

/* ---------------------------------------------------------------------- VIN */

export type VinCandidate = {
  vin: string;
  /** True when the position-9 check digit validates. */
  checksums: boolean;
  /** Set when we fixed characters a VIN is not allowed to contain. */
  repairedFrom?: string;
};

/**
 * I, O and Q are not legal VIN characters — the standard excludes them precisely
 * because they are confusable with 1, 0 and 0. So a 17-character run containing
 * one is not a "maybe"; it is a known OCR substitution with a known correction.
 * Repairing those three and re-checking the digit recovers a large share of the
 * reads that otherwise fail on a phone photo of a doorjamb label.
 *
 * Note what is deliberately NOT done: brute-forcing every position against every
 * legal character. The check digit is mod-11, so roughly one in eleven random
 * candidates validates — a 17x33 sweep yields dozens of "valid" VINs and no way
 * to choose. Illegal-character repair is safe because those characters were
 * always wrong; blind repair is not repair, it is invention.
 */
function repairIllegalChars(raw: string): string {
  return raw.replace(/I/g, '1').replace(/[OQ]/g, '0');
}

/**
 * Model-year codes, position 10. The standard omits I, O, Q, U, Z and 0.
 *
 * This is a hard rule rather than a heuristic, so it is applied to every
 * candidate: a 17-character run with a U in position 10 is not a VIN with a typo,
 * it is not a VIN.
 */
const YEAR_CODE = /^[ABCDEFGHJKLMNPRSTVWXY1-9]$/;

/**
 * A guard the check digit cannot provide on its own.
 *
 * The check digit is mod-11, so roughly one in eleven arbitrary 17-character
 * strings satisfies it — which a test caught here: an 18-digit account number
 * contains two 17-character windows, and one of them checksummed clean. On a
 * bill of sale full of account and routing numbers that is not a rare event, and
 * a "valid" VIN made of somebody's bank details is the worst possible outcome.
 *
 * Real VINs carry letters — the WMI and the vehicle descriptor section both do,
 * and the sparsest real examples still have four or five. Requiring three is
 * comfortably below any genuine VIN and comfortably above a run of digits.
 */
function structurallyPlausible(v: string, minLetters: number): boolean {
  if (!YEAR_CODE.test(v[9]!)) return false;
  return (v.match(/[A-Z]/g) ?? []).length >= minLetters;
}

/**
 * Every plausible VIN in a blob of text, best first.
 *
 * Ranking is: checksums clean > checksums after illegal-character repair >
 * structurally valid but fails the digit. That last bucket is kept rather than
 * discarded because pre-1981 vehicles and some grey imports genuinely do not
 * carry a conforming check digit — but it is surfaced with a warning, never
 * silently accepted.
 */
export function findVins(text: string): VinCandidate[] {
  /**
   * Tokens, in reading order, with punctuation stripped inside each one.
   *
   * The search runs over *runs of consecutive tokens* rather than over a sliding
   * window across the whole compacted page — which was the first implementation
   * and was wrong. Compacting everything lets a window start inside one word and
   * end inside another, and since the check digit is mod-11, about one in eleven
   * of those accidents validates. A test caught it stitching "ACCOUNT" onto an
   * account number and producing a clean-looking VIN.
   *
   * Consecutive-token joins cover every way a real VIN gets broken up —
   * "1FT-FW1E53-KFA12345", "1HGCM826 33A004352", or a wrap between two lines —
   * without ever inventing an alignment the document did not have.
   */
  const tokens = text
    .toUpperCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);

  const seen = new Set<string>();
  const out: VinCandidate[] = [];

  /**
   * `minLetters` encodes how much the alignment itself is worth as evidence. A
   * 17-character token standing on its own line under the word VIN is strong
   * evidence; an arbitrary window sliced out of a wall of digits is not, so it
   * has to clear a higher bar.
   */
  const consider = (raw: string, minLetters: number) => {
    if (!/^[A-Z0-9]{17}$/.test(raw)) return;
    if (seen.has(raw)) return;
    seen.add(raw);

    const repaired = repairIllegalChars(raw);
    if (!structurallyPlausible(repaired, minLetters)) return;

    if (isValidVin(raw)) {
      out.push({ vin: raw, checksums: true });
      return;
    }
    if (repaired !== raw && isValidVin(repaired) && !seen.has(repaired)) {
      seen.add(repaired);
      out.push({ vin: repaired, checksums: true, repairedFrom: raw });
      return;
    }
    // Structurally legal (no I/O/Q) but the digit disagrees.
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(raw)) out.push({ vin: raw, checksums: false });
  };

  // A VIN printed as its own word: the common case, and the strongest evidence.
  for (const token of tokens) if (token.length === 17) consider(token, 2);

  // Then joins of two or three consecutive tokens, for hyphenated VINs and line
  // wraps. Only when the single-token pass found nothing clean, and held to a
  // higher letter bar because the alignment is inferred rather than printed.
  if (!out.some((c) => c.checksums)) {
    for (let i = 0; i < tokens.length; i++) {
      let joined = tokens[i]!;
      for (let span = 1; span < 3 && i + span < tokens.length; span++) {
        joined += tokens[i + span]!;
        if (joined.length > 17) break;
        if (joined.length === 17) consider(joined, 3);
      }
    }
  }

  return out.sort((a, b) => Number(b.checksums) - Number(a.checksums));
}

/** Repair a VIN a model handed back, without re-searching the document. */
export function normaliseVin(raw: string): VinCandidate | null {
  const v = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length !== 17) return null;
  if (isValidVin(v)) return { vin: v, checksums: true };
  const repaired = repairIllegalChars(v);
  if (repaired !== v && isValidVin(repaired)) {
    return { vin: repaired, checksums: true, repairedFrom: v };
  }
  // No plausibility gate here on purpose: this is only ever called with a string
  // somebody meant as a VIN — typed into the box, or returned in the reader's
  // `vin` field — so "17 characters, none of them I/O/Q" is the right bar, and
  // rejecting an unusual-looking one would be worse than flagging it.
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return { vin: v, checksums: false };
  return null;
}

/** What position 9 *should* be — shown in the debug panel next to what it was. */
export function expectedCheckDigit(vin: string): string | null {
  const v = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return null;
  try {
    return checkDigit(v);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ numbers */

const MILEAGE_LABELS =
  /(?:odometer|odo|mileage|miles|mi\.?|km)\s*(?:reading|at\s*(?:time\s*of\s*)?(?:transfer|sale))?\s*[:\-=]?\s*/i;

/**
 * Mileage, with the labelled reading preferred over any loose number.
 *
 * The trap here is the year: "2019" on a title is a four-digit number sitting a
 * few characters from the word MILES more often than you would like. Requiring a
 * label on the left, or the unit on the right, is what separates 2019 miles from
 * a 2019 model year — and the plausibility floor below catches the rest.
 */
export function findMileage(text: string): Field<number> | null {
  const candidates: Array<{ n: number; evidence: string; strong: boolean }> = [];

  // Labelled: "ODOMETER: 84,213" / "Mileage — 84213"
  for (const m of text.matchAll(new RegExp(`${MILEAGE_LABELS.source}([\\d][\\d,\\s]{2,9})`, 'gi'))) {
    const n = toInt(m[1]);
    if (n !== null) candidates.push({ n, evidence: m[0].trim(), strong: true });
  }
  // Trailing unit: "84,213 miles" / "84213 MI"
  for (const m of text.matchAll(/\b([\d][\d,]{2,9})\s*(miles|mi|km)\b/gi)) {
    const n = toInt(m[1]);
    if (n !== null) candidates.push({ n, evidence: m[0].trim(), strong: true });
  }

  const plausible = candidates.filter((c) => c.n >= 1 && c.n <= 600_000);
  if (!plausible.length) return null;

  // Highest labelled reading wins. Documents that show several numbers tend to
  // show the odometer alongside smaller figures (doors, cylinders, a fee), and
  // the odometer is almost always the largest of them.
  const best = plausible.sort((a, b) => b.n - a.n)[0]!;

  // Round numbers under 1,000 are much more likely to be something else — a
  // price in hundreds, a lot number — than a genuine reading.
  const confidence = best.n < 1_000 ? 'low' : 'medium';
  return field(best.n, 'document', confidence, best.evidence);
}

const PRICE_LABELS =
  /(?:asking|sale|sales|selling|list|retail|purchase|total)?\s*price|msrp|total\s*(?:due|sale)|amount|sold\s*for/i;

/**
 * A dollar figure, and which kind it is.
 *
 * Always returned at `low` confidence regardless of how clean the match looks.
 * A wrong price is the one extraction error that reaches the public in minutes
 * and costs real money, so it gets a human's eye every single time — this is the
 * "extract, then confirm on one screen" behaviour, enforced at the parser rather
 * than left to the UI to remember.
 */
export function findPrices(text: string): { price?: Field<number>; msrp?: Field<number> } {
  const out: { price?: Field<number>; msrp?: Field<number> } = {};

  const msrp = text.match(/\b(?:msrp|manufacturer'?s?\s+suggested[^$\n]{0,30})[^\d$]{0,12}\$?\s*([\d,]{3,9})/i);
  if (msrp) {
    const n = toInt(msrp[1]);
    if (n && n >= 1_000 && n <= 500_000) out.msrp = field(n, 'document', 'low', msrp[0].trim());
  }

  const labelled: Array<{ n: number; evidence: string }> = [];
  for (const m of text.matchAll(new RegExp(`(${PRICE_LABELS.source})[^\\d$]{0,12}\\$?\\s*([\\d,]{3,9})`, 'gi'))) {
    if (/msrp/i.test(m[0])) continue;
    const n = toInt(m[2]);
    if (n && n >= 500 && n <= 500_000) labelled.push({ n, evidence: m[0].trim() });
  }
  if (labelled.length) {
    out.price = field(labelled[0]!.n, 'document', 'low', labelled[0]!.evidence);
  }

  return out;
}

function toInt(raw?: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------- colour */

/**
 * State title forms abbreviate colour to three or four letters, and the codes
 * are not standardised across states — Florida's BLK/WHI/SIL differ from
 * California's. This is the union of the common ones; an unrecognised code is
 * dropped rather than guessed, because a wrong colour on a listing is the kind
 * of small lie a shopper notices in the parking lot.
 */
const COLOR_CODES: Record<string, string> = {
  BLK: 'Black', BK: 'Black', BLA: 'Black',
  WHI: 'White', WHT: 'White', WH: 'White', WT: 'White',
  SIL: 'Silver', SLV: 'Silver', SI: 'Silver', SVR: 'Silver',
  GRY: 'Gray', GRA: 'Gray', GY: 'Gray', CHA: 'Charcoal',
  BLU: 'Blue', BL: 'Blue', LTB: 'Light Blue', DKB: 'Dark Blue', NAV: 'Navy',
  RED: 'Red', RD: 'Red', MAR: 'Maroon', BUR: 'Burgundy',
  GRN: 'Green', GN: 'Green', GRE: 'Green',
  BRN: 'Brown', BR: 'Brown', TAN: 'Tan', BGE: 'Beige', CRM: 'Cream',
  GLD: 'Gold', GD: 'Gold', YEL: 'Yellow', ORG: 'Orange',
  PUR: 'Purple', PLE: 'Purple', BRZ: 'Bronze', CPR: 'Copper',
  TEA: 'Teal', TRQ: 'Turquoise', PNK: 'Pink',
};

const COLOR_WORDS = [
  'Black', 'White', 'Silver', 'Gray', 'Grey', 'Charcoal', 'Blue', 'Navy', 'Red',
  'Maroon', 'Burgundy', 'Green', 'Brown', 'Tan', 'Beige', 'Cream', 'Gold',
  'Yellow', 'Orange', 'Purple', 'Bronze', 'Copper', 'Teal', 'Turquoise', 'Pink',
];

/** Approximate hex per colour name, for the swatch the form already renders. */
const COLOR_HEX: Record<string, string> = {
  Black: '#111827', White: '#f8fafc', Silver: '#c0c5cc', Gray: '#8b9099',
  Grey: '#8b9099', Charcoal: '#3f4652', Blue: '#1d4ed8', Navy: '#1e293b',
  Red: '#b91c1c', Maroon: '#7f1d1d', Burgundy: '#6b1520', Green: '#15803d',
  Brown: '#6b4423', Tan: '#c8a67a', Beige: '#d6c7a8', Cream: '#efe6d0',
  Gold: '#b8912f', Yellow: '#eab308', Orange: '#ea6a1e', Purple: '#6d28d9',
  Bronze: '#8c6239', Copper: '#a55c33', Teal: '#0f766e', Turquoise: '#14b8a6',
  Pink: '#db2777',
};

export function hexForColor(name?: string | null): string | null {
  if (!name) return null;
  const key = Object.keys(COLOR_HEX).find((c) => name.toLowerCase().includes(c.toLowerCase()));
  return key ? COLOR_HEX[key]! : null;
}

export function resolveColor(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const upper = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (COLOR_CODES[upper]) return COLOR_CODES[upper];
  const word = COLOR_WORDS.find((w) => new RegExp(`\\b${w}\\b`, 'i').test(s));
  if (word) {
    // Keep the manufacturer's name when there is one — "Midnight Blue" reads
    // better on a listing than "Blue", and it is what is on the sticker.
    const m = s.match(new RegExp(`([\\w'-]+\\s+){0,2}${word}`, 'i'));
    const phrase = (m?.[0] ?? word).trim();
    return phrase.length <= 30 ? titleCaseWords(phrase) : word;
  }
  return null;
}

export function findColors(text: string): { exterior?: Field<string>; interior?: Field<string> } {
  const out: { exterior?: Field<string>; interior?: Field<string> } = {};

  const ext = text.match(/(?:ext(?:erior)?\.?\s*colou?r|body\s*colou?r|colou?r)\s*[:\-=]?\s*([A-Za-z][\w '-]{1,28})/i);
  const int = text.match(/(?:int(?:erior)?\.?\s*colou?r|trim\s*colou?r|upholstery)\s*[:\-=]?\s*([A-Za-z][\w '-]{1,28})/i);

  const e = resolveColor(ext?.[1]);
  if (e) out.exterior = field(e, 'document', 'medium', ext![0].trim());

  const i = resolveColor(int?.[1]);
  if (i) out.interior = field(i, 'document', 'medium', int![0].trim());

  return out;
}

function titleCaseWords(s: string) {
  return s.toLowerCase().replace(/(^|\s)([a-z])/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}

/* ------------------------------------------------------------- title status */

/**
 * Branded titles, in severity order.
 *
 * Checked worst-first and matched on the brand words rather than on "CLEAN",
 * because the word "clean" appears on plenty of salvage paperwork ("cleaned and
 * inspected", "clean and clear of liens"). Absence of a brand is not evidence of
 * a clean title, so nothing is returned when nothing matches — the form's
 * existing CLEAN default applies and the human owns that call.
 */
export function findTitleStatus(text: string): Field<'CLEAN' | 'REBUILT' | 'SALVAGE' | 'BONDED'> | null {
  const rules: Array<[RegExp, 'SALVAGE' | 'REBUILT' | 'BONDED']> = [
    [/\b(salvage|total\s*loss|junk(ed)?|non.?repairable|certificate\s+of\s+destruction)\b/i, 'SALVAGE'],
    [/\b(rebuilt|reconstructed|restored\s+salvage|prior\s+salvage|revived)\b/i, 'REBUILT'],
    [/\b(bonded|surety\s*bond|bond(ed)?\s*title)\b/i, 'BONDED'],
  ];
  for (const [re, val] of rules) {
    const m = text.match(re);
    if (m) return field(val, 'document', 'medium', m[0]);
  }
  return null;
}

/* ------------------------------------------------------------------- stock */

export function findStockNumber(text: string): Field<string> | null {
  const m = text.match(/\b(?:stock|stk|inventory|inv)\s*(?:number|no\.?|#)?\s*[:\-=]?\s*([A-Z0-9][A-Z0-9-]{2,15})\b/i);
  if (!m) return null;
  const v = m[1]!.toUpperCase();
  // A 17-character "stock number" is the VIN wearing a label.
  if (v.replace(/-/g, '').length === 17) return null;
  return field(v, 'document', 'medium', m[0].trim());
}

/* ---------------------------------------------------------------- the pass */

/**
 * Run every deterministic rule over a blob of text.
 *
 * Returns only the fields that matched. Nothing here overwrites anything — the
 * caller decides precedence in `merge.ts`.
 */
export function parseText(text: string): Extraction {
  const e: Extraction = {};
  if (!text.trim()) return e;

  const [bestVin] = findVins(text);
  if (bestVin) {
    e.vin = field(
      bestVin.vin,
      'document',
      bestVin.checksums ? 'high' : 'low',
      bestVin.repairedFrom
        ? `read as ${bestVin.repairedFrom}, corrected to ${bestVin.vin} (I/O/Q are not VIN characters)`
        : undefined,
    );
  }

  const mileage = findMileage(text);
  if (mileage) e.mileage = mileage;

  const { price, msrp } = findPrices(text);
  if (price) e.price = price;
  if (msrp) e.msrp = msrp;

  const { exterior, interior } = findColors(text);
  if (exterior) {
    e.exteriorColor = exterior;
    const hex = hexForColor(exterior.value);
    if (hex) e.exteriorColorHex = field(hex, 'derived', 'low', `swatch for ${exterior.value}`);
  }
  if (interior) e.interiorColor = interior;

  const title = findTitleStatus(text);
  if (title) e.titleStatus = title;

  const stock = findStockNumber(text);
  if (stock) e.stockNumber = stock;

  return e;
}
