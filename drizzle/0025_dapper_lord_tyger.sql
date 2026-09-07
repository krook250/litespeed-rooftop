CREATE TYPE "public"."vehicle_type" AS ENUM('AUTO', 'RV_TOWABLE', 'RV_MOTORIZED');--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "vin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vehicleType" "vehicle_type" DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
CREATE INDEX "vehicles_rooftop_stock_idx" ON "vehicles" USING btree ("rooftopId","stockNumber");--> statement-breakpoint
CREATE INDEX "vehicles_rooftop_type_idx" ON "vehicles" USING btree ("rooftopId","vehicleType");