-- A/S INTAKE UX 체크포인트 — 유상/무상(billing_type)을 workflowType과
-- 독립된 필드로 분리한다(감사 승인 완료). workflowType은 그대로 워크플로
-- 템플릿/버전/단계 선택자로만 남는다 — 이 마이그레이션은 그 동작을 전혀
-- 건드리지 않는다.
--
-- billing_type은 nullable로 남는다: 신규 접수부터는 애플리케이션 레벨에서
-- 필수로 받지만, 과거 데이터는 정확히 알 수 있는 경우에만 백필하고 나머지는
-- 절대 추측하지 않는다.
--   - PAID_GENERATOR 였던 기존 행 -> PAID
--   - WARRANTY_GENERATOR 였던 기존 행 -> WARRANTY
--   - MATCHER 였던 기존 행 -> 그대로 NULL (건드리지 않음)
--
-- workflow_type은 repair_cases에 직접 저장되지 않고 workflow_version_id ->
-- workflow_versions.workflow_template_id -> workflow_templates.code로만
-- 연결되므로, 백필은 이 관계를 그대로 따라가는 JOIN 기반 UPDATE다(리터럴
-- 값을 직접 박아넣지 않는다) — procedure_case_executions.template_category를
-- 관계형으로 백필했던 0016 마이그레이션과 동일한 패턴이다.

CREATE TYPE "public"."billing_type" AS ENUM('PAID', 'WARRANTY');--> statement-breakpoint

ALTER TABLE "repair_cases" ADD COLUMN "billing_type" "billing_type";--> statement-breakpoint

UPDATE "repair_cases" AS "rc"
SET "billing_type" = 'PAID'
FROM "workflow_versions" AS "wv"
JOIN "workflow_templates" AS "wt" ON "wt"."id" = "wv"."workflow_template_id"
WHERE "wv"."id" = "rc"."workflow_version_id" AND "wt"."code" = 'PAID_GENERATOR';--> statement-breakpoint

UPDATE "repair_cases" AS "rc"
SET "billing_type" = 'WARRANTY'
FROM "workflow_versions" AS "wv"
JOIN "workflow_templates" AS "wt" ON "wt"."id" = "wv"."workflow_template_id"
WHERE "wv"."id" = "rc"."workflow_version_id" AND "wt"."code" = 'WARRANTY_GENERATOR';
