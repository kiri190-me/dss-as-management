CREATE TABLE "repair_case_billing_decision_histories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_case_id" uuid NOT NULL,
	"previous_billing_type" "billing_type" NOT NULL,
	"next_billing_type" "billing_type" NOT NULL,
	"previous_workflow_version_id" uuid NOT NULL,
	"next_workflow_version_id" uuid NOT NULL,
	"previous_workflow_step_id" uuid NOT NULL,
	"next_workflow_step_id" uuid NOT NULL,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repair_case_billing_decision_histories" ADD CONSTRAINT "repair_case_billing_decision_histories_repair_case_id_repair_cases_id_fk" FOREIGN KEY ("repair_case_id") REFERENCES "public"."repair_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_billing_decision_histories" ADD CONSTRAINT "repair_case_billing_decision_histories_previous_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("previous_workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_billing_decision_histories" ADD CONSTRAINT "repair_case_billing_decision_histories_next_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("next_workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_billing_decision_histories" ADD CONSTRAINT "repair_case_billing_decision_histories_previous_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("previous_workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_billing_decision_histories" ADD CONSTRAINT "repair_case_billing_decision_histories_next_workflow_step_id_workflow_steps_id_fk" FOREIGN KEY ("next_workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case_billing_decision_histories" ADD CONSTRAINT "repair_case_billing_decision_histories_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repair_case_billing_decision_history_case_decided_at_idx" ON "repair_case_billing_decision_histories" USING btree ("repair_case_id","decided_at");--> statement-breakpoint
CREATE INDEX "repair_case_billing_decision_history_actor_idx" ON "repair_case_billing_decision_histories" USING btree ("decided_by");
--> statement-breakpoint
-- Apply only after 0035 has committed: these rows use the new workflow_type
-- labels. Pending workflows are independent, intentionally minimal, and
-- have no transition/approval definitions.
WITH pending_templates(code, name) AS (
  VALUES
    ('PENDING_MATCHER'::workflow_type, '추후결정 Matcher'),
    ('PENDING_GENERATOR'::workflow_type, '추후결정 Generator'),
    ('PENDING_TOTAL_CONTROLLER'::workflow_type, '추후결정 Total Controller')
)
INSERT INTO "workflow_templates" ("id", "code", "name", "created_at")
SELECT md5('dss-as-workflow-template:' || code::text)::uuid, code, name, now()
FROM pending_templates
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
WITH pending_templates(code) AS (
  VALUES
    ('PENDING_MATCHER'::workflow_type),
    ('PENDING_GENERATOR'::workflow_type),
    ('PENDING_TOTAL_CONTROLLER'::workflow_type)
), migration_owner AS (
  SELECT "id" FROM "users"
  WHERE "role" IN ('SUPER_ADMIN', 'ADMIN') AND "is_deleted" = false
  ORDER BY CASE WHEN "role" = 'SUPER_ADMIN' THEN 0 ELSE 1 END, "created_at", "id"
  LIMIT 1
)
INSERT INTO "workflow_versions" (
  "id", "workflow_template_id", "version_number", "status", "is_current",
  "published_at", "created_by", "created_at"
)
SELECT
  md5('dss-as-workflow-version:' || pending_templates.code::text || ':1')::uuid,
  workflow_templates.id, 1, 'PUBLISHED', true, now(), migration_owner.id, now()
FROM pending_templates
JOIN "workflow_templates" ON "workflow_templates"."code" = pending_templates.code
CROSS JOIN migration_owner
ON CONFLICT ("workflow_template_id", "version_number") DO NOTHING;
--> statement-breakpoint
WITH pending_steps(code, step_order, key, label) AS (
  VALUES
    ('PENDING_MATCHER'::workflow_type, 1, 'product_intake', '제품 인수'),
    ('PENDING_MATCHER'::workflow_type, 2, 'intake_inspection', '인수점검'),
    ('PENDING_GENERATOR'::workflow_type, 1, 'product_intake', '제품 인수'),
    ('PENDING_GENERATOR'::workflow_type, 2, 'intake_inspection', '인수점검'),
    ('PENDING_TOTAL_CONTROLLER'::workflow_type, 1, 'product_intake', '제품 인수'),
    ('PENDING_TOTAL_CONTROLLER'::workflow_type, 2, 'intake_inspection', '인수점검')
)
INSERT INTO "workflow_steps" (
  "id", "workflow_version_id", "step_order", "key", "label", "is_active",
  "created_at", "updated_at"
)
SELECT
  md5('dss-as-workflow-step:' || pending_steps.code::text || ':' || pending_steps.key)::uuid,
  workflow_versions.id, pending_steps.step_order, pending_steps.key,
  pending_steps.label, true, now(), now()
FROM pending_steps
JOIN "workflow_templates" ON "workflow_templates"."code" = pending_steps.code
JOIN "workflow_versions"
  ON "workflow_versions"."workflow_template_id" = "workflow_templates"."id"
  AND "workflow_versions"."version_number" = 1
ON CONFLICT ("workflow_version_id", "key") DO NOTHING;
