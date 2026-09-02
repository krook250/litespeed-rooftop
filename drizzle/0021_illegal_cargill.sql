CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"groupId" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"token" text NOT NULL,
	"invitedByUserId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"acceptedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_groupId_dealer_groups_id_fk" FOREIGN KEY ("groupId") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invitedByUserId_users_id_fk" FOREIGN KEY ("invitedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_group_idx" ON "invites" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email");