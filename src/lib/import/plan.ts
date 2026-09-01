import { normaliseVin } from '@/lib/intake/parse';
import {
  cleanDescription, deriveStockNumber, splitList, splitUrls, toBodyStyle, toCylinders,
  toDoors, toDrivetrain, toFuelType, toMileage, toMoney, toTransmission, toYear,
  type BodyStyle, type Drivetrain, type FuelType, type ImportField, type Mapping,
  type Transmission,
} from './mapping';

/**
 * What an import *would* do, worked out before anything is written.
 *
 * Nothing in this file touches a database. `plan()` takes parsed rows and an
 * agreed mapping and returns the drafts plus every doubt it had, so the screen
 * can show a dealer exactly what they are about to accept and the whole thing
 * can be tested against a real file with no Postgres in the picture.
 *
 * ADDITIVE ONLY, ON PURPOSE. There is no delete path here and no "absent from
 * the file means sold." That rule is correct for a nightly feed and catastrophic
 * for a one-off upload of a partial file, and the two are indistinguishable from
 * inside this function. It gets decided when scheduled pulls land, by somebody
 * who knows which kind of file arrived.
 */

export type IssueCode =
  | 'MISSING_VIN' | 'BAD_VIN' | 'VIN_CHECKSUM_FAILED' | 'DUPLICATE_VIN_IN_FILE'
  | 'MISSING_REQUIRED' | 'BODY_STYLE_UNRECOGNISED' | 'BODY_STYLE_APPROXIMATED'
  | 'TRANSMISSION_UNKNOWN' | 'DRIVETRAIN_UNKNOWN' | 'STOCK_NUMBER_DERIVED'
  | 'CONTACT_INFO_REMOVED' | 'NO_PHOTOS' | 'PHOTOS_OFF_SITE' | 'OPTIONS_SPEC_DUMP'
  | 'VIN_DISAGREES_WITH_FILE';

export type Issue = {
  code: IssueCode;
  /** `error` keeps the row out of the import. `warning` lets it through, loudly. */
  severity: 'error' | 'warning';
  message: string;
};

export type VehicleDraft = {
  vin: string;
  stockNumber: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: BodyStyle;
  doors?: number;
  engine: string;
  cylinders?: number;
  transmission?: Transmission;
  drivetrain?: Drivetrain;
  fuelType?: FuelType;
  exteriorColor: string;
  interiorColor: string;
  mileage: number;
  price: number;
  salePrice?: number;
  msrp?: number;
  description: string;
  options: string[];
  photoUrls: string[];
};

export type PlannedRow = {
  /** 1-based row number in the file, header excluded. Quote this to a dealer. */
  line: number;
  vin: string;
  title: string;
  action: 'create' | 'update' | 'skip';
  draft: VehicleDraft | null;
  issues: Issue[];
};

export type ImportPlan = {
  rows: PlannedRow[];
  summary: {
    total: number;
    create: number;
    update: number;
    skip: number;
    warnings: number;
    photos: number;
  };
};

const err = (code: IssueCode, message: string): Issue => ({ code, severity: 'error', message });
const warn = (code: IssueCode, message: string): Issue => ({ code, severity: 'warning', message });

/** Photos above this are kept but called out — some channels cap well below it. */
export const PHOTO_NOTE_THRESHOLD = 30;

/**
 * Above this many options, the column is a factory spec sheet rather than a
 * list of selling points.
 *
 * The Malabar file carries 139 per truck, including `Steering Ratio - 16.8`,
 * `Turns Lock-To-Lock - 3.3` and `Front Headrests - 2`. Nothing is wrong with
 * the data — but CarGurus joins options into one `Installed Options` cell, and
 * four thousand characters of headrest counts is what makes a listing read as
 * machine-generated. Kept in full here, because throwing away a dealer's data on
 * import is not this module's call; flagged so the decision gets made once,
 * visibly, in the syndication builder.
 */
export const OPTIONS_SPEC_DUMP_THRESHOLD = 40;

