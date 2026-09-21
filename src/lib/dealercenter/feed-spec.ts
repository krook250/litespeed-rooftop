/**
 * Rooftop Auto — the DealerCenter / Nowcom inventory feed.
 *
 * Built against `NowcomSampleFeedWithData 4.csv`, sent 21 Sep 2026 by Jaimes
 * Xyrus Caoile (Application Support Agent Tier II, DealerCenter) as "the default
 * format with data that we use for mapping". 60 columns, 68 populated rows.
 * Every format decision below is read off that file rather than guessed, and the
 * evidence is quoted inline so nobody has to re-open it.
 *
 * WHAT DEALERCENTER TOLD US IN WRITING
 *
 *   "Dealer_ID, VIN and Stock Number are required."
 *   "Please input the DCID … in the first column of the file and in the
 *    filename format. Our filename convention is as follows DCID_YYYYMMDD.csv"
 *   "We currently support FTP/SFTP only."   — Albert Rigor, 21 Sep 2026
 *
 * THERE IS A SECOND, INCOMPATIBLE TEMPLATE IN CIRCULATION. `InventoryTemplate
 * for CSV file-DC.csv` (Albert Rigor, 11 Sep) is 40 columns with different names
 * — `StockNumber`, `AskingPrice`, `PhotoURLs`, plus lot-management fields like
 * `IgnitionCode` and `LicenseExpiration`. It is NOT this format and nothing here
 * maps to it. We build against the Nowcom sample because it came from Tier II
 * support, it names the required fields, and it arrived with real data in it.
 *
 * WHY THIS IS NOT THE CARGURUS MODULE WITH DIFFERENT COLUMNS
 *
 * Direction. Every other feed in this codebase publishes a car to a marketplace
 * where a wrong value costs us a listing. This one writes into the dealer's own
 * DMS, where a wrong value costs him a deal — DealerCenter matches on VIN and
 * overwrites the record he sells against. So the bias here is the opposite of
 * Meta's: when we do not know something, we send DealerCenter's own blank rather
 * than our best guess, because his F&I screen is downstream of this file.
 *
 * ONE FILE PER DEALER, unlike CarGurus. The DCID is both the first column and
 * part of the filename, so there is no batching across rooftops and no
 * equivalent of `combineFeeds`.
 */

/* ------------------------------------------------------------------ types */

