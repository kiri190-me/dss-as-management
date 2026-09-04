ALTER TABLE "quotes" ADD COLUMN "power_test_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "labor_power_test_deduction" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_labor_power_test_deduction_not_negative" CHECK ("quotes"."labor_power_test_deduction" >= 0);