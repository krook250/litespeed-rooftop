CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;