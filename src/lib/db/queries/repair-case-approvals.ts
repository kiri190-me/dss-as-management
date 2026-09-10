import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseApprovals, users } from "../schema";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { INSPECTION_DECIDE_ELIGIBLE_ROLES } from "../mutations/repair-case-approvals";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";

const requester = alias(users, "requester");
const decider = alias(users, "decider");
const delegator = alias(users, "delegator");
const assignedApprover = alias(users, "assigned_approver");

export type ApprovalRecordRow = {
  id: string;
  approvalType: RepairCaseApprovalType;
  status: "REQUESTED" | "APPROVED" | "REJECTED";
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  requestReason: string | null;
  /**
   * 이 요청을 처리하도록 지정된 사람. `null` 은 「지정 없음」이고 정상값이다 —
   * 자격 있는 사람 누구나 처리한다(스키마 칸 주석 참조). 화면이 이 값을
   * mayDecideAssignedApproval 에 그대로 넘겨 단추를 열지 말지 정한다.
   */
  assignedApproverUserId: string | null;
  /** 지정된 사람의 이름. 지정이 없으면 `null` — 카드가 `-` 로 그린다. */
  assignedApproverName: string | null;
  /**
   * 이 요청이 타고 있는 결재선 판. `null` 은 「결재선을 타지 않는다」이고
   * 정상값이다 — 그때는 대표·위임 방식으로 처리한다. 화면이 이 값을
   * approvalFollowsRoute 에 그대로 넘겨 어느 축으로 판정할지 정한다.
   *
   * 🔴 **「현재 판」이 아니라 요청 시점에 붙잡아 둔 판**이다. 진행 중인 건은
   * 관리자가 절차를 바꿔도 이 판을 끝까지 따라간다.
   */
  routeId: string | null;
  /** 그 판 안에서 몇 번째 단계인가(1부터). `routeId` 와 함께 있거나 함께 없다. */
  routeStepOrder: number | null;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  delegatedFromUserId: string | null;
  delegatedFromName: string | null;
  repairCaseVersionAtRequest: number;
};

const SELECT_COLUMNS = {
  id: repairCaseApprovals.id,
  approvalType: repairCaseApprovals.approvalType,
  status: repairCaseApprovals.status,
  requestedByUserId: repairCaseApprovals.requestedByUserId,
  requestedByName: requester.name,
  requestedAt: repairCaseApprovals.requestedAt,
  requestReason: repairCaseApprovals.requestReason,
  assignedApproverUserId: repairCaseApprovals.assignedApproverUserId,
  assignedApproverName: assignedApprover.name,
  routeId: repairCaseApprovals.routeId,
  routeStepOrder: repairCaseApprovals.routeStepOrder,
  decidedByUserId: repairCaseApprovals.decidedByUserId,
  decidedByName: decider.name,
  decidedAt: repairCaseApprovals.decidedAt,
  decisionReason: repairCaseApprovals.decisionReason,
  delegatedFromUserId: repairCaseApprovals.delegatedFromUserId,
  delegatedFromName: delegator.name,
  repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
};

function baseQuery() {
  return db
    .select(SELECT_COLUMNS)
    .from(repairCaseApprovals)
    .innerJoin(requester, eq(repairCaseApprovals.requestedByUserId, requester.id))
    .leftJoin(decider, eq(repairCaseApprovals.decidedByUserId, decider.id))
    .leftJoin(delegator, eq(repairCaseApprovals.delegatedFromUserId, delegator.id))
    // LEFT JOIN — 지정이 없는 행(대부분이 그렇다)이 여기서 떨어지면 안 된다.
    .leftJoin(assignedApprover, eq(repairCaseApprovals.assignedApproverUserId, assignedApprover.id));
}

