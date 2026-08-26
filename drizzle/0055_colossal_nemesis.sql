ALTER TABLE "users" ADD COLUMN "sso_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sso_linked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_sso_subject_unique" ON "users" USING btree ("sso_subject") WHERE sso_subject is not null;