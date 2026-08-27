import { normaliseVin } from '@/lib/intake/parse';

/**
 * Turning somebody else's inventory export into our vehicles.
 *
 * THE SHAPE OF THE PROBLEM, from the first real file we were handed — twenty-one
 * trucks exported from CarsForSale:
 *
 *   - `StockNumber` is **blank on every row.** Ours is `NOT NULL` and CarGurus
 *     lists it required, so it has to be derived — and derived *stably*, because
 *     a nightly re-import that invents a new stock number each night is a lot
 *     full of duplicates.
 *   - `Cylinders` contains `"3.6L V6"`. It is not a count and never was.
 *   - `BodyStyle` contains `"Chassis"`, which is not one of our eight and is not
 *     one of anybody's eight.
 *   - `Transmission` contains `"Unspecified"`, which must not become
 *     `AUTOMATIC` silently on a manual truck.
 *   - `Description` is markdown carrying the dealer's own name, street address
 *     and phone number. Autotrader audits listings for exactly that.
 *   - `images` is forty comma-separated URLs on the *competitor's* CDN.
 *
 * None of those are exotic. They are what an export looks like, and every one of
 * them is silent: the import succeeds and the data is wrong. So this module's
 * job is not really mapping — it is being loud about what it had to guess.
 *
 * Pure. No database, no network. `plan()` takes rows and returns what would
 * happen; nothing here writes anything.
 */

/* ------------------------------------------------------------------ fields */

export type ImportField =
  | 'vin' | 'stockNumber' | 'year' | 'make' | 'model' | 'trim'
  | 'bodyStyle' | 'doors' | 'engine' | 'cylinders' | 'transmission'
  | 'drivetrain' | 'fuelType' | 'exteriorColor' | 'interiorColor'
  | 'mileage' | 'price' | 'salePrice' | 'msrp'
  | 'description' | 'options' | 'photos';

type FieldSpec = {
  key: ImportField;
  label: string;
  /** A row without this cannot become a vehicle. */
  required: boolean;
  /** Lowercased, punctuation-stripped header names we recognise. */
  synonyms: string[];
};

/**
 * The catalog the header sniffer works from.
 *
 * Synonyms are deliberately generous and deliberately not clever: matching is
 * exact against a normalised header, never fuzzy. A fuzzy matcher that maps
 * `Cost` to `price` is worse than no matcher at all, because the operator
 * confirming the mapping reads a plausible-looking screen and clicks through.
 */
export const IMPORT_FIELDS: FieldSpec[] = [
  { key: 'vin', label: 'VIN', required: true, synonyms: ['vin', 'vinnumber', 'vehicleidentificationnumber', 'serialnumber'] },
  { key: 'stockNumber', label: 'Stock number', required: false, synonyms: ['stocknumber', 'stock', 'stockno', 'stockid', 'inventoryid', 'dealerstocknumber'] },
  { key: 'year', label: 'Year', required: true, synonyms: ['year', 'modelyear', 'vehicleyear', 'yr'] },
  { key: 'make', label: 'Make', required: true, synonyms: ['make', 'manufacturer', 'brand'] },
  { key: 'model', label: 'Model', required: true, synonyms: ['model', 'modelname'] },
  { key: 'trim', label: 'Trim', required: false, synonyms: ['trim', 'trimlevel', 'series', 'style', 'stylename'] },
  { key: 'bodyStyle', label: 'Body style', required: false, synonyms: ['bodystyle', 'body', 'bodytype', 'vehicletype', 'category', 'segment'] },
  { key: 'doors', label: 'Doors', required: false, synonyms: ['doors', 'doorcount', 'numberofdoors'] },
  { key: 'engine', label: 'Engine', required: false, synonyms: ['engine', 'enginedescription', 'enginesize', 'enginetype', 'motor'] },
  { key: 'cylinders', label: 'Cylinders', required: false, synonyms: ['cylinders', 'cylinder', 'cyl', 'enginecylinders'] },
  { key: 'transmission', label: 'Transmission', required: false, synonyms: ['transmission', 'trans', 'transmissiontype', 'transmissiondescription'] },
  { key: 'drivetrain', label: 'Drivetrain', required: false, synonyms: ['drivetrain', 'drive', 'drivetype', 'driveline', 'drivewheels', 'wheeldrive'] },
  { key: 'fuelType', label: 'Fuel type', required: false, synonyms: ['fueltype', 'fuel'] },
  { key: 'exteriorColor', label: 'Exterior color', required: false, synonyms: ['exteriorcolor', 'extcolor', 'exterior', 'color', 'colour', 'exteriorcolour'] },
  { key: 'interiorColor', label: 'Interior color', required: false, synonyms: ['interiorcolor', 'intcolor', 'interior', 'interiorcolour'] },
  { key: 'mileage', label: 'Mileage', required: true, synonyms: ['mileage', 'miles', 'odometer', 'odometerreading', 'km'] },
  { key: 'price', label: 'Price', required: true, synonyms: ['price', 'askingprice', 'sellingprice', 'listprice', 'internetprice', 'retailprice', 'saleprice'] },
  { key: 'salePrice', label: 'Sale price', required: false, synonyms: ['specialprice', 'discountprice', 'saleprice2'] },
  { key: 'msrp', label: 'MSRP', required: false, synonyms: ['msrp', 'listprice2', 'originalprice', 'stickerprice'] },
  { key: 'description', label: 'Description', required: false, synonyms: ['description', 'comments', 'dealercomments', 'sellercomments', 'notes', 'detail', 'details'] },
  { key: 'options', label: 'Options', required: false, synonyms: ['options', 'optiontext', 'features', 'equipment', 'standardoptions', 'installedoptions'] },
  { key: 'photos', label: 'Photos', required: false, synonyms: ['images', 'image', 'imageurls', 'photos', 'photourls', 'pictures', 'imageurl', 'pictureurls'] },
];

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export type Mapping = Partial<Record<ImportField, string>>;

