-- Hand-corrected. drizzle-kit does not infer enum-value renames, so its
-- generated version dropped and recreated `user_role` with no step to carry
-- 'MANAGER' rows across — the final cast would have failed on every database
-- that has one. It also set the new default before the column had its new type,
-- which errors on its own.
--
-- Three changes from the generated file:
--   1. DROP DEFAULT first, so the text conversion is not blocked by a default
--      that is still typed as the old enum.
--   2. The UPDATE that turns MANAGER into SALES_MANAGER while the column is
--      text and can hold a value that is in neither enum.
--   3. SET DATA TYPE before SET DEFAULT, not after.
--
-- The drizzle snapshot already describes the correct end state, so editing this
-- file does not put the next `db:generate` out of step.

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
UPDATE "users" SET "role" = 'SALES_MANAGER' WHERE "role" = 'MANAGER';--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('OWNER', 'SALES_MANAGER', 'SALES', 'RECEPTION', 'PARTS', 'SERVICE', 'MARKETING', 'LOT_PORTER');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'SALES'::"public"."user_role";
