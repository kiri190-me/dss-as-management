import { sql } from "drizzle-orm";
import {
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
import { repairCases } from "./repair-cases";
import { users } from "./users";

/**
 * Two-value set matching the local-demo domain layer's ApprovalType exactly
 * (src/lib/domain/local/approval/approval-types.ts APPROVAL_TYPE_CODES) —
 * no new approval types invented here.
 */
export const approvalTypeEnum = pgEnum("repair_case_approval_type", [
  "REPAIR_INSPECTION",
  "FINAL_SHIPMENT",
]);

/**
 * Deliberately narrower than the local-demo layer's four-value
 * StoredApprovalStatus (which also has CHANGES_REQUESTED): this task's
 * approved schema only calls for REQUESTED/APPROVED/REJECTED, and
 * CHANGES_REQUESTED is not "already supported" in the sense the task's
 * conditional CANCELLED note implies — so it is intentionally not carried
 * over. A rejected request can always be resubmitted (a fresh REQUESTED
 * row), which covers the same "send it back for changes" business need
 * without a distinct status. CANCELLED is likewise omitted (not already
 * supported anywhere today).
 */
export const approvalStatusEnum = pgEnum("repair_case_approval_status", [
  "REQUESTED",
  "APPROVED",
  "REJECTED",
]);

/**
 * Immutable, append-style approval request/decision history — same
 * no-soft-delete convention as status_change_histories (an approval
 * decision is a historical fact, never edited or removed). One row per
 * request; a decision (approve/reject) updates that same row's decision
 * columns exactly once (enforced by the CHECK below plus the mutation
 * layer's re-check of status === 'REQUESTED' inside its transaction) —
 * this mirrors the local-demo layer's "at most one current record per
 * (repairCaseId, approvalType), decisions are terminal" model, except here
 * each request *is* its own row (append-only) rather than being mutated
 * back to PENDING on resubmission, so full request history is preserved
 * without a separate events table.
 *
 * `repair_case_version_at_request` snapshots repair_cases.version at
 * request time — resolveVerifiedApproval() (mutation layer) compares this
 * against the case's current version before letting an APPROVED row gate a
 * transition, so an approval granted against stale case state can never be
 * silently reused (task requirement: "Approval cannot be reused ... if the
 * business state changed materially").
 *
 * No customer/contact PII: only user ids/names (via join) and free-text
 * reasons an internal user typed about the repair, never customer contact
 * fields.
 */
export const repairCaseApprovals = pgTable(
  "repair_case_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Nullable, ON DELETE SET NULL (repair-case permanent-delete schema
    // foundation checkpoint) — was NOT NULL + RESTRICT, which made a
    // repair_cases hard-delete impossible at the DB level. This table is
    // immutable/append-only approval history (검수/출하 승인) that must
    // outlive the case's own hard-delete; the row's own approvalType/status/
    // decision columns permanently preserve the decision regardless of this
    // column going NULL. Existing rows are untouched by this — only a
    // future repair_cases hard-delete ever nulls it. Same proven pattern as
    // repair_case_flowchart_edit_history.flowchart_id (migration 0026).
    repairCaseId: uuid("repair_case_id").references(() => repairCases.id, {
      onDelete: "set null",
    }),
    approvalType: approvalTypeEnum("approval_type").notNull(),
    status: approvalStatusEnum("status").notNull().default("REQUESTED"),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    requestReason: text("request_reason"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    // FINAL_SHIPMENT decisions only, when the deciding user acted as a
    // delegate rather than the representative directly — see
    // is_shipment_representative on users. Always NULL for
    // REPAIR_INSPECTION rows (CHECK below).
    delegatedFromUserId: uuid("delegated_from_user_id").references(
      () => users.id,
      { onDelete: "restrict" }
    ),
    repairCaseVersionAtRequest: integer(
      "repair_case_version_at_request"
    ).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // At most one active (still-REQUESTED) approval per case+type — the
    // mutation layer's transactional re-check is the primary guard, this
    // index is the DB-level backstop that makes a race condition impossible
    // rather than merely unlikely.
    uniqueIndex("repair_case_approvals_one_active_request")
      .on(table.repairCaseId, table.approvalType)
      .where(sql`status = 'REQUESTED'`),
    index("repair_case_approvals_repair_case_id_idx").on(table.repairCaseId),
    index("repair_case_approvals_requested_by_user_id_idx").on(
      table.requestedByUserId
    ),
    check(
      "repair_case_approvals_decision_metadata",
      sql`
        (status = 'REQUESTED' AND decided_by_user_id IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR
        (status = 'APPROVED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (status = 'REJECTED' AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)
      `
    ),
    check(
      "repair_case_approvals_delegation_only_for_final_shipment",
      sql`delegated_from_user_id IS NULL OR approval_type = 'FINAL_SHIPMENT'`
    ),
  ]
);
