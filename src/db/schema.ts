/**
 * Rooftop Auto — data model
 * Litespeed Marketing LLC
 *
 * Design notes:
 *  - Rooftop = one physical dealership location.
 *    Storefront = one public-facing website, mapped to 1..N rooftops. That is
 *    how a group runs several physical rooftops as one "virtual rooftop" online.
 *  - Money is whole dollars (integer). cost / pack / reconCost are INTERNAL ONLY
 *    and must never appear in a syndication payload.
 *  - Aging buckets and days-in-stock are computed, never stored.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

const cuid = () => text().$defaultFn(() => crypto.randomUUID());

/* ------------------------------------------------------------------ enums */

export const bodyStyleEnum = pgEnum('body_style', [
  'SEDAN', 'SUV', 'TRUCK', 'COUPE', 'HATCHBACK', 'WAGON', 'VAN', 'CONVERTIBLE',
]);
export const transmissionEnum = pgEnum('transmission', ['AUTOMATIC', 'MANUAL', 'CVT']);
export const drivetrainEnum = pgEnum('drivetrain', ['FWD', 'RWD', 'AWD', 'FOUR_WD']);
export const fuelTypeEnum = pgEnum('fuel_type', [
  'GAS', 'DIESEL', 'HYBRID', 'PLUGIN_HYBRID', 'ELECTRIC', 'FLEX',
]);
export const titleStatusEnum = pgEnum('title_status', ['CLEAN', 'REBUILT', 'SALVAGE', 'BONDED']);

/** Lot workflow. front-line ready = recon + photos + merchandising complete. */
export const vehicleStatusEnum = pgEnum('vehicle_status', [
  'ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE', 'SOLD', 'WHOLESALED',
]);
export const acquisitionSourceEnum = pgEnum('acquisition_source', [
  'AUCTION', 'TRADE_IN', 'STREET_PURCHASE', 'LEASE_RETURN', 'DEALER_TRADE',
]);
export const photoTagEnum = pgEnum('photo_tag', [
  'EXTERIOR_FRONT', 'EXTERIOR_SIDE', 'EXTERIOR_REAR', 'INTERIOR', 'ODOMETER', 'ENGINE', 'DAMAGE', 'OTHER',
]);
export const channelKindEnum = pgEnum('channel_kind', [
  'WEBSITE', 'SOCIAL', 'SEARCH', 'MARKETPLACE', 'CLASSIFIED',
]);
/** PUSH_API = real-time push, lands in seconds/minutes.
 *  FEED_PULL = destination pulls our feed on a schedule, lands at next pull. */
export const syncModeEnum = pgEnum('sync_mode', ['PUSH_API', 'FEED_PULL']);
export const syncStatusEnum = pgEnum('sync_status', [
  'NOT_LISTED', 'PENDING', 'QUEUED', 'SYNCING', 'LIVE', 'ERROR', 'REMOVED', 'EXCLUDED',
]);
export const connectionStatusEnum = pgEnum('connection_status', [
  'CONNECTED', 'PENDING_SETUP', 'DISCONNECTED', 'ERROR',
]);
export const syncActionEnum = pgEnum('sync_action', [
  'CREATE', 'UPDATE_PRICE', 'UPDATE_PHOTOS', 'UPDATE_DETAILS', 'REMOVE', 'RELIST',
]);
export const userRoleEnum = pgEnum('user_role', ['OWNER', 'MANAGER', 'SALES', 'LOT_PORTER']);

/** Which screen a user lands on after signing in. Feed is the default bet. */
export const homeViewEnum = pgEnum('home_view', ['FEED', 'DASHBOARD']);

/**
 * How the event stream is *rendered*. Not what is in it.
 *
 * `feed_events` is a dealer log — a timestamped, tenant-scoped record of
 * everything that moved money, with a number attached to each row. Lot Walk's
 * social feel is a presentation layer on top of it: avatars, 👍/🔥, the comment
 * thread, the composer, the card chrome. Strip those and the same rows read as
 * a dense activity log that looks like the management software these dealers
 * already use.
 *
 * That split is the product decision. A twenty-person store gets a morale
 * feature; the owner-plus-two-reps store gets a log and never sees an emoji.
 * Same table, same emitters, same sweep, same backfill — so a store that grows
 * into the social view flips a setting rather than migrating anything.
 *
 * SOCIAL is the default because it is the differentiation bet.
 */
export const feedStyleEnum = pgEnum('feed_style', ['SOCIAL', 'LOG']);

/**
 * Lot Walk event kinds. The list grows as the product does — a lead becomes
 * another `kind` when the CRM lands, with no re-architecture.
 * `team` and `note` are the two human-authored kinds; everything else is
 * posted by the system off a real write.
 */
export const feedEventKindEnum = pgEnum('feed_event_kind', [
  'acquired', 'recon_in', 'recon_out', 'photos', 'front_line', 'price_change',
  'at_risk', 'aged', 'water', 'vdp_milestone', 'sync_error', 'sold', 'team', 'note',
  /** Website/domain lifecycle: pointed, verifying, live, expiring, failed. */
  'domain',
  /**
   * A unit moving between two of the group's own lots. Two kinds rather than
   * one because a transfer is the only event that belongs to **two** rooftops,
   * and `feed_events.rooftopId` is single-valued: the departure posts to the
   * origin, the arrival posts to the destination. See `vehicleTransfers`.
   *
   * `transfer_inbound` is the third: the *destination* hearing at departure
   * that something is on its way. It exists because the porter at the far end
   * is the person who most needs the warning, and he needs it before the truck
   * shows up rather than after.
   */
  'transfer_out', 'transfer_in', 'transfer_inbound',
]);

