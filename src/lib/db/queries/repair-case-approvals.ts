import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { repairCaseApprovals, repairCases, users } from "../schema";
import { actorHasAllowedRole } from "@/lib/auth/developer-promotion";
import { INSPECTION_DECIDE_ELIGIBLE_ROLES } from "../mutations/repair-case-approvals";
import {
  resolveApprovalState,
  type ShipmentApprovalState,
} from "@/lib/domain/local/workflow/shipment-approval-checklist";
import {
  isValidApprovalType,
  type RepairCaseApprovalType,
} from "@/lib/validation/repair-case-approval-input";

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

/**
 * 읽어 온 행들을 화면이 쓰는 모양으로 — 그리고 **접수 건 결재 행만** 남긴다.
 *
 * 🔴 2026-11-06 부터 `repair_case_approvals` 에는 **기타건**(내자 정리의 한 줄) 결재
 * 행도 쌓인다('DOMESTIC_ORDER_FINAL_SHIPMENT'). 그 행은 `repair_case_id` 가 언제나
 * NULL 이고(표의 CHECK) 아래 두 조회는 전부 `repair_case_id = ?` 로 좁히므로 여기
 * 올 수 없다 — 그래도 한 겹을 두는 까닭은 **그 조건이 바뀌는 날 기타건 결재가 접수
 * 건 승인 화면에 조용히 섞이지 않게** 하려는 것이다. 섞이면 카드가 종류를 모르는 행을
 * 받아 아무 카드에도 그려지지 않고, 그 실패는 화면에 아무 표시도 남기지 않는다.
 */
function toRepairCaseRows(rows: Awaited<ReturnType<typeof baseQuery>>): ApprovalRecordRow[] {
  const result: ApprovalRecordRow[] = [];
  for (const row of rows) {
    if (!isValidApprovalType(row.approvalType)) continue;
    result.push({
      ...row,
      approvalType: row.approvalType,
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    });
  }
  return result;
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
  return toRepairCaseRows(rows);
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
  for (const record of toRepairCaseRows(rows)) {
    if (seen.has(record.approvalType)) continue;
    seen.add(record.approvalType);
    latestByType.set(record.approvalType, record);
  }

  return (["REPAIR_INSPECTION", "FINAL_SHIPMENT"] as const).map((approvalType) => ({
    approvalType,
    latest: latestByType.get(approvalType) ?? null,
  }));
}

/**
 * ============================================================================
 * 🔴 여러 접수 건의 **최종 출하 승인 상태**를 한 번에 (2026-11-08)
 * ============================================================================
 * [최종 출하 승인 완료] 배지가 쓰는 값이다(사용자 요구 — 전체 A/S 현황 · 수리 건
 * 상세 머리 카드 · 내자 정리의 [완료 처리] 옆).
 *
 * ── 🔴 **N+1 이면 안 된다** ─────────────────────────────────────────────
 * 전체 A/S 현황은 한 해치가 수백 줄이다. 줄마다 getCurrentApprovalsForCase 를
 * 부르면 질의가 줄 수만큼 돈다. 여기서는 **질의 하나**로 그 건들의 최종 출하
 * 승인 행을 통째로 걷어 와 건마다 최신 한 줄만 남긴다 — 기타건 쪽이 먼저 같은
 * 모양으로 푼 자리다(queries/domestic-order-approvals.ts 의
 * loadDomesticOrderApprovalStates).
 *
 * ── 🔴 **판 번호를 부르는 쪽에서 받지 않는다** ──────────────────────────
 * 기타건 쪽과 **일부러 다르다.** 저쪽은 목록이 이미 읽어 온 `version` 을 받지만,
 * 이 함수를 부르는 자리 셋 중 하나(내자 정리의 목록)는 **접수 건의 판 번호를 아예
 * 안 들고 있다** — 내자 줄이 들고 있는 `version` 은 그 줄의 것이고, 접수 건의
 * 것과 **다른 수**다. 🔴 그 둘을 헷갈려 넘기면 이 함수는 멀쩡한 승인을 STALE 로
 * 답하거나(또는 그 반대로) 하고, 그 어긋남은 오류를 내지 않는다.
 * 그래서 판 번호는 **여기서 조인해 읽는다**(한 번의 조인이다).
 *
 * ── 🔴 접수 건 행만 온다 ────────────────────────────────────────────────
 * `repair_case_approvals` 에는 기타건 결재 행도 함께 쌓이지만
 * ('DOMESTIC_ORDER_FINAL_SHIPMENT'), 그 행은 `repair_case_id` 가 언제나 NULL
 * 이라(표의 CHECK) `IN (...)` 에 걸릴 수 없다. 🔵 그런데도 승인 종류로 한 번 더
 * 좁히는 것은 **같은 접수 건의 수리 검수 승인(REPAIR_INSPECTION)을 빼기 위해서**다
 * — 종류를 안 가르면 검수 승인이 더 최근일 때 그 행이 「최신」으로 뽑힌다.
 *
 * 🔵 **결재 기록이 없는 건은 지도에 넣지 않는다** — 받는 쪽이 `?? null` 로 메우면
 * 그것이 곧 NOT_REQUESTED 다(domain/final-shipment-approval-badge.ts 가 둘을 같게
 * 다룬다).
 * ============================================================================
 */
export async function loadRepairCaseFinalShipmentApprovalStates(
  repairCaseIds: readonly string[]
): Promise<Map<string, ShipmentApprovalState>> {
  const states = new Map<string, ShipmentApprovalState>();
  // 🔴 빈 목록으로 `IN ()` 을 만들지 않는다 — drizzle 이 거짓 조건으로 접어 주더라도
  //    질의 한 벌을 괜히 돌린다.
  const ids = [...new Set(repairCaseIds)];
  if (ids.length === 0) return states;

  const rows = await db
    .select({
      repairCaseId: repairCaseApprovals.repairCaseId,
      status: repairCaseApprovals.status,
      versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
      currentVersion: repairCases.version,
    })
    .from(repairCaseApprovals)
    .innerJoin(repairCases, eq(repairCaseApprovals.repairCaseId, repairCases.id))
    .where(
      and(
        inArray(repairCaseApprovals.repairCaseId, ids),
        eq(repairCaseApprovals.approvalType, "FINAL_SHIPMENT")
      )
    )
    // 🔴 「가장 최근」의 정의가 다른 자리들과 **같아야 한다** — `requested_at`
    //    내림차순의 첫 행이다(resolveApprovalValidity · 전이 관문이 쓰는 그 정의).
    //    갈리면 화면은 「승인 완료」라는데 출하 완료 단추는 거절한다.
    .orderBy(desc(repairCaseApprovals.requestedAt));

  for (const row of rows) {
    // 조인이 접수 건 행만 남기므로 null 일 수 없지만, 타입이 그것을 모른다.
    if (row.repairCaseId === null) continue;
    // 🔴 **먼저 온 것이 이긴다** — 위 정렬이 최신을 맨 앞에 둔다.
    if (states.has(row.repairCaseId)) continue;
    states.set(
      row.repairCaseId,
      // 🔴 판정은 여기 새로 적지 않는다 — 승인 카드·전이 관문이 쓰는 그 함수 하나다.
      resolveApprovalState(
        { status: row.status, repairCaseVersionAtRequest: row.versionAtRequest },
        row.currentVersion
      )
    );
  }

  return states;
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
