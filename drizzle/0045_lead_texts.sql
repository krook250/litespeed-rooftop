CREATE TABLE "lead_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"leadId" text NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"twilioSid" text,
	"error" text,
	"sentBy" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "smsOptedOutAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_leadId_leads_id_fk" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_messages" ADD CONSTRAINT "lead_messages_sentBy_users_id_fk" FOREIGN KEY ("sentBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_messages_lead_idx" ON "lead_messages" USING btree ("leadId","createdAt");