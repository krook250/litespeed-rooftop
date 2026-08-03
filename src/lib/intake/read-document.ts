/**
 * The document reader, behind a seam.
 *
 * WHY A SEAM RATHER THAN A VENDOR
 * Same reasoning as `lib/storage.ts`: the interface is the deliverable. Today
 * there are two implementations and the choice is made by which env vars are
 * set, so a dealer demo runs with no AI spend at all and a real account runs
 * with the good reader. Nothing above this module knows which one ran.
 *
 * WHY THE MODEL READER IS THE PRIMARY ONE
 * The OCR-plus-regex approach works, right up until the paper stops cooperating.
 * A Florida title prints its fields in a different order than a Georgia one, an
 * auction run list is a table, a window sticker is three columns, and a phone
 * photo of any of them is rotated and glared. Regexes handle each of those by
 * accumulating another special case — which is exactly the long debugging tail
 * this feature is known for. A vision model reads layout, so the same prompt
 * handles all four documents and the maintenance goes into the *schema* instead
 * of into the patterns.
 *
 * WHAT THE MODEL IS NOT TRUSTED WITH
 * It is asked to transcribe, not to conclude. Every value comes back with the
 * verbatim text it came from, the VIN is re-derived through the check digit in
 * `parse.ts`, and the specs are thrown away in favour of the vPIC decode. The
 * model's real job is finding the four numbers nothing else can supply.
 *
 * COST, HONESTLY
 * A page of a window sticker is roughly 1.5k input tokens. At Haiku pricing that
 * is a fraction of a cent per scan, and the escalation path below only fires when
 * the check digit says the first read was wrong. This does not move the $99/mo
 * unit economics — but it is a real per-call cost, so it stays behind a key that
 * has to be set on purpose.
 */

import 'server-only';
import type { DocumentKind, ReaderKind } from './types';

/**
 * Default to the cheapest, fastest model. Accuracy is defended by the check
 * digit rather than by model size, and when the digit fails we escalate — which
 * is a better use of money than paying for the big model on every clean read.
 */
const MODEL = process.env.INTAKE_MODEL || 'claude-haiku-4-5';
const MODEL_ESCALATE = process.env.INTAKE_MODEL_ESCALATE || 'claude-sonnet-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const READ_TIMEOUT_MS = 45_000;

export type Page = { bytes: Buffer; contentType: string };

/** What the reader claims to have seen. Claims, not facts — see `merge.ts`. */
export type DocClaims = {
  documentKind: DocumentKind;
  vin: string | null;
  /** The reader's own view of how legible the VIN was. */
  vinLegibility: 'clear' | 'partial' | 'guessed' | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  mileage: number | null;
  odometerUnit: 'mi' | 'km' | null;
  askingPrice: number | null;
  msrp: number | null;
  purchasePrice: number | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleBrand: 'CLEAN' | 'REBUILT' | 'SALVAGE' | 'BONDED' | null;
  stockNumber: string | null;
  keysCount: number | null;
  options: string[];
  callouts: string[];
  /** Where each value was seen, keyed by field name. Feeds the "why" panel. */
  evidence: Record<string, string>;
  /** Everything legible on the page, verbatim. Cross-checked by `parse.ts`. */
  transcript: string;
};

export type ReadOutcome = {
  reader: ReaderKind;
  claims: DocClaims | null;
  /** Plain text for the deterministic pass. Always populated when possible. */
  text: string;
  /** Untouched vendor response, stored per scan so a bad read is diagnosable. */
  raw: unknown;
  escalated: boolean;
  error?: string;
};

export function emptyClaims(): DocClaims {
  return {
    documentKind: 'UNKNOWN',
    vin: null,
    vinLegibility: null,
    year: null,
    make: null,
    model: null,
    trim: null,
    mileage: null,
    odometerUnit: null,
    askingPrice: null,
    msrp: null,
    purchasePrice: null,
    exteriorColor: null,
    interiorColor: null,
    titleBrand: null,
    stockNumber: null,
    keysCount: null,
    options: [],
    callouts: [],
    evidence: {},
    transcript: '',
  };
}