export function planImport(
  rows: Record<string, string>[],
  mapping: Mapping,
  opts: { existingVins?: Iterable<string> } = {},
): ImportPlan {
  const existing = new Set([...(opts.existingVins ?? [])].map((v) => v.toUpperCase()));
  const seen = new Set<string>();
  const planned: PlannedRow[] = [];

  const cell = (row: Record<string, string>, field: ImportField): string | undefined => {
    const header = mapping[field];
    return header ? row[header] : undefined;
  };

  rows.forEach((row, i) => {
    const line = i + 1;
    const issues: Issue[] = [];

    const rawVin = (cell(row, 'vin') ?? '').trim();
    if (!rawVin) {
      planned.push({ line, vin: '', title: '(no VIN)', action: 'skip', draft: null,
        issues: [err('MISSING_VIN', 'No VIN in this row.')] });
      return;
    }
    const candidate = normaliseVin(rawVin);
    if (!candidate) {
      planned.push({ line, vin: rawVin, title: rawVin, action: 'skip', draft: null,
        issues: [err('BAD_VIN', `"${rawVin}" is not a 17-character VIN.`)] });
      return;
    }
    const vin = candidate.vin;
    if (!candidate.checksums) {
      // Proof of a bad character, not a suspicion — the check digit is
      // arithmetic over the other sixteen. Still imported: a real VIN typed
      // wrong is better in the system, flagged, than silently dropped.
      issues.push(warn('VIN_CHECKSUM_FAILED', `VIN ${vin} fails its check digit — one character is wrong.`));
    }

    const year = toYear(cell(row, 'year'));
    const make = (cell(row, 'make') ?? '').trim();
    const model = (cell(row, 'model') ?? '').trim();
    const trim = (cell(row, 'trim') ?? '').trim();
    const mileage = toMileage(cell(row, 'mileage'));
    const price = toMoney(cell(row, 'price'));

    const missing: string[] = [];
    if (!year) missing.push('year');
    if (!make) missing.push('make');
    if (!model) missing.push('model');
    if (mileage === null) missing.push('mileage');
    if (price === null) missing.push('price');

    const title = `${year ?? ''} ${make} ${model}`.trim() || vin;

    if (seen.has(vin)) {
      issues.push(err('DUPLICATE_VIN_IN_FILE', `VIN ${vin} appears earlier in this file.`));
    }
    seen.add(vin);

    if (missing.length) {
      issues.push(err('MISSING_REQUIRED', `No ${missing.join(', ')}.`));
    }

    const body = toBodyStyle(cell(row, 'bodyStyle') ?? trim);
    if (!body.value) {
      issues.push(err('BODY_STYLE_UNRECOGNISED',
        `Body style "${cell(row, 'bodyStyle') ?? ''}" is not one we recognise.`));
    } else if (!body.exact) {
      issues.push(warn('BODY_STYLE_APPROXIMATED',
        `"${cell(row, 'bodyStyle')}" filed as ${body.value} — closest of the eight we have.`));
    }

    if (issues.some((x) => x.severity === 'error') || !body.value) {
      planned.push({ line, vin, title, action: 'skip', draft: null, issues });
      return;
    }

    const transmission = toTransmission(cell(row, 'transmission'));
    if (!transmission) {
      // The column is nullable, so the unit goes out with no transmission at all
      // rather than asserting one. Still a warning: a blank spec is a blank a
      // human can fill, and it is the only place they will be told.
      issues.push(warn('TRANSMISSION_UNKNOWN',
        `Transmission "${cell(row, 'transmission') ?? ''}" not recognised — left blank rather than guessed.`));
    }

    const drivetrain = toDrivetrain(cell(row, 'drivetrain'), trim, cell(row, 'engine'));
    if (!drivetrain) {
      // Default is FWD. On a pickup that is simply wrong.
      issues.push(warn('DRIVETRAIN_UNKNOWN', 'No drivetrain found — will default to front-wheel drive.'));
    }

    let stockNumber = (cell(row, 'stockNumber') ?? '').trim();
    if (!stockNumber) {
      stockNumber = deriveStockNumber(vin);
      issues.push(warn('STOCK_NUMBER_DERIVED',
        `No stock number in the file — using ${stockNumber}, the last six of the VIN.`));
    }

    const { text: description, removed } = cleanDescription(cell(row, 'description'));
    if (removed.length) {
      issues.push(warn('CONTACT_INFO_REMOVED', `Removed from the description — ${removed.join('; ')}.`));
    }

    const options = splitList(cell(row, 'options'));
    if (options.length > OPTIONS_SPEC_DUMP_THRESHOLD) {
      issues.push(warn('OPTIONS_SPEC_DUMP',
        `${options.length} options — this column is a factory spec sheet, not selling points.`));
    }

    const photoUrls = splitUrls(cell(row, 'photos'));
    if (photoUrls.length === 0) {
      issues.push(warn('NO_PHOTOS', 'No photos in the file.'));
    } else {
      const hosts = new Set(photoUrls.map((u) => { try { return new URL(u).host; } catch { return ''; } }));
      issues.push(warn('PHOTOS_OFF_SITE',
        `${photoUrls.length} photo${photoUrls.length === 1 ? '' : 's'} hosted on ${[...hosts].join(', ')} — ` +
        'these stay live only as long as that account does.'));
    }

    const draft: VehicleDraft = {
      vin,
      stockNumber,
      year: year!,
      make,
      model,
      trim,
      bodyStyle: body.value,
      doors: toDoors(cell(row, 'doors'), trim) ?? undefined,
      engine: (cell(row, 'engine') ?? cell(row, 'cylinders') ?? '').trim(),
      cylinders: toCylinders(cell(row, 'cylinders'), cell(row, 'engine')) ?? undefined,
      transmission: transmission ?? undefined,
      drivetrain: drivetrain ?? undefined,
      fuelType: toFuelType(cell(row, 'fuelType')) ?? undefined,
      exteriorColor: (cell(row, 'exteriorColor') ?? '').trim(),
      interiorColor: (cell(row, 'interiorColor') ?? '').trim(),
      mileage: mileage!,
      price: price!,
      salePrice: toMoney(cell(row, 'salePrice')) ?? undefined,
      msrp: toMoney(cell(row, 'msrp')) ?? undefined,
      description,
      options,
      photoUrls,
    };

    planned.push({
      line,
      vin,
      title,
      action: existing.has(vin) ? 'update' : 'create',
      draft,
      issues,
    });
  });

  return {
    rows: planned,
    summary: {
      total: planned.length,
      create: planned.filter((r) => r.action === 'create').length,
      update: planned.filter((r) => r.action === 'update').length,
      skip: planned.filter((r) => r.action === 'skip').length,
      warnings: planned.reduce((n, r) => n + r.issues.filter((i) => i.severity === 'warning').length, 0),
      photos: planned.reduce((n, r) => n + (r.draft?.photoUrls.length ?? 0), 0),
    },
  };
}

