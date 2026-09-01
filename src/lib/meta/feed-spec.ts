/**
 * Rooftop Auto — the Meta vehicle feed, as a pure function.
 *
 * This file turns lot rows into the exact TSV Meta's Automotive Inventory Ads
 * ingester expects, and it decides which units are eligible for which surface.
 * It touches no database, no `next/*` and no network, so it is testable and so
 * `src/db/backfill-feed.ts` and the route handler can share one implementation.
 *
 * WHY THIS FILE IS SO FUSSY ABOUT ENUMS
 *
 * Meta publishes *three* overlapping specs for the same concepts and they do
 * not agree. The AIA **feed file** spec, the `POST /{catalog_id}/vehicles`
 * **Graph node**, and the automotive **pixel events** spec each have their own
 * enum spellings. Sending the node's spelling in a feed file does not error —
 * the row is accepted and the vehicle quietly never serves. That is the worst
 * possible failure mode and it is exactly the class of bug
 * `claude/meta-marketplace.md` §3 says competitors ship.
 *
 * The four that bite, verified against the AIA feed reference (Jun 2026):
 *
 *   mileage.unit   MI / KM            — NOT MILES / KILOMETERS (that's the node)
 *   drivetrain     4X2 / 4X4 / …      — NOT TWO_WD / FOUR_WD (node)
 *   fuel_type      6 values, no PETROL, no PLUGIN_HYBRID (node/model-ads only)
 *   price          "18000 USD" string — NOT a bare int + currency column (node)
 *
 * ADDRESS: Meta accepts either a single `address` blob column *or* flattened
 * `address.city` / `address.region` / `address.country` columns, and sending
 * both "will result in an error". We send the blob, because the flattened form
 * has no street-line column at all and a dealership address without a street is
 * not much of an address.
 *
 * ELIGIBILITY IS NOT A FILTER. Every unit we decline to send, and every unit we
 * send that cannot reach the Marketplace surface, comes back with a reason a
 * dealer can act on. A vehicle silently missing from a placement is the single
 * most common complaint about every vendor in this category — see
 * `claude/meta-marketplace.md` §3.
 */

/* -------------------------------------------------------------- inputs */

