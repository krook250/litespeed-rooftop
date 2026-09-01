CREATE TYPE "public"."photo_ingest_status" AS ENUM('PENDING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TABLE "photo_ingests" (
	"id" text PRIMARY KEY NOT NULL,
	"photoId" text NOT NULL,
	"vehicleId" text NOT NULL,
	"sourceUrl" text NOT NULL,
	"status" "photo_ingest_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text DEFAULT '' NOT NULL,
	"blobUrl" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"attemptedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "photo_ingests" ADD CONSTRAINT "photo_ingests_photoId_vehicle_photos_id_fk" FOREIGN KEY ("photoId") REFERENCES "public"."vehicle_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_ingests" ADD CONSTRAINT "photo_ingests_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_ingests_photo_uq" ON "photo_ingests" USING btree ("photoId");--> statement-breakpoint
CREATE INDEX "photo_ingests_status_idx" ON "photo_ingests" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "photo_ingests_source_idx" ON "photo_ingests" USING btree ("sourceUrl");