CREATE TYPE "public"."feed_style" AS ENUM('SOCIAL', 'LOG');--> statement-breakpoint
ALTER TYPE "public"."feed_event_kind" ADD VALUE 'transfer_inbound';--> statement-breakpoint
ALTER TABLE "dealer_groups" ADD COLUMN "feedStyle" "feed_style" DEFAULT 'SOCIAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "feedStyle" "feed_style";