/** Which reader is actually usable right now, given the environment. */
export function availableReader(): ReaderKind {
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.OCR_SPACE_API_KEY) return 'ocr';
  return 'none';
}

/* ----------------------------------------------------------- the tool shape */

/**
 * Forced tool use rather than "reply with JSON".
 *
 * The schema is validated by the API before the response comes back, so the
 * failure mode "model returned prose with a JSON block in it" does not exist
 * here. Every field is nullable on purpose: a photo of a VIN plate legitimately
 * has no price on it, and a schema that cannot express "not present" gets a
 * fabricated value instead of a null.
 */
const EXTRACT_TOOL = {
  name: 'record_vehicle_document',
  description: 'Record exactly what is legible on this vehicle document. Never infer.',
  input_schema: {
    type: 'object',
    properties: {
      document_kind: {
        type: 'string',
        enum: [
          'WINDOW_STICKER', 'TITLE', 'REGISTRATION', 'AUCTION_SHEET',
          'BILL_OF_SALE', 'VIN_PLATE', 'ODOMETER', 'UNKNOWN',
        ],
      },
      vin: {
        type: ['string', 'null'],
        description: '17 characters exactly as printed. Never fill in an unreadable character.',
      },
      vin_legibility: { type: ['string', 'null'], enum: ['clear', 'partial', 'guessed', null] },
      year: { type: ['integer', 'null'] },
      make: { type: ['string', 'null'] },
      model: { type: ['string', 'null'] },
      trim: { type: ['string', 'null'] },
      mileage: { type: ['integer', 'null'], description: 'Odometer reading as a number only.' },
      odometer_unit: { type: ['string', 'null'], enum: ['mi', 'km', null] },
      asking_price: { type: ['integer', 'null'], description: 'Retail/asking/list price in dollars.' },
      msrp: { type: ['integer', 'null'] },
      purchase_price: {
        type: ['integer', 'null'],
        description: 'What the dealer paid — auction hammer price or bill-of-sale amount.',
      },
      exterior_color: { type: ['string', 'null'] },
      interior_color: { type: ['string', 'null'] },
      title_brand: { type: ['string', 'null'], enum: ['CLEAN', 'REBUILT', 'SALVAGE', 'BONDED', null] },
      stock_number: { type: ['string', 'null'] },
      keys_count: { type: ['integer', 'null'] },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Equipment and packages, one per entry, as printed.',
      },
      callouts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short selling points a shopper would care about. At most five.',
      },
      evidence: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description:
          'For each field you filled, the verbatim text you read it from. Keys are field names.',
      },
      transcript: {
        type: 'string',
        description: 'Every legible line on the document, in reading order.',
      },
    },
    required: ['document_kind', 'options', 'callouts', 'evidence', 'transcript'],
  },
} as const;

