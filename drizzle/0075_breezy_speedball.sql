CREATE TABLE "intake_mail_signature_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cid" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"content" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intake_mail_settings" ADD COLUMN "signature_html" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "intake_mail_signature_images" ADD CONSTRAINT "intake_mail_signature_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intake_mail_signature_images_cid_unique" ON "intake_mail_signature_images" USING btree ("cid");