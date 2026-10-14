CREATE TYPE "public"."messaging_registration_step" AS ENUM('PROFILE', 'BRAND', 'CAMPAIGN', 'DONE');--> statement-breakpoint
ALTER TABLE "messaging_numbers" ADD COLUMN "forwardTo" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "step" "messaging_registration_step";--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "legalName" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "businessType" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "ein" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "contactFirst" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "contactLast" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "contactTitle" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "contactPosition" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "contactEmail" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "contactPhone" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "businessUserSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "repUserSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "addressSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "addressDocSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "profileSubmitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "a2pSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "a2pUserSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "a2pSubmitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "campaignSid" text;--> statement-breakpoint
ALTER TABLE "messaging_registrations" ADD COLUMN "autoReply" boolean DEFAULT false NOT NULL;