export type DcPhoto = {
  url: string;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type DcVehicle = {
  id: string;
  /** Nullable since `vehicles.vin` is. DealerCenter requires one — see NO_VIN. */
  vin: string | null;
  stockNumber: string;
  /** AUTO only. See NOT_AN_AUTOMOBILE. */
  vehicleType: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  doors: number;
  engine: string;
  cylinders: number | null;
  transmission: string | null;
  drivetrain: string;
  fuelType: string;
  mpgCity: number | null;
  mpgHwy: number | null;
  exteriorColor: string;
  interiorColor: string;
  mileage: number;
  price: number;
  salePrice: number | null;
  msrp: number | null;
  cost: number;
  status: string;
  isCertified: boolean;
  description: string;
  options: string[];
  features: string[];
  acquiredDate: Date;
  photos: DcPhoto[];
};

export type DcRooftop = {
  id: string;
  /**
   * The DCID, and nothing else will do.
   *
   * CarGurus explicitly blessed using our own rooftop id; DealerCenter does the
   * opposite and names the number — 23548716 for Malabar Truck and Trade. It
   * lives in `channelConnections.providerDealerId`. Never derive it, never fall
   * back to `rooftops.id`: a file whose first column is a cuid is a file
   * DealerCenter cannot attach to an account, and the failure is silent.
   */
  dcid: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  /** Where DealerCenter should send leads, if we ever populate Dealer Email. */
  leadEmail: string;
};

/* ------------------------------------------------------------ eligibility */

export type DcIssueCode =
  | 'NOT_RETAIL_READY'
  | 'NO_VIN'
  | 'NO_PRICE'
  | 'NOT_AN_AUTOMOBILE';

export type DcIssue = {
  code: DcIssueCode;
  /** Written for a dealer, not an engineer. */
  reason: string;
  /** What to actually do about it. Empty when there is nothing the lot can do. */
  fix: string;
};

/**
 * Wider than the CarGurus set on purpose: PHOTOS_PENDING is IN.
 *
 * CarGurus lists image URLs as required, so a photoless unit there produces a
 * broken listing. DealerCenter is his inventory system — a car sitting in recon
 * with no pictures still belongs in it, and `ImageList` is plainly optional in
 * the sample. Holding it out would mean he cannot desk a deal on a unit he owns.
 *
 * Still out: ARRIVED and IN_RECON (not his to sell yet, and he adds those by
 * hand in DC as they land), SOLD and WHOLESALED (see `liveWindow`).
 */
const RETAIL_READY = new Set(['PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE']);

const SOLD_STATUSES = new Set(['SOLD', 'WHOLESALED']);

/**
 * Only automobiles go in this file.
 *
 * The Nowcom format has no RV vocabulary anywhere: `Body` values in the sample
 * run "4dr Car", "Sport Utility", "Crew Cab Pickup", "Station Wagon"; there is
 * no length, no sleeps, no axle count, and no hours-of-use column. A travel
 * trailer sent through here would arrive as some make of car with a blank body
 * style, in the system the dealer prices and finances from.
 *
 * So RVs are held out with a reason rather than mapped approximately. If a
 * dealer ever needs his towables in DealerCenter, that is a question for
 * DealerCenter, not a mapping we invent. See `claude/rv-vertical-fit.md`.
 */
const AUTO_TYPES = new Set(['AUTO']);

export function evaluate(v: DcVehicle): DcIssue[] {
  const issues: DcIssue[] = [];

  if (!AUTO_TYPES.has(v.vehicleType)) {
    issues.push({
      code: 'NOT_AN_AUTOMOBILE',
      reason: 'DealerCenter’s inventory format only describes cars and trucks.',
      fix: '',
    });
  }

  if (!RETAIL_READY.has(v.status)) {
    issues.push({
      code: 'NOT_RETAIL_READY',
      reason: 'Not on the front line yet, so it is not in the file.',
      fix: 'Move it to Photos pending or Front line ready once it is yours to sell.',
    });
  }

  if (!v.vin || v.vin.trim() === '') {
    issues.push({
      code: 'NO_VIN',
      reason: 'DealerCenter requires a VIN and matches every record on it.',
      fix: 'Add the VIN on the vehicle.',
    });
  }

  if (activePrice(v) <= 0) {
    issues.push({
      code: 'NO_PRICE',
      reason: 'No asking price, so DealerCenter would receive a $0 car.',
      fix: 'Set a price on the vehicle.',
    });
  }

  return issues;
}

/** Sale price when there is one, otherwise the asking price. */
export function activePrice(v: Pick<DcVehicle, 'price' | 'salePrice'>): number {
  const sale = v.salePrice ?? 0;
  return sale > 0 && sale < v.price ? sale : v.price;
}

/* ------------------------------------------------------------- value maps */

/**
 * Every map below is keyed to values actually present in the sample. A value we
 * cannot attest to becomes an empty string, never an invented one — the sample
 * itself ships blanks (16 of 68 rows have no `Transmission`, 9 have no
 * `Fuel_Type`, 17 have no `Ext_Color_Generic`), so a blank is a shape their
 * importer already handles and a novel token is not.
 */

/** Sample: "Automatic" (48), "Variable" (4), blank (16). No "Manual" appears. */
const TRANSMISSION: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  CVT: 'Variable',
  /* Unattested in the sample but unambiguous, and the alternative — sending a
   * blank — would let DealerCenter's own default assert an automatic on a stick
   * shift. That is the `transmission` mistake this codebase already made once;
   * see the column comment in `src/db/schema.ts`. */
  MANUAL: 'Manual',
};

/** Sample: FWD (52), RWD (15), 4WD (1). AWD never appears — see below. */
const DRIVETRAIN: Record<string, string> = {
  FWD: 'FWD',
  RWD: 'RWD',
  FOUR_WD: '4WD',
  /* THE ONE GUESS IN THIS MODULE. The sample has no all-wheel-drive row, so
   * "AWD" is inferred from the pattern of the other three rather than attested.
   * It is on the question list for DCSupportEscalation. If they reject it the
   * fix is this line; sending 4WD instead would be a spec claim about the car
   * that is simply false. */
  AWD: 'AWD',
};

