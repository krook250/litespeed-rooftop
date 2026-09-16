CREATE TYPE "public"."messaging_registration_status" AS ENUM('NOT_STARTED', 'COLLECTING', 'SUBMITTED', 'ACTION_NEEDED', 'READY');--> statement-breakpoint
CREATE TABLE "messaging_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"rooftopId" text,
	"phoneNumber" text NOT NULL,
	"twilioSid" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"status" "messaging_registration_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"subaccountSid" text,
	"customerProfileSid" text,
	"profileInquiryId" text,
	"brandSid" text,
	"brandInquiryId" text,
	"messagingServiceSid" text,
	"campaignInquiryId" text,
	"actionNeeded" text,
	"submittedAt" timestamp with time zone,
	"readyAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_numbers" ADD CONSTRAINT "messaging_numbers_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_numbers" ADD CONSTRAINT "messaging_numbers_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD CONSTRAINT "messaging_registrations_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_numbers_sid_uq" ON "messaging_numbers" USING btree ("twilioSid");--> statement-breakpoint
CREATE INDEX "messaging_numbers_group_idx" ON "messaging_numbers" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_registrations_group_uq" ON "messaging_registrations" USING btree ("groupId");