/**
 * Guess which column is which. Always shown to a human before anything is
 * written — the guess is a starting point, not a decision.
 *
 * First match wins and a header is never used twice, so a file carrying both
 * `Price` and `SalePrice` puts each where it belongs instead of both racing for
 * `price`.
 */
export function inferMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const taken = new Set<string>();
  for (const spec of IMPORT_FIELDS) {
    const hit = headers.find((h) => !taken.has(h) && spec.synonyms.includes(normHeader(h)));
    if (hit) {
      mapping[spec.key] = hit;
      taken.add(hit);
    }
  }
  return mapping;
}

export function unmappedRequired(mapping: Mapping): ImportField[] {
  return IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.key);
}

/* ------------------------------------------------------------- normalisers */

export type BodyStyle = 'SEDAN' | 'SUV' | 'TRUCK' | 'COUPE' | 'HATCHBACK' | 'WAGON' | 'VAN' | 'CONVERTIBLE';
export type Transmission = 'AUTOMATIC' | 'MANUAL' | 'CVT';
export type Drivetrain = 'FWD' | 'RWD' | 'AWD' | 'FOUR_WD';
export type FuelType = 'GAS' | 'DIESEL' | 'HYBRID' | 'PLUGIN_HYBRID' | 'ELECTRIC' | 'FLEX';

