import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Schema foundation checkpoint — general-purpose, polymorphic audit trail
 * (DATABASE_DESIGN.md §9), created now specifically so the future automatic
 * 15-day flowchart-purge job has somewhere to record what it did. No
 * mutation helper, no purge job, and no other caller exist yet — this
 * checkpoint is schema only (see the flowchart permanent-delete-audit's own
 * "smallest schema needed" scoping).
 *
 * Deliberately NOT soft-delete (no is_deleted/deleted_at/deleted_by/
 * delete_reason): append-only by policy (DATABASE_DESIGN.md §9 — "수정/삭제
 * 불가"), same exemption precedent as repair_case_idempotency_keys. Rows are
 * only ever removed by a separately-approved, documented retention job
 * (3-year policy, SECURITY_POLICY.md §8 — not implemented here either).
 *
 * `actor_user_id` is nullable specifically so a system-initiated action
 * (e.g. the automatic flowchart-purge sweep) can be recorded without
 * inventing a fake system user row — general-purpose, not special-cased to
 * any one action_type, so any future system-originated audit entry can use
 * the same convention.
 *
 * `target_entity` + `target_record_id` are the polymorphic reference
 * (DATABASE_DESIGN.md §3: "모든 테이블을 대상으로 참조하는 polymorphic
 * 관계 — DB 레벨 FK 없음, 애플리케이션 레벨로 무결성 관리"). target_entity
 * stays plain text, not an enum, so auditing a new entity never requires a
 * schema migration.
 */
export const auditLogActionTypeEnum = pgEnum("audit_log_action_type", [
  "LOGIN",
  "CREATE",
  "UPDATE",
  "SOFT_DELETE",
  "RESTORE",
  "STATUS_CHANGE",
  "FILE_UPLOAD",
  "FILE_DOWNLOAD",
  "FILE_DELETE",
  "EXCEL_IMPORT",
  "EXCEL_EXPORT",
  "APPROVE",
  "APPROVAL_CANCEL",
  "ACCOUNT_LOCK",
  "ACCOUNT_DEACTIVATE",
  "PURGE",
]);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable — NULL means system-initiated (no human actor), never a
    // fake/placeholder user row. Non-null values are restricted from
    // referencing a hard-deleted user (users are soft-delete-only in this
    // app, so this is a defensive backstop, not an expected path).
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
    actionType: auditLogActionTypeEnum("action_type").notNull(),
    targetEntity: text("target_entity").notNull(),
    targetRecordId: uuid("target_record_id").notNull(),
    previousValue: jsonb("previous_value"),
    newValue: jsonb("new_value"),
    sessionId: text("session_id"),
    sourceIp: text("source_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_target_entity_target_record_id_idx").on(table.targetEntity, table.targetRecordId),
    index("audit_logs_actor_user_id_idx").on(table.actorUserId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ]
);
