CREATE TYPE "public"."feed_event_kind" AS ENUM('acquired', 'recon_in', 'recon_out', 'photos', 'front_line', 'price_change', 'at_risk', 'aged', 'water', 'vdp_milestone', 'sync_error', 'sold', 'team', 'note');--> statement-breakpoint
CREATE TYPE "public"."feed_reaction_kind" AS ENUM('THUMB', 'FIRE');--> statement-breakpoint
CREATE TYPE "public"."home_view" AS ENUM('FEED', 'DASHBOARD');--> statement-breakpoint
CREATE TABLE "feed_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"eventId" text NOT NULL,
	"userId" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"kind" "feed_event_kind" NOT NULL,
	"actorId" text,
	"vehicleId" text,
	"subjectUserId" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"stats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dedupeKey" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"eventId" text NOT NULL,
	"userId" text NOT NULL,
	"kind" "feed_reaction_kind" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "homeView" "home_view" DEFAULT 'FEED' NOT NULL;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_eventId_feed_events_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."feed_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_subjectUserId_users_id_fk" FOREIGN KEY ("subjectUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_eventId_feed_events_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."feed_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_comments_event_created_idx" ON "feed_comments" USING btree ("eventId","createdAt");--> statement-breakpoint
CREATE INDEX "feed_events_rooftop_created_idx" ON "feed_events" USING btree ("rooftopId","createdAt");--> statement-breakpoint
CREATE INDEX "feed_events_vehicle_created_idx" ON "feed_events" USING btree ("vehicleId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_events_dedupe_uq" ON "feed_events" USING btree ("dedupeKey");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_reactions_event_user_kind_uq" ON "feed_reactions" USING btree ("eventId","userId","kind");--> statement-breakpoint
CREATE INDEX "feed_reactions_event_idx" ON "feed_reactions" USING btree ("eventId");