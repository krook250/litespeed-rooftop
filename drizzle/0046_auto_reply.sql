ALTER TABLE "messaging_registrations" ALTER COLUMN "autoReply" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "sendAfter" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "autoReplyAfterHours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "lead_messages_due_idx" ON "lead_messages" USING btree ("status","sendAfter");