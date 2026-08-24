import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db } from "../client";
import { repairCaseApprovals, repairCases, users, workflowTransitions } from "../schema";
import { resolveApprovalState } from "@/lib/domain/local/workflow/shipment-approval-checklist";
import { resolveShipmentDecideAuthorization } from "./shipment-delegations";
import type { RepairCaseApprovalType } from "@/lib/validation/repair-case-approval-input";

/**
 * ============================================================================
 * 내가 결재해야 할 접수 건 — 여러 건을 가로로 훑는 유일한 조회
 * ============================================================================
 * `repair_case_approvals`에는 요청(REQUESTED)과 결정(APPROVED/REJECTED)이 함께
 * 쌓인다. "결재 대기"라는 값이 행에 저장돼 있는 게 아니므로 이것은 파생
 * 계산이다 — *결재를 요구하는 단계에 서 있고, 그 종류의 결재 요청이 들어와
 * 있으며, 아직 결정되지 않은 상태*.
 *
 * 요청이 들어와 있는 것까지 요구하는 이유: 배지와 목록은 **결재자가 지금
 * 눌러서 처리할 수 있는 건**이어야 한다. 아직 아무도 요청하지 않았거나
 * (NOT_REQUESTED), 반려됐거나(REJECTED), 승인 이후 접수 건이 바뀌어 무효가 된
 * (STALE) 건은 다음 차례가 결재자가 아니라 **엔지니어의 재요청**이다 — 결재자
 * 화면에 세워 두면 눌러도 할 일이 없다.
 *
 * ── 판정은 새로 만들지 않는다 ───────────────────────────────────────────
 * 유효/무효 판정은 `resolveApprovalState`(shipment-approval-checklist.ts)
 * 하나만 쓴다. 상세 화면의 승인 카드와 "출하까지 남은 결재" 체크리스트가 쓰는
 * 바로 그 함수다 — 여기서 따로 계산하면 사이드바 배지·목록·상세 화면이 서로
 * 다른 답을 내게 된다. 그 함수는 서버의 두 판정(전이 게이트
 * workflow-transitions.ts, 요청 사전 조건 repair-case-approvals.ts)과 같은
 * 규칙, 즉 "가장 최근 행이 APPROVED이고 그때의 version이 지금 version과 같다"를
 * 그대로 쓴다(resolveApprovalValidity와 동일한 기준).
 *
 * ── 결재를 요구하는 단계인가 ────────────────────────────────────────────
 * 이 접수 건의 workflow version에서, **지금 단계를 출발점으로 하는 전이 중
 * required_approval_type이 걸린 것**이 있는가로 본다. 화면
 * (DatabaseWorkflowControlPanel)이 `findTransitionInDto(...).requiredApprovalType`
 * 로 보는 것과 같은 값을 SQL로 조인해서 볼 뿐이다. 단계 이름("출하 승인됨")이
 * 아니라 전이의 요건을 보는 것이 핵심이다 — 그 둘을 혼동한 것이 786572a가
 * 고친 사고였다.
 *
 * ── 인가 ────────────────────────────────────────────────────────────────
 * 화면이 무엇을 렌더했든 여기서 독립적으로 다시 판정한다. 기준은
 * `decideRepairCaseApproval`(mutations/repair-case-approvals.ts)이 실제로
 * 강제하는 것과 같다:
 *  - REPAIR_INSPECTION: 삭제되지 않은 사용자 + approvalStatus APPROVED +
 *    역할이 최고관리자/관리자/A/S 엔지니어.
 *  - FINAL_SHIPMENT: `resolveShipmentDecideAuthorization`을 그대로 호출한다
 *    (대표 직접 결재 또는 유효한 위임을 받은 대리 결재). 스키마 CHECK상 위임은
 *    FINAL_SHIPMENT에만 적용된다.
 * 권한이 없는 종류는 조회 조건에서 아예 빠진다 — 걸러 내는 게 아니라 애초에
 * 묻지 않는다.
 *
 * 이 함수는 읽기 전용이고 최종 판정도 아니다. 실제 승인/반려는 여전히
 * decideRepairCaseApproval이 자기 트랜잭션 안에서 전부 다시 확인한다.
 * ============================================================================
 */

