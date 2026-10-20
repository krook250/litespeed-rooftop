CREATE TYPE "public"."social_platform" AS ENUM('FACEBOOK', 'INSTAGRAM');--> statement-breakpoint
CREATE TYPE "public"."social_post_kind" AS ENUM('VEHICLE', 'WALKAROUND', 'VIDEO', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."social_post_source" AS ENUM('MANUAL', 'AUTO_RANDOM', 'NEW_ARRIVAL', 'PRICE_DROP');--> statement-breakpoint
CREATE TYPE "public"."social_post_status" AS ENUM('SCHEDULED', 'POSTING', 'POSTED', 'PARTIAL', 'FAILED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."social_target_status" AS ENUM('QUEUED', 'PROCESSING', 'POSTED', 'FAILED');--> statement-breakpoint
CREATE TABLE "social_post_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"status" "social_target_status" DEFAULT 'QUEUED' NOT NULL,
	"containerId" text,
	"externalId" text,
	"permalink" text,
	"error" text,
	"startedAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"rooftopId" text NOT NULL,
	"kind" "social_post_kind" NOT NULL,
	"source" "social_post_source" DEFAULT 'MANUAL' NOT NULL,
	"vehicleId" text,
	"videoId" text,
	"photoUrls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"link" text,
	"scheduledFor" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "social_post_status" DEFAULT 'SCHEDULED' NOT NULL,
	"createdBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_postId_social_posts_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_videoId_videos_id_fk" FOREIGN KEY ("videoId") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_post_targets_post_platform_uq" ON "social_post_targets" USING btree ("postId","platform");--> statement-breakpoint
CREATE INDEX "social_post_targets_status_idx" ON "social_post_targets" USING btree ("status","updatedAt");--> statement-breakpoint
CREATE INDEX "social_posts_rooftop_sched_idx" ON "social_posts" USING btree ("rooftopId","scheduledFor");--> statement-breakpoint
CREATE INDEX "social_posts_vehicle_idx" ON "social_posts" USING btree ("vehicleId");