/** Two reactions, deliberately. 👍 acknowledges, 🔥 says "this one is hot." */
export const feedReactionKindEnum = pgEnum('feed_reaction_kind', ['THUMB', 'FIRE']);

/**
 * Storefront layouts. Three shapes that differ by *sales posture*, not by mood —
 * see `src/components/store/layouts/index.ts`. Adding a fourth is one file, one
 * value here, and one migration; nothing in the route or the queries changes.
 */
export const storefrontLayoutEnum = pgEnum('storefront_layout', [
  'CLASSIC',
  'SHOWCASE',
  'LOT_LIST',
]);

/**
 * Where a storefront's custom domain came from. This is not cosmetic: a
 * PURCHASED domain sits in our Vercel team and we hold the account of record,
 * so the transfer-out path and the renewal exposure only apply to those.
 */
export const domainSourceEnum = pgEnum('domain_source', ['BYO', 'PURCHASED']);

/**
 * The live status a dealer watches on the domain screen. Ordered as the dealer
 * experiences it. BLOCKED is ours, not Vercel's — it means we ran the
 * pre-flight (CAA, registrar hold) and know the certificate cannot issue yet,
 * which is the whole point of checking before we promise SSL.
 */
export const domainStatusEnum = pgEnum('domain_status', [
  'NONE',
  'BLOCKED',
  'PENDING_DNS',
  'VERIFYING',
  'SSL_ISSUING',
  'LIVE',
  'ERROR',
]);

/** Lifecycle of a domain purchase through the Vercel Registrar API. */
export const domainOrderStatusEnum = pgEnum('domain_order_status', [
  'QUOTED',
  'CONTACT_PENDING',
  'PURCHASING',
  'PURCHASED',
  'FAILED',
  'REJECTED_OVER_CAP',
]);

/* ---------------------------------------------------------------- tenancy */

