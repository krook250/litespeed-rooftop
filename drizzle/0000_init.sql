CREATE TYPE "public"."acquisition_source" AS ENUM('AUCTION', 'TRADE_IN', 'STREET_PURCHASE', 'LEASE_RETURN', 'DEALER_TRADE');--> statement-breakpoint
CREATE TYPE "public"."body_style" AS ENUM('SEDAN', 'SUV', 'TRUCK', 'COUPE', 'HATCHBACK', 'WAGON', 'VAN', 'CONVERTIBLE');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('WEBSITE', 'SOCIAL', 'SEARCH', 'MARKETPLACE', 'CLASSIFIED');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('CONNECTED', 'PENDING_SETUP', 'DISCONNECTED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."drivetrain" AS ENUM('FWD', 'RWD', 'AWD', 'FOUR_WD');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('GAS', 'DIESEL', 'HYBRID', 'PLUGIN_HYBRID', 'ELECTRIC', 'FLEX');--> statement-breakpoint
CREATE TYPE "public"."photo_tag" AS ENUM('EXTERIOR_FRONT', 'EXTERIOR_SIDE', 'EXTERIOR_REAR', 'INTERIOR', 'ODOMETER', 'ENGINE', 'DAMAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."sync_action" AS ENUM('CREATE', 'UPDATE_PRICE', 'UPDATE_PHOTOS', 'UPDATE_DETAILS', 'REMOVE', 'RELIST');--> statement-breakpoint
CREATE TYPE "public"."sync_mode" AS ENUM('PUSH_API', 'FEED_PULL');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('NOT_LISTED', 'PENDING', 'QUEUED', 'SYNCING', 'LIVE', 'ERROR', 'REMOVED', 'EXCLUDED');--> statement-breakpoint
CREATE TYPE "public"."title_status" AS ENUM('CLEAN', 'REBUILT', 'SALVAGE', 'BONDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL', 'CVT');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'MANAGER', 'SALES', 'LOT_PORTER');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('ARRIVED', 'IN_RECON', 'PHOTOS_PENDING', 'FRONT_LINE_READY', 'PENDING_SALE', 'SOLD', 'WHOLESALED');--> statement-breakpoint
CREATE TABLE "channel_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"channelId" text NOT NULL,
	"status" "connection_status" DEFAULT 'CONNECTED' NOT NULL,
	"accountLabel" text DEFAULT '' NOT NULL,
	"feedUrl" text,
	"lastSyncAt" timestamp with time zone,
	"nextSyncAt" timestamp with time zone,
	"errorMessage" text
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"shortName" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"syncMode" "sync_mode" NOT NULL,
	"cadenceMinutes" integer DEFAULT 60 NOT NULL,
	"brandHex" text DEFAULT '#334155' NOT NULL,
	"initials" text DEFAULT '--' NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"maxPhotos" integer DEFAULT 30 NOT NULL,
	"supportsOverrides" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channels_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "dealer_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_groups_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text,
	"storefrontId" text NOT NULL,
	"rooftopId" text NOT NULL,
	"channelId" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"oldPrice" integer NOT NULL,
	"newPrice" integer NOT NULL,
	"reason" text,
	"changedBy" text DEFAULT 'system' NOT NULL,
	"changedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooftops" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"addressLine1" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postalCode" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooftops_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"rooftopId" text NOT NULL,
	"soldDate" timestamp with time zone NOT NULL,
	"soldPrice" integer NOT NULL,
	"cost" integer NOT NULL,
	"pack" integer NOT NULL,
	"reconCost" integer NOT NULL,
	"frontGross" integer NOT NULL,
	"daysToSell" integer NOT NULL,
	CONSTRAINT "sales_vehicleId_unique" UNIQUE("vehicleId")
);
--> statement-breakpoint
CREATE TABLE "storefront_rooftops" (
	"storefrontId" text NOT NULL,
	"rooftopId" text NOT NULL,
	CONSTRAINT "storefront_rooftops_storefrontId_rooftopId_pk" PRIMARY KEY("storefrontId","rooftopId")
);
--> statement-breakpoint
CREATE TABLE "storefronts" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"domain" text,
	"tagline" text,
	"phone" text NOT NULL,
	"addressLine" text,
	"hoursNote" text,
	"brandColor" text DEFAULT '#1d4ed8' NOT NULL,
	"accentColor" text DEFAULT '#f97316' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	CONSTRAINT "storefronts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"connectionId" text NOT NULL,
	"action" "sync_action" NOT NULL,
	"status" "sync_status" NOT NULL,
	"message" text,
	"fieldChanges" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'MANAGER' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_channel_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"channelId" text NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"titleOverride" text,
	"descriptionOverride" text,
	"priceOverride" integer
);
--> statement-breakpoint
CREATE TABLE "vehicle_daily_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"channelId" text NOT NULL,
	"date" date NOT NULL,
	"vdpViews" integer DEFAULT 0 NOT NULL,
	"srpImpressions" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_photos" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"url" text NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isPrimary" boolean DEFAULT false NOT NULL,
	"tag" "photo_tag" DEFAULT 'EXTERIOR_SIDE' NOT NULL,
	"alt" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_sync_states" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"connectionId" text NOT NULL,
	"status" "sync_status" DEFAULT 'NOT_LISTED' NOT NULL,
	"remoteId" text,
	"remoteUrl" text,
	"payloadHash" text,
	"lastSyncedAt" timestamp with time zone,
	"lastAttemptAt" timestamp with time zone,
	"pendingSince" timestamp with time zone,
	"dueAt" timestamp with time zone,
	"errorCode" text,
	"errorMessage" text
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"vin" text NOT NULL,
	"stockNumber" text NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text DEFAULT '' NOT NULL,
	"bodyStyle" "body_style" NOT NULL,
	"doors" integer DEFAULT 4 NOT NULL,
	"engine" text DEFAULT '' NOT NULL,
	"cylinders" integer,
	"transmission" "transmission" DEFAULT 'AUTOMATIC' NOT NULL,
	"drivetrain" "drivetrain" DEFAULT 'FWD' NOT NULL,
	"fuelType" "fuel_type" DEFAULT 'GAS' NOT NULL,
	"mpgCity" integer,
	"mpgHwy" integer,
	"exteriorColor" text DEFAULT '' NOT NULL,
	"exteriorColorHex" text DEFAULT '#9ca3af' NOT NULL,
	"interiorColor" text DEFAULT '' NOT NULL,
	"mileage" integer NOT NULL,
	"titleStatus" "title_status" DEFAULT 'CLEAN' NOT NULL,
	"isCertified" boolean DEFAULT false NOT NULL,
	"certifiedProgram" text,
	"price" integer NOT NULL,
	"salePrice" integer,
	"msrp" integer,
	"cost" integer DEFAULT 0 NOT NULL,
	"pack" integer DEFAULT 0 NOT NULL,
	"reconCost" integer DEFAULT 0 NOT NULL,
	"marketValue" integer DEFAULT 0 NOT NULL,
	"status" "vehicle_status" DEFAULT 'ARRIVED' NOT NULL,
	"acquisitionSource" "acquisition_source" DEFAULT 'AUCTION' NOT NULL,
	"acquiredDate" timestamp with time zone NOT NULL,
	"frontLineDate" timestamp with time zone,
	"soldDate" timestamp with time zone,
	"description" text DEFAULT '' NOT NULL,
	"callouts" text[] DEFAULT '{}' NOT NULL,
	"options" text[] DEFAULT '{}' NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"carfaxOneOwner" boolean DEFAULT false NOT NULL,
	"carfaxNoAccidents" boolean DEFAULT false NOT NULL,
	"carfaxUrl" text,
	"videoUrl" text,
	"keysCount" integer DEFAULT 2 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_channelId_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_storefrontId_storefronts_id_fk" FOREIGN KEY ("storefrontId") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_channelId_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooftops" ADD CONSTRAINT "rooftops_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_rooftops" ADD CONSTRAINT "storefront_rooftops_storefrontId_storefronts_id_fk" FOREIGN KEY ("storefrontId") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefront_rooftops" ADD CONSTRAINT "storefront_rooftops_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_connectionId_channel_connections_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_channel_overrides" ADD CONSTRAINT "vehicle_channel_overrides_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_channel_overrides" ADD CONSTRAINT "vehicle_channel_overrides_channelId_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_daily_stats" ADD CONSTRAINT "vehicle_daily_stats_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_daily_stats" ADD CONSTRAINT "vehicle_daily_stats_channelId_channels_id_fk" FOREIGN KEY ("channelId") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sync_states" ADD CONSTRAINT "vehicle_sync_states_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sync_states" ADD CONSTRAINT "vehicle_sync_states_connectionId_channel_connections_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."channel_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_connections_rooftop_channel_uq" ON "channel_connections" USING btree ("rooftopId","channelId");--> statement-breakpoint
