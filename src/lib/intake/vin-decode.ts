/**
 * VIN → specs, from NHTSA vPIC.
 *
 * WHY THIS IS THE GROUND TRUTH LAYER
 * vPIC is the manufacturer's own encoding of the VIN, published by the DOT. It
 * is free, unauthenticated, and correct about the things it covers. Anything a
 * document reader believes about year/make/model/body/engine is a guess by
 * comparison, so `merge.ts` lets this layer win those fields outright.
 *
 * WHAT IT DOES NOT KNOW, AND WHY THAT MATTERS
 * vPIC has no mileage, no price, no colour, no options, no title brand. Those
 * are the fields intake actually has to read off paper — which is a useful thing
 * to internalise, because it means the document reader's job is much smaller
 * than "read the whole sticker". It reads the handful of things nothing else
 * can supply. Small jobs are accurate jobs.
 *
 * MPG is deliberately absent: it comes from fueleconomy.gov, keyed by trim
 * rather than VIN, and guessing a trim to get an MPG number is how you publish
 * the wrong fuel economy. Left blank for a human or a later CarAPI layer.
 *
 * CACHING
 * Free API, but a re-scan of the same title should not wait on a network round
 * trip, and vPIC does go down. The cache is the availability story more than the
 * cost story: once a VIN is decoded it stays decoded.
 */

import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as t from '@/db/schema';
import { isValidVin } from '@/lib/vin';
import { field, type Extraction } from './types';

const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

/** vPIC is usually fast. If it is not, intake proceeds without it. */
const TIMEOUT_MS = 6_000;

/** Only the columns we use. vPIC returns ~140 of them. */
export type VpicRow = {
  ErrorCode?: string;
  ErrorText?: string;
  ModelYear?: string;
  Make?: string;
  Model?: string;
  Trim?: string;
  Series?: string;
  BodyClass?: string;
  Doors?: string;
  DisplacementL?: string;
  EngineCylinders?: string;
  EngineConfiguration?: string;
  TransmissionStyle?: string;
  DriveType?: string;
  FuelTypePrimary?: string;
  ElectrificationLevel?: string;
  VehicleType?: string;
};

type BodyStyle = (typeof t.bodyStyleEnum.enumValues)[number];
type Drivetrain = (typeof t.drivetrainEnum.enumValues)[number];
type FuelType = (typeof t.fuelTypeEnum.enumValues)[number];
type Transmission = (typeof t.transmissionEnum.enumValues)[number];

/* ------------------------------------------------------------- vPIC → enums */

/**
 * Ordered on purpose, and the order is load-bearing.
 *
 * vPIC's BodyClass is free text and its values routinely contain more than one
 * of our keywords, so "first match wins" only works if the specific patterns sit
 * above the generic ones. Two that bite:
 *
 *   - "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)" is vPIC's single
 *     most common SUV value, and it contains "MPV". A van rule placed above the
 *     SUV rule files every SUV on the lot as a minivan — silently, and on every
 *     channel. A test caught exactly that here.
 *   - "Sport Utility Truck (SUT)" contains "Sport Utility". An Avalanche is a
 *     truck, so the SUT rule has to sit above the SUV rule in turn.
 *
 * Net: TRUCK-specific, then the unambiguous shapes, then SUV, then VAN. Do not
 * reorder without running `vin-decode.test.ts`.
 */
const BODY_RULES: Array<[RegExp, BodyStyle]> = [
  [/pickup|sport utility truck|\bsut\b/i, 'TRUCK'],
  [/convertible|cabriolet|roadster|targa|spyder/i, 'CONVERTIBLE'],
  [/hatchback|liftback|notchback/i, 'HATCHBACK'],
  [/wagon|estate|shooting brake/i, 'WAGON'],
  [/sport utility|\bsuv\b|crossover|\bcuv\b/i, 'SUV'],
  [/minivan|passenger van|cargo van|\bvan\b|\bmpv\b/i, 'VAN'],
  [/coupe|2dr|two.door/i, 'COUPE'],
  [/sedan|saloon|hardtop/i, 'SEDAN'],
  [/truck|chassis cab|cutaway|incomplete/i, 'TRUCK'],
];

const DRIVE_RULES: Array<[RegExp, Drivetrain]> = [
  [/\b4wd\b|4-wheel|four.wheel|\b4x4\b|\b4xe\b/i, 'FOUR_WD'],
  [/\bawd\b|all.wheel/i, 'AWD'],
  [/\bfwd\b|front.wheel|\b4x2\b.*front/i, 'FWD'],
  [/\brwd\b|rear.wheel|\b4x2\b|\b6x2\b/i, 'RWD'],
];

