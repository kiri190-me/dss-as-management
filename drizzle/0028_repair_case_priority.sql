CREATE TYPE "public"."priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
ALTER TABLE "repair_cases" ADD COLUMN "priority" "priority" DEFAULT 'NORMAL' NOT NULL;