ALTER TABLE "dealer_groups" ADD COLUMN "isDemo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the seeded demo group already exists in production and `seed.ts`
-- will never run there again. Keyed on the slug rather than the name because
-- the name is editable. Idempotent, and a no-op on a fresh database where the
-- seed sets isDemo itself.
UPDATE "dealer_groups" SET "isDemo" = true WHERE "slug" = 'rooftop-demo';
