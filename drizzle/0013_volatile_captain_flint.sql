CREATE TYPE "public"."storefront_theme" AS ENUM('LIGHT', 'DARK', 'BRAND');--> statement-breakpoint
ALTER TABLE "storefronts" ADD COLUMN "theme" "storefront_theme" DEFAULT 'LIGHT' NOT NULL;