export const dealerGroups = pgTable('dealer_groups', {
  id: cuid().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  /**
   * The house default for how this dealership reads its own event stream.
   * Style is more a house trait than a personal one — a two-person lot sets it
   * once at signup and never thinks about it again — but `users.feedStyle`
   * overrides it, because the controller at a twenty-person store should not be
   * forced into the same view as the receptionist.
   */
  feedStyle: feedStyleEnum().notNull().default('SOCIAL'),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const rooftops = pgTable('rooftops', {
  id: cuid().primaryKey(),
  groupId: text().notNull().references(() => dealerGroups.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  slug: text().notNull().unique(),
  addressLine1: text().notNull(),
  city: text().notNull(),
  state: text().notNull(),
  postalCode: text().notNull(),
  phone: text().notNull(),
  email: text().notNull(),
  timezone: text().notNull().default('America/Los_Angeles'),
  isActive: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * A DNS challenge Vercel wants satisfied before it will serve a domain. Only
 * appears when the domain is already claimed on another Vercel account —
 * failure mode #5 in `claude/domains-and-syndication.md`. Stored verbatim so
 * the UI renders exactly what Vercel asked for rather than our guess at it.
 */
export type DomainChallenge = {
  type: string;
  domain: string;
  value: string;
  reason?: string;
};

/**
 * ICANN registrant contact. **The dealer's details, not Litespeed's** — see §3
 * of `claude/billing-and-domain-economics.md`. Registering a domain that
 * contains a dealer's business name to Litespeed hands them a trademark/UDRP
 * argument we have no reason to create, and `buy` requires a registrant either
 * way. Retention is protected by the account of record, not this field.
 */
export type RegistrantContact = {
  firstName: string;
  lastName: string;
  companyName?: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const storefronts = pgTable('storefronts', {
  id: cuid().primaryKey(),
  groupId: text().notNull().references(() => dealerGroups.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  slug: text().notNull().unique(),

  /**
   * The dealer's custom domain, apex form and lowercase — `cascademotorswa.com`,
   * never `www.` and never a scheme. Unique across every tenant, because two
   * storefronts cannot answer on one hostname.
   *
   * Safe to resolve in the same lookup as `slug`: slugs never contain a dot and
   * domains always do, so the two key spaces are disjoint by construction. That
   * is what lets `proxy.ts` rewrite a host straight into `/s/[slug]` with no
   * database call on the request path.
   */
  domain: text().unique(),
  domainSource: domainSourceEnum(),
  domainStatus: domainStatusEnum().notNull().default('NONE'),
  /**
   * Verification challenges Vercel handed back from the domain-add call, stored
   * verbatim. Only populated when the domain was already claimed on another
   * Vercel account — failure mode #5.
   */
  domainVerification: jsonb().$type<DomainChallenge[]>().notNull().default([]),
  /** Last thing that went wrong, shown to the dealer rather than swallowed. */
  domainError: text(),
  domainAddedAt: timestamp({ withTimezone: true }),
  domainVerifiedAt: timestamp({ withTimezone: true }),
  domainCheckedAt: timestamp({ withTimezone: true }),

  tagline: text(),
  phone: text().notNull(),
  addressLine: text(),
  hoursNote: text(),

  layout: storefrontLayoutEnum().notNull().default('CLASSIC'),
  /**
   * Content-addressed key into `blobs`. Not a URL: the storage implementation is
   * swappable (Postgres today, R2 when roadmap item 3 lands) and a stored URL
   * would outlive the backend that minted it.
   */
  logoKey: text(),

  /**
   * Rooftop Auto's own blue and amber, as the default a new storefront starts on.
   *
   * Deliberately the brand rather than a neutral grey: a dealer who skips the
   * colour step gets a website that looks finished, and the Design card can then
   * treat "still on these two" as "never chose" without a nullable column. Keep
   * these in step with `ROOFTOP_BRAND` / `ROOFTOP_ACCENT` in
   * `src/lib/branding/palette.ts` — that is what the admin screen compares against.
   */
  brandColor: text().notNull().default('#3d8bff'),
  accentColor: text().notNull().default('#ffb020'),
  isActive: boolean().notNull().default(true),
});

export const storefrontRooftops = pgTable(
  'storefront_rooftops',
  {
    storefrontId: text().notNull().references(() => storefronts.id, { onDelete: 'cascade' }),
    rooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.storefrontId, t.rooftopId] })],
);

/**
 * `users` doubles as Better Auth's `user` model (mapped via `user.modelName`
 * in src/lib/auth.ts). The four columns below the divider are Better Auth's;
 * `groupId` and `role` are ours and are set server-side in a database hook,
 * never accepted from the client.
 */
export const users = pgTable('users', {
  id: cuid().primaryKey(),
  groupId: text().notNull().references(() => dealerGroups.id, { onDelete: 'cascade' }),
  email: text().notNull().unique(),
  name: text().notNull(),
  role: userRoleEnum().notNull().default('MANAGER'),
  /** Landing screen. Lot Walk is the bet, so it is the default. */
  homeView: homeViewEnum().notNull().default('FEED'),
  /**
   * Personal override of the house feed style. **Nullable on purpose** — null
   * means "whatever the dealership uses", which is different from having picked
   * SOCIAL. Without the null the owner could never change the house default for
   * anyone who had already signed in, because every row would already hold a
   * value that looks like a choice.
   */
  feedStyle: feedStyleEnum(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  /* ---- Better Auth core fields ---- */
  emailVerified: boolean().notNull().default(false),
  image: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* --------------------------------------------------------- auth (Better Auth) */

export const sessions = pgTable(
  'sessions',
  {
    id: cuid().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (s) => [index('sessions_user_idx').on(s.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: cuid().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    idToken: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (a) => [index('accounts_user_idx').on(a.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: cuid().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (v) => [index('verifications_identifier_idx').on(v.identifier)],
);

/* -------------------------------------------------------------- inventory */

export const vehicles = pgTable(
  'vehicles',
  {
    id: cuid().primaryKey(),
    rooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),

    // identity
    vin: text().notNull().unique(),
    stockNumber: text().notNull(),
    year: integer().notNull(),
    make: text().notNull(),
    model: text().notNull(),
    trim: text().notNull().default(''),
    bodyStyle: bodyStyleEnum().notNull(),
    doors: integer().notNull().default(4),
    engine: text().notNull().default(''),
    cylinders: integer(),
    transmission: transmissionEnum().notNull().default('AUTOMATIC'),
    drivetrain: drivetrainEnum().notNull().default('FWD'),
    fuelType: fuelTypeEnum().notNull().default('GAS'),
    mpgCity: integer(),
    mpgHwy: integer(),

    exteriorColor: text().notNull().default(''),
    exteriorColorHex: text().notNull().default('#9ca3af'),
    interiorColor: text().notNull().default(''),
    mileage: integer().notNull(),
    titleStatus: titleStatusEnum().notNull().default('CLEAN'),
    isCertified: boolean().notNull().default(false),
    certifiedProgram: text(),

    // money — cost / pack / reconCost are INTERNAL, never syndicated
    price: integer().notNull(),
    salePrice: integer(),
    msrp: integer(),
    cost: integer().notNull().default(0),
    pack: integer().notNull().default(0),
    reconCost: integer().notNull().default(0),
    marketValue: integer().notNull().default(0),

    // workflow
    status: vehicleStatusEnum().notNull().default('ARRIVED'),
    acquisitionSource: acquisitionSourceEnum().notNull().default('AUCTION'),
    acquiredDate: timestamp({ withTimezone: true }).notNull(),
    frontLineDate: timestamp({ withTimezone: true }),
    soldDate: timestamp({ withTimezone: true }),

    // merchandising
    description: text().notNull().default(''),
    callouts: text().array().notNull().default([]),
    options: text().array().notNull().default([]),
    features: text().array().notNull().default([]),
    carfaxOneOwner: boolean().notNull().default(false),
    carfaxNoAccidents: boolean().notNull().default(false),
    carfaxUrl: text(),
    videoUrl: text(),
    keysCount: integer().notNull().default(2),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vehicles_rooftop_status_idx').on(t.rooftopId, t.status),
    index('vehicles_make_model_idx').on(t.make, t.model),
  ],
);

export const vehiclePhotos = pgTable(
  'vehicle_photos',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    sortOrder: integer().notNull().default(0),
    isPrimary: boolean().notNull().default(false),
    tag: photoTagEnum().notNull().default('EXTERIOR_SIDE'),
    alt: text().notNull().default(''),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('vehicle_photos_vehicle_sort_idx').on(t.vehicleId, t.sortOrder)],
);

export const priceChanges = pgTable(
  'price_changes',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    oldPrice: integer().notNull(),
    newPrice: integer().notNull(),
    reason: text(),
    changedBy: text().notNull().default('system'),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_changes_vehicle_idx').on(t.vehicleId, t.changedAt)],
);

/**
 * A unit moving from one of the group's lots to another.
 *
 * Three decisions worth keeping:
 *
 * **The row is the in-transit state — there is no `IN_TRANSIT` vehicle status.**
 * `vehicles.status` is the recon/merchandising workflow, and a unit can be
 * front-line ready *and* on a truck at the same time. Overloading the enum
 * would clobber the workflow state on departure and lose it on arrival. A unit
 * is in transit exactly when it has a row here with no `arrivedAt` and no
 * `cancelledAt`, which the partial unique index below allows at most one of.
 *
 * **`vehicles.rooftopId` moves on arrival, not on departure.** The car stays on
 * the origin lot's books, storefront and channel connections for the whole
 * trip. The address is briefly stale; the alternative is a unit going dark
 * mid-move, and a delist/relist cycle costs real ranking on the marketplaces.
 *
 * **Both timestamps are recorded, so transit time is a fact rather than a
 * guess.** `departedAt` defaults to now and `arrivedAt` stays null until
 * somebody says the car is there — which is the whole point of the two-step.
 * The "it's already there" shortcut sets both in one write for a fifteen-minute
 * hop across town; it does not skip the row.
 *
 * Days in stock deliberately does **not** reset on transfer: the money has been
 * tied up since `acquiredDate` wherever the car was parked.
 */
export const vehicleTransfers = pgTable(
  'vehicle_transfers',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    fromRooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
    toRooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
    departedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Null while the unit is on the truck. Set by a human at the far end. */
    arrivedAt: timestamp({ withTimezone: true }),
    /** The move was called off and the unit never left / came back. */
    cancelledAt: timestamp({ withTimezone: true }),
    departedBy: text().references(() => users.id, { onDelete: 'set null' }),
    arrivedBy: text().references(() => users.id, { onDelete: 'set null' }),
    note: text().notNull().default(''),
  },
  (t) => [
    index('vehicle_transfers_vehicle_idx').on(t.vehicleId, t.departedAt),
    index('vehicle_transfers_to_idx').on(t.toRooftopId, t.departedAt),
    /**
     * One open move per unit. Without this, a double-submitted form puts the
     * same car on two trucks and the second arrival silently overwrites the
     * first — the database refuses instead.
     */
    uniqueIndex('vehicle_transfers_open_uq')
      .on(t.vehicleId)
      .where(sql`"arrivedAt" is null and "cancelledAt" is null`),
  ],
);

/* ------------------------------------------------------------ syndication */

export const channels = pgTable('channels', {
  id: cuid().primaryKey(),
  key: text().notNull().unique(),
  name: text().notNull(),
  shortName: text().notNull(),
  kind: channelKindEnum().notNull(),
  syncMode: syncModeEnum().notNull(),
  /** how often a FEED_PULL destination pulls; ignored for PUSH_API */
  cadenceMinutes: integer().notNull().default(60),
  brandHex: text().notNull().default('#334155'),
  initials: text().notNull().default('--'),
  blurb: text().notNull().default(''),
  maxPhotos: integer().notNull().default(30),
  supportsOverrides: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
});

export const channelConnections = pgTable(
  'channel_connections',
  {
    id: cuid().primaryKey(),
    rooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
    channelId: text().notNull().references(() => channels.id, { onDelete: 'cascade' }),
    status: connectionStatusEnum().notNull().default('CONNECTED'),
    accountLabel: text().notNull().default(''),
    feedUrl: text(),
    lastSyncAt: timestamp({ withTimezone: true }),
    nextSyncAt: timestamp({ withTimezone: true }),
    errorMessage: text(),
  },
  (t) => [uniqueIndex('channel_connections_rooftop_channel_uq').on(t.rooftopId, t.channelId)],
);

/** Current listing state for one vehicle on one channel connection. */
export const vehicleSyncStates = pgTable(
  'vehicle_sync_states',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    connectionId: text().notNull().references(() => channelConnections.id, { onDelete: 'cascade' }),
    status: syncStatusEnum().notNull().default('NOT_LISTED'),
    remoteId: text(),
    remoteUrl: text(),
    payloadHash: text(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    lastAttemptAt: timestamp({ withTimezone: true }),
    pendingSince: timestamp({ withTimezone: true }),
    /** when this pending change is expected to land (next pull, or push ETA) */
    dueAt: timestamp({ withTimezone: true }),
    errorCode: text(),
    errorMessage: text(),
  },
  (t) => [
    uniqueIndex('vehicle_sync_states_vehicle_conn_uq').on(t.vehicleId, t.connectionId),
    index('vehicle_sync_states_conn_status_idx').on(t.connectionId, t.status),
  ],
);

/**
 * Append-only activity log. This is what makes "change the price here and watch
 * it change everywhere" auditable instead of a magic trick.
 */
export const syncEvents = pgTable(
  'sync_events',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    connectionId: text().notNull().references(() => channelConnections.id, { onDelete: 'cascade' }),
    action: syncActionEnum().notNull(),
    status: syncStatusEnum().notNull(),
    message: text(),
    fieldChanges: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('sync_events_vehicle_idx').on(t.vehicleId, t.createdAt),
    index('sync_events_created_idx').on(t.createdAt),
  ],
);

/** Per-VIN, per-channel merchandising overrides. Marketplace copy is not
 *  website copy — CarsForSale makes you retype it. */
export const vehicleChannelOverrides = pgTable(
  'vehicle_channel_overrides',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    channelId: text().notNull().references(() => channels.id, { onDelete: 'cascade' }),
    excluded: boolean().notNull().default(false),
    titleOverride: text(),
    descriptionOverride: text(),
    priceOverride: integer(),
  },
  (t) => [uniqueIndex('vehicle_channel_overrides_uq').on(t.vehicleId, t.channelId)],
);

/* -------------------------------------------------------------- reporting */

export const vehicleDailyStats = pgTable(
  'vehicle_daily_stats',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
    channelId: text().notNull().references(() => channels.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    vdpViews: integer().notNull().default(0),
    srpImpressions: integer().notNull().default(0),
    leads: integer().notNull().default(0),
    saves: integer().notNull().default(0),
  },
  (t) => [
    uniqueIndex('vehicle_daily_stats_uq').on(t.vehicleId, t.channelId, t.date),
    index('vehicle_daily_stats_date_idx').on(t.date),
  ],
);

export const sales = pgTable(
  'sales',
  {
    id: cuid().primaryKey(),
    vehicleId: text().notNull().unique().references(() => vehicles.id, { onDelete: 'cascade' }),
    rooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
    soldDate: timestamp({ withTimezone: true }).notNull(),
    soldPrice: integer().notNull(),
    cost: integer().notNull(),
    pack: integer().notNull(),
    reconCost: integer().notNull(),
    frontGross: integer().notNull(),
    daysToSell: integer().notNull(),
  },
  (t) => [index('sales_rooftop_date_idx').on(t.rooftopId, t.soldDate)],
);

/** Captured from VDP forms. Deliberately minimal — the CRM is not this product. */
export const leads = pgTable(
  'leads',
  {
    id: cuid().primaryKey(),
    vehicleId: text().references(() => vehicles.id, { onDelete: 'set null' }),
    storefrontId: text().notNull().references(() => storefronts.id, { onDelete: 'cascade' }),
    rooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
    channelId: text().references(() => channels.id, { onDelete: 'set null' }),
    name: text().notNull(),
    email: text().notNull(),
    phone: text().notNull().default(''),
    message: text().notNull().default(''),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('leads_rooftop_idx').on(t.rooftopId, t.createdAt)],
);

/* --------------------------------------------------------------- lot walk */

/**
 * One stat cell on a feed card. Section 2 of the data-model doc makes this
 * non-negotiable: **every card carries a number.** The moment the feed reads
 * as activity theater instead of "where my money is sitting", a dealer mutes
 * it. That is why `stats` is not nullable and why `emitFeedEvent` takes a
 * non-empty tuple — see src/lib/feed.ts.
 */
export type FeedStat = {
  /** Short uppercase label: "DAYS IN STOCK", "FRONT GROSS". */
  k: string;
  /** Already formatted for display — the writer owns the units. */
  v: string;
  /** Colour intent. Neither set = neutral. */
  good?: boolean;
  bad?: boolean;
};

/**
 * The feed. **The inventory posts, humans comment.**
 *
 * Scoped by `rooftopId` rather than by group: a multi-rooftop dealer wants to
 * walk one lot at a time, and the scoping story stays identical to vehicles.
 * `actorId` null means the system authored it, which is the common case.
 */
export const feedEvents = pgTable(
  'feed_events',
  {
    id: cuid().primaryKey(),
    rooftopId: text().notNull().references(() => rooftops.id, { onDelete: 'cascade' }),
    kind: feedEventKindEnum().notNull(),
    /** null = posted by the system. Otherwise the user who did it. */
    actorId: text().references(() => users.id, { onDelete: 'set null' }),
    /** The unit this is about, when it is about a unit. */
    vehicleId: text().references(() => vehicles.id, { onDelete: 'cascade' }),
    /** The person this is about — "meet the new rep" posts. */
    subjectUserId: text().references(() => users.id, { onDelete: 'set null' }),
    title: text().notNull(),
    body: text().notNull().default(''),
    stats: jsonb().$type<FeedStat[]>().notNull().default([]),
    /**
     * Idempotency key for threshold events. "This unit crossed 30 days" must
     * post exactly once, no matter how many times the sweep runs. Null for
     * events that are genuinely allowed to repeat (every price change is news).
     * Postgres treats NULLs as distinct, so the unique index below does not
     * collapse them.
     */
    dedupeKey: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('feed_events_rooftop_created_idx').on(t.rooftopId, t.createdAt),
    index('feed_events_vehicle_created_idx').on(t.vehicleId, t.createdAt),
    uniqueIndex('feed_events_dedupe_uq').on(t.dedupeKey),
  ],
);

/** One row per (event, user, kind). The unique index is the toggle. */
export const feedReactions = pgTable(
  'feed_reactions',
  {
    id: cuid().primaryKey(),
    eventId: text().notNull().references(() => feedEvents.id, { onDelete: 'cascade' }),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: feedReactionKindEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('feed_reactions_event_user_kind_uq').on(t.eventId, t.userId, t.kind),
    index('feed_reactions_event_idx').on(t.eventId),
  ],
);

export const feedComments = pgTable(
  'feed_comments',
  {
    id: cuid().primaryKey(),
    eventId: text().notNull().references(() => feedEvents.id, { onDelete: 'cascade' }),
    userId: text().notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feed_comments_event_created_idx').on(t.eventId, t.createdAt)],
);

/* -------------------------------------------------------------- relations */

/* ------------------------------------------------------------------ blobs */

/**
 * Small binary assets, content-addressed by sha256.
 *
 * This is deliberately the *smallest* thing that works, not the photo pipeline.
 * Roadmap item 3 (R2 + CDN + hardened sharp) is a vehicle-photo problem: 30
 * images per unit, variant generation, untrusted input at volume. A dealer logo
 * is one small image, uploaded once, changed almost never — it exercises none
 * of that. Building R2 to hold it would pay item 3's cost without its benefit.
 *
 * Everything above this table goes through `src/lib/storage.ts`, so swapping the
 * implementation to R2 later is a migration script, not a refactor.
 */
export const blobs = pgTable('blobs', {
  /** sha256 of the bytes. Dedupes uploads and makes the URL immutable. */
  key: text().primaryKey(),
  groupId: text().notNull().references(() => dealerGroups.id, { onDelete: 'cascade' }),
  contentType: text().notNull(),
  bytes: integer().notNull(),
  width: integer(),
  height: integer(),
  data: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/* ---------------------------------------------------------- domain orders */

/**
 * One row per domain purchase attempt through the Vercel Registrar API.
 *
 * Written *before* the `buy` call and updated after, so a purchase that fails
 * halfway still leaves a record. `renewalPrice` is stored at purchase time on
 * purpose: a $9 first year that renews at $40 is the real exposure, and year two
 * should be a decision rather than a surprise on the statement.
 */
export const domainOrders = pgTable(
  'domain_orders',
  {
    id: cuid().primaryKey(),
    groupId: text().notNull().references(() => dealerGroups.id, { onDelete: 'cascade' }),
    storefrontId: text().notNull().references(() => storefronts.id, { onDelete: 'cascade' }),
    domain: text().notNull(),
    status: domainOrderStatusEnum().notNull().default('QUOTED'),
    /** Whole dollars, both years. Quoted server-side and re-checked before buy. */
    priceUsd: integer().notNull(),
    renewalPriceUsd: integer(),
    years: integer().notNull().default(1),
    autoRenew: boolean().notNull().default(true),
    /** The cap in force when this order was written, for the audit trail. */
    capUsd: integer().notNull(),
    /** ICANN registrant — the dealer, from day one. */
    registrant: jsonb().$type<RegistrantContact>(),
    vercelOrderId: text(),
    error: text(),
    /** Who clicked buy. Domains spend real money; this is not anonymous. */
    orderedBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('domain_orders_group_created_idx').on(t.groupId, t.createdAt),
    uniqueIndex('domain_orders_storefront_active_uq')
      .on(t.storefrontId)
      .where(sql`status in ('QUOTED','CONTACT_PENDING','PURCHASING','PURCHASED')`),
  ],
);

export const dealerGroupsRelations = relations(dealerGroups, ({ many }) => ({
  rooftops: many(rooftops),
  storefronts: many(storefronts),
}));

export const rooftopsRelations = relations(rooftops, ({ one, many }) => ({
  group: one(dealerGroups, { fields: [rooftops.groupId], references: [dealerGroups.id] }),
  vehicles: many(vehicles),
  connections: many(channelConnections),
  storefronts: many(storefrontRooftops),
}));

export const storefrontsRelations = relations(storefronts, ({ one, many }) => ({
  group: one(dealerGroups, { fields: [storefronts.groupId], references: [dealerGroups.id] }),
  rooftops: many(storefrontRooftops),
}));

export const storefrontRooftopsRelations = relations(storefrontRooftops, ({ one }) => ({
  storefront: one(storefronts, {
    fields: [storefrontRooftops.storefrontId],
    references: [storefronts.id],
  }),
  rooftop: one(rooftops, {
    fields: [storefrontRooftops.rooftopId],
    references: [rooftops.id],
  }),
}));

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  rooftop: one(rooftops, { fields: [vehicles.rooftopId], references: [rooftops.id] }),
  photos: many(vehiclePhotos),
  syncStates: many(vehicleSyncStates),
  overrides: many(vehicleChannelOverrides),
  priceChanges: many(priceChanges),
  dailyStats: many(vehicleDailyStats),
  events: many(syncEvents),
  transfers: many(vehicleTransfers),
}));

export const vehicleTransfersRelations = relations(vehicleTransfers, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleTransfers.vehicleId], references: [vehicles.id] }),
  from: one(rooftops, { fields: [vehicleTransfers.fromRooftopId], references: [rooftops.id] }),
  to: one(rooftops, { fields: [vehicleTransfers.toRooftopId], references: [rooftops.id] }),
  departedByUser: one(users, { fields: [vehicleTransfers.departedBy], references: [users.id] }),
  arrivedByUser: one(users, { fields: [vehicleTransfers.arrivedBy], references: [users.id] }),
}));

export const vehiclePhotosRelations = relations(vehiclePhotos, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehiclePhotos.vehicleId], references: [vehicles.id] }),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
  connections: many(channelConnections),
}));

