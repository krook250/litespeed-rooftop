ALTER TYPE "public"."domain_status" ADD VALUE 'RESERVED' BEFORE 'BLOCKED';--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainPriorDns" jsonb;--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "domainReservedAt" timestamp with time zone;