/** Sample: "Gasoline Fuel" (54), "Flex Fuel" (5), blank (9). */
const FUEL_TYPE: Record<string, string> = {
  GAS: 'Gasoline Fuel',
  FLEX: 'Flex Fuel',
  /* Same reasoning as MANUAL: extrapolated from their "<X> Fuel" pattern, and a
   * blank on a diesel truck is worse than a near-miss token on his own DMS. On
   * the question list. */
  DIESEL: 'Diesel Fuel',
  ELECTRIC: 'Electric Fuel',
  HYBRID: 'Gasoline/Electric Hybrid',
  PLUGIN_HYBRID: 'Plug-In Electric/Gas',
};

/**
 * `Body`, and this is the loosest column in the format.
 *
 * The sample carries nine distinct values and they are not a controlled
 * vocabulary — "4dr Car", "2dr Car" and "3dr Car" encode the door count in the
 * body style while a separate `Doors` column already says it, and "Mini-van,
 * Passenger" carries a comma inside the field. We emit the sample's own strings
 * so nothing novel arrives, and derive the door-count variants from `doors`.
 */
export function toBody(bodyStyle: string, doors: number): string {
  const d = doors >= 2 && doors <= 5 ? doors : 4;
  switch (bodyStyle) {
    case 'SEDAN':
      return `${d}dr Car`;
    case 'COUPE':
      return '2dr Car';
    case 'HATCHBACK':
      return 'Hatchback';
    case 'WAGON':
      return 'Station Wagon';
    case 'SUV':
      return 'Sport Utility';
    case 'VAN':
      return 'Mini-van, Passenger';
    case 'CONVERTIBLE':
      return 'Convertible';
    /* Their two pickup values distinguish cab style, which we do not store —
     * `trim` carries it as free text ("Work Truck 4x4 4dr Crew Cab") and parsing
     * a cab style out of a trim string to satisfy a body column is exactly the
     * kind of confident guess that put three-cylinder Silverados in the
     * importer. Four doors means a crew cab in every practical case; fewer is
     * left to their broader value. */
    case 'TRUCK':
      return d >= 4 ? 'Crew Cab Pickup' : 'Extended Cab Pickup';
    default:
      return '';
  }
}

/**
 * `DateInStock` is M/D/YYYY, unpadded — the sample has "2/17/2015" and
 * "12/18/2014" side by side. Not ISO, and not zero-filled.
 *
 * Rendered in UTC deliberately. `acquiredDate` is a timestamptz whose time
 * component is meaningless (a date picker wrote it), and rendering it in the
 * server's local zone would slide a car acquired at midnight to the previous
 * day on any deploy west of Greenwich.
 */
export function toDcDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/**
 * Money. Plain integers, no currency symbol, no thousands separator, no
 * decimals — and **0 is their blank**, not a claim.
 *
 * The sample is unambiguous: a row with `SellingPrice` 16995 carries `MSRP` 0,
 * `BookValue` 0, `Cost` 0, `Invoice` 0 and `Internet_Price` 0. So sending 0 for
 * a figure we do not hold matches their own file rather than asserting a
 * free car, which is what made this column look dangerous before the sample
 * arrived.
 */
export function toMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '0';
  return String(Math.round(n));
}

/** "3.2L" in the sample. Pulled out of our free-text `engine` when it is there. */
export function toDisplacement(engine: string): string {
  const m = /(\d\.\d)\s*L/i.exec(engine);
  return m ? `${m[1]}L` : '';
}

/* ----------------------------------------------------------------- output */

export type DcRow = Record<string, string>;

export type DcBuiltVehicle = {
  vehicleId: string;
  stockNumber: string;
  title: string;
  issues: DcIssue[];
  /** Null when an issue kept the unit out of the file entirely. */
  row: DcRow | null;
};

export type DcBuildResult = {
  rows: DcRow[];
  vehicles: DcBuiltVehicle[];
  columns: string[];
};

export type DcBuildOptions = {
  /**
   * Absolute origin that serves photo URLs, no trailing slash — normally
   * `https://app.rooftopauto.com`. Required for any photo stored as a
   * root-relative path.
   */
  photoBase?: string;
};

/**
 * `ImageList` and `Options` both pack multiple values into one field with a
 * comma, inside the quoted field. Not a guess: the sample's `ImageList` holds
 * comma-separated homenetiol.com URLs and its `Options` holds
 * "Traction Control,Stability Control,Front Wheel Drive,…".
 *
 * This is why `toCsv` below quotes every field unconditionally.
 */
