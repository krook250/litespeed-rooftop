ALTER TYPE "public"."connection_status" ADD VALUE 'AWAITING_DEALER' BEFORE 'DISCONNECTED';--> statement-breakpoint
ALTER TYPE "public"."connection_status" ADD VALUE 'SUBMITTED' BEFORE 'DISCONNECTED';--> statement-breakpoint
ALTER TABLE "channel_connections" ALTER COLUMN "status" SET DEFAULT 'PENDING_SETUP';--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "providerDealerId" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "leadEmail" text;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "requestedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "dealerConfirmedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "submittedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "liveAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_connections" ADD COLUMN "internalNote" text DEFAULT '' NOT NULL;