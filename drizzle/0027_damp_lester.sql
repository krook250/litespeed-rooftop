CREATE TABLE "meta_ad_copy" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"name" text NOT NULL,
	"message" text NOT NULL,
	"headline" text NOT NULL,
	"description" text NOT NULL,
	"callToAction" text DEFAULT 'LEARN_MORE' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_ad_copy" ADD CONSTRAINT "meta_ad_copy_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_ad_copy_rooftop_idx" ON "meta_ad_copy" USING btree ("rooftopId");