export const channelConnectionsRelations = relations(channelConnections, ({ one, many }) => ({
  rooftop: one(rooftops, { fields: [channelConnections.rooftopId], references: [rooftops.id] }),
  channel: one(channels, { fields: [channelConnections.channelId], references: [channels.id] }),
  syncStates: many(vehicleSyncStates),
  events: many(syncEvents),
}));

export const vehicleSyncStatesRelations = relations(vehicleSyncStates, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleSyncStates.vehicleId], references: [vehicles.id] }),
  connection: one(channelConnections, {
    fields: [vehicleSyncStates.connectionId],
    references: [channelConnections.id],
  }),
}));

export const syncEventsRelations = relations(syncEvents, ({ one }) => ({
  vehicle: one(vehicles, { fields: [syncEvents.vehicleId], references: [vehicles.id] }),
  connection: one(channelConnections, {
    fields: [syncEvents.connectionId],
    references: [channelConnections.id],
  }),
}));

export const vehicleChannelOverridesRelations = relations(vehicleChannelOverrides, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleChannelOverrides.vehicleId], references: [vehicles.id] }),
  channel: one(channels, { fields: [vehicleChannelOverrides.channelId], references: [channels.id] }),
}));

export const vehicleDailyStatsRelations = relations(vehicleDailyStats, ({ one }) => ({
  vehicle: one(vehicles, { fields: [vehicleDailyStats.vehicleId], references: [vehicles.id] }),
  channel: one(channels, { fields: [vehicleDailyStats.channelId], references: [channels.id] }),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  vehicle: one(vehicles, { fields: [sales.vehicleId], references: [vehicles.id] }),
  rooftop: one(rooftops, { fields: [sales.rooftopId], references: [rooftops.id] }),
}));

