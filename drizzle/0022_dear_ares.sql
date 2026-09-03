CREATE TYPE "public"."plan_status" AS ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');--> statement-breakpoint
ALTER TABLE "dealer_groups" ADD COLUMN "plan" "plan_status" DEFAULT 'TRIALING' NOT NULL;--> statement-breakpoint
ALTER TABLE "dealer_groups" ADD COLUMN "trialEndsAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dealer_groups" ADD COLUMN "activatedAt" timestamp with time zone;--> statement-breakpoint
-- Every group that exists at this point predates self-serve trials: the demo lot
-- and anything hand-onboarded. The ADD COLUMN above defaulted them all to
-- TRIALING, which would put David's own dealers on a 30-day clock and lock them
-- out of the domain gate. Mark them ACTIVE with no trial deadline. New rows keep
-- the column default.
UPDATE "dealer_groups" SET "plan" = 'ACTIVE', "activatedAt" = "createdAt";