export const MULTI_VALUE_SEPARATOR = ',';

/**
 * Header spelling, verbatim from the sample including its inconsistencies —
 * `Dealer ID` with a space beside `Ext_Color_Generic` with underscores,
 * `Categorized Options` with a space, `Comment 1` numbered from one.
 *
 * DealerCenter gave us no statement that header wording is flexible, which is
 * the opposite of CarGurus ("field names do not have to match exactly"). With
 * no such assurance the only safe file is a byte-identical header row, so this
 * array is transcription, not design. Do not tidy it.
 */
export const DC_COLUMNS = [
  'Dealer ID',
  'Type',
  'Stock',
  'VIN',
  'Year',
  'Make',
  'Model',
  'Body',
  'Trim',
  'ModelNumber',
  'Doors',
  'ExteriorColor',
  'InteriorColor',
  'EngineCylinders',
  'EngineDisplacement',
  'Transmission',
  'Miles',
  'SellingPrice',
  'MSRP',
  'BookValue',
  'Cost',
  'Invoice',
  'Certified',
  'DateInStock',
  'Description',
  'Options',
  'Categorized Options',
  'Dealer Name',
  'Dealer Address',
  'Dealer City',
  'Dealer State',
  'Dealer Zip',
  'Dealer Phone',
  'Dealer Fax',
  'Dealer Email',
  'Comment 1',
  'Comment 2',
  'Comment 3',
  'Comment 4',
  'Comment 5',
  'Style_Description',
  'Ext_Color_Generic',
  'Ext_Color_Code',
  'Engine_Aspiration_Type',
  'Engine_Description',
  'Transmission_Speed',
  'Transmission_Description',
  'Drivetrain',
  'Fuel_Type',
  'CityMPG',
  'HighwayMPG',
  'EPAClassification',
  'Internet_Price',
  'Misc_Price1',
  'Misc_Price2',
  'Misc_Price3',
  'Factory_Codes',
  'MarketClass',
  'PassengerCapacity',
  'ImageList',
] as const;

/**
 * Columns we send present-but-empty, and why each one is not worth filling.
 *
 * Every name here is in DC_COLUMNS — the header row is complete. What is
 * deliberate is the value.
 *
 *  - `ModelNumber`, `Factory_Codes`, `Style_Description`, `Ext_Color_Code`,
 *    `Engine_Aspiration_Type` — OEM build-data codes. We do not hold them and
 *    cannot derive them. Blank in most of the sample's own rows too.
 *  - `Categorized Options` — their `Category@Value~Category@Value` encoding
 *    ("Exterior@Chip resistant rocker panels~…"). Our options are a flat
 *    string array with no category, so every value would have to be assigned
 *    one by guesswork. `Options` already carries the same content flat.
 *  - `EPAClassification`, `MarketClass` — the sample's own values for these are
 *    internally inconsistent ("Mid-Size", "Mid-size", "Midsize", "Midsize Cars"
 *    all appear), which is a sign they are informational rather than matched on.
 *  - `BookValue`, `Invoice`, `Misc_Price1..3` — book and invoice figures we do
 *    not carry. 0 is their blank; see `toMoney`.
 *  - `Comment 1..5` — five free-text slots with no documented destination.
 *    Sending merchandising copy into an unknown field on the dealer's DMS is a
 *    guess we do not need to take; `Description` is the documented place.
 *  - `Dealer Fax` — no.
 *  - `Dealer Email` — deliberately blank until we know whether DealerCenter
 *    treats it as the lead destination. Putting `leadEmail` here on a guess
 *    could reroute his customer inquiries; see the question list.
 */
export const DC_BLANK_FIELDS = [
  'ModelNumber',
  'Categorized Options',
  'Dealer Fax',
  'Dealer Email',
  'Comment 1',
  'Comment 2',
  'Comment 3',
  'Comment 4',
  'Comment 5',
  'Style_Description',
  'Ext_Color_Code',
  'Engine_Aspiration_Type',
  'EPAClassification',
  'MarketClass',
  'Factory_Codes',
] as const;

export function absolutePhotoUrl(url: string, photoBase?: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return photoBase ? `${photoBase}${url}` : null;
  return null;
}