export const feedEventsRelations = relations(feedEvents, ({ one, many }) => ({
  rooftop: one(rooftops, { fields: [feedEvents.rooftopId], references: [rooftops.id] }),
  vehicle: one(vehicles, { fields: [feedEvents.vehicleId], references: [vehicles.id] }),
  actor: one(users, { fields: [feedEvents.actorId], references: [users.id] }),
  subject: one(users, { fields: [feedEvents.subjectUserId], references: [users.id] }),
  reactions: many(feedReactions),
  comments: many(feedComments),
}));

export const feedReactionsRelations = relations(feedReactions, ({ one }) => ({
  event: one(feedEvents, { fields: [feedReactions.eventId], references: [feedEvents.id] }),
  user: one(users, { fields: [feedReactions.userId], references: [users.id] }),
}));

export const feedCommentsRelations = relations(feedComments, ({ one }) => ({
  event: one(feedEvents, { fields: [feedComments.eventId], references: [feedEvents.id] }),
  user: one(users, { fields: [feedComments.userId], references: [users.id] }),
}));

/* ------------------------------------------------------------------ types */

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type VehiclePhoto = typeof vehiclePhotos.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type ChannelConnection = typeof channelConnections.$inferSelect;
export type VehicleSyncState = typeof vehicleSyncStates.$inferSelect;
export type SyncEvent = typeof syncEvents.$inferSelect;
export type Rooftop = typeof rooftops.$inferSelect;
export type Storefront = typeof storefronts.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SyncStatus = (typeof syncStatusEnum.enumValues)[number];
export type VehicleStatus = (typeof vehicleStatusEnum.enumValues)[number];
export type VehicleTransfer = typeof vehicleTransfers.$inferSelect;
export type FeedEvent = typeof feedEvents.$inferSelect;
export type NewFeedEvent = typeof feedEvents.$inferInsert;
export type FeedComment = typeof feedComments.$inferSelect;
export type FeedReaction = typeof feedReactions.$inferSelect;
export type FeedEventKind = (typeof feedEventKindEnum.enumValues)[number];
export type FeedReactionKind = (typeof feedReactionKindEnum.enumValues)[number];
export type HomeView = (typeof homeViewEnum.enumValues)[number];
export type FeedStyle = (typeof feedStyleEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type StorefrontLayout = (typeof storefrontLayoutEnum.enumValues)[number];
export type DomainStatus = (typeof domainStatusEnum.enumValues)[number];
export type DomainSource = (typeof domainSourceEnum.enumValues)[number];
export type DomainOrder = typeof domainOrders.$inferSelect;
export type DomainOrderStatus = (typeof domainOrderStatusEnum.enumValues)[number];
export type Blob = typeof blobs.$inferSelect;

/* ------------------------------------------------------------ meta ad desk */

/**
 * Meta connection health.
 *
 * NEEDS_REAUTH is distinct from ERROR on purpose. A system-user token does not
 * expire, but the dealer can revoke it from their own Business settings at any
 * time — and per Meta's Developer Policy we are required to let them. That is a
 * normal, expected end state, not a fault, and the dealer-facing copy differs:
 * "reconnect Facebook" versus "something broke, we're looking at it".
 */
export const metaConnectionStatusEnum = pgEnum('meta_connection_status', [
  'CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED', 'ERROR',
]);

/**
 * Which token shape the dealer ended up with.
 *
 * SYSTEM_USER is the one we want: a Business Integration System User created
 * inside the *dealer's* portfolio, scoped to the assets they ticked, and
 * non-expiring — so a salesperson leaving the dealership does not break the
 * integration, which is the failure mode that kills most agency setups.
 *
 * USER is the fallback for a dealer whose Page and ad account are not owned by
 * the same business, or who has no business admin available. Meta's own
 * guidance names this case. It costs a 60-day expiry and a re-auth prompt, and
 * a lot whose Page was set up by someone who left in 2019 will land here more
 * often than the happy path suggests.
 */
export const metaTokenKindEnum = pgEnum('meta_token_kind', ['SYSTEM_USER', 'USER']);

/**
 * Where the vehicles catalog came from.
 *
 * ADOPTED means the dealer already had one and we attached to it. CREATED means
 * we made it. The distinction matters on disconnect: we delete nothing either
 * way, but a catalog we created is one we can explain, and a catalog we adopted
 * may be carrying somebody else's feed.
 */
export const metaCatalogSourceEnum = pgEnum('meta_catalog_source', ['ADOPTED', 'CREATED']);

/**
 * One row per dealer group: the Meta business portfolio and the token we hold
 * against it.
 *
 * KEYED BY GROUP, NOT ROOFTOP, because a Business Manager is a company-level
 * object — a two-lot dealer logs in once. The per-lot assets (Page, ad account,
 * catalog, feed) hang off `metaRooftopAssets`, which is the level Meta itself
 * works at: "a single auto feed to represent all vehicles, or multiple auto
 * feeds where each feed represents a single dealership."
 *
 * THE CATALOG IS OWNED BY THE DEALER'S BUSINESS, NOT OURS. See
 * `claude/meta-ad-desk-build.md` §2. We hold access; they hold title. A dealer
 * who leaves keeps their catalog, pixel history and audiences, and needs no
 * approval from us to do it — which is precisely the hostage dynamic they
 * already resent about their incumbent vendors.
 */
export const metaConnections = pgTable('meta_connections', {
  id: cuid().primaryKey(),
  groupId: text().notNull().unique().references(() => dealerGroups.id, { onDelete: 'cascade' }),

  /** The dealer's Meta business portfolio id, from `GET /me?fields=client_business_id`. */
  businessId: text().notNull(),
  businessName: text().notNull().default(''),
  /** The BISU Meta created inside the dealer's portfolio. Null on the USER fallback. */
  systemUserId: text(),

  /**
   * AES-256-GCM ciphertext, never the raw token — see `src/lib/meta/tokens.ts`.
   * A system-user token does not expire, so a database leak is *permanent*
   * access to a dealer's ad account and ad spend. That asymmetry is why this
   * column is encrypted when `users.password` hashing would have been enough
   * for a credential we could simply reset.
   */
  accessTokenCipher: text().notNull(),
  tokenKind: metaTokenKindEnum().notNull().default('SYSTEM_USER'),
  /** Null for SYSTEM_USER (non-expiring). Set for the USER fallback. */
  tokenExpiresAt: timestamp({ withTimezone: true }),

  /** What Meta actually granted, which is not always what we asked for. */
  grantedScopes: jsonb().$type<string[]>().notNull().default([]),

  status: metaConnectionStatusEnum().notNull().default('CONNECTED'),
  errorMessage: text(),

  connectedByUserId: text().references(() => users.id, { onDelete: 'set null' }),
  connectedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp({ withTimezone: true }),
});

/**
 * Per-lot Meta assets: the Page the ads run from, the ad account that pays, the
 * vehicles catalog, its scheduled feed, and the pixel.
 *
 * All nullable, and that is the design rather than an oversight. A dealer can
 * arrive with all five, none, or any subset, and the connect flow has to be a
 * branch rather than a happy path — most independent lots have a Page and
 * nothing else. Partial state is the normal state, and the UI reads these
 * columns to decide what it still has to ask for.
 */
export const metaRooftopAssets = pgTable(
  'meta_rooftop_assets',
  {
    id: cuid().primaryKey(),
    connectionId: text().notNull().references(() => metaConnections.id, { onDelete: 'cascade' }),
    rooftopId: text().notNull().unique().references(() => rooftops.id, { onDelete: 'cascade' }),

    pageId: text(),
    pageName: text(),

    adAccountId: text(),
    adAccountName: text(),

    catalogId: text(),
    catalogName: text(),
    catalogSource: metaCatalogSourceEnum(),

    /** `POST /{catalog_id}/product_feeds` — the daily full-replace feed. */
    productFeedId: text(),
    /**
     * Random path segment for the public feed URL Meta fetches.
     *
     * Meta pulls the feed unauthenticated from a URL we hand it, and that feed
     * carries the lot's entire inventory with prices. It is not secret data —
     * it is on the storefront too — but it should not be *enumerable* by
     * walking rooftop ids, which is what a predictable URL would allow.
     */
    feedSecret: text(),

    pixelId: text(),

    errorMessage: text(),
    provisionedAt: timestamp({ withTimezone: true }),
    lastFeedPushAt: timestamp({ withTimezone: true }),
  },
  (t) => [index('meta_rooftop_assets_connection_idx').on(t.connectionId)],
);
