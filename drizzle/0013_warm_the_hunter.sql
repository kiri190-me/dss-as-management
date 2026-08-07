CREATE TYPE "public"."stock_owner" AS ENUM('DSS', 'KYOSAN', 'SERVICE_SPARE', 'TEST');--> statement-breakpoint
CREATE TYPE "public"."stock_transaction_type" AS ENUM('RECEIPT', 'USE', 'RETURN');--> statement-breakpoint
CREATE TABLE "part_stock_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_id" uuid NOT NULL,
	"owner" "stock_owner" NOT NULL,
	"location" text NOT NULL,
	"current_quantity" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_stock_balances_quantity_not_negative" CHECK ("part_stock_balances"."current_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_name" text NOT NULL,
	"part_spec" text,
	"kyosan_part_no" text,
	"drawing_no" text,
	"category" text,
	"item_type" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE "stock_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"part_stock_balance_id" uuid NOT NULL,
	"transaction_type" "stock_transaction_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"resulting_quantity" integer NOT NULL,
	"repair_case_id" uuid,
	"destination_note" text,
	"procedure_execution_node_id" uuid,
	"reversal_of_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transactions_delta_sign_matches_type" CHECK (("stock_transactions"."transaction_type" = 'USE' AND "stock_transactions"."quantity_delta" < 0) OR ("stock_transactions"."transaction_type" IN ('RECEIPT', 'RETURN') AND "stock_transactions"."quantity_delta" > 0)),
	CONSTRAINT "stock_transactions_reversal_only_on_return" CHECK ("stock_transactions"."reversal_of_id" IS NULL OR "stock_transactions"."transaction_type" = 'RETURN'),
	CONSTRAINT "stock_transactions_use_has_destination" CHECK ("stock_transactions"."transaction_type" <> 'USE' OR "stock_transactions"."repair_case_id" IS NOT NULL OR "stock_transactions"."destination_note" IS NOT NULL),
	CONSTRAINT "stock_transactions_execution_node_only_on_use" CHECK ("stock_transactions"."procedure_execution_node_id" IS NULL OR "stock_transactions"."transaction_type" = 'USE')
);
--> statement-breakpoint
ALTER TABLE "part_stock_balances" ADD CONSTRAINT "part_stock_balances_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_part_stock_balance_id_part_stock_balances_id_fk" FOREIGN KEY ("part_stock_balance_id") REFERENCES "public"."part_stock_balances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_procedure_execution_node_id_procedure_case_execution_nodes_id_fk" FOREIGN KEY ("procedure_execution_node_id") REFERENCES "public"."procedure_case_execution_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_reversal_of_id_stock_transactions_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."stock_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "part_stock_balances_part_owner_location_unique" ON "part_stock_balances" USING btree ("part_id","owner","location");--> statement-breakpoint
CREATE INDEX "part_stock_balances_part_id_idx" ON "part_stock_balances" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "parts_part_name_idx" ON "parts" USING btree ("part_name");--> statement-breakpoint
CREATE INDEX "parts_drawing_no_idx" ON "parts" USING btree ("drawing_no");--> statement-breakpoint
CREATE INDEX "parts_kyosan_part_no_idx" ON "parts" USING btree ("kyosan_part_no");--> statement-breakpoint
CREATE INDEX "parts_not_deleted_idx" ON "parts" USING btree ("is_deleted") WHERE is_deleted = false;--> statement-breakpoint
CREATE INDEX "stock_transactions_balance_id_idx" ON "stock_transactions" USING btree ("part_stock_balance_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_repair_case_id_idx" ON "stock_transactions" USING btree ("repair_case_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_execution_node_id_idx" ON "stock_transactions" USING btree ("procedure_execution_node_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_reversal_of_id_idx" ON "stock_transactions" USING btree ("reversal_of_id");--> statement-breakpoint
CREATE INDEX "stock_transactions_created_at_idx" ON "stock_transactions" USING btree ("created_at");