const TRANS_RULES: Array<[RegExp, Transmission]> = [
  // CVT first: "Continuously Variable Transmission (CVT)" also matches nothing
  // else, but "Automated Manual" contains "Manual" and must not become MANUAL.
  [/continuously variable|\bcvt\b|\becvt\b/i, 'CVT'],
  [/automated manual|dual.clutch|\bdct\b|\bamt\b|automatic/i, 'AUTOMATIC'],
  [/manual|standard/i, 'MANUAL'],
];

/**
 * Electrification is a separate vPIC column from fuel type, and it is the one
 * that actually distinguishes a hybrid — a Prius reports FuelTypePrimary
 * "Gasoline". Checking fuel type alone lists every hybrid on the lot as a
 * plain gas car, which is a real merchandising miss on a $4/gal forecourt.
 */
function mapFuel(fuel?: string, electrification?: string): FuelType | null {
  const e = (electrification ?? '').toLowerCase();
  if (/phev|plug-in/.test(e)) return 'PLUGIN_HYBRID';
  if (/\bbev\b|battery electric/.test(e)) return 'ELECTRIC';
  if (/hev|hybrid/.test(e)) return 'HYBRID';

  const f = (fuel ?? '').toLowerCase();
  if (!f) return null;
  if (/electric/.test(f)) return 'ELECTRIC';
  if (/diesel/.test(f)) return 'DIESEL';
  if (/flex|\bffv\b|e85|ethanol/.test(f)) return 'FLEX';
  if (/gasoline|petrol/.test(f)) return 'GAS';
  return null;
}

function firstMatch<T>(rules: Array<[RegExp, T]>, input?: string): T | null {
  if (!input) return null;
  for (const [re, val] of rules) if (re.test(input)) return val;
  return null;
}

/** vPIC writes "Not Applicable", "", "0" and literal "null" for absent values. */
function clean(v?: string): string | null {
  const s = (v ?? '').trim();
  if (!s || s === '0' || /^(not applicable|not available|null|n\/a|unknown)$/i.test(s)) return null;
  return s;
}

function num(v?: string): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* --------------------------------------------------------------- the decode */

export type DecodeOutcome =
  | { ok: true; extraction: Extraction; cached: boolean; raw: VpicRow }
  | { ok: false; reason: 'INVALID_VIN' | 'NOT_FOUND' | 'UNAVAILABLE' };

/**
 * Decode a VIN into the subset of fields vPIC is authoritative about.
 *
 * The check digit is validated before spending a network call: vPIC will happily
 * return a partial decode for a mistyped VIN (the WMI and year code still parse)
 * and that partial decode looks exactly like a good one. Failing here instead
 * keeps a plausible-but-wrong car out of inventory.
 */