export type FeedPhoto = {
  url: string;
  tag?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type FeedVehicle = {
  id: string;
  vin: string;
  stockNumber: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  bodyStyle: string;
  transmission: string | null;
  drivetrain: string;
  fuelType: string;
  exteriorColor: string;
  interiorColor: string;
  mileage: number;
  price: number;
  salePrice: number | null;
  status: string;
  isCertified: boolean;
  description: string;
  acquiredDate: Date | string;
  frontLineDate: Date | string | null;
  soldDate: Date | string | null;
  photos: FeedPhoto[];
};

export type FeedRooftop = {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  /** Nullable because a lot can exist before anyone geocodes it. Meta requires both. */
  latitude: number | null;
  longitude: number | null;
  /** From `meta_rooftop_assets.pageId`. Required for the on-Facebook destination. */
  pageId: string | null;
};

/* --------------------------------------------------------- eligibility */

/**
 * `FEED` — the unit is not sent to Meta at all. Sending it would be rejected or
 *          would serve as a broken listing.
 * `MARKETPLACE` — the unit is in the catalog and can run in Feed, Search and
 *          Instagram placements, but cannot appear on the Marketplace surface.
 *
 * The split matters commercially: a `MARKETPLACE` reason is not "your car is
 * missing", it is "your car is missing from the one placement dealers ask for
 * by name", and those are different conversations.
 */
export type EligibilityScope = 'FEED' | 'MARKETPLACE';

export type EligibilityIssue = {
  code:
    | 'NOT_RETAIL_READY'
    | 'NO_PHOTOS'
    | 'NO_PRICE'
    | 'NO_STORE_COORDINATES'
    | 'ONE_PHOTO_ONLY'
    | 'UNDER_500_MILES'
    | 'NO_VIN'
    | 'NO_PAGE_CONNECTED';
  scope: EligibilityScope;
  /** Written for a dealer, not an engineer. Shown verbatim on the Lot Walk card. */
  reason: string;
  /** What to actually do about it. Empty when there is nothing the lot can do. */
  fix: string;
};

/** Meta: "For Marketplace, a 2-image minimum is required." */
export const MARKETPLACE_MIN_IMAGES = 2;

/**
 * Meta: "For Marketplace, vehicles must have over 500 miles/kms."
 *
 * Strictly greater than, and Meta does not normalise the unit — 500 is compared
 * against the raw number whether it is miles or kilometres. We always send MI.
 * A fresh trade sitting at 40 miles is genuinely ineligible; this is not our
 * rule and the dealer-facing copy says so.
 */
export const MARKETPLACE_MIN_MILEAGE = 500;

/** Meta caps a catalog item at 20 images. */
export const MAX_IMAGES = 20;

/**
 * Only front-line-ready and pending-sale units belong in paid placements.
 * Deliberately narrower than `isSyndicatable` in `src/lib/domain.ts`, which
 * includes `PHOTOS_PENDING`: a unit whose photos are still pending has, by
 * definition, no photo set, and Meta requires at least one image. Letting it
 * through would only produce a `NO_PHOTOS` exclusion one line later with a less
 * useful reason attached.
 */
const AD_READY_STATUSES = new Set(['FRONT_LINE_READY', 'PENDING_SALE']);

/** Sold units linger in the full feed rather than vanishing from it — see below. */
const SOLD_STATUSES = new Set(['SOLD', 'WHOLESALED']);

/**
 * How long a sold unit stays in the full feed as `not_available`.
 *
 * The daily `schedule` feed is a full replace: items absent from the file are
 * **deleted**, and Meta is explicit that deletion destroys the item-level
 * delivery history it has accumulated for that vehicle. A unit that sells and
 * comes back as an unwind, or a stock number that gets reused, should not lose
 * that. So a sold unit is carried, marked unavailable, for a grace window and
 * only then allowed to fall out.
 */
export const SOLD_GRACE_DAYS = 30;

export function evaluate(
  v: FeedVehicle,
  lot: FeedRooftop,
  now: Date = new Date(),
): EligibilityIssue[] {
  const issues: EligibilityIssue[] = [];
  const photos = usablePhotos(v);
  const sold = SOLD_STATUSES.has(v.status);

  if (!sold && !AD_READY_STATUSES.has(v.status)) {
    issues.push({
      code: 'NOT_RETAIL_READY',
      scope: 'FEED',
      reason: 'This unit is not front-line ready yet, so it is not being advertised.',
      fix: 'Finish recon and photos, then mark it front-line ready.',
    });
  }

  if (photos.length === 0) {
    issues.push({
      code: 'NO_PHOTOS',
      scope: 'FEED',
      reason: 'Facebook will not list a vehicle with no photos.',
      fix: 'Add at least one photo — two to reach Marketplace.',
    });
  } else if (photos.length < MARKETPLACE_MIN_IMAGES) {
    issues.push({
      code: 'ONE_PHOTO_ONLY',
      scope: 'MARKETPLACE',
      reason: "This unit isn't eligible for Marketplace placement — Facebook wants a second photo.",
      fix: 'Add one more photo.',
    });
  }

  if (activePrice(v) <= 0) {
    issues.push({
      code: 'NO_PRICE',
      scope: 'FEED',
      reason: 'This unit has no asking price, so it cannot be advertised.',
      fix: 'Set a price on the vehicle.',
    });
  }

  // New units are exempt: Meta's rule is about *used* vehicles, and a 0-mile new
  // car is expected. We are an independent used-car platform, so in practice
  // every unit here is used and this is close to unconditional — but the check
  // is written the way the rule is written, not the way our inventory happens
  // to look today.
  if (stateOfVehicle(v) !== 'New' && v.mileage <= MARKETPLACE_MIN_MILEAGE) {
    issues.push({
      code: 'UNDER_500_MILES',
      scope: 'MARKETPLACE',
      reason:
        `Facebook Marketplace only lists used vehicles over ${MARKETPLACE_MIN_MILEAGE} miles, ` +
        `and this one shows ${v.mileage.toLocaleString('en-US')}.`,
      fix: '',
    });
  }

  if (!v.vin || v.vin.trim().length !== 17) {
    issues.push({
      code: 'NO_VIN',
      scope: 'MARKETPLACE',
      reason: 'Facebook Marketplace requires a full 17-character VIN on every listing.',
      fix: 'Correct the VIN on the vehicle record.',
    });
  }

  // Lot-level problems. These repeat on every unit at the lot, which is the
  // point: the UI groups them and shows one card, but the reason has to live on
  // the vehicle or a per-vehicle export loses it.
  // TODO: there is no lot settings screen yet, so a dealer cannot self-serve
  // this. Point them at support until one exists — telling them to use a screen
  // that does not exist is worse than telling them to ask.
  if (lot.latitude == null || lot.longitude == null) {
    issues.push({
      code: 'NO_STORE_COORDINATES',
      scope: 'FEED',
      reason: `${lot.name} has no map location set, and Facebook requires one on every vehicle.`,
      fix: 'Contact Rooftop support to set this lot’s map location.',
    });
  }

  if (!lot.pageId) {
    issues.push({
      code: 'NO_PAGE_CONNECTED',
      scope: 'MARKETPLACE',
      reason: `${lot.name} has no Facebook Page connected, which Marketplace listings run from.`,
      fix: 'Pick this lot’s Page in the Ad Desk.',
    });
  }

  void now;
  return issues;
}

export const blocksFeed = (issues: EligibilityIssue[]) => issues.some((i) => i.scope === 'FEED');
export const blocksMarketplace = (issues: EligibilityIssue[]) => issues.length > 0;

/* ------------------------------------------------------------ mapping */

const DAY = 86_400_000;

function asDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

export function activePrice(v: Pick<FeedVehicle, 'price' | 'salePrice'>): number {
  return v.salePrice ?? v.price;
}

/**
 * A photo URL Meta can actually fetch, or null.
 *
 * Already-absolute URLs pass through untouched — a dealer's real photos live on
 * a CDN and must not be rewritten. Root-relative paths get `photoBase`, which is
 * the case that matters: everything `generatedPhotoUrl()` produces is
 * `/api/photo?…`, correct in an `<img>` on our own page and unusable to Meta.
 *
 * Returns null rather than guessing when there is no base to apply. An item with
 * one fewer photo still uploads; an item with a malformed image URL does not
 * upload at all.
 */
export function absolutePhotoUrl(url: string, photoBase?: string): string | null {
  const u = url.trim();
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (!u.startsWith('/') || !photoBase) return null;
  return `${photoBase.replace(/\/+$/, '')}${u}`;
}

/** Photos with a usable URL, in display order, capped at Meta's limit of 20. */
export function usablePhotos(v: FeedVehicle): FeedPhoto[] {
  return [...v.photos]
    .filter((p) => typeof p.url === 'string' && p.url.trim().length > 0)
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    })
    .slice(0, MAX_IMAGES);
}

