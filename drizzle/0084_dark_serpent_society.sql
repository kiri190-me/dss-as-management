CREATE TABLE "ui_theme_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_key" text NOT NULL,
	"scope" text NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ui_theme_tokens" ADD CONSTRAINT "ui_theme_tokens_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ui_theme_tokens_key_scope_unique" ON "ui_theme_tokens" USING btree ("token_key","scope");