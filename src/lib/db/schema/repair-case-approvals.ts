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
import { shipmentApprovalRoutes } from "./shipment-approval-routes";
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
    // 「이 요청을 누가 처리할지」 — 요청할 때 지정한 사람.
    //
    // 🔴 **NULL 이 정상값이고, 뜻이 있다: 「지정 없음 = 자격 있는 사람 누구나
    // 처리」** — 이 칸이 생기기 전과 완전히 같은 동작이다. 그래서 NOT NULL 도
    // 기본값도 두지 않는다. 이미 쌓여 있는 승인 기록이 전부 NULL 로 남아 어제와
    // 똑같이 동작하는 것이 이 설계의 안전장치다. 지정은 어디까지나 선택이다
    // (「누구든 빨리 봐 주세요」인 경우가 실제로 있다).
    //
    // 지정이 있으면 그 사람만 처리할 수 있다(+ 최고관리자는 언제나 — 자리를
    // 비워 영영 막히는 것을 막는다). 판정은 화면·서버 액션·mutation·알림 조회가
    // 전부 같은 함수 하나를 본다: mayDecideAssignedApproval
    // (src/lib/auth/approval-assignment.ts).
    //
    // 승인 종류를 가리지 않는 이름인 것은 의도다. 최종 출하 승인의 순차 승인도
    // 이 칸으로 풀 예정이라(단계마다 요청 행 하나, 그 행의 지정된 사람이 그
    // 단계의 승인자) 「검수 전용」이 되면 안 된다.
    //
    // ON DELETE RESTRICT — 다른 사람 참조 칸들(requested_by/decided_by/
    // delegated_from)과 같다. 지정된 사람이 지워지면서 이 이력이 조용히
    // 뭉개지지 않게 한다.
    assignedApproverUserId: uuid("assigned_approver_user_id").references(
      () => users.id,
      { onDelete: "restrict" }
    ),
    // 「이 요청이 결재선(판)의 몇 번째 단계인가」 — 두 칸이 한 쌍이다.
    //
    // 🔴 **NULL 이 정상값이고, 뜻이 있다: 「결재선을 타지 않는 요청」** — 이
    // 칸들이 생기기 전과 완전히 같은 동작이다(최종 출하 승인은 「출하 대표」·
    // 위임 방식으로 처리, 검수 승인은 역할 자격으로 처리). 그래서 NOT NULL 도
    // 기본값도 두지 않는다. 이미 쌓여 있는 승인 기록이 전부 NULL 로 남아 어제와
    // 똑같이 동작하는 것이 이 설계의 안전장치다. 결재선 판이 하나도 없거나 단계
    // 0개인 판일 때도 NULL 이다(빈 판은 「절차를 쓰지 않겠다」는 정상적인 뜻이다).
    //
    // 값이 있으면 그 단계의 승인자(assigned_approver_user_id)만 처리할 수 있고
    // (+ 최고관리자), 대표·위임 판정은 건너뛴다 — 절차가 대표를 **대신한다**.
    // 승인되면 같은 판의 다음 단계 요청 행이 이어서 하나 만들어진다.
    //
    // 🔴 판을 **그때 그 판으로 붙잡아 두는** 칸이다. 관리자가 절차를 바꾸면 새
    // 판이 얹히지만(shipment_approval_routes 는 append-only), 이미 요청된 건은
    // 여기에 적힌 옛 판을 끝까지 따라간다. 요청 시점의 결재선을 복사해 굳히는
    // 표가 따로 필요 없는 이유다 — repair_case_version_at_request 가 접수 건
    // 상태에 대해 하는 것과 같은 종류의 고정이다.
    //
    // ON DELETE RESTRICT — 판이 지워지면서 이 이력이 「몇 번째 단계였는지 알 수
    // 없는 행」으로 남지 않게 한다(판은 실제로 지우지 않으므로 방어선이다).
    routeId: uuid("route_id").references(() => shipmentApprovalRoutes.id, {
      onDelete: "restrict",
    }),
    // 그 판 안에서 몇 번째 단계인가(1부터). route_id 와 **함께 있거나 함께
    // 없다** — 아래 CHECK 가 그것을 강제한다. 다음 단계를 찾을 때
    // (route_id, route_step_order + 1) 로 조회한다.
    routeStepOrder: integer("route_step_order"),
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
    // 알림 종·배지가 "내게 지정된 결재"를 찾는 길 — 지정된 행만 걸러 읽는다.
    index("repair_case_approvals_assigned_approver_user_id_idx").on(
      table.assignedApproverUserId
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
    // 결재선 두 칸은 한 쌍이다. 하나만 채워진 행은 「어느 판인지는 아는데 몇
    // 번째인지 모른다」(또는 그 반대)라서 다음 단계를 이을 수도, 지난 단계를
    // 설명할 수도 없다.
    check(
      "repair_case_approvals_route_columns_together",
      sql`(route_id IS NULL AND route_step_order IS NULL) OR (route_id IS NOT NULL AND route_step_order IS NOT NULL)`
    ),
    // 결재선은 최종 출하 승인에만 있다 — 검수 승인은 역할 자격으로 처리한다.
    // delegation_only_for_final_shipment 와 같은 모양의 방어선이다.
    check(
      "repair_case_approvals_route_only_for_final_shipment",
      sql`route_id IS NULL OR approval_type = 'FINAL_SHIPMENT'`
    ),
  ]
);
