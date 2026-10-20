CREATE TYPE "public"."video_ad_goal" AS ENUM('CLICKS', 'VIEWS');--> statement-breakpoint
CREATE TABLE "video_ad_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"name" text NOT NULL,
	"goal" "video_ad_goal" DEFAULT 'CLICKS' NOT NULL,
	"dailyBudgetUsd" integer DEFAULT 20 NOT NULL,
	"radiusMiles" integer DEFAULT 25 NOT NULL,
	"campaignId" text,
	"adSetId" text,
	"builtAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_ads" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"videoId" text,
	"message" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"callToAction" text DEFAULT 'LEARN_MORE' NOT NULL,
	"link" text NOT NULL,
	"fbVideoId" text,
	"creativeId" text,
	"adId" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_ad_groups" ADD CONSTRAINT "video_ad_groups_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ads" ADD CONSTRAINT "video_ads_groupId_video_ad_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."video_ad_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ads" ADD CONSTRAINT "video_ads_videoId_videos_id_fk" FOREIGN KEY ("videoId") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_ad_groups_rooftop_idx" ON "video_ad_groups" USING btree ("rooftopId");--> statement-breakpoint
CREATE INDEX "video_ads_group_idx" ON "video_ads" USING btree ("groupId","sortOrder");