/** decideRepairCaseApproval의 INSPECTION_DECIDE_ELIGIBLE_ROLES와 같은 집합. */
const INSPECTION_DECIDE_ELIGIBLE_ROLES = ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"] as const;

export type PendingApprovalItem = {
  repairCaseId: string;
  intakeNumber: string;
  approvalType: RepairCaseApprovalType;
  /**
   * 항상 "PENDING" — 결재 요청이 들어와 있고 아직 결정되지 않은 상태다. 다른
   * 상태(NOT_REQUESTED/REJECTED/STALE/APPROVED)는 이 목록에 들어오지 않는다.
   * 필드로 남겨 두는 것은 화면이 값을 읽기 때문이 아니라, 이 목록이 어떤
   * 판정으로 좁혀졌는지를 타입에 적어 두기 위해서다.
   */
  state: "PENDING";
};

type DecidableTypes = {
  types: RepairCaseApprovalType[];
};

/**
 * 이 사용자가 지금 결재할 수 있는 승인 종류. 둘 다 아니면 빈 배열이고, 그때는
 * DB를 더 읽지 않는다.
 */
async function resolveDecidableApprovalTypes(actorUserId: string): Promise<DecidableTypes> {
  const [actor] = await db
    .select({ role: users.role, approvalStatus: users.approvalStatus })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));

  if (!actor || actor.approvalStatus !== "APPROVED") {
    return { types: [] };
  }

  const types: RepairCaseApprovalType[] = [];
  if ((INSPECTION_DECIDE_ELIGIBLE_ROLES as readonly string[]).includes(actor.role)) {
    types.push("REPAIR_INSPECTION");
  }
  // 대표 자격/위임은 역할과 무관한 별도 축이다 — 같은 함수를 승인 화면이
  // 이미 쓰고 있으므로 여기서 다시 짜지 않는다.
  const shipmentAuthorization = await resolveShipmentDecideAuthorization(actorUserId);
  if (shipmentAuthorization.allowed) {
    types.push("FINAL_SHIPMENT");
  }
  return { types };
}

/**
 * 이 사용자가 결재할 수 있는 승인 종류가 하나라도 있는가 — 목록이 0건일 때
 * "결재할 게 없다"와 "애초에 결재자가 아니다"를 화면이 구분하기 위한 것이다
 * (전자는 조건을 보여 주고, 후자는 조건 자체를 감춘다).
 */
export async function canDecideAnyRepairCaseApproval(actorUserId: string): Promise<boolean> {
  const { types } = await resolveDecidableApprovalTypes(actorUserId);
  return types.length > 0;
}

/**
 * 내가 결재해야 할 (접수 건, 승인 종류) 목록. 인수번호 순.
 *
 * 제외 대상:
 *  - 소프트 삭제(휴지통)된 건 — `repair_cases.is_deleted`.
 *  - 출하 완료로 잠긴 건 — `is_locked`. 워크플로 전이 자체가 막혀 있어
 *    결재를 받아도 할 수 있는 일이 없다(상세 화면의 체크리스트도 잠긴 건에는
 *    나오지 않는다).
 *  - 유·무상 확정을 기다리는 건 — `billing_type = 'PENDING_DECISION'`.
 *    그 상태에서는 decideRepairCaseApproval이 BILLING_DECISION_REQUIRED로
 *    거절하므로 "지금 결재할 수 있는 건"이 아니다.
 *  - 결재 요청이 들어와 있지 않거나 이미 결정된 건 — resolveApprovalState가
 *    PENDING이 아닌 것 전부. 아직 요청조차 없음(NOT_REQUESTED), 이미 유효한
 *    승인이 있음(APPROVED), 반려됨(REJECTED), 승인 이후 접수 건이 바뀌어
 *    무효(STALE)가 여기 해당한다. 뒤의 셋은 다음 차례가 엔지니어의 재요청이라
 *    결재자가 지금 할 일이 없다.
 *  - 내가 결재할 수 없는 승인 종류.
 */
