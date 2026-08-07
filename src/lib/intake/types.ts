/**
 * Rooftop Auto — vehicle intake by document.
 *
 * THE ONE IDEA IN THIS FOLDER
 * A document and a VIN are not the same kind of evidence, and the mistake that
 * makes these features flaky is treating them as one bag of extracted strings.
 *
 *   - The VIN *proves* year, make, model, body, engine, drivetrain and fuel.
 *     Those come from the manufacturer's own encoding via NHTSA. They are not
 *     opinions and nothing a reader "sees" on a page should overwrite them.
 *   - The document *claims* mileage, price, colors, options and title status.
 *     Nothing else knows those. They are exactly the fields worth a human's
 *     two seconds before the unit goes live.
 *
 * So every field carries where it came from and how sure we are, the merge has a
 * fixed precedence (`merge.ts`), and the review screen shows the human only the
 * claims — never the proofs. That is the difference between "auto-fill" and
 * "auto-fill you can trust with a price".
 *
 * WHY A 17-CHARACTER REGEX IS NOT A VIN
 * OCR on a folded title produces plenty of 17-character runs. A VIN has a
 * position-9 check digit (`isValidVin` in `lib/vin.ts`), so a candidate either
 * checksums or it does not. Rejecting the ones that do not is the single highest
 * -value validation here: a wrong VIN silently creates the wrong car, and every
 * downstream field inherits the error.
 */

import type {
  bodyStyleEnum,
  drivetrainEnum,
  fuelTypeEnum,
  titleStatusEnum,
  transmissionEnum,
} from '@/db/schema';

type BodyStyle = (typeof bodyStyleEnum.enumValues)[number];
type Drivetrain = (typeof drivetrainEnum.enumValues)[number];
type FuelType = (typeof fuelTypeEnum.enumValues)[number];
type TitleStatus = (typeof titleStatusEnum.enumValues)[number];
type Transmission = (typeof transmissionEnum.enumValues)[number];

/**
 * How much a value deserves a human's attention.
 *
 * `high`   — accept silently. Barcode reads and VIN-decoded specs.
 * `medium` — pre-filled, not flagged. The reader saw it plainly.
 * `low`    — pre-filled AND flagged. The reader guessed, or the value is one
 *            where being wrong costs money (price, mileage).
 */
export type Confidence = 'high' | 'medium' | 'low';

export type FieldSource =
  /** Machine-readable code on the doorjamb label or a dealer sticker. Exact. */
  | 'barcode'
  /** The VIN's own encoding, via NHTSA vPIC. Authoritative for specs. */
  | 'vin'
  /** The reader says it saw this on the page. A claim, not a proof. */
  | 'document'
  /** We computed it from other fields (color hex, description, stock #). */
  | 'derived';

export type Field<T> = {
  value: T;
  confidence: Confidence;
  source: FieldSource;
  /**
   * The verbatim text the reader based this on. Powers the "where did this come
   * from" toggle on the review screen — which is the thing that turns a bad read
   * from a mystery into a two-second diagnosis.
   */
  evidence?: string;
};

/**
 * Everything intake can populate, keyed to match `VehicleForm` input names so
 * the review screen can hand the whole object to the existing form untouched.
 *
 * All optional: a photo of a VIN plate yields five of these, a full window
 * sticker yields most of them, and a bad read yields none. The UI is driven by
 * what is present rather than by a mode flag.
 */
export type Extraction = {
  /* --- proofs: the VIN and what it decodes to --- */
  vin?: Field<string>;
  year?: Field<number>;
  make?: Field<string>;
  model?: Field<string>;
  trim?: Field<string>;
  bodyStyle?: Field<BodyStyle>;
  doors?: Field<number>;
  engine?: Field<string>;
  cylinders?: Field<number>;
  transmission?: Field<Transmission>;
  drivetrain?: Field<Drivetrain>;
  fuelType?: Field<FuelType>;
  mpgCity?: Field<number>;
  mpgHwy?: Field<number>;

  /* --- claims: only the document knows these --- */
  mileage?: Field<number>;
  price?: Field<number>;
  msrp?: Field<number>;
  cost?: Field<number>;
  exteriorColor?: Field<string>;
  exteriorColorHex?: Field<string>;
  interiorColor?: Field<string>;
  titleStatus?: Field<TitleStatus>;
  stockNumber?: Field<string>;
  keysCount?: Field<number>;

  /* --- merchandising --- */
  description?: Field<string>;
  options?: Field<string[]>;
  callouts?: Field<string[]>;
  features?: Field<string[]>;
};

export type ExtractionKey = keyof Extraction;

/**
 * The fields a human should look at before this unit exists.
 *
 * Deliberately short. A confirm screen listing twenty fields gets the same
 * treatment as a EULA; one listing four gets read. Mileage and price are here
 * because a wrong number goes straight out to every channel, and title status
 * because "salvage" read as "clean" is a misrepresentation claim, not a typo.
 */
export const REVIEW_FIELDS: readonly ExtractionKey[] = [
  'vin',
  'mileage',
  'price',
  'titleStatus',
] as const;

/** What kind of paper the reader thinks it was looking at. Advisory only. */
export type DocumentKind =
  | 'WINDOW_STICKER'
  | 'TITLE'
  | 'REGISTRATION'
  | 'AUCTION_SHEET'
  | 'BILL_OF_SALE'
  | 'VIN_PLATE'
  | 'ODOMETER'
  | 'UNKNOWN';

/** Which reader produced the raw material. Recorded per scan for debugging. */
export type ReaderKind = 'barcode' | 'claude' | 'ocr' | 'none';

export type ScanWarning = {
  code:
    | 'NO_VIN'
    | 'VIN_CHECKSUM_FAILED'
    | 'VIN_DECODE_FAILED'
    | 'DOC_DISAGREES_WITH_VIN'
    | 'MILEAGE_IMPLAUSIBLE'
    | 'PRICE_IMPLAUSIBLE'
    | 'DUPLICATE_VIN'
    | 'READER_UNAVAILABLE'
    | 'PARTIAL_READ';
  /** Written for a person standing on a lot holding a phone. */
  message: string;
};

export type ScanResult = {
  ok: boolean;
  /** Opaque id of the stored scan row. Quote this when a read goes wrong. */
  scanId: string | null;
  documentKind: DocumentKind;
  reader: ReaderKind;
  extraction: Extraction;
  warnings: ScanWarning[];
  /**
   * Set when the VIN already exists in this tenant's inventory. The UI offers
   * "open the existing unit" instead of creating a duplicate — the single most
   * common intake mistake at a small store with two people adding cars.
   */
  existingVehicleId?: string;
  /** Storage key for the page image, so the doc can be attached to the unit. */
  blobKeys: string[];
  timings: { readMs: number; decodeMs: number; totalMs: number };
};

/** Fields the VIN proves. `merge.ts` refuses to let a document overwrite these. */
export const VIN_OWNED_FIELDS: readonly ExtractionKey[] = [
  'year',
  'make',
  'model',
  'bodyStyle',
  'doors',
  'engine',
  'cylinders',
  'drivetrain',
  'fuelType',
] as const;

/** Convenience for building a field without repeating the shape everywhere. */
export function field<T>(
  value: T,
  source: FieldSource,
  confidence: Confidence,
  evidence?: string,
): Field<T> {
  return evidence ? { value, source, confidence, evidence } : { value, source, confidence };
}

/** Flatten to plain values — what the form's defaultValues actually want. */
export function plainValues(e: Extraction): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v && typeof v === 'object' && 'value' in v) out[k] = (v as Field<unknown>).value;
  }
  return out;
}
