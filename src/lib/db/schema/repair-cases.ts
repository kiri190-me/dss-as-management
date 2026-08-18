import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customers, endUsers } from "./customers";
import { products } from "./products";
import { users } from "./users";
import { exceptionStatuses, workflowSteps, workflowVersions } from "./workflow";

/**
 * 유상/무상 — independent of workflowType (A/S INTAKE UX 체크포인트 감사
 * 승인). workflowType은 그대로 워크플로 템플릿/버전/단계 선택자로만 남고,
 * billing_type은 신규 접수부터 애플리케이션 레벨에서 별도로 입력받는
 * 비즈니스 분류 값이다. 일반 접수는 세 최종값만, Excel 이관은 확정 전
 * PENDING_DECISION도 허용한다. 과거 데이터를 추측하지 않기 위해 nullable —
 * PAID_GENERATOR/WARRANTY_GENERATOR였던 기존 행만 확실하게 백필하고,
 * MATCHER였던 기존 행은 NULL로 남긴다(마이그레이션 파일 참고).
 */
export const billingTypeEnum = pgEnum("billing_type", [
  "PAID",
  "PARTIAL_PAID",
  "WARRANTY",
  "PENDING_DECISION",
]);

/**
 * 우선순위 — domain/types.ts의 PRIORITY_CODES(LOW/NORMAL/HIGH/URGENT)와 값이
 * 정확히 일치해야 한다(billingTypeEnum/BILLING_TYPE_CODES와 같은 원칙 —
 * 스키마 레이어는 도메인 레이어를 import하지 않으므로 값을 그대로 복제해
 * 유지한다; 둘 중 하나를 바꾸면 반드시 같이 바꿀 것). NOT NULL DEFAULT
 * 'NORMAL' — billing_type과 달리 과거 데이터를 추측해야 하는 모호함이 없다
 * (지금까지 이 컬럼 자체가 없어 모든 DB 행이 이미 매퍼에서 "NORMAL"로
 * 고정 표시되고 있었으므로, 실제 컬럼을 만들 때도 같은 값으로 시작하는 것이
 * 유일하게 맞는 백필이다).
 */
export const priorityEnum = pgEnum("priority", ["LOW", "NORMAL", "HIGH", "URGENT"]);

/**
 * intake_number allocator (MISSING — documented for the next gate):
 * The visible business key stays "D" + YY + MM + a 2-digit monthly
 * sequence (e.g. D260601). Gate 4 only defines the unique column and its
 * format CHECK constraint; it deliberately does NOT implement the counter.
 * Client code must never generate this value. A correct implementation
 * needs a transactional allocator (e.g. a per-YYMM counter table plus a
 * `SELECT ... FOR UPDATE`/`INSERT ... ON CONFLICT DO UPDATE RETURNING`
 * sequence step, or a Postgres SEQUENCE per month) to avoid duplicate
 * numbers under concurrent intake — that design/migration is out of scope
 * here and must be approved separately before repair_cases insert code is
 * written.
 *
 * `reported_symptom` / `intake_inspection_result` / `current_diagnosis_summary`
 * / `next_planned_action` (added in the first Gate 4 correction batch) and
 * `notes` / `accessory_list` / `external_condition_summary` /
 * `reason_for_removal` (added in this second correction batch) persist the
 * full free-text entered by the intake UI (IntakeFormInner.tsx) — nullable
 * text, no empty-string default, so "not yet entered" stays distinguishable
 * from "entered as empty".
 *
 * `contact_name_snapshot` / `contact_phone_snapshot` / `contact_email_snapshot`
 * capture the contact info as entered AT INTAKE TIME. These are plain text,
 * deliberately NOT foreign keys to customers/end_users contact columns —
 * a later edit to the customer's or end-user's contact info must not
 * retroactively rewrite what this specific historical intake recorded.
 * ⚠️ POTENTIAL PII: these three columns may contain a real person's name,
 * phone number, and email address. No encryption is applied at this stage
 * (explicitly deferred). Any logging, error reporting, or audit trail that
 * touches repair_cases rows must redact these three columns before writing
 * them anywhere. A production security review (encryption at rest, access
 * logging, retention policy) is still required before this table holds real
 * intake data — see SECURITY_POLICY.md.
 *
 * Fields still intentionally NOT carried over from the demo/local intake
 * layer, because they are not documented anywhere in DATABASE_DESIGN.md,
 * PROJECT_REQUIREMENTS.md or API_SPECIFICATION.md and were not approved for
 * persistence: PDF/export metadata, attachment fields, work-history fields,
 * approval fields. The flat `status` (RepairStatus) field is also excluded
 * — authoritative state is current_workflow_step_id (+ nullable
 * exception_status_id) instead. `priority` WAS in this excluded list
 * (fixed to a non-persisted "NORMAL" placeholder in the row mapper) until
 * the 인수 정보 priority-editing checkpoint added the real `priority` column
 * below — see priorityEnum's own comment.
 *
 * `internal_target_inspection_completion_date` / `delay_reason` (Stage G-3R
 * Batch 1): both nullable, no default, matching the same intake-field
 * convention as every other optional column here. Validated at read/write
 * time in a later batch — not enforced by any DB constraint here.
 *
 * `part_number` (products table) and `reason_for_removal` (this table) are
 * retained per Stage G-3R's approved removed-field policy: the new-intake
 * UI stops collecting them, but the columns themselves are never dropped or
 * altered — both are already nullable and, as of this batch, still hold
 * `NULL` in every existing row.
 */