export async function listRepairCasesPendingMyApproval(actorUserId: string): Promise<PendingApprovalItem[]> {
  const { types } = await resolveDecidableApprovalTypes(actorUserId);
  if (types.length === 0) return [];

  // 지금 단계를 출발점으로 하는 전이 중 승인이 걸린 것 — 한 단계에 여러 개가
  // 걸릴 수 있으므로 (건, 종류) 쌍으로 나온다.
  const candidates = await db
    .select({
      repairCaseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      version: repairCases.version,
      approvalType: workflowTransitions.requiredApprovalType,
    })
    .from(repairCases)
    .innerJoin(
      workflowTransitions,
      and(
        eq(workflowTransitions.workflowVersionId, repairCases.workflowVersionId),
        eq(workflowTransitions.fromStepId, repairCases.currentWorkflowStepId),
        isNotNull(workflowTransitions.requiredApprovalType),
        inArray(workflowTransitions.requiredApprovalType, types)
      )
    )
    .where(
      and(
        eq(repairCases.isDeleted, false),
        eq(repairCases.isLocked, false),
        // 유·무상 확정을 기다리는 건은 지금 결재할 수 없다 —
        // decideRepairCaseApproval이 BILLING_DECISION_REQUIRED로 거절한다.
        // 배지는 "지금 내가 처리할 수 있는 건수"여야 한다: 잡히는데 눌러도
        // 막히면 배지를 믿지 않게 된다.
        //
        // isNull을 함께 두는 이유: billing_type은 nullable이고(값이 아예 없는
        // 옛 건이 있다), SQL에서 `<> 'PENDING_DECISION'`은 NULL 행에 대해
        // NULL이라 그 행까지 조용히 빠진다. 서버가 막는 것은 값이 정확히
        // PENDING_DECISION일 때뿐이므로 그 한 값만 뺀다.
        or(isNull(repairCases.billingType), ne(repairCases.billingType, "PENDING_DECISION"))
      )
    )
    .orderBy(repairCases.intakeNumber);

  if (candidates.length === 0) return [];

  // (건, 종류)별 가장 최근 행 하나 — getCurrentApprovalsForCase가 한 건에
  // 대해 하는 것과 같은 접기를, 여러 건에 대해 한 번의 조회로 한다.
  const caseIds = [...new Set(candidates.map((candidate) => candidate.repairCaseId))];
  const approvalRows = await db
    .select({
      repairCaseId: repairCaseApprovals.repairCaseId,
      approvalType: repairCaseApprovals.approvalType,
      status: repairCaseApprovals.status,
      repairCaseVersionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
    })
    .from(repairCaseApprovals)
    .where(inArray(repairCaseApprovals.repairCaseId, caseIds))
    .orderBy(desc(repairCaseApprovals.requestedAt));

  const latestByCaseAndType = new Map<string, { status: string; repairCaseVersionAtRequest: number }>();
  for (const row of approvalRows) {
    // repairCaseId는 영구 삭제 대비로 nullable이지만, inArray로 걸러 온
    // 행에는 항상 값이 있다.
    if (!row.repairCaseId) continue;
    const key = `${row.repairCaseId}::${row.approvalType}`;
    if (latestByCaseAndType.has(key)) continue;
    latestByCaseAndType.set(key, {
      status: row.status,
      repairCaseVersionAtRequest: row.repairCaseVersionAtRequest,
    });
  }

  const items: PendingApprovalItem[] = [];
  for (const candidate of candidates) {
    const approvalType = candidate.approvalType;
    // isNotNull + inArray로 걸렀으므로 null일 수 없다 — 타입만 좁힌다.
    if (!approvalType) continue;
    const latest = latestByCaseAndType.get(`${candidate.repairCaseId}::${approvalType}`) ?? null;
    const state = resolveApprovalState(latest, candidate.version);
    if (state !== "PENDING") continue;
    items.push({
      repairCaseId: candidate.repairCaseId,
      intakeNumber: candidate.intakeNumber,
      approvalType,
      state,
    });
  }
  return items;
}

/**
 * 사이드바 배지에 쓰는 **접수 건 수**. 한 건에 두 종류가 함께 걸려 있어도
 * 사람에게는 한 건이므로 건 단위로 센다. 0이면 배지를 그리지 않는다.
 */
export async function countRepairCasesPendingMyApproval(actorUserId: string): Promise<number> {
  const items = await listRepairCasesPendingMyApproval(actorUserId);
  return new Set(items.map((item) => item.repairCaseId)).size;
}