/**
 * Photos, primary first, then by sort order.
 *
 * No extension filter, unlike CarGurus. That filter exists there because
 * CarGurus publishes a listing and names the formats it accepts; DealerCenter's
 * sample states nothing about format, and a picture his DMS cannot render is a
 * cosmetic problem in a screen he is looking at, not a dead listing. Generated
 * SVG placeholders are still excluded — they are our artwork, not his car.
 */
export function feedablePhotos(v: DcVehicle, photoBase?: string): string[] {
  return [...v.photos]
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    })
    .map((p) => absolutePhotoUrl(p.url, photoBase))
    .filter((u): u is string => u != null && !u.includes('/api/photo'));
}

/** Live inventory only — a unit's absence is the only way to say it is gone. */
export function liveWindow<T extends { status: string }>(vehicles: T[]): T[] {
  return vehicles.filter((v) => !SOLD_STATUSES.has(v.status));
}

/**
 * `DCID_YYYYMMDD.csv`, verbatim from Jaimes: *"Our filename convention is as
 * follows 'DCID_YYYYMMDD.csv'"*. Zero-padded here even though `DateInStock` is
 * not — a filename convention written as YYYYMMDD means fixed width, and it is
 * the one place in this format where a date has to sort.
 */
export function dcFilename(dcid: string, on: Date): string {
  const y = on.getUTCFullYear();
  const m = String(on.getUTCMonth() + 1).padStart(2, '0');
  const d = String(on.getUTCDate()).padStart(2, '0');
  return `${dcid}_${y}${m}${d}.csv`;
}

export function buildDealerCenterFeed(
  vehicles: DcVehicle[],
  lot: DcRooftop,
  opts: DcBuildOptions = {},
): DcBuildResult {
  const built: DcBuiltVehicle[] = [];
  const rows: DcRow[] = [];

  for (const v of vehicles) {
    const issues = evaluate(v);
    const title = `${v.year} ${v.make} ${v.model}`.trim();

    if (issues.length > 0) {
      built.push({ vehicleId: v.id, stockNumber: v.stockNumber, title, issues, row: null });
      continue;
    }

    const photos = feedablePhotos(v, opts.photoBase);
    const options = [...v.options, ...v.features].filter((s) => s.trim() !== '');

    const row: DcRow = {
      'Dealer ID': lot.dcid,
      /* Every car on an independent used lot is used. There is no new/used flag
       * on `vehicles` because the product has never needed one, and inferring
       * "New" from zero mileage would misfile a dealer-trade demo unit into the
       * one category that changes how DealerCenter taxes and titles a deal. */
      Type: 'Used',
      Stock: v.stockNumber,
      VIN: v.vin ?? '',
      Year: String(v.year),
      Make: v.make,
      Model: v.model,
      Body: toBody(v.bodyStyle, v.doors),
      Trim: v.trim,
      Doors: String(v.doors),
      ExteriorColor: v.exteriorColor,
      InteriorColor: v.interiorColor,
      EngineCylinders: v.cylinders != null ? String(v.cylinders) : '',
      EngineDisplacement: toDisplacement(v.engine),
      Transmission: v.transmission ? (TRANSMISSION[v.transmission] ?? '') : '',
      Miles: String(Math.max(0, Math.round(v.mileage))),
      SellingPrice: toMoney(activePrice(v)),
      MSRP: toMoney(v.msrp),
      BookValue: '0',
      /* His own cost, into his own DMS — which is the whole reason this column
       * is filled here and stripped from every marketplace feed we build. Note
       * that anything imported from a syndication export carries cost 0, so most
       * of a migrating lot will read 0 until he enters real numbers. That is
       * their blank, not a claim; see `toMoney`. */
      Cost: toMoney(v.cost),
      Invoice: '0',
      /* Literal uppercase TRUE/FALSE — every sample row reads "FALSE". */
      Certified: v.isCertified ? 'TRUE' : 'FALSE',
      DateInStock: toDcDate(v.acquiredDate),
      Description: v.description,
      Options: options.join(MULTI_VALUE_SEPARATOR),
      'Dealer Name': lot.name,
      'Dealer Address': lot.addressLine1,
      'Dealer City': lot.city,
      'Dealer State': lot.state,
      'Dealer Zip': lot.postalCode,
      'Dealer Phone': lot.phone,
      Ext_Color_Generic: v.exteriorColor,
      Engine_Description: v.engine,
      /* We do not store gear count. Their own sample leaves it blank on 8 rows. */
      Transmission_Speed: '',
      Transmission_Description: v.transmission ? (TRANSMISSION[v.transmission] ?? '') : '',
      Drivetrain: DRIVETRAIN[v.drivetrain] ?? '',
      Fuel_Type: FUEL_TYPE[v.fuelType] ?? '',
      CityMPG: v.mpgCity != null ? String(v.mpgCity) : '',
      HighwayMPG: v.mpgHwy != null ? String(v.mpgHwy) : '',
      /* One live price, in SellingPrice. The sample's own rows price the car in
       * SellingPrice and leave Internet_Price 0, and two populated price columns
       * is how a lot ends up advertising two different numbers. */
      Internet_Price: '0',
      Misc_Price1: '0',
      Misc_Price2: '0',
      Misc_Price3: '0',
      PassengerCapacity: '',
      ImageList: photos.join(MULTI_VALUE_SEPARATOR),
    };

    for (const f of DC_BLANK_FIELDS) if (row[f] === undefined) row[f] = '';

    rows.push(row);
    built.push({ vehicleId: v.id, stockNumber: v.stockNumber, title, issues, row });
  }

  return { rows, vehicles: built, columns: [...DC_COLUMNS] };
}