/**
 * What status an imported row lands in. Pure, so it can be tested and so the
 * rule is stated once rather than inlined in the writer.
 *
 * ARRIVED is never right: an imported lot is already for sale somewhere else —
 * that is the entire reason we have the file — and ARRIVED syndicates nothing,
 * so the dealer would have to touch every row to fix it.
 *
 * Between the other two, the photos decide, and only the photos. The first
 * version landed everything in PHOTOS_PENDING on the reasoning that
 * FRONT_LINE_READY is a claim about recon nobody made. The first real migration
 * showed that backwards twice:
 *
 *   - The storefront badges PHOTOS_PENDING as "Photos being shot". Units came in
 *     with 16, 23, 26 and 27 photos each, and every card claimed a photographer
 *     was on the way.
 *   - Both `src/lib/cargurus/feed-spec.ts` and `src/lib/meta/feed-spec.ts`
 *     exclude PHOTOS_PENDING, on the reasoning that such a unit has no photo set
 *     and the marketplace requires one. An imported unit with 27 photos breaks
 *     that assumption, so the units the dealer most wanted syndicated were
 *     exactly the ones that never went out.
 *
 * A row that arrived with photos is, on the evidence in the file, already
 * merchandised and already retailing — the dealer's other site is showing these
 * exact pictures. That is not a claim we invent; it is the one the file makes.
 * A row that arrived with none genuinely is waiting on photos.
 */
export function importStatus(photoCount: number): 'FRONT_LINE_READY' | 'PHOTOS_PENDING' {
  return photoCount > 0 ? 'FRONT_LINE_READY' : 'PHOTOS_PENDING';
}
