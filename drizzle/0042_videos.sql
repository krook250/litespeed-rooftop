CREATE TYPE "public"."video_kind" AS ENUM('WALKAROUND', 'LOT', 'INTRO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('UPLOADING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"rooftopId" text,
	"vehicleId" text,
	"kind" "video_kind" DEFAULT 'OTHER' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" "video_status" DEFAULT 'UPLOADING' NOT NULL,
	"muxUploadId" text,
	"muxAssetId" text,
	"playbackId" text,
	"mp4Name" text,
	"durationSec" real,
	"aspectRatio" text,
	"error" text,
	"createdBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_muxUploadId_unique" UNIQUE("muxUploadId"),
	CONSTRAINT "videos_muxAssetId_unique" UNIQUE("muxAssetId")
);
--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "introVideoId" text;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "videos_group_created_idx" ON "videos" USING btree ("groupId","createdAt");--> statement-breakpoint
CREATE INDEX "videos_vehicle_idx" ON "videos" USING btree ("vehicleId");--> statement-breakpoint
ALTER TABLE "storefronts" ADD CONSTRAINT "storefronts_introVideoId_videos_id_fk" FOREIGN KEY ("introVideoId") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;