/**
 * `New` / `Used` / `CPO`.
 *
 * We have no new/used column, because an independent used-car lot does not need
 * one — everything is used. Certification is the only distinction the schema
 * carries, and `CPO` is the value Meta wants for it.
 */
export function stateOfVehicle(v: Pick<FeedVehicle, 'isCertified'>): 'New' | 'Used' | 'CPO' {
  return v.isCertified ? 'CPO' : 'Used';
}

/** Our enum → the AIA feed's 12-value `body_style`. VAN is a minivan here (see BODY_LABEL). */
const BODY_STYLE: Record<string, string> = {
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  TRUCK: 'TRUCK',
  COUPE: 'COUPE',
  HATCHBACK: 'HATCHBACK',
  WAGON: 'WAGON',
  VAN: 'MINIVAN',
  CONVERTIBLE: 'CONVERTIBLE',
};

/** The feed spec has only `Automatic` and `Manual`. A CVT is an automatic to a shopper. */
const TRANSMISSION: Record<string, string> = {
  AUTOMATIC: 'Automatic',
  MANUAL: 'Manual',
  CVT: 'Automatic',
};

/** Feed spelling is `4X2 / 4X4 / AWD / FWD / RWD / Other` — not the node's TWO_WD/FOUR_WD. */
const DRIVETRAIN: Record<string, string> = {
  FWD: 'FWD',
  RWD: 'RWD',
  AWD: 'AWD',
  FOUR_WD: '4X4',
};

