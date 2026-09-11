CREATE TABLE "meta_ad_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"rooftopId" text NOT NULL,
	"bucket" text DEFAULT 'all' NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"adSetId" text,
	"productSetId" text,
	"dailyBudgetUsd" integer DEFAULT 25 NOT NULL,
	"radiusMiles" integer DEFAULT 25 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_ad_groups" ADD CONSTRAINT "meta_ad_groups_rooftopId_rooftops_id_fk" FOREIGN KEY ("rooftopId") REFERENCES "public"."rooftops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_groups_rooftop_bucket_idx" ON "meta_ad_groups" USING btree ("rooftopId","bucket");