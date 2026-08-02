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
import { relations } from 'drizzle-orm';

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

/* ---------------------------------------------------------------- tenancy */

export const dealerGroups = pgTable('dealer_groups', {
  id: cuid().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
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

export const storefronts = pgTable('storefronts', {
  id: cuid().primaryKey(),
  groupId: text().notNull().references(() => dealerGroups.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  slug: text().notNull().unique(),
  domain: text(),
  tagline: text(),
  phone: text().notNull(),
  addressLine: text(),
  hoursNote: text(),
  brandColor: text().notNull().default('#1d4ed8'),
  accentColor: text().notNull().default('#f97316'),
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

/* -------------------------------------------------------------- relations */

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