CREATE INDEX "leads_rooftop_idx" ON "leads" USING btree ("rooftopId","createdAt");--> statement-breakpoint
CREATE INDEX "price_changes_vehicle_idx" ON "price_changes" USING btree ("vehicleId","changedAt");--> statement-breakpoint
CREATE INDEX "sales_rooftop_date_idx" ON "sales" USING btree ("rooftopId","soldDate");--> statement-breakpoint
CREATE INDEX "sync_events_vehicle_idx" ON "sync_events" USING btree ("vehicleId","createdAt");--> statement-breakpoint
CREATE INDEX "sync_events_created_idx" ON "sync_events" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_channel_overrides_uq" ON "vehicle_channel_overrides" USING btree ("vehicleId","channelId");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_daily_stats_uq" ON "vehicle_daily_stats" USING btree ("vehicleId","channelId","date");--> statement-breakpoint
CREATE INDEX "vehicle_daily_stats_date_idx" ON "vehicle_daily_stats" USING btree ("date");--> statement-breakpoint
CREATE INDEX "vehicle_photos_vehicle_sort_idx" ON "vehicle_photos" USING btree ("vehicleId","sortOrder");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_sync_states_vehicle_conn_uq" ON "vehicle_sync_states" USING btree ("vehicleId","connectionId");--> statement-breakpoint
CREATE INDEX "vehicle_sync_states_conn_status_idx" ON "vehicle_sync_states" USING btree ("connectionId","status");--> statement-breakpoint
CREATE INDEX "vehicles_rooftop_status_idx" ON "vehicles" USING btree ("rooftopId","status");--> statement-breakpoint
CREATE INDEX "vehicles_make_model_idx" ON "vehicles" USING btree ("make","model");