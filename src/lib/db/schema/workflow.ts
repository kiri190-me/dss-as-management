import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { approvalTypeEnum } from "./repair-case-approvals";
import { roleEnum, users } from "./users";

// Ten persisted workflow types: legacy MATCHER, six final-billing workflows,
// and three Excel-only pending-billing workflows.
export const workflowTypeEnum = pgEnum("workflow_type", [
  "MATCHER",
  "PAID_MATCHER",
  "WARRANTY_MATCHER",
  "PAID_GENERATOR",
  "WARRANTY_GENERATOR",
  "PAID_TOTAL_CONTROLLER",
  "WARRANTY_TOTAL_CONTROLLER",
  "PENDING_MATCHER",
  "PENDING_GENERATOR",
  "PENDING_TOTAL_CONTROLLER",
]);

export const workflowVersionStatusEnum = pgEnum("workflow_version_status", [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);

/**
 * ============================================================================
 * Phase 1 — 전이 규칙의 DB 이관 (2026-08-18 승인, WORKFLOW_EDITOR_DESIGN.md)
 * ============================================================================
 * 아래 세 타입과 workflow_transitions 테이블은 지금까지 TypeScript 파일에
 * 하드코딩되어 있던 워크플로 규칙이 들어갈 자리다
 * (transition-definitions.ts 183행, step-status-map.ts, step-category.ts).
 *
 * **Phase 1 시점에는 런타임이 이 테이블을 읽지 않는다.** 앱은 여전히 TS 표를
 * 조회하며, 여기 담긴 값은 그 표와 1:1로 일치해야 한다 —
 * workflow-rules-parity.test.ts가 그 일치를 강제한다. 두 소스가 공존하는
 * 동안 그 테스트가 유일한 안전망이다. 런타임 전환은 Phase 2다.
 * ============================================================================
 */
export const workflowTransitionActionEnum = pgEnum("workflow_transition_action", [
  "STEP_ADVANCED",
  "STEP_RETURNED",
  "SHIPMENT_COMPLETED",
]);

/**
 * 접수 건의 평탄화된 상태. 저장 컬럼이 아니라 "현재 단계"에서 파생되는
 * 값이며(mappers/repair-status.ts), 그 파생표가 지금까지 step-status-map.ts에
 * 있었다. 값 집합은 domain/types.ts의 REPAIR_STATUS_CODES와 같아야 한다.
 */
export const repairStatusEnum = pgEnum("repair_status", [
  "WAITING_INTAKE_INSPECTION",
  "WAITING_KYOSAN_REPLY",
  "WAITING_PO",
  "WAITING_PARTS_SUPPLY",
  "IN_REPAIR",
  "WAITING_SHIPMENT_APPROVAL",
  "WAITING_SHIPMENT",
  "SHIPMENT_COMPLETED",
]);

/** 단계의 담당 구분. 보류 자격 판정에 쓰인다(step-category.ts). */
export const workflowStepCategoryEnum = pgEnum("workflow_step_category", [
  "TECHNICAL",
  "BUSINESS",
  "PARTS_SHIPMENT",
]);

// Stable identifier for a workflow type. No workflow editor UI in Gate 4 —
// this table only carries the fixed type code/name.
export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: workflowTypeEnum("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("workflow_templates_code_unique").on(table.code)]
);

/**
 * A published version's set of steps (existence/order/name) is immutable
 * (DATABASE_DESIGN.md #13). Versions/steps intentionally do not use the
 * soft-delete four-column convention — history that references a version or
 * step must never be soft- or hard-deleted; lifecycle is controlled only via
 * `status` (this table) and `workflow_steps.is_active`.
 */
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowTemplateId: uuid("workflow_template_id")
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: workflowVersionStatusEnum("status").notNull().default("DRAFT"),
    // Exactly one PUBLISHED + is_current row per template is enforced by the
    // partial unique index below (new intake cases are assigned this row).
    isCurrent: boolean("is_current").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_versions_template_version_unique").on(
      table.workflowTemplateId,
      table.versionNumber
    ),
    uniqueIndex("workflow_versions_current_per_template_unique")
      .on(table.workflowTemplateId)
      .where(sql`status = 'PUBLISHED' AND is_current = true`),
  ]
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    stepOrder: integer("step_order").notNull(),
    // Stable key (e.g. "product_intake") — matched against, never parsed
    // from the human-readable label.
    key: text("key").notNull(),
    label: text("label").notNull(),
    /**
     * 이 단계에 놓인 접수 건이 갖는 평탄화 상태. 지금까지 step-status-map.ts에
     * 있던 값이며, 비어 있으면 그 접수 건은 목록·대시보드를 읽을 때마다
     * UnmappedWorkflowStepError로 실패한다(화면이 통째로 깨진다).
     *
     * Phase 1에서는 nullable로 도입한다 — 기존 115행에 값이 없는 상태로
     * NOT NULL을 걸 수 없기 때문이다. 이관 스크립트가 값을 채운 뒤 별도
     * 마이그레이션으로 NOT NULL로 승격한다.
     */
    repairStatus: repairStatusEnum("repair_status"),
    /**
     * 담당 구분. nullable인 것은 의도적이다 — product_intake(도달 불가 단계),
     * shipment_completed(종료 단계)처럼 담당이 없는 단계가 실제로 존재한다
     * (2026-08-18 측정 기준 17건).
     */
    category: workflowStepCategoryEnum("category"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workflow_steps_version_order_unique").on(
      table.workflowVersionId,
      table.stepOrder
    ),
    uniqueIndex("workflow_steps_version_key_unique").on(
      table.workflowVersionId,
      table.key
    ),
  ]
);

