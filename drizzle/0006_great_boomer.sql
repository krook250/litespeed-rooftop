CREATE TYPE "public"."meta_catalog_source" AS ENUM('ADOPTED', 'CREATED');--> statement-breakpoint
CREATE TYPE "public"."meta_connection_status" AS ENUM('CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."meta_token_kind" AS ENUM('SYSTEM_USER', 'USER');--> statement-breakpoint
CREATE TABLE "intake_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"vehicleId" text,
	"userId" text,
	"reader" text NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"documentKind" text DEFAULT 'UNKNOWN' NOT NULL,
	"pageCount" integer DEFAULT 1 NOT NULL,
	"blobKeys" text[] DEFAULT '{}' NOT NULL,
	"vin" text,
	"vinChecksums" boolean,
	"extraction" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript" text,
	"rawResponse" jsonb,
	"readMs" integer DEFAULT 0 NOT NULL,
	"totalMs" integer DEFAULT 0 NOT NULL,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"businessId" text NOT NULL,
	"businessName" text DEFAULT '' NOT NULL,
	"systemUserId" text,
	"accessTokenCipher" text NOT NULL,
	"tokenKind" "meta_token_kind" DEFAULT 'SYSTEM_USER' NOT NULL,
	"tokenExpiresAt" timestamp with time zone,
	"grantedScopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "meta_connection_status" DEFAULT 'CONNECTED' NOT NULL,
	"errorMessage" text,
	"connectedByUserId" text,
	"connectedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastCheckedAt" timestamp with time zone,
	CONSTRAINT "meta_connections_groupId_unique" UNIQUE("groupId")
);
--> statement-breakpoint
CREATE TABLE "meta_rooftop_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"connectionId" text NOT NULL,
	"rooftopId" text NOT NULL,
	"pageId" text,
	"pageName" text,
	"adAccountId" text,
	"adAccountName" text,
	"catalogId" text,
	"catalogName" text,
	"catalogSource" "meta_catalog_source",
	"productFeedId" text,
	"feedSecret" text,
	"pixelId" text,
	"errorMessage" text,
	"provisionedAt" timestamp with time zone,
	"lastFeedPushAt" timestamp with time zone,
	CONSTRAINT "meta_rooftop_assets_rooftopId_unique" UNIQUE("rooftopId")
);
--> statement-breakpoint
CREATE TABLE "vin_decodes" (
	"vin" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"decodedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storefronts" ALTER COLUMN "brandColor" SET DEFAULT '#3d8bff';--> statement-breakpoint
ALTER TABLE "storefronts" ALTER COLUMN "accentColor" SET DEFAULT '#ffb020';--> statement-breakpoint
ALTER TABLE "intake_scans" ADD CONSTRAINT "intake_scans_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_scans" ADD CONSTRAINT "intake_scans_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_scans" ADD CONSTRAINT "intake_scans_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_connectedByUserId_users_id_fk" FOREIGN KEY ("connectedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_rooftop_assets" ADD CONSTRAINT "meta_rooftop_assets_connectionId_meta_connections_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_rooftop_assets" ADD CONSTRAINT "meta_rooftop_assets_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "intake_scans_rooftop_idx" ON "intake_scans" USING btree ("rooftopId","createdAt");--> statement-breakpoint
CREATE INDEX "intake_scans_vin_idx" ON "intake_scans" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "meta_rooftop_assets_connection_idx" ON "meta_rooftop_assets" USING btree ("connectionId");