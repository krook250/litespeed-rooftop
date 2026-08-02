CREATE TYPE "public"."domain_order_status" AS ENUM('QUOTED', 'CONTACT_PENDING', 'PURCHASING', 'PURCHASED', 'FAILED', 'REJECTED_OVER_CAP');--> statement-breakpoint
CREATE TYPE "public"."domain_source" AS ENUM('BYO', 'PURCHASED');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('NONE', 'BLOCKED', 'PENDING_DNS', 'VERIFYING', 'SSL_ISSUING', 'LIVE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."storefront_layout" AS ENUM('CLASSIC', 'SHOWCASE', 'LOT_LIST');--> statement-breakpoint
ALTER TYPE "public"."feed_event_kind" ADD VALUE 'domain';--> statement-breakpoint
CREATE TABLE "blobs" (
	"key" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"contentType" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"data" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"storefrontId" text NOT NULL,
	"domain" text NOT NULL,
	"status" "domain_order_status" DEFAULT 'QUOTED' NOT NULL,
	"priceUsd" integer NOT NULL,
	"renewalPriceUsd" integer,
	"years" integer DEFAULT 1 NOT NULL,
	"autoRenew" boolean DEFAULT true NOT NULL,
	"capUsd" integer NOT NULL,
	"registrant" jsonb,
	"vercelOrderId" text,
	"error" text,
	"orderedBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainSource" "domain_source";--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainStatus" "domain_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainVerification" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainError" text;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainAddedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainVerifiedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainCheckedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "layout" "storefront_layout" DEFAULT 'CLASSIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "logoKey" text;--> statement-breakpoint
ALTER TABLE "blobs" ADD CONSTRAINT "blobs_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_storefrontId_storefronts_id_fk" FOREIGN KEY ("storefrontId") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_orders" ADD CONSTRAINT "domain_orders_orderedBy_users_id_fk" FOREIGN KEY ("orderedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_orders_group_created_idx" ON "domain_orders" USING btree ("groupId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_orders_storefront_active_uq" ON "domain_orders" USING btree ("storefrontId") WHERE status in ('QUOTED','CONTACT_PENDING','PURCHASING','PURCHASED');--> statement-breakpoint
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_domain_unique" UNIQUE("domain");