/**
 * 합법적인 전이 한 줄. 버전에 종속되므로 발행된 버전의 규칙은 단계 구성과
 * 마찬가지로 불변이다(DATABASE_DESIGN.md #13) — 규칙을 바꾸려면 새 DRAFT
 * 버전을 만들어 발행한다.
 *
 * direction(FORWARD/RETURN/TERMINAL)과 to_status는 컬럼으로 두지 않는다.
 * 전자는 action_code에서, 후자는 to_step의 repair_status에서 그대로 나온다 —
 * 중복 저장하면 언젠가 어긋난다.
 */
export const workflowTransitions = pgTable(
  "workflow_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "restrict" }),
    actionCode: workflowTransitionActionEnum("action_code").notNull(),
    fromStepId: uuid("from_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "restrict" }),
    toStepId: uuid("to_step_id")
      .notNull()
      .references(() => workflowSteps.id, { onDelete: "restrict" }),
    /** 빈 배열은 "아무도 할 수 없는 전이"가 되어 무의미하므로 체크 제약으로 막는다. */
    allowedRoles: roleEnum("allowed_roles").array().notNull(),
    requiresAssignedEngineer: boolean("requires_assigned_engineer").notNull().default(false),
    requiresReason: boolean("requires_reason").notNull().default(false),
    requiredApprovalType: approvalTypeEnum("required_approval_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * 한 단계에서 같은 동작으로 갈 수 있는 곳은 하나뿐이다 — 지금 코드가
     * (workflowType, actionCode, fromStepKey)로 조회하며 첫 행만 쓰는 것과
     * 같은 불변식을, 이제 DB가 강제한다.
     */
    uniqueIndex("workflow_transitions_version_action_from_unique").on(
      table.workflowVersionId,
      table.actionCode,
      table.fromStepId
    ),
    index("workflow_transitions_version_idx").on(table.workflowVersionId),
    check("workflow_transitions_allowed_roles_not_empty", sql`array_length(${table.allowedRoles}, 1) >= 1`),
  ]
);

// Admin-managed master list (9 defaults, DATABASE_DESIGN.md #13). Not a
// fixed Postgres enum because admins may add/deactivate entries; "삭제"
// (delete) is intentionally never one of the codes.
export const exceptionStatuses = pgTable(
  "exception_statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("exception_statuses_code_unique").on(table.code)]
);