export async function decodeVin(vin: string): Promise<DecodeOutcome> {
  const v = vin.trim().toUpperCase();
  if (!isValidVin(v)) return { ok: false, reason: 'INVALID_VIN' };

  const cached = await readCache(v);
  if (cached) return { ok: true, extraction: vpicToExtraction(cached), cached: true, raw: cached };

  let row: VpicRow;
  try {
    const res = await fetch(`${VPIC_URL}/${encodeURIComponent(v)}?format=json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // vPIC data for a given VIN never changes; Next's fetch cache is fine to
      // use as a second layer in front of ours.
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return { ok: false, reason: 'UNAVAILABLE' };
    const json = (await res.json()) as { Results?: VpicRow[] };
    const first = json.Results?.[0];
    if (!first) return { ok: false, reason: 'NOT_FOUND' };
    row = first;
  } catch {
    return { ok: false, reason: 'UNAVAILABLE' };
  }

  // ErrorCode "0" is a clean decode. Anything else is a list of complaint codes,
  // but a partial decode with a complaint is still worth having as long as it
  // produced a make and a model — vPIC flags plenty of legitimate older VINs.
  const usable = clean(row.Make) && clean(row.ModelYear);
  if (!usable) return { ok: false, reason: 'NOT_FOUND' };

  await writeCache(v, row);
  return { ok: true, extraction: vpicToExtraction(row), cached: false, raw: row };
}

/**
 * vPIC row → our field shape.
 *
 * Everything here is `high` confidence and sourced `vin`, which is what gives
 * `merge.ts` its precedence rule. Trim is the one exception: vPIC's Trim and
 * Series columns are inconsistently populated and frequently hold marketing
 * text, so it is offered at `medium` and a document may overwrite it.
 *
 * Exported because this — not the fetch around it — is the part that breaks.
 * vPIC's columns are free text with no schema, so every mapping below is a
 * judgement call about somebody else's string, and `vin-decode.test.ts` pins
 * each one against a recorded row.
 */
export function vpicToExtraction(r: VpicRow): Extraction {
  const e: Extraction = {};
  const from = 'NHTSA vPIC';

  const year = num(r.ModelYear);
  if (year) e.year = field(year, 'vin', 'high', from);

  const make = clean(r.Make);
  // vPIC shouts: "TOYOTA". Title-case it so it matches how it is typed by hand.
  if (make) e.make = field(titleCase(make), 'vin', 'high', from);

  const model = clean(r.Model);
  if (model) e.model = field(model, 'vin', 'high', from);

  const trim = clean(r.Trim) ?? clean(r.Series);
  if (trim) e.trim = field(trim, 'vin', 'medium', from);

  const body = firstMatch(BODY_RULES, clean(r.BodyClass) ?? clean(r.VehicleType) ?? undefined);
  if (body) e.bodyStyle = field(body, 'vin', 'high', `${from}: ${r.BodyClass ?? r.VehicleType}`);

  const doors = num(r.Doors);
  if (doors && doors >= 2 && doors <= 6) e.doors = field(Math.round(doors), 'vin', 'high', from);

  const cyl = num(r.EngineCylinders);
  if (cyl && cyl >= 2 && cyl <= 16) e.cylinders = field(Math.round(cyl), 'vin', 'high', from);

  const litres = num(r.DisplacementL);
  const engineText = [
    litres ? `${litres.toFixed(1)}L` : null,
    cyl ? `${clean(r.EngineConfiguration)?.match(/^V/i) ? 'V' : ''}${Math.round(cyl)}-Cylinder` : null,
  ]
    .filter(Boolean)
    .join(' ');
  if (engineText) e.engine = field(engineText, 'vin', 'high', from);

  const trans = firstMatch(TRANS_RULES, clean(r.TransmissionStyle) ?? undefined);
  if (trans) e.transmission = field(trans, 'vin', 'high', `${from}: ${r.TransmissionStyle}`);

  const drive = firstMatch(DRIVE_RULES, clean(r.DriveType) ?? undefined);
  if (drive) e.drivetrain = field(drive, 'vin', 'high', `${from}: ${r.DriveType}`);

  const fuel = mapFuel(clean(r.FuelTypePrimary) ?? undefined, clean(r.ElectrificationLevel) ?? undefined);
  if (fuel) {
    e.fuelType = field(
      fuel,
      'vin',
      'high',
      `${from}: ${[r.FuelTypePrimary, r.ElectrificationLevel].filter(Boolean).join(' / ')}`,
    );
  }

  return e;
}

/**
 * vPIC shouts every make: "TOYOTA", "MERCEDES-BENZ". Left alone it would sit in
 * inventory next to the hand-typed "Toyota" and sort separately in every filter.
 *
 * The exceptions are marques that are genuinely initialisms or stylised, where
 * title case is simply the wrong spelling of the brand.
 */
const MAKE_AS_WRITTEN: Record<string, string> = {
  BMW: 'BMW', GMC: 'GMC', MINI: 'MINI', RAM: 'RAM', FIAT: 'FIAT',
  KIA: 'Kia', MG: 'MG', BYD: 'BYD', 'MERCEDES-BENZ': 'Mercedes-Benz',
};

function titleCase(s: string) {
  const exact = MAKE_AS_WRITTEN[s.toUpperCase()];
  if (exact) return exact;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/* ------------------------------------------------------------------- cache */

async function readCache(vin: string): Promise<VpicRow | null> {
  try {
    const rows = await db
      .select({ payload: t.vinDecodes.payload })
      .from(t.vinDecodes)
      .where(eq(t.vinDecodes.vin, vin))
      .limit(1);
    return (rows[0]?.payload as VpicRow | undefined) ?? null;
  } catch {
    // A cache that is down must not take intake down with it.
    return null;
  }
}

async function writeCache(vin: string, payload: VpicRow) {
  try {
    await db
      .insert(t.vinDecodes)
      .values({ vin, payload })
      .onConflictDoNothing({ target: t.vinDecodes.vin });
  } catch {
    /* best effort */
  }
}