export const repairCases = pgTable(
  "repair_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeNumber: text("intake_number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    endUserId: uuid("end_user_id").references(() => endUsers.id, {
      onDelete: "restrict",
    }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    // Fixed at intake to the template's is_current version; never follows
    // later republished versions (DATABASE_DESIGN.md #13).
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    // Authoritative workflow state.
    currentWorkflowStepId: uuid("current_workflow_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "restrict" }),
    // Independent of workflow progression — a case can sit at a step and
    // simultaneously carry an exception status (DATABASE_DESIGN.md #13).
    exceptionStatusId: uuid("exception_status_id").references(
      () => exceptionStatuses.id,
      { onDelete: "restrict" }
    ),
    assignedEngineerId: uuid("assigned_engineer_id").references(
      () => users.id,
      { onDelete: "restrict" }
    ),
    // 유상/무상 — workflowType과 독립적인 별도 필드다(파일 상단 billingTypeEnum
    // 주석 참고). nullable: 신규 접수는 애플리케이션 레벨에서 필수로 받지만,
    // 과거 MATCHER 행은 추측할 근거가 없어 NULL로 남는다.
    billingType: billingTypeEnum("billing_type"),
    // 인수 정보 편집 폼의 우선순위 필드 — priorityEnum 자체 주석 참고.
    priority: priorityEnum("priority").notNull().default("NORMAL"),
    receivedAt: date("received_at").notNull(),
    customerRequestedDueDate: date("customer_requested_due_date"),
    internalTargetInspectionCompletionDate: date(
      "internal_target_inspection_completion_date"
    ),
    internalTargetShipmentDate: date("internal_target_shipment_date"),
    actualShipmentDate: date("actual_shipment_date"),
    // Excel legacy `목록` A-column identifier. Nullable, non-unique and never
    // auto-numbered; the future official report_number is a separate concept.
    legacyReportNumber: text("legacy_report_number"),
    delayReason: text("delay_reason"),
    isLocked: boolean("is_locked").notNull().default(false),
    // Full free text from the intake UI. Nullable (not "") — "not entered"
    // must stay distinguishable from "entered as empty".
    reportedSymptom: text("reported_symptom"),
    intakeInspectionResult: text("intake_inspection_result"),
    currentDiagnosisSummary: text("current_diagnosis_summary"),
    nextPlannedAction: text("next_planned_action"),
    notes: text("notes"),
    accessoryList: text("accessory_list"),
    externalConditionSummary: text("external_condition_summary"),
    reasonForRemoval: text("reason_for_removal"),
    // Contact-at-intake-time snapshot — plain text, not FK'd to
    // customers/end_users (see file header comment). Potential PII: must be
    // redacted from logs/error reports; no encryption yet (deferred).
    contactNameSnapshot: text("contact_name_snapshot"),
    contactPhoneSnapshot: text("contact_phone_snapshot"),
    contactEmailSnapshot: text("contact_email_snapshot"),
    // Optimistic concurrency token.
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete four-column convention (DATABASE_DESIGN.md #8).
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    uniqueIndex("repair_cases_intake_number_unique").on(table.intakeNumber),
    // D + YY + MM(01-12) + 2-digit monthly sequence, e.g. D260601.
    check(
      "repair_cases_intake_number_format",
      sql`${table.intakeNumber} ~ '^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$'`
    ),
    index("repair_cases_customer_id_idx").on(table.customerId),
    index("repair_cases_end_user_id_idx").on(table.endUserId),
    index("repair_cases_product_id_idx").on(table.productId),
    index("repair_cases_workflow_version_id_idx").on(table.workflowVersionId),
    index("repair_cases_current_workflow_step_id_idx").on(
      table.currentWorkflowStepId
    ),
    index("repair_cases_exception_status_id_idx").on(table.exceptionStatusId),
    index("repair_cases_assigned_engineer_id_idx").on(
      table.assignedEngineerId
    ),
    index("repair_cases_created_at_idx").on(table.createdAt),
    index("repair_cases_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
  ]
);