const SYSTEM = `You transcribe vehicle paperwork for a used-car dealership's inventory system.

You are reading one of: a window sticker (Monroney or dealer addendum), a state title
or registration, an auction run list or bill of sale, a photo of a VIN plate or
doorjamb label, or a photo of an odometer.

Rules, in order of importance:

1. Transcribe. Do not infer, complete, or correct. If three characters of the VIN are
   under a glare, return what you can see for the rest and set vin_legibility to
   "partial" — do NOT guess the missing characters. A guessed VIN creates the wrong
   car in inventory, which is worse than no VIN at all.
2. VINs are 17 characters and never contain the letters I, O or Q. If you see what
   looks like one of those, it is a 1, 0 and 0 respectively.
3. Odometer readings: report the number only. If the document says the reading is not
   actual, exceeds mechanical limits, or is exempt, put that phrase in evidence.mileage
   and still report the number.
4. Prices: asking_price is what the vehicle is offered for. purchase_price is what the
   dealer paid (auction hammer, bill of sale). These are different fields; do not merge
   them. If the document only shows one number and you cannot tell which it is, put it
   in asking_price and say so in evidence.
5. Title brands: only set title_brand when a brand word actually appears. The word
   "clean" in "clean and clear of all liens" refers to liens, not to the title brand.
6. stock_number is the DEALER's own inventory number — it appears on a dealer
   addendum, a lot tag, or an internal sheet, and usually has a letter prefix. A
   title number, document number, control number, lot number or auction run number
   is NOT a stock number. If the only number you can see belongs to the state or to
   the auction, leave stock_number null.
7. evidence must contain, for every non-null field, the short verbatim phrase you read
   it from. This is what a human uses to check your work.
8. transcript is everything legible, in reading order. Include it even when the rest is
   empty — a blurred photo with a readable transcript is still useful.

Return null for anything not on the page. An honest null is the correct answer.`;

/* -------------------------------------------------------------- claude read */

function mediaBlock(p: Page) {
  const b64 = p.bytes.toString('base64');
  if (p.contentType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  }
  return { type: 'image', source: { type: 'base64', media_type: p.contentType, data: b64 } };
}

async function callClaude(pages: Page[], model: string): Promise<{ claims: DocClaims; raw: unknown }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      tools: [EXTRACT_TOOL],
      // Forced, so there is exactly one shape of response to handle.
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            ...pages.map(mediaBlock),
            {
              type: 'text',
              text:
                pages.length > 1
                  ? `These ${pages.length} images are pages or sides of the same vehicle's paperwork. Combine them into one record.`
                  : 'Record this document.',
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
  };
  const block = json.content?.find((c) => c.type === 'tool_use' && c.name === EXTRACT_TOOL.name);
  if (!block?.input) throw new Error('anthropic: no tool_use block in response');

  return { claims: toClaims(block.input), raw: json };
}

