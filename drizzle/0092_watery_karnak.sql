CREATE TABLE "domestic_order_sheet_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"greeting_text" text NOT NULL,
	"internal_memo" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domestic_order_sheet_settings_singleton_true" CHECK ("domestic_order_sheet_settings"."singleton"),
	CONSTRAINT "domestic_order_sheet_settings_greeting_text_length" CHECK (char_length("domestic_order_sheet_settings"."greeting_text") <= 2000),
	CONSTRAINT "domestic_order_sheet_settings_internal_memo_length" CHECK (char_length("domestic_order_sheet_settings"."internal_memo") <= 500)
);
--> statement-breakpoint
ALTER TABLE "domestic_order_sheet_settings" ADD CONSTRAINT "domestic_order_sheet_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "domestic_order_sheet_settings_singleton_unique" ON "domestic_order_sheet_settings" USING btree ("singleton");