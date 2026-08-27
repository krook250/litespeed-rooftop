CREATE TYPE "public"."feed_upload_status" AS ENUM('UPLOADED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TABLE "feed_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"channelKey" text NOT NULL,
	"filename" text NOT NULL,
	"status" "feed_upload_status" NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"lotCount" integer DEFAULT 0 NOT NULL,
	"rowCount" integer DEFAULT 0 NOT NULL,
	"excludedCount" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"rawBytes" integer DEFAULT 0 NOT NULL,
	"contentHash" text,
	"lots" jsonb,
	"warnings" jsonb,
	"message" text
);
--> statement-breakpoint
CREATE INDEX "feed_uploads_channel_started_idx" ON "feed_uploads" USING btree ("channelKey","startedAt");