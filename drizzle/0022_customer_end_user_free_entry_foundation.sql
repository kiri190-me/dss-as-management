ALTER TABLE "customers" ALTER COLUMN "contact_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "contact_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "contact_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "end_users" ALTER COLUMN "contact_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "end_users" ALTER COLUMN "contact_email" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_normalized_name_unique" ON "customers" USING btree (lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'))) WHERE is_deleted = false;--> statement-breakpoint
CREATE UNIQUE INDEX "end_users_customer_normalized_name_unique" ON "end_users" USING btree ("customer_id",lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'))) WHERE is_deleted = false;