/** Strip currency, thousands separators and cents. `"$13,999.00"` → `13999`. */
export function toMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Math.round(Number(cleaned));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Mileage, which unlike price is legitimately allowed to be zero. */
export function toMileage(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function toYear(raw: string | undefined): number | null {
  const n = Number((raw ?? '').replace(/[^0-9]/g, ''));
  // Anything outside this is a parse accident, not an old car.
  return n >= 1900 && n <= 2100 ? n : null;
}

/**
 * `"Chassis"` is the interesting one. It is a cab-and-frame with no bed — a
 * flatbed or a box truck before the body goes on — and there is no honest home
 * for it in an eight-value enum. TRUCK is the least wrong answer and the caller
 * gets told we guessed.
 */
export function toBodyStyle(raw: string | undefined): { value: BodyStyle | null; exact: boolean } {
  const s = (raw ?? '').toLowerCase();
  if (!s.trim()) return { value: null, exact: false };
  const exact = (v: BodyStyle) => ({ value: v, exact: true });
  if (/\bconvertible|roadster|cabriolet\b/.test(s)) return exact('CONVERTIBLE');
  if (/\bsuv\b|sport utility|crossover|\bcuv\b/.test(s)) return exact('SUV');
  if (/pickup|\btruck\b|crew cab|regular cab|extended cab/.test(s)) return exact('TRUCK');
  if (/minivan|\bvan\b|cargo van|passenger van/.test(s)) return exact('VAN');
  if (/hatchback|\bhatch\b|liftback/.test(s)) return exact('HATCHBACK');
  if (/wagon|estate|sportwagen/.test(s)) return exact('WAGON');
  if (/coupe|\b2dr\b|two door/.test(s)) return exact('COUPE');
  if (/sedan|saloon|\b4dr\b|four door/.test(s)) return exact('SEDAN');
  // Chassis cab, box truck, cutaway — a truck by every practical measure.
  if (/chassis|cutaway|box truck|flatbed|cab and chassis/.test(s)) return { value: 'TRUCK', exact: false };
  return { value: null, exact: false };
}

/**
 * Never defaults. `"Unspecified"` is a real value in the wild and turning it
 * into AUTOMATIC puts a manual truck on four marketplaces as an automatic,
 * which is the kind of thing a buyer discovers on the test drive.
 */
export function toTransmission(raw: string | undefined): Transmission | null {
  const s = (raw ?? '').toLowerCase();
  if (!s.trim() || /unspecified|unknown|n\/a/.test(s)) return null;
  if (/\bcvt\b|continuously variable/.test(s)) return 'CVT';
  if (/manual|\bmt\b|stick|\d-speed manual/.test(s)) return 'MANUAL';
  if (/auto|\bat\b|tiptronic|dsg|pdk/.test(s)) return 'AUTOMATIC';
  return null;
}

export function toFuelType(raw: string | undefined): FuelType | null {
  const s = (raw ?? '').toLowerCase();
  if (!s.trim()) return null;
  // Plug-in before hybrid: "Plug-In Hybrid" contains "hybrid".
  if (/plug.?in/.test(s)) return 'PLUGIN_HYBRID';
  if (/hybrid/.test(s)) return 'HYBRID';
  if (/electric|\bev\b|battery/.test(s)) return 'ELECTRIC';
  if (/diesel|\btdi\b|duramax|powerstroke|cummins/.test(s)) return 'DIESEL';
  if (/flex|\be85\b|ffv/.test(s)) return 'FLEX';
  if (/gas|petrol|unleaded|regular|premium/.test(s)) return 'GAS';
  return null;
}

/**
 * Drivetrain, from a dedicated column when there is one and otherwise from the
 * trim string — which is where it actually lives in this file. Every Malabar row
 * carries `4x4` or `4WD` inside `Trim` and nowhere else.
 */
export function toDrivetrain(...sources: (string | undefined)[]): Drivetrain | null {
  const s = sources.filter(Boolean).join(' ').toLowerCase();
  if (!s.trim()) return null;
  if (/\b4x4\b|\b4wd\b|four.?wheel|\bfour_wd\b/.test(s)) return 'FOUR_WD';
  if (/\bawd\b|all.?wheel/.test(s)) return 'AWD';
  if (/\brwd\b|rear.?wheel|\b4x2\b/.test(s)) return 'RWD';
  if (/\bfwd\b|front.?wheel/.test(s)) return 'FWD';
  return null;
}

/** `"4dr Crew Cab"` → 4. Also reads a bare numeric column. */
export function toDoors(...sources: (string | undefined)[]): number | null {
  for (const src of sources) {
    if (!src) continue;
    const bare = src.trim();
    if (/^\d$/.test(bare)) return Number(bare);
    const m = bare.match(/(\d)\s*(?:dr|door)/i);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * `"3.6L V6"` → 6. The column is named `Cylinders` and contains displacement,
 * so reading it as a number gives you 3 — a three-cylinder Silverado.
 */
export function toCylinders(...sources: (string | undefined)[]): number | null {
  for (const src of sources) {
    if (!src) continue;
    const config = src.match(/\b[VvIiLlWwHh][- ]?(\d{1,2})\b/);
    if (config) {
      const n = Number(config[1]);
      if (n >= 2 && n <= 16) return n;
    }
    const labelled = src.match(/(\d{1,2})\s*(?:cyl|cylinder)/i);
    if (labelled) return Number(labelled[1]);
    // A bare number is only a cylinder count if it is plausible as one. This is
    // what stops "3.6" becoming three.
    const bare = src.trim();
    if (/^\d{1,2}$/.test(bare)) {
      const n = Number(bare);
      if (n >= 2 && n <= 16) return n;
    }
  }
  return null;
}

/** Comma or pipe separated lists, deduped, blanks dropped. */
export function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  const parts = raw.split(/[|;]|,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts)];
}

/** Image URL lists. Split on commas/pipes/whitespace, keep only http(s). */
export function splitUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const parts = raw.split(/[\s,|]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(parts.filter((u) => /^https?:\/\//i.test(u)))];
}

/**
 * The label comes out with the value.
 *
 * Stripping just the digits out of `**Phone: 321-390-4793**` leaves `Phone:`
 * sitting in the ad copy, and out of `(Call: 321-390-4793)` it leaves `(Call: )`.
 * Both read as a bug to whoever sees the listing, which is worse than the
 * problem being solved. So the optional label is part of the match.
 */
const PHONE_LABEL = '(?:\\b(?:phone|tel|telephone|call|text|cell|mobile|contact)\\b\\s*[:#-]?\\s*)?';
const PHONE = new RegExp(`${PHONE_LABEL}(?:\\+?1[-. ]?)?\\(?\\d{3}\\)?[-. ]?\\d{3}[-. ]?\\d{4}`, 'gi');
const EMAIL = /(?:\b(?:e-?mail|contact)\b\s*[:#-]?\s*)?[\w.+-]+@[\w-]+\.[\w.]+/gi;
const URL = /(?:\b(?:web|site|website|visit)\b\s*[:#-]?\s*)?(?:https?:\/\/\S+|\bwww\.\S+)/gi;

/**
 * A US street address. The Malabar descriptions lead with the dealership's own,
 * and an address is contact information exactly like a phone number is — the
 * marketplace policies that object to one object to both.
 *
 * Anchored on a street-type suffix AND on each word of the street name being
 * capitalised. Both matter: without the suffix it eats numbers out of prose,
 * and case-insensitively "20 years on the road" is a street address. Do not add
 * an `i` flag here — the capitalisation is load-bearing, not incidental.
 */
const STREET = /(?:\b(?:[Ll]ocation|[Aa]ddress|[Ll]ocated\s+at|[Ff]ind\s+us(?:\s+at)?|[Vv]isit\s+us(?:\s+at)?)\b\s*[:#-]?\s*)?\b\d{2,6}\s+(?:[A-Z][\w.'-]*\s+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Hwy|Highway|Ln|Lane|Pkwy|Parkway|Way|Ct|Court|Cir|Circle|Pl|Place|Trl|Trail)\b\.?(?:\s*,?\s*[A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)*\s*,?\s*[A-Z]{2}(?:\s+\d{5})?)?/g;

/**
 * Strip markdown and the dealer's own contact details out of a description.
 *
 * Every marketplace in this category has a rule about this and Autotrader
 * reserves the right to pull listings over it. The Malabar descriptions open
 * with the dealership's name, street address and phone number in markdown —
 * useful on their own site, a policy problem the moment it is syndicated.
 *
 * Returns what was removed as well as the cleaned text, because "we quietly
 * edited your ad copy" is not something to do without saying so.
 */
export function cleanDescription(raw: string | undefined): { text: string; removed: string[] } {
  if (!raw) return { text: '', removed: [] };
  const removed: string[] = [];

  let s = raw;
  for (const [label, re] of [
    ['phone number', PHONE],
    ['email address', EMAIL],
    ['web address', URL],
    ['street address', STREET],
  ] as const) {
    const hits = s.match(re);
    if (hits?.length) {
      const uniq = [...new Set(hits.map((h) => h.trim()))];
      removed.push(`${label}${uniq.length > 1 ? ` \u00d7${uniq.length}` : ''}: ${uniq.join(', ')}`);
    }
    s = s.replace(re, ' ');
  }

  // Whatever the removals left holding nothing: "( )", "[ ]", a lone bullet, a
  // label with no value after it, doubled punctuation.
  s = s
    .replace(/\(\s*[:\-–]?\s*\)/g, ' ')
    .replace(/\[\s*[:\-–]?\s*\]/g, ' ')
    .replace(/[|·•]\s*(?=[|·•\n]|$)/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,;:])\s*(?=[,.;:])/g, '');

  s = s
    .replace(/^#{1,6}\s*/gm, '')          // headings
    .replace(/\*\*(.*?)\*\*/g, '$1')      // bold
    .replace(/\*(.*?)\*/g, '$1')          // italic
    .replace(/^[-*]\s+/gm, '• ')          // bullets
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return { text: s, removed };
}

/**
 * A stock number for a row that has none.
 *
 * MUST BE DERIVED FROM THE VIN AND NOTHING ELSE. A counter, a timestamp or a
 * random suffix all produce a different number on tonight's import than on
 * last night's, and the next re-import of an unchanged lot then looks like
 * twenty-one changed vehicles. Same VIN in, same stock number out, forever.
 *
 * The last six of a VIN is the sequential serial the factory assigned, which is
 * what most dealers write on the windshield anyway.
 */
export function deriveStockNumber(vin: string): string {
  return vin.trim().toUpperCase().slice(-6);
}