function toRow(row: Awaited<ReturnType<typeof baseQuery>>[number]): ApprovalRecordRow {
  return {
    ...row,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/**
 * Full request/decision history for a case, both approval types mixed,
 * newest first — feeds the database-mode approval timeline UI. Every
 * REQUESTED row is its own permanent record (append-only, see the schema
 * file), so this alone reconstructs the complete history without a
 * separate events table.
 */
export async function getApprovalHistoryForCase(repairCaseId: string): Promise<ApprovalRecordRow[]> {
  const rows = await baseQuery()
    .where(eq(repairCaseApprovals.repairCaseId, repairCaseId))
    .orderBy(desc(repairCaseApprovals.requestedAt));
  return rows.map(toRow);
}

export type CurrentApprovalState = {
  approvalType: RepairCaseApprovalType;
  /** null means NOT_REQUESTED — no row has ever been created for this (case, type) pair. */
  latest: ApprovalRecordRow | null;
};

/**
 * The single most recent row per approval type — mirrors the local-demo
 * layer's getDisplayStatus(findRecordFor(...)) derivation (NOT_REQUESTED is
 * "no row", not a stored state). Used by both the approval screen (what to
 * show/what actions to offer) and the workflow control panel (whether a
 * gated transition's requirement is currently satisfied).
 */
export async function getCurrentApprovalsForCase(repairCaseId: string): Promise<CurrentApprovalState[]> {
  const rows = await baseQuery()
    .where(eq(repairCaseApprovals.repairCaseId, repairCaseId))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  const seen = new Set<RepairCaseApprovalType>();
  const latestByType = new Map<RepairCaseApprovalType, ApprovalRecordRow>();
  for (const row of rows) {
    if (seen.has(row.approvalType)) continue;
    seen.add(row.approvalType);
    latestByType.set(row.approvalType, toRow(row));
  }

  return (["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const).map((approvalType) => ({
    approvalType,
    latest: latestByType.get(approvalType) ?? null,
  }));
}

export type ApprovalAssigneeCandidate = {
  id: string;
  name: string;
  role: string;
};

/**
 * 검수 승인 요청 창의 「누구에게 보낼까요」 후보 목록 — 지금 그 승인을 처리할
 * 수 있는 사람들이다.
 *
 * 🔴 자격 판정은 요청 mutation 과 **같은 목록·같은 함수**로 한다
 * (INSPECTION_DECIDE_ELIGIBLE_ROLES + actorHasAllowedRole). 여기서 목록을 한
 * 벌 더 만들면 화면에는 고를 수 있게 나오는데 요청하면 서버가 거절하는(또는
 * 그 반대의) 어긋남이 생긴다 — 그 어긋남은 사용자에게 「왜 안 되지」로만
 * 보인다.
 *
 * 계정 상태 조건도 요청 mutation 이 트랜잭션 안에서 다시 보는 것과 같다:
 * 삭제 안 됨 · 승인됨 · 활성 · 잠기지 않음. 이 목록은 어디까지나 화면을 위한
 * 힌트이고, 최종 판정은 언제나 mutation 이 자기 트랜잭션 안에서 다시 한다.
 *
 * 역할 필터를 SQL 이 아니라 메모리에서 하는 이유: 개발자 표시(is_developer)가
 * 켜진 계정은 역할이 목록에 없어도 최고관리자 권한을 더해 받는데, 그 규칙은
 * actorHasAllowedRole 안에만 있다. SQL 에 역할 목록을 적으면 그 계정이 조용히
 * 빠진다. 사용자 표는 규모가 작아 전량을 읽어 거르는 비용이 문제되지 않는다.
 */
export async function listInspectionApproverCandidates(): Promise<ApprovalAssigneeCandidate[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isDeveloper: users.isDeveloper,
    })
    .from(users)
    .where(
      and(
        eq(users.isDeleted, false),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isActive, true),
        isNull(users.lockedAt)
      )
    )
    .orderBy(asc(users.name));

  return rows
    .filter((row) => actorHasAllowedRole(row, INSPECTION_DECIDE_ELIGIBLE_ROLES))
    .map((row) => ({ id: row.id, name: row.name, role: row.role }));
}

/**
 * Used by transitionWorkflow() (workflow-transitions.ts) to decide whether
 * a gated transition may proceed. A valid approval is: the most recent row
 * for (repairCaseId, approvalType), status APPROVED, and requested against
 * the repair case's *current* version (repair_case_version_at_request must
 * still match repair_cases.version) — an approval requested before a
 * material edit to the case must never silently authorize a transition
 * against the post-edit state.
 */
export type ApprovalValidityResult =
  | { state: "VALID"; approvalId: string }
  | { state: "MISSING" }
  | { state: "STALE" };

export async function resolveApprovalValidity(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType,
  currentRepairCaseVersion: number
): Promise<ApprovalValidityResult> {
  const [latest] = await db
    .select({
      id: repairCaseApprovals.id,
      status: repairCaseApprovals.status,
      repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
    })
    .from(repairCaseApprovals)
    .where(and(eq(repairCaseApprovals.repairCaseId, repairCaseId), eq(repairCaseApprovals.approvalType, approvalType)))
    .orderBy(desc(repairCaseApprovals.requestedAt))
    .limit(1);

  if (!latest || latest.status !== "APPROVED") {
    return { state: "MISSING" };
  }
  if (latest.repairCaseVersionAtRequest !== currentRepairCaseVersion) {
    return { state: "STALE" };
  }
  return { state: "VALID", approvalId: latest.id };
}
