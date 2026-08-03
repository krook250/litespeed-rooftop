ALTER TYPE "public"."feed_event_kind" ADD VALUE 'transfer_out';--> statement-breakpoint
ALTER TYPE "public"."feed_event_kind" ADD VALUE 'transfer_in';--> statement-breakpoint
CREATE TABLE "vehicle_transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicleId" text NOT NULL,
	"fromRooftopId" text NOT NULL,
	"toRooftopId" text NOT NULL,
	"departedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"arrivedAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	"departedBy" text,
	"arrivedBy" text,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_vehicleId_vehicles_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_fromRooftopId_rooftops_id_fk" FOREIGN KEY ("fromRooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_toRooftopId_rooftops_id_fk" FOREIGN KEY ("toRooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_departedBy_users_id_fk" FOREIGN KEY ("departedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_transfers" ADD CONSTRAINT "vehicle_transfers_arrivedBy_users_id_fk" FOREIGN KEY ("arrivedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_transfers_vehicle_idx" ON "vehicle_transfers" USING btree ("vehicleId","departedAt");--> statement-breakpoint
CREATE INDEX "vehicle_transfers_to_idx" ON "vehicle_transfers" USING btree ("toRooftopId","departedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_transfers_open_uq" ON "vehicle_transfers" USING btree ("vehicleId") WHERE "arrivedAt" is null and "cancelledAt" is null;