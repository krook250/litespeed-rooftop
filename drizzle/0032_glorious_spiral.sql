CREATE TABLE "page_views" (
	"id" text PRIMARY KEY NOT NULL,
	"storefrontId" text NOT NULL,
	"vehicleId" text,
	"visitorId" text NOT NULL,
	"path" text NOT NULL,
	"source" text NOT NULL,
	"referrerHost" text,
	"utmSource" text,
	"utmMedium" text,
	"utmCampaign" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "gaMeasurementId" text;--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_storefrontId_storefronts_id_fk" FOREIGN KEY ("storefrontId") REFERENCES "public"."storefronts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_views_storefront_idx" ON "page_views" USING btree ("storefrontId","createdAt");--> statement-breakpoint
CREATE INDEX "page_views_vehicle_idx" ON "page_views" USING btree ("vehicleId","createdAt");