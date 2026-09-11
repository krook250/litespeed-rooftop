DROP INDEX "meta_ad_copy_rooftop_idx";--> statement-breakpoint
ALTER TABLE "meta_ad_copy" ADD COLUMN "bucket" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
CREATE INDEX "meta_ad_copy_rooftop_bucket_idx" ON "meta_ad_copy" USING btree ("rooftopId","bucket");