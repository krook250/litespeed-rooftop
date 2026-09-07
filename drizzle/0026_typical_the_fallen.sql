ALTER TYPE "public"."body_style" ADD VALUE 'TRAVEL_TRAILER';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'FIFTH_WHEEL';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'TOY_HAULER';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'POP_UP';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'TRUCK_CAMPER';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'CLASS_A';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'CLASS_B';--> statement-breakpoint
ALTER TYPE "public"."body_style" ADD VALUE 'CLASS_C';--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvLengthFt" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvSleeps" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvSlideouts" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvDryWeightLbs" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvGvwrLbs" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvAxles" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "rvAcUnits" integer;