function toClaims(input: Record<string, unknown>): DocClaims {
  const s = (k: string): string | null => {
    const v = input[k];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const n = (k: string): number | null => {
    const v = input[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const arr = (k: string): string[] => {
    const v = input[k];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[]): T | null => {
    const v = s(k);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  };

  const evidence: Record<string, string> = {};
  const rawEv = input.evidence;
  if (rawEv && typeof rawEv === 'object') {
    for (const [k, v] of Object.entries(rawEv as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) evidence[k] = v.trim().slice(0, 240);
    }
  }

  return {
    documentKind:
      oneOf('document_kind', [
        'WINDOW_STICKER', 'TITLE', 'REGISTRATION', 'AUCTION_SHEET',
        'BILL_OF_SALE', 'VIN_PLATE', 'ODOMETER', 'UNKNOWN',
      ] as const) ?? 'UNKNOWN',
    vin: s('vin'),
    vinLegibility: oneOf('vin_legibility', ['clear', 'partial', 'guessed'] as const),
    year: n('year'),
    make: s('make'),
    model: s('model'),
    trim: s('trim'),
    mileage: n('mileage'),
    odometerUnit: oneOf('odometer_unit', ['mi', 'km'] as const),
    askingPrice: n('asking_price'),
    msrp: n('msrp'),
    purchasePrice: n('purchase_price'),
    exteriorColor: s('exterior_color'),
    interiorColor: s('interior_color'),
    titleBrand: oneOf('title_brand', ['CLEAN', 'REBUILT', 'SALVAGE', 'BONDED'] as const),
    stockNumber: s('stock_number'),
    keysCount: n('keys_count'),
    options: arr('options').slice(0, 80),
    callouts: arr('callouts').slice(0, 8),
    evidence,
    transcript: s('transcript') ?? '',
  };
}

/* ------------------------------------------------------------------ ocr read */

/**
 * OCR.space fallback.
 *
 * Note there is no hardcoded demo key here. The reference implementation used
 * OCR.space's public `helloworld` key, which is shared by every tutorial on the
 * internet, rate-limited globally, and produces intermittent failures that look
 * exactly like bad photos — a genuinely nasty thing to debug on a lot. A free
 * registered key removes that entire class of ghost bug.
 */
async function callOcr(pages: Page[]): Promise<{ text: string; raw: unknown }> {
  const texts: string[] = [];
  const raws: unknown[] = [];

  for (const p of pages) {
    const fd = new FormData();
    fd.append('apikey', process.env.OCR_SPACE_API_KEY!);
    fd.append('language', 'eng');
    fd.append('OCREngine', '2');
    fd.append('scale', 'true');
    fd.append('detectOrientation', 'true');
    fd.append('isOverlayRequired', 'false');
    fd.append(
      'file',
      new Blob([new Uint8Array(p.bytes)], { type: p.contentType }),
      p.contentType === 'application/pdf' ? 'doc.pdf' : 'page.jpg',
    );

    const res = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    const json = (await res.json()) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string[] | string;
      ParsedResults?: Array<{ ParsedText?: string }>;
    };
    raws.push(json);
    if (json.IsErroredOnProcessing) {
      const msg = Array.isArray(json.ErrorMessage) ? json.ErrorMessage[0] : json.ErrorMessage;
      throw new Error(`ocr.space: ${msg ?? 'processing error'}`);
    }
    texts.push((json.ParsedResults ?? []).map((r) => r.ParsedText ?? '').join('\n'));
  }

  return { text: texts.join('\n\n').trim(), raw: raws };
}

/* --------------------------------------------------------------- the reader */

/**
 * Read the pages with whatever reader is configured.
 *
 * The escalation is the interesting part: `shouldEscalate` is supplied by the
 * caller and is, in practice, "the VIN you returned does not satisfy its check
 * digit". That is a cheap, objective, self-administered correctness test — one
 * of the few places where a system can tell on its own that it got the answer
 * wrong — so it is worth spending a second, better read on. It fires rarely, and
 * when it fires it is nearly always right to.
 */
export async function readDocument(
  pages: Page[],
  opts: { shouldEscalate?: (claims: DocClaims) => boolean } = {},
): Promise<ReadOutcome> {
  const reader = availableReader();

  if (reader === 'claude') {
    try {
      const first = await callClaude(pages, MODEL);
      let { claims, raw } = first;
      let escalated = false;

      if (opts.shouldEscalate?.(claims) && MODEL_ESCALATE && MODEL_ESCALATE !== MODEL) {
        try {
          const second = await callClaude(pages, MODEL_ESCALATE);
          // Only take the escalated read if it actually resolved the doubt.
          if (!opts.shouldEscalate(second.claims)) {
            claims = second.claims;
            raw = { first: raw, escalated: second.raw };
            escalated = true;
          }
        } catch {
          /* keep the first read rather than failing the scan */
        }
      }

      return { reader: 'claude', claims, text: claims.transcript, raw, escalated };
    } catch (err) {
      // Fall through to OCR when it is configured — a degraded read beats a
      // dead end for someone standing next to the car.
      if (!process.env.OCR_SPACE_API_KEY) {
        return {
          reader: 'claude',
          claims: null,
          text: '',
          raw: null,
          escalated: false,
          error: String(err),
        };
      }
    }
  }

  if (process.env.OCR_SPACE_API_KEY) {
    try {
      const { text, raw } = await callOcr(pages);
      return { reader: 'ocr', claims: null, text, raw, escalated: false };
    } catch (err) {
      return { reader: 'ocr', claims: null, text: '', raw: null, escalated: false, error: String(err) };
    }
  }

  return {
    reader: 'none',
    claims: null,
    text: '',
    raw: null,
    escalated: false,
    error: 'No document reader configured. Set ANTHROPIC_API_KEY or OCR_SPACE_API_KEY.',
  };
}