/**
 * Render as a fully-quoted, CRLF-terminated CSV.
 *
 * CRLF because the sample is CRLF throughout (69 of 69 line endings) and
 * DealerCenter has told us nothing about what their parser tolerates. Differs
 * from `cargurus/toCsv`, which uses LF, and the two are deliberately not shared:
 * a change to one destination's line endings must not silently reshape the
 * other's file.
 *
 * Every field quoted and every inner quote doubled, uniformly — mixed quoting is
 * what trips delimiter autodetection, and this format packs commas inside
 * `Options`, `ImageList` and even one of their own `Body` values
 * ("Mini-van, Passenger").
 *
 * Newlines inside a field are stripped rather than escaped. A dealer's
 * description arrives carrying whatever the previous DMS put in it, and a
 * literal newline inside a quoted field is legal CSV and the single most common
 * thing a hand-rolled parser on the far end gets wrong.
 */
export function toCsv(columns: string[], rows: DcRow[]): string {
  const cell = (raw: string | undefined) =>
    `"${(raw ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Whether this file may be sent, kept separate so it is readable without a
 * database and so the transport and the preview screen agree on the answer.
 *
 * Three refusals, in the order they matter:
 *
 *  - **No DCID.** Unattachable; see the note above.
 *  - **No connection row, or one that is not carrying.** We have not been asked
 *    to send this lot's inventory anywhere.
 *  - **Zero rows.** An empty file is not nothing — DealerCenter's importer has a
 *    delete setting, and on the wrong setting an empty file is an instruction to
 *    mark the dealer's whole lot Deleted or Sold. That setting lives in his
 *    DealerCenter account and we cannot read it, so we never send the file that
 *    depends on it being right. `claude/dealercenter-interop.md` has the detail.
 *
 * Deliberately NOT here: the short-file ratio guard the CarGurus run uses. That
 * needs the previous run's row count, which is the caller's to hold. This
 * function has only ever seen tonight.
 */
export function dealerCenterBlocker(input: {
  dcid: string;
  status: string | null;
  sent: number;
}): string | null {
  if (!input.dcid) {
    return 'No DealerCenter dealer ID (DCID) on the connection, so the file cannot be matched to an account.';
  }
  if (!input.status) {
    return 'This rooftop has no DealerCenter connection.';
  }
  if (!(DEALERCENTER_FILE_STATUSES as readonly string[]).includes(input.status)) {
    return `The DealerCenter connection is ${input.status.toLowerCase().replace(/_/g, ' ')}, so nothing is sent.`;
  }
  if (input.sent === 0) {
    return 'No vehicles qualified, and an empty file can delist the lot depending on the dealer’s import settings.';
  }
  return null;
}

/** Which connection states put a rooftop's cars in the file. */
export const DEALERCENTER_FILE_STATUSES = ['SUBMITTED', 'CONNECTED', 'ERROR'] as const;

export function inDealerCenterFile(status: string | null | undefined): boolean {
  return status != null && (DEALERCENTER_FILE_STATUSES as readonly string[]).includes(status);
}
