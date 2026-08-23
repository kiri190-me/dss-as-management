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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Detailed technical procedure templates (Phase 2 of the repair-center
 * workflow digitization — see the Phase 1 report). Deliberately named
 * "procedure_templates", not "workflow_templates": the latter already exists
 * (workflow.ts) and is the existing high-level repair-case status machine
 * (intake/inspection/repair/shipment/approvals/locking). These two systems
 * are separate layers by design (Phase 1 report §17) — nothing here
 * references repair_cases, and nothing in the high-level workflow tables
 * references this file.
 */
export const procedureTemplateStatusEnum = pgEnum("procedure_template_status", [
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);

export const procedureTemplateSourceTypeEnum = pgEnum("procedure_template_source_type", [
  "MANUAL",
  "EXCEL_IMPORT",
]);

// The two equipment families found in the source workbook (Phase 1 report),
// plus COMMON (Phase 2.5) for sheets that aren't equipment-specific at all —
// "Main page" (a navigational index into both RFG and MB detail sheets) and
// "QC" (repair-center-wide operational checklist, not tied to one equipment
// family). Not reused from workflowTypeEnum (MATCHER/PAID_GENERATOR/
// WARRANTY_GENERATOR) — that enum encodes billing/product distinctions for
// the high-level workflow, not the equipment family a technical procedure
// applies to.
export const procedureEquipmentTypeEnum = pgEnum("procedure_equipment_type", [
  "RFG",
  "MB",
  "COMMON",
]);

/**
 * Phase 5C-5A — the technical/business-content discriminator this table
 * always needed but never had: WHAT KIND of procedure a row is, completely
 * independent of `status` (DRAFT/PUBLISHED/ARCHIVED, WHERE a row is in its
 * own edit/publish lifecycle) and of `workflow_templates`/`workflow_steps`
 * (the separate high-level system that tracks WHERE a repair_case is in
 * the business process — see this file's own top-of-file comment; nothing
 * about that system is touched or renamed by this enum).
 *
 *  - FULL_SERVICE: a comprehensive whole-product service/repair procedure
 *    spanning a product's entire servicing journey — today's two real
 *    executable templates (rfg-full-lifecycle, mb-full-lifecycle). At most
 *    one active (non-deleted) execution per repair case — see
 *    procedure_case_executions' own uniqueness comment.
 *  - TECHNICAL_TASK: a focused, symptom/task-specific technical procedure
 *    (e.g. "RFG 출력 없음 진단", "AMP 점검") — none exist yet; Phase 5C-5A
 *    only prepares the type/schema/authorization foundation, Phase 5C-5B
 *    adds the authoring UI/CRUD. Multiple concurrent executions per repair
 *    case are allowed.
 *  - REFERENCE: non-executable navigational/index content — today's other
 *    two real templates (main-page-index, qc-common-operations). Always
 *    paired with `is_reference_only = true` — see the CHECK constraint
 *    below. Can never gain a procedure_case_executions row.
 *
 * No application-level default — every insertion path (the Excel importer,
 * createNewDraftVersion) must supply this explicitly; there is no sensible
 * universal default across three semantically distinct categories.
 */
export const procedureTemplateCategoryEnum = pgEnum("procedure_template_category", [
  "FULL_SERVICE",
  "TECHNICAL_TASK",
  "REFERENCE",
]);

/**
 * Versioning model (Phase 1 report §10, ratified by this task's brief):
 * publishing a template freezes its node/edge rows permanently — a new
 * version is always a fresh row here (never an in-place edit of a published
 * row), linked back via supersedes_template_id so the version chain is
 * queryable without relying on `code` + `version` alone. A DRAFT may be
 * freely edited; a PUBLISHED or ARCHIVED row's nodes/edges are enforced
 * read-only by the mutation layer (procedure-templates.ts), not just by
 * convention.
 *
 * source_file_hash (sha256 of the uploaded .xlsx bytes) is what makes the
 * importer idempotent for a given source file — see
 * scripts/import-procedure-templates.ts.
 */
export const procedureTemplates = pgTable(
  "procedure_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    equipmentType: procedureEquipmentTypeEnum("equipment_type").notNull(),
    // Phase 5C-5A — see procedureTemplateCategoryEnum's own doc comment.
    // NOT NULL, no default: every insert must decide this explicitly.
    category: procedureTemplateCategoryEnum("category").notNull(),
    description: text("description"),
    status: procedureTemplateStatusEnum("status").notNull().default("DRAFT"),
    // Phase 2.5: true only for the two navigational/reference-index
    // templates (Main page, QC) — no procedure_template_nodes rows, no
    // graph, just procedure_reference_items. A future repair-case
    // execution-assignment feature (out of this phase's scope) must filter
    // on this being false before offering a template as an executable
    // workflow source; nothing in this phase enforces that yet since no
    // such assignment mechanism exists.
    isReferenceOnly: boolean("is_reference_only").notNull().default(false),
    // Increments only on publish (Phase 1 report §10) — never bumped by a
    // plain draft edit, matching workflow_versions.version_number's
    // integer-per-published-row precedent elsewhere in this schema.
    version: integer("version").notNull().default(1),
    sourceType: procedureTemplateSourceTypeEnum("source_type").notNull(),
    sourceFileName: text("source_file_name"),
    sourceFileHash: text("source_file_hash"),
    // Self-referencing version chain — the published row this DRAFT was
    // cloned from when editing a PUBLISHED template (Phase 1 report §10).
    // Null for a template's very first version.
    supersedesTemplateId: uuid("supersedes_template_id").references(
      (): AnyPgColumn => procedureTemplates.id,
      { onDelete: "restrict" }
    ),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /**
     * 소프트 삭제 4컬럼 (DATABASE_DESIGN.md #8) — 기술 절차 휴지통 체크포인트.
     *
     * ── 보관(status = ARCHIVED)과 다른 일이다 ─────────────────────────
     * 보관은 **발행된** 절차를 "이제 안 씀"으로 내리는 수명주기의 다음
     * 단계이고, 내용도 과거 수행 기록도 그대로 그 절차를 가리킨다. 삭제는
     * **쓰인 적 없는** 절차를 목록에서 치우는 일이다. 둘은 대상이 겹치지
     * 않는다 — 보관은 PUBLISHED만, 삭제는 procedure_case_executions가
     * 가리키지 않는 행만.
     *
     * 이 컬럼들을 도입한 이유가 그 차이에 있다: 이 시스템의 절차는 지금
     * 전부 DRAFT라 보관 대상이 하나도 없고, 그래서 **잘못 만든 초안을 치울
     * 방법이 없었다.**
     *
     * 15일이 지나면 자동으로 완전삭제된다(master-data-purge.ts). 단
     * procedure_case_executions나 다른 버전의 supersedes_template_id가
     * 가리키는 행은 애초에 삭제되지 않으므로 그 지점까지 오지 않는다.
     *
     * procedure_templates_code_version_unique는 **부분 인덱스가 아니다** —
     * 삭제된 행도 (code, version) 자리를 계속 차지한다. 일부러 그대로 둔다:
     * 그 덕에 휴지통에 있는 동안 같은 code+version이 새로 생길 수 없고,
     * 따라서 복원이 이름 충돌로 막히는 경우가 존재하지 않는다(고객사·제품
     * 모델은 부분 인덱스라 그 검사가 필요했다).
     */
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "restrict" }),
    deleteReason: text("delete_reason"),
  },
  (table) => [
    index("procedure_templates_not_deleted_idx")
      .on(table.isDeleted)
      .where(sql`is_deleted = false`),
    // "code" identifies a template lineage (e.g. "rfg-safety-inspection")
    // across versions, so it is unique per *version row*, not globally —
    // the (code, version) pair is the real identity; see the version-chain
    // comment above for why version itself lives on this row rather than a
    // separate join table.
    uniqueIndex("procedure_templates_code_version_unique").on(
      table.code,
      table.version
    ),
    // Phase 5C-5A — the only three valid (category, is_reference_only)
    // pairs: REFERENCE always means is_reference_only=true (no graph, no
    // execution); FULL_SERVICE/TECHNICAL_TASK always mean
    // is_reference_only=false (both are real executable graph content).
    // Verified compatible with every existing and planned insertion path
    // (the Excel importer's two reference-only builders set both fields
    // together; createNewDraftVersion copies both fields verbatim from its
    // parent, which already satisfies this by construction).
    check(
      "procedure_templates_category_reference_only_consistency",
      sql`(category = 'REFERENCE' AND is_reference_only = true) OR (category <> 'REFERENCE' AND is_reference_only = false)`
    ),
  ]
);
