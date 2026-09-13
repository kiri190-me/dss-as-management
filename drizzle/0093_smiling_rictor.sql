CREATE TYPE "public"."improvement_request_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "improvement_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"status" "improvement_request_status" DEFAULT 'OPEN' NOT NULL,
	"in_progress_by" uuid,
	"in_progress_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "improvement_requests_body_length" CHECK (char_length("improvement_requests"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "improvement_requests_in_progress_pair" CHECK (("improvement_requests"."in_progress_by" IS NULL AND "improvement_requests"."in_progress_at" IS NULL) OR ("improvement_requests"."in_progress_by" IS NOT NULL AND "improvement_requests"."in_progress_at" IS NOT NULL)),
	CONSTRAINT "improvement_requests_resolved_pair" CHECK (("improvement_requests"."resolved_by" IS NULL AND "improvement_requests"."resolved_at" IS NULL) OR ("improvement_requests"."resolved_by" IS NOT NULL AND "improvement_requests"."resolved_at" IS NOT NULL)),
	CONSTRAINT "improvement_requests_status_columns" CHECK (
        ("improvement_requests"."status" = 'OPEN'
          AND "improvement_requests"."in_progress_by" IS NULL AND "improvement_requests"."in_progress_at" IS NULL
          AND "improvement_requests"."resolved_by" IS NULL AND "improvement_requests"."resolved_at" IS NULL)
        OR
        ("improvement_requests"."status" = 'IN_PROGRESS'
          AND "improvement_requests"."in_progress_by" IS NOT NULL AND "improvement_requests"."in_progress_at" IS NOT NULL
          AND "improvement_requests"."resolved_by" IS NULL AND "improvement_requests"."resolved_at" IS NULL)
        OR
        ("improvement_requests"."status" = 'RESOLVED'
          AND "improvement_requests"."resolved_by" IS NOT NULL AND "improvement_requests"."resolved_at" IS NOT NULL)
      )
);
--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_in_progress_by_users_id_fk" FOREIGN KEY ("in_progress_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "improvement_requests" ADD CONSTRAINT "improvement_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "improvement_requests_created_at_idx" ON "improvement_requests" USING btree ("created_at");