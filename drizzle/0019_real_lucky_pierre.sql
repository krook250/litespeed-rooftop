ALTER TYPE "public"."feed_event_kind" ADD VALUE 'bell' BEFORE 'domain';--> statement-breakpoint
ALTER TABLE "dealer_groups" ALTER COLUMN "feedStyle" SET DEFAULT 'LOG';