/**
 * Feed `fuel_type` has six values and **no plug-in hybrid**. `PLUG_IN_HYBRID`
 * exists on the Graph node and in automotive *model* ads, neither of which this
 * is. A PHEV maps to HYBRID rather than OTHER: it is closer to true, and OTHER
 * drops the unit out of every fuel-type-filtered product set a dealer builds.
 */
const FUEL_TYPE: Record<string, string> = {
  GAS: 'GASOLINE',
  DIESEL: 'DIESEL',
  HYBRID: 'HYBRID',
  PLUGIN_HYBRID: 'HYBRID',
  ELECTRIC: 'ELECTRIC',
  FLEX: 'FLEX',
};

/** Aging bucket as a catalog-filterable label. Mirrors AGING_BUCKETS in src/lib/domain.ts. */
export function agingLabel(days: number): string {
  if (days <= 15) return 'age_0_15';
  if (days <= 30) return 'age_16_30';
  if (days <= 45) return 'age_31_45';
  if (days <= 60) return 'age_46_60';
  return 'age_61_plus';
}

export function daysOnLot(v: FeedVehicle, now: Date = new Date()): number {
  const end = v.soldDate ? asDate(v.soldDate).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - asDate(v.acquiredDate).getTime()) / DAY));
}

/**
 * `+1 3605551234`. Meta: "Must include the country code" — and it is what makes
 * the Call button appear on a Marketplace listing, so a lot that gets this
 * wrong loses its phone calls without ever seeing an error.
 */
export function e164ish(phone: string): string {
  const digits = (phone ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1 ${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+1 ${digits.slice(1)}`;
  return `+${digits}`;
}

function ymd(d: Date | string): string {
  return asDate(d).toISOString().slice(0, 10);
}

/**
 * The single-column address blob, in Meta's own unusual notation: unquoted keys,
 * single-quoted values, `addr1` rather than `address1`. Copied from the spec
 * example rather than normalised, because the parser on the other end is theirs.
 */
function addressBlob(lot: FeedRooftop): string {
  const esc = (s: string) => (s ?? '').replace(/'/g, ' ').trim();
  return (
    `{addr1: '${esc(lot.addressLine1)}', city: '${esc(lot.city)}', ` +
    `region: '${esc(lot.state)}', postal_code: '${esc(lot.postalCode)}', country: 'US'}`
  );
}

/* --------------------------------------------------------------- rows */

export type FeedRow = Record<string, string>;

export type BuiltVehicle = {
  vehicleId: string;
  stockNumber: string;
  title: string;
  issues: EligibilityIssue[];
  /** Null when a FEED-scope issue kept it out of the file entirely. */
  row: FeedRow | null;
};

export type BuildResult = {
  rows: FeedRow[];
  /** Every unit considered, in feed order, with its reasons. Drives the dealer UI. */
  vehicles: BuiltVehicle[];
  /** Header, in the order the columns are written. */
  columns: string[];
};

export type BuildOptions = {
  /**
   * Absolute origin + storefront prefix, no trailing slash.
   * `https://cascademotorswa.com` on a dealer domain, or
   * `https://app.rooftopauto.com/s/cascade` on the shared host.
   */
  siteBase: string;
  /**
   * Absolute origin that serves photo URLs, no trailing slash — normally
   * `https://app.rooftopauto.com`.
   *
   * REQUIRED FOR ANY PHOTO STORED AS A ROOT-RELATIVE PATH, which every
   * generated demo photo is: `generatedPhotoUrl()` returns `/api/photo?…`
   * because the app renders it in an `<img>` on the same origin, where relative
   * is exactly right.
   *
   * It is exactly wrong in a feed. Meta fetches the file from its own
   * infrastructure and has no origin to resolve against, so every row came back
   *
   *   Result: Item not uploaded
   *   Issue:  URL Incorrectly Formatted
   *
   * — all seven vehicles, 6 Aug 2026, on the first upload that ever reached
   * Meta. Nothing else in the row was wrong; the landing-page `url` column
   * built from `siteBase` was absolute and accepted. Only the images were
   * relative, and one bad image URL rejects the whole item.
   *
   * Left optional so the preview path, which never leaves our own origin, does
   * not have to invent one. A relative photo with no `photoBase` is dropped
   * from the feed rather than emitted broken — a vehicle with fewer images is
   * survivable, a vehicle Meta refuses is not.
   */
  photoBase?: string;
  now?: Date;
  /**
   * `full` carries live inventory plus recently-sold units marked unavailable.
   * `delta` carries only what changed inside `sinceMs` and never deletes.
   */
  mode?: 'full' | 'delta';
};

const BASE_COLUMNS = [
  'vehicle_id',
  'title',
  'description',
  'url',
  'make',
  'model',
  'year',
  'trim',
  'body_style',
  'transmission',
  'drivetrain',
  'fuel_type',
  'exterior_color',
  'interior_color',
  'state_of_vehicle',
  'mileage.value',
  'mileage.unit',
  'price',
  'sale_price',
  'vin',
  'stock_number',
  'availability',
  'address',
  'latitude',
  'longitude',
  'dealer_id',
  'dealer_name',
  'dealer_phone',
  'fb_page_id',
  'date_first_on_lot',
  'days_on_lot',
  'custom_label_0',
  'custom_label_1',
  'custom_label_2',
] as const;

export function buildFeed(
  vehicles: FeedVehicle[],
  lot: FeedRooftop,
  opts: BuildOptions,
): BuildResult {
  const now = opts.now ?? new Date();
  const built: BuiltVehicle[] = [];
  let maxImages = 1;

  for (const v of vehicles) {
    const issues = evaluate(v, lot, now);
    const title = `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ''}`.trim();
    const sold = SOLD_STATUSES.has(v.status);

    // A sold unit inside the grace window is carried deliberately, so its
    // NOT_RETAIL_READY exclusion does not apply to it. Everything else does:
    // a sold unit with no photos still has nothing to show.
    const hardBlocked = issues.some(
      (i) => i.scope === 'FEED' && !(sold && i.code === 'NOT_RETAIL_READY'),
    );

    if (hardBlocked) {
      built.push({ vehicleId: v.id, stockNumber: v.stockNumber, title, issues, row: null });
      continue;
    }

    const photos = usablePhotos(v);
    maxImages = Math.max(maxImages, photos.length);

    const days = daysOnLot(v, now);
    const marketplaceOk = !blocksMarketplace(issues);

    const row: FeedRow = {
      vehicle_id: v.id,
      title: clip(title, 500),
      description: clip(v.description || title, 5000),
      url: `${opts.siteBase}/${encodeURIComponent(v.stockNumber)}`,
      make: v.make,
      model: v.model,
      year: String(v.year),
      trim: clip(v.trim, 50),
      body_style: BODY_STYLE[v.bodyStyle] ?? 'OTHER',
      // Unknown goes out empty. Meta treats the column as optional, and an
      // invented 'Automatic' is a spec claim on someone else's listing.
      transmission: v.transmission ? TRANSMISSION[v.transmission] ?? '' : '',
      drivetrain: DRIVETRAIN[v.drivetrain] ?? 'Other',
      fuel_type: FUEL_TYPE[v.fuelType] ?? 'OTHER',
      exterior_color: v.exteriorColor,
      interior_color: clip(v.interiorColor, 50),
      state_of_vehicle: stateOfVehicle(v),
      'mileage.value': String(v.mileage),
      'mileage.unit': 'MI',
      price: `${activePrice(v)} USD`,
      sale_price: v.salePrice != null ? `${v.salePrice} USD` : '',
      vin: v.vin,
      stock_number: v.stockNumber,
      availability: sold ? 'not_available' : 'available',
      address: addressBlob(lot),
      latitude: lot.latitude != null ? lot.latitude.toFixed(6) : '',
      longitude: lot.longitude != null ? lot.longitude.toFixed(6) : '',
      dealer_id: lot.id,
      dealer_name: clip(lot.name, 100),
      dealer_phone: e164ish(lot.phone),
      fb_page_id: lot.pageId ?? '',
      date_first_on_lot: ymd(v.acquiredDate),
      days_on_lot: String(days),
      // custom_label_0 is the only custom label Meta documents unambiguously as
      // filterable on the vehicles vertical, so the aging bucket — the thing the
      // Lot Walk actually campaigns on — gets it. Note `days_on_lot` is *also*
      // filterable and numeric, so a set can use either; the label exists so a
      // set reads like the lot talks.
      custom_label_0: agingLabel(days),
      custom_label_1: marketplaceOk ? 'mkt_ok' : 'mkt_hold',
      custom_label_2: v.isCertified ? 'certified' : 'standard',
    };

    // Absolutise before emitting, and renumber: `image[0]` must exist or Meta
    // treats the item as imageless, so a dropped photo cannot leave a hole.
    let slot = 0;
    photos.forEach((p) => {
      const abs = absolutePhotoUrl(p.url, opts.photoBase);
      if (!abs) return;
      row[`image[${slot}].url`] = abs;
      if (p.tag) row[`image[${slot}].tag[0]`] = photoTag(p.tag);
      slot += 1;
    });

    built.push({ vehicleId: v.id, stockNumber: v.stockNumber, title, issues, row });
  }

  const imageColumns: string[] = [];
  for (let i = 0; i < maxImages; i += 1) {
    imageColumns.push(`image[${i}].url`, `image[${i}].tag[0]`);
  }
  const columns = [...BASE_COLUMNS, ...imageColumns];

  return {
    rows: built.map((b) => b.row).filter((r): r is FeedRow => r !== null),
    vehicles: built,
    columns,
  };
}

/** Meta's documented image tags are Exterior / Interior / StockImage. */
function photoTag(tag: string): string {
  if (tag.startsWith('EXTERIOR')) return 'Exterior';
  if (tag === 'INTERIOR' || tag === 'ODOMETER' || tag === 'ENGINE') return 'Interior';
  return 'Exterior';
}

function clip(s: string, max: number): string {
  const flat = (s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max) : flat;
}

/* ---------------------------------------------------------------- TSV */

/**
 * Render as a fully-quoted TSV.
 *
 * Every field is quoted and every inner quote doubled, which is the shape
 * Meta's own example header uses. That matters more than it looks: the feed's
 * `quoted_fields_mode` defaults to AUTODETECT, and a file where *some* rows
 * quote and others do not is exactly what autodetect gets wrong. Consistency is
 * the point, not prettiness.
 *
 * Tabs, carriage returns and newlines are stripped from values rather than
 * escaped. A dealer's vehicle description arrives with whatever the previous
 * DMS put in it, and one stray tab in a free-text field shifts every column to
 * its right for that row — which Meta accepts, silently, as garbage data.
 */
export function toTsv(columns: string[], rows: FeedRow[]): string {
  const cell = (raw: string | undefined) => {
    const flat = (raw ?? '').replace(/[\t\r\n]+/g, ' ');
    return `"${flat.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map(cell).join('\t')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join('\t'));
  // Trailing newline: some ingesters drop an unterminated final record.
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------ windows */

/**
 * Which units belong in a full replace.
 *
 * Live inventory, plus anything sold inside the grace window so it lands as
 * `not_available` rather than being deleted out of the catalog.
 */
export function fullWindow<T extends { status: string; soldDate: Date | string | null }>(
  vehicles: T[],
  now: Date = new Date(),
): T[] {
  const cutoff = now.getTime() - SOLD_GRACE_DAYS * DAY;
  return vehicles.filter((v) => {
    if (!SOLD_STATUSES.has(v.status)) return true;
    if (!v.soldDate) return false;
    return asDate(v.soldDate).getTime() >= cutoff;
  });
}
