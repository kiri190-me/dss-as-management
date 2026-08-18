-- Apply only after 0033 has committed: PostgreSQL does not allow a newly
-- added enum label to be used in the transaction that created it.
-- This is a one-time materialized clone with independent stable UUIDs.
WITH clone_plan(code, name) AS (
  VALUES
    ('PAID_MATCHER'::workflow_type, '유상 Matcher'),
    ('WARRANTY_MATCHER'::workflow_type, '무상(보증) Matcher'),
    ('PAID_TOTAL_CONTROLLER'::workflow_type, '유상 Total Controller'),
    ('WARRANTY_TOTAL_CONTROLLER'::workflow_type, '무상(보증) Total Controller')
)
INSERT INTO "workflow_templates" ("id", "code", "name", "created_at")
SELECT md5('dss-as-workflow-template:' || code::text)::uuid, code, name, now()
FROM clone_plan
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

WITH clone_plan(code) AS (
  VALUES
    ('PAID_MATCHER'::workflow_type),
    ('WARRANTY_MATCHER'::workflow_type),
    ('PAID_TOTAL_CONTROLLER'::workflow_type),
    ('WARRANTY_TOTAL_CONTROLLER'::workflow_type)
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
  md5('dss-as-workflow-version:' || clone_plan.code::text || ':1')::uuid,
  workflow_templates.id, 1, 'PUBLISHED', true, now(), migration_owner.id, now()
FROM clone_plan
JOIN "workflow_templates" ON "workflow_templates"."code" = clone_plan.code
CROSS JOIN migration_owner
ON CONFLICT ("workflow_template_id", "version_number") DO NOTHING;--> statement-breakpoint

WITH clone_plan(target_code, source_code) AS (
  VALUES
    ('PAID_MATCHER'::workflow_type, 'MATCHER'::workflow_type),
    ('WARRANTY_MATCHER'::workflow_type, 'MATCHER'::workflow_type),
    ('PAID_TOTAL_CONTROLLER'::workflow_type, 'PAID_GENERATOR'::workflow_type),
    ('WARRANTY_TOTAL_CONTROLLER'::workflow_type, 'WARRANTY_GENERATOR'::workflow_type)
), source_steps AS (
  SELECT clone_plan.target_code, workflow_steps.step_order, workflow_steps.key,
    workflow_steps.label, workflow_steps.is_active
  FROM clone_plan
  JOIN "workflow_templates" source_template ON source_template.code = clone_plan.source_code
  JOIN "workflow_versions" source_version
    ON source_version.workflow_template_id = source_template.id
    AND source_version.status = 'PUBLISHED' AND source_version.is_current = true
  JOIN "workflow_steps" ON workflow_steps.workflow_version_id = source_version.id
)
INSERT INTO "workflow_steps" (
  "id", "workflow_version_id", "step_order", "key", "label", "is_active",
  "created_at", "updated_at"
)
SELECT
  md5('dss-as-workflow-step:' || source_steps.target_code::text || ':' || source_steps.key)::uuid,
  target_version.id, source_steps.step_order, source_steps.key, source_steps.label,
  source_steps.is_active, now(), now()
FROM source_steps
JOIN "workflow_templates" target_template ON target_template.code = source_steps.target_code
JOIN "workflow_versions" target_version
  ON target_version.workflow_template_id = target_template.id
  AND target_version.version_number = 1
ON CONFLICT ("workflow_version_id", "key") DO NOTHING;
