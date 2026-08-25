/**
 * Rooftop Auto — the CarGurus inventory feed.
 *
 * Built against the published spec at
 * `cargurus.com/Cars/inventorylisting/feedFileRequirements.action`, read 25 Aug
 * 2026. That page is robots-blocked to agents; the quotes below are verbatim
 * from it so nobody has to re-open it to check what we assumed.
 *
 * WHY THIS IS NOT `src/lib/meta/feed-spec.ts` WITH DIFFERENT COLUMNS
 *
 * Meta's feed is strict in a way that fails silently: `MILES` instead of `MI`,
 * or `TWO_WD` instead of `4X2`, is *accepted* and the vehicle then never serves.
 * Every enum map and every clip() in that module is paying down that specific
 * risk. CarGurus is the opposite, and says so plainly:
 *
 *   "The fields do not have to be any particular order, field names do not have
 *    to match exactly, and some values can be combined from multiple fields."
 *
 * and lists, as things that would *not* stop them processing a file: different
 * field order, different header wording ("ExtColor" vs "Exterior Color"), a
 * required value split across fields, and additional fields they never asked
 * for. So this module sends human-readable headers and unnormalised values on
 * purpose. Importing Meta's enum tables here would be paying a tax levied by a
 * different government.
 *
 * The two modules are deliberately independent — no shared helpers — so that a
 * change to Meta's rules cannot quietly reshape the file CarGurus receives.
 * The cost is three duplicated one-line functions. That is the cheaper mistake.
 */

/* ------------------------------------------------------------------ types */

export type CgPhoto = {
  url: string;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type CgVehicle = {
  id: string;
  vin: string;
  stockNumber: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  transmission: string;
  engine: string;
  exteriorColor: string;
  interiorColor: string;
  mileage: number;
  price: number;
  salePrice: number | null;
  msrp: number | null;
  status: string;
  isCertified: boolean;
  description: string;
  options: string[];
  features: string[];
  photos: CgPhoto[];
};

export type CgRooftop = {
  id: string;
  /**
   * What goes in the Dealer ID column.
   *
   * Normally our own `rooftops.id`, which CarGurus explicitly blesses: *"CarGurus
   * does not require you to use our dealer ID to match up to a dealer. Just use
   * the unique dealer ID your system uses."* It is a separate field from `id`
   * because `channelConnections.providerDealerId` exists for the day they ask us
   * to switch one rooftop to theirs, and the schema comment on that column is
   * emphatic: never derive it, read it and fall back. Resolving that fallback is
   * the loader's job, not this module's.
   */
  dealerId: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  latitude: number | null;
  longitude: number | null;
  /**
   * The ADF address we declare to CarGurus for this rooftop, from
   * `channelConnections.leadEmail` — normally
   * `leads-{rooftopId}@inbound.rooftopauto.com`.
   *
   * On CarGurus this is a column in the feed file rather than a portal setting,
   * which is why lead capture costs the dealer nothing here. See
   * `claude/syndication-onboarding-runbook.md` section 3. CarGurus asks to be
   * told whether it accepts ADF; it does, and that goes in the onboarding email,
   * not in the file.
   */
  leadEmail: string;
};

/* ------------------------------------------------------------ eligibility */

export type CgIssueCode = 'NOT_RETAIL_READY' | 'NO_PHOTOS' | 'NO_PRICE' | 'NO_VIN';

export type CgIssue = {
  code: CgIssueCode;
  /** Written for a dealer, not an engineer. */
  reason: string;
  /** What to actually do about it. Empty when there is nothing the lot can do. */
  fix: string;
};

/**
 * Only units that are actually for sale go out.
 *
 * Narrower than `isSyndicatable` in `src/lib/domain.ts`, which admits
 * PHOTOS_PENDING. A unit whose photos are pending has by definition no photo
 * set, and CarGurus lists Image URLs as required — so admitting it here would
 * only produce a NO_PHOTOS exclusion one line later with a worse reason on it.
 */
const RETAIL_READY = new Set(['FRONT_LINE_READY', 'PENDING_SALE']);

const SOLD_STATUSES = new Set(['SOLD', 'WHOLESALED']);

/**
 * Image formats CarGurus will accept: "Image formats supported are JPEG, PNG,
 * and GIF."
 *
 * TWO OF OUR OWN URL SHAPES FAIL THIS, and both would have gone out unnoticed:
 *
 *  - **Generated tiles are SVG.** `generatedPhotoUrl()` returns `/api/photo?…`,
 *    served as `image/svg+xml`. Every demo vehicle and every unit a dealer has
 *    not photographed yet carries nothing else. Those units have no valid image
 *    URL at all and must be held out of the file, not sent with a broken one.
 *  - **WebP uploads.** `UPLOADABLE` in `src/lib/actions.ts` admits image/webp
 *    and stores a `.webp` blob URL. The browser downscaler normally re-encodes
 *    to JPEG, so this is rare rather than impossible — and "rare" is exactly the
 *    kind of bad row that gets found by a dealer rather than by us.
 *
 * Matching on extension is sound here because we control the pathnames: photo
 * blobs are written as `vehicles/{id}/{sha256}.{jpg|png|webp}`. A query string
 * or fragment after the extension is tolerated.
 */
const CG_IMAGE_EXT = /\.(jpe?g|png|gif)(?:[?#]|$)/i;

export function evaluate(v: CgVehicle, photoBase?: string): CgIssue[] {
  const issues: CgIssue[] = [];

  if (!RETAIL_READY.has(v.status)) {
    issues.push({
      code: 'NOT_RETAIL_READY',
      reason: 'This vehicle is not front-line ready, so it is not being sent to CarGurus.',
      fix: 'Mark it front line ready once recon and photos are done.',
    });
  }

  if (!v.vin || v.vin.trim().length === 0) {
    issues.push({
      code: 'NO_VIN',
      reason: 'CarGurus requires a VIN and this vehicle does not have one.',
      fix: 'Add the VIN on the vehicle page.',
    });
  }

  if (activePrice(v) <= 0) {
    issues.push({
      code: 'NO_PRICE',
      reason: 'CarGurus requires a price and this vehicle is not priced.',
      fix: 'Set an asking price on the vehicle page.',
    });
  }

  if (feedablePhotos(v, photoBase).length === 0) {
    issues.push({
      code: 'NO_PHOTOS',
      reason:
        'CarGurus requires at least one photograph, and this vehicle has none it can use. ' +
        'Placeholder images generated by Rooftop do not count.',
      fix: 'Upload a real photo of the vehicle.',
    });
  }

  return issues;
}

/* --------------------------------------------------------------- helpers */

export function activePrice(v: Pick<CgVehicle, 'price' | 'salePrice'>): number {
  return v.salePrice ?? v.price;
}

/**
 * An image URL CarGurus can fetch, or null.
 *
 * Absolute URLs pass through; root-relative ones get `photoBase`. Returns null
 * rather than guessing when there is no base — CarGurus pulls these from their
 * own infrastructure and has no origin to resolve a relative path against.
 */
export function absolutePhotoUrl(url: string, photoBase?: string): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (!u.startsWith('/') || !photoBase) return null;
  return `${photoBase.replace(/\/+$/, '')}${u}`;
}

/**
 * Every image URL for this vehicle that CarGurus can actually use, lead photo
 * first, de-duplicated.
 *
 * De-duplication is not cosmetic now that photo URLs are content-addressed: the
 * same photograph uploaded twice is genuinely the same URL, and a listing that
 * shows one car twice looks like a broken feed to a shopper.
 *
 * No cap. The spec sets no image limit, unlike Meta's 20.
 */
export function feedablePhotos(v: CgVehicle, photoBase?: string): string[] {
  const ordered = [...(v.photos ?? [])].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of ordered) {
    const abs = absolutePhotoUrl(p.url, photoBase);
    if (!abs || !CG_IMAGE_EXT.test(abs) || seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/** `(360) 555-1234`. Human-readable on purpose — this one is read by people. */
export function prettyPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D+/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return (phone ?? '').trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function yn(b: boolean): string {
  return b ? 'Y' : 'N';
}

/** Collapse whitespace. No length cap — CarGurus publishes none. */
function flat(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ rows */

export type CgRow = Record<string, string>;

export type CgBuiltVehicle = {
  vehicleId: string;
  stockNumber: string;
  title: string;
  issues: CgIssue[];
  /** Null when an issue kept the unit out of the file entirely. */
  row: CgRow | null;
};

export type CgBuildResult = {
  rows: CgRow[];
  vehicles: CgBuiltVehicle[];
  columns: string[];
};

export type CgBuildOptions = {
  /**
   * Absolute origin that serves photo URLs, no trailing slash — normally
   * `https://app.rooftopauto.com`. Required for any photo stored as a
   * root-relative path.
   */
  photoBase?: string;
  /** The dealer's public storefront, for the Dealer Website URL column. */
  siteBase?: string;
  /** Separator for the multi-URL image column. See IMAGE_URL_SEPARATOR. */
  imageSeparator?: string;
};

/**
 * How multiple image URLs are packed into one column.
 *
 * THIS IS THE ONE THING IN THIS MODULE THAT IS A GUESS. The spec names a single
 * required field, "Image URLs", plural, and never says how several are carried.
 * A pipe is the common convention across dealer feeds and cannot appear in a
 * URL unescaped, which a comma can. It is on the list of questions for
 * dealers@cargurus.com, and it is one line to change when they answer.
 */
export const IMAGE_URL_SEPARATOR = '|';

/**
 * Header wording, chosen to match the spec's own prose exactly.
 *
 * CarGurus does not care — "Different wording in header … would not stop us
 * from processing your file" — but a human at dealers@cargurus.com reads the
 * first file by hand during onboarding, and a header that matches their page
 * word for word is one fewer thing for them to ask about.
 *
 * `Operation` and `Complete Inventory Batch` are deliberately absent; see
 * OMITTED_CONTROL_FIELDS.
 */
export const CG_COLUMNS = [
  'VIN',
  'Stock Number',
  'Year',
  'Make',
  'Model',
  'Trim',
  'Price',
  'MSRP',
  'Mileage',
  'Exterior Color',
  'Interior Color',
  'Transmission Type',
  'Engine',
  'Certified',
  'Is New',
  'Installed Options',
  'Dealer Comments',
  'Main Image',
  'Image URLs',
  'Dealer ID',
  'Dealer Name',
  'Dealer Street Address',
  'Dealer City',
  'Dealer State',
  'Dealer ZIP',
  'Dealer Phone Number',
  'Dealer CRM Email',
  'Dealer Website URL',
  'Dealer Latitude',
  'Dealer Longitude',
] as const;

/**
 * `Operation` and `Complete Inventory Batch` — listed by CarGurus as optional
 * fields and then never explained anywhere on the page.
 *
 * WE DO NOT SEND EITHER, AND THAT IS A SAFETY DECISION, NOT AN OVERSIGHT.
 * Their names strongly suggest per-row create/update/delete semantics and a
 * flag asserting "this file is the dealer's entire inventory." If that second
 * reading is right, sending it on a file that is short a few units — a failed
 * photo upload, a partial query, a half-finished migration — instructs CarGurus
 * to delist the difference. Guessing at an undocumented control field whose
 * failure mode is "the dealer's lot disappears" is not a trade worth taking for
 * a feature we do not yet need.
 *
 * The cost of omitting them is that we do not know how a sold unit is removed;
 * see `liveWindow` for how that is handled in the meantime. Both are on the
 * question list for dealers@cargurus.com.
 */
export const OMITTED_CONTROL_FIELDS = ['Operation', 'Complete Inventory Batch'] as const;

export function buildCarGurusFeed(
  vehicles: CgVehicle[],
  lot: CgRooftop,
  opts: CgBuildOptions = {},
): CgBuildResult {
  const sep = opts.imageSeparator ?? IMAGE_URL_SEPARATOR;
  const built: CgBuiltVehicle[] = [];

  for (const v of vehicles) {
    const issues = evaluate(v, opts.photoBase);
    const title = `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ''}`.trim();

    if (issues.length > 0) {
      built.push({ vehicleId: v.id, stockNumber: v.stockNumber, title, issues, row: null });
      continue;
    }

    const photos = feedablePhotos(v, opts.photoBase);

    // options and features are two arrays in our schema and one field here.
    // CarGurus explicitly accepts a value "combined from multiple fields", so
    // joining is not a lossy compromise — it is the shape they asked for.
    const installed = [...(v.options ?? []), ...(v.features ?? [])]
      .map(flat)
      .filter(Boolean);

    built.push({
      vehicleId: v.id,
      stockNumber: v.stockNumber,
      title,
      issues,
      row: {
        VIN: v.vin,
        'Stock Number': v.stockNumber,
        Year: String(v.year),
        Make: v.make,
        Model: v.model,
        Trim: flat(v.trim),
        Price: String(activePrice(v)),
        MSRP: v.msrp != null ? String(v.msrp) : '',
        Mileage: String(v.mileage),
        'Exterior Color': flat(v.exteriorColor),
        'Interior Color': flat(v.interiorColor),
        // Unmapped on purpose. CarGurus accepts "5-speed manual" and "Manual"
        // equally, so our enum goes out as written rather than through a table
        // that could only introduce a translation bug.
        'Transmission Type': flat(v.transmission),
        Engine: flat(v.engine),
        Certified: yn(v.isCertified),
        // Every unit on an independent used lot is used. Sent explicitly rather
        // than left blank so a current-model-year trade is never read as new.
        'Is New': 'N',
        'Installed Options': installed.join(', '),
        'Dealer Comments': flat(v.description || title),
        // The spec lists Main Image separately from Image URLs: "This is the
        // first image displayed on a listing." Sending it removes any question
        // about whether they honour our ordering.
        'Main Image': photos[0] ?? '',
        'Image URLs': photos.join(sep),
        'Dealer ID': lot.dealerId,
        'Dealer Name': flat(lot.name),
        'Dealer Street Address': flat(lot.addressLine1),
        'Dealer City': flat(lot.city),
        'Dealer State': flat(lot.state),
        'Dealer ZIP': flat(lot.postalCode),
        'Dealer Phone Number': prettyPhone(lot.phone),
        'Dealer CRM Email': lot.leadEmail,
        'Dealer Website URL': opts.siteBase ?? '',
        'Dealer Latitude': lot.latitude != null ? lot.latitude.toFixed(6) : '',
        'Dealer Longitude': lot.longitude != null ? lot.longitude.toFixed(6) : '',
      },
    });
  }

  return {
    rows: built.map((b) => b.row).filter((r): r is CgRow => r !== null),
    vehicles: built,
    columns: [...CG_COLUMNS],
  };
}

/* ------------------------------------------------------------------- CSV */

/**
 * Render as a fully-quoted CSV.
 *
 * Every field quoted and every inner quote doubled, uniformly. A file where
 * some rows quote and others do not is what trips delimiter autodetection, and
 * a dealer's vehicle description arrives carrying whatever the previous DMS put
 * in it — commas and quotation marks included.
 *
 * Newlines and carriage returns are stripped rather than escaped. A literal
 * newline inside a quoted CSV field is legal and is also the single most
 * common thing a hand-rolled parser on the far end gets wrong; there is nothing
 * in a vehicle description worth that risk.
 */
export function toCsv(columns: string[], rows: CgRow[]): string {
  const cell = (raw: string | undefined) =>
    `"${(raw ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '""')}"`;
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  // Trailing newline: some ingesters drop an unterminated final record.
  return `${lines.join('\n')}\n`;
}

/* ---------------------------------------------------------------- window */

/**
 * Which units belong in a CarGurus upload.
 *
 * Live inventory only. Sold units are dropped immediately, which is the exact
 * opposite of `fullWindow` in the Meta builder — and both are right for their
 * own destination.
 *
 * Meta carries a sold unit for 30 days marked `not_available`, because Meta has
 * an availability field and because deletion there destroys the item's accrued
 * delivery history. The CarGurus spec has no availability column at all, so a
 * unit's absence from the file is the only way to say it is gone. Carrying a
 * sold car would leave it listed.
 *
 * That still leaves the timing problem the runbook flags: on a daily upload a
 * unit can stay live for up to 24 hours after it sells, and Autotrader-style
 * guidelines expect removal inside that window. Twice-daily uploads halve it.
 * Anything better needs the removal semantics we deliberately did not guess at
 * in OMITTED_CONTROL_FIELDS.
 */
export function liveWindow<T extends { status: string }>(vehicles: T[]): T[] {
  return vehicles.filter((v) => !SOLD_STATUSES.has(v.status));
}
