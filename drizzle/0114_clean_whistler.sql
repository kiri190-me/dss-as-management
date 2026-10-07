CREATE TABLE "product_model_share_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_model_id" uuid NOT NULL,
	"entry_kind" "share_doc_entry_kind" NOT NULL,
	"relative_path" text NOT NULL,
	"label" text,
	"display_order" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_model_share_docs_relative_path_shape" CHECK (char_length("product_model_share_docs"."relative_path") BETWEEN 1 AND 400
        AND "product_model_share_docs"."relative_path" = btrim("product_model_share_docs"."relative_path")
        AND strpos("product_model_share_docs"."relative_path", chr(92)) = 0
        AND "product_model_share_docs"."relative_path" !~ '[|<>"?*:]'
        AND "product_model_share_docs"."relative_path" !~ '[[:cntrl:]]'
        AND "product_model_share_docs"."relative_path" !~ '(^/)|(/$)|(//)'
        AND "product_model_share_docs"."relative_path" !~ '(^|/)[.]{1,2}(/|$)'),
	CONSTRAINT "product_model_share_docs_label_not_blank" CHECK ("product_model_share_docs"."label" IS NULL OR char_length(btrim("product_model_share_docs"."label")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "product_model_share_docs" ADD CONSTRAINT "product_model_share_docs_product_model_id_product_models_id_fk" FOREIGN KEY ("product_model_id") REFERENCES "public"."product_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_model_share_docs" ADD CONSTRAINT "product_model_share_docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_model_share_docs_model_path_unique" ON "product_model_share_docs" USING btree ("product_model_id",lower(regexp_replace(btrim(normalize("relative_path", NFC)), '\s+', ' ', 'g')));--> statement-breakpoint
CREATE INDEX "product_model_share_docs_model_order_idx" ON "product_model_share_docs" USING btree ("product_model_id","display_order","created_at");