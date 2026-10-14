CREATE TABLE "lead_recipients" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"userId" text,
	"name" text DEFAULT '' NOT NULL,
	"email" text,
	"cell" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cell" text;--> statement-breakpoint
ALTER TABLE "lead_recipients" ADD CONSTRAINT "lead_recipients_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_recipients" ADD CONSTRAINT "lead_recipients_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_recipients_rooftop_idx" ON "lead_recipients" USING btree ("rooftopId");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_recipients_rooftop_user_uq" ON "lead_recipients" USING btree ("rooftopId","userId");--> statement-breakpoint
-- Carry the old second email / second cell over as one typed-in recipient per
-- lot, named "Sales" (the dealer can rename it on Leads). The old columns stay
-- until a later migration so the code live during this migration keeps working.
INSERT INTO "lead_recipients" ("id", "rooftopId", "name", "email", "cell")
SELECT gen_random_uuid()::text, "id", 'Sales', NULLIF("leadEmail2", ''), NULLIF("leadAlertPhone2", '')
FROM "rooftops"
WHERE NULLIF("leadEmail2", '') IS NOT NULL OR NULLIF("leadAlertPhone2", '') IS NOT NULL;
