import {
  isRouteStepSkippedForRequester,
  type RouteStepAssignment,
  type ShipmentApprovalRouteScope,
} from "./shipment-approval-route";

/**
 * ============================================================================
 * 사용자 계정 삭제 — 순수 규칙
 * ============================================================================
 * 사용자 결정(2026-09-13): 이 시스템의 삭제는 「목록에서 치우고 일을 넘기는 것」이다.
 * 결재 자리 · 결재 대기 · 마지막 출하 대표는 **결재 이어받을 사람**에게, 담당 중인
 * 접수 건은 **담당 이어받을 사람**에게 넘긴다. 진짜 차단은 통합 로그인 포털의 권한
 * 회수다.
 *
 * 여기 적힌 것은 자료를 읽지 않고 답할 수 있는 판정뿐이다 — 영향 미리보기
 * (queries/user-deletion-impact.ts)와 삭제 mutation 이 **같은 함수**를 부른다. 두
 * 곳이 각자 적으면 「미리보기는 이어받을 사람이 필요 없다는데 삭제는 요구한다」나
 * 「후보로 보여 준 사람을 삭제가 거절한다」가 생긴다.
 *
 * ── 🔴 계정 상태와 검수 자격은 여기서 다시 적지 않는다 ──────────────────
 * 이 층은 db 층을 가져오지 않는다(도메인 층의 관례). 그래서 계정 조건 넷(승인됨 ·
 * 활성 · 잠기지 않음 · 삭제 안 됨)과 수리 검수 결재 역할은 **그 판정이 적힌 층이
 * 계산해 사실로 넘긴다** — 계정 조건은 mutations/shipment-approval-routes.ts 의
 * approverBlockReason(결재선에 올릴 수 있는가와 글자 그대로 같다), 검수 자격은
 * mutations/repair-case-approvals.ts 의 INSPECTION_DECIDE_ELIGIBLE_ROLES 다. 여기서
 * 조건을 한 벌 더 적으면 새 판 저장이 거절할 사람을 후보로 보여 주게 된다.
 *
 * ── 진행 중인 결재 사슬 (planOpenApproval) ──────────────────────────────
 * 진행 중인 결재는 요청할 때 붙잡은 판을 끝까지 따라간다(schema/repair-case-
 * approvals.ts 의 route_id 주석). 그래서 「현재 판에서 지울 사람 자리를 바꾼 새 판」을
 * 만드는 것만으로는 이미 요청된 건의 **뒤 단계**가 여전히 지울 사람에게 간다. 사슬
 * 하나마다 셋 중 하나를 고른다:
 *  - 지금 열린 단계가 지울 사람에게 지정됨 → 그 행만 이어받을 사람에게(REASSIGN)
 *  - 지울 사람이 **현재 판**의 뒤 단계에 있음 → 그 행을 새 판으로 옮김(REPIN) —
 *    새 판은 그 자리만 바뀌었으므로 단계 번호가 그대로 맞는다
 *  - 지울 사람이 **옛 판**의 뒤 단계에 있음 → 삭제를 멈춘다(사용자 결정 2026-09-14,
 *    IN_FLIGHT_ON_OLD_ROUTE). 옛 판의 단계는 고칠 수 없고(append-only), 지울 사람은
 *    아직 삭제 전이라 자기 단계를 결재할 수 있다
 * ============================================================================
 */

/** 이어받을 사람을 세울 수 없을 때의 결과 코드 — 삭제 결과 코드와 같은 이름이다. */
export type UserDeletionSuccessorBlockCode =
  /** 계정 조건 · 역할 · 자기 자신 — 사람 자체가 이 자리에 맞지 않는다. */
  | "INVALID_SUCCESSOR"
  /** 이미 그 결재선의 다른 단계에 있다(사용자 결정 2026-09-13). */
  | "SUCCESSOR_ALREADY_IN_ROUTE"
  /** 넘겨받을 진행 중 결재 사슬을 그 사람이 올렸다. */
  | "SUCCESSOR_IS_REQUESTER";

export type UserDeletionSuccessorBlock = {
  code: UserDeletionSuccessorBlockCode;
  message: string;
};

/**
 * 결재 이어받을 사람 후보 한 명에 대해 **부르는 쪽이 계산해 넘기는** 사실(파일
 * 머리말의 🔴 절).
 */
export type ApprovalSuccessorFacts = {
  id: string;
  name: string;
  /** approverBlockReason 의 결과. null 이면 계정 조건 넷을 통과했다. */
  accountBlockReason: string | null;
  /** 수리 검수 승인을 결재할 수 있는 역할인가 — 개발자 승격 포함. */
  canDecideInspection: boolean;
};

export type ApprovalSuccessorContext = {
  targetUserId: string;
  /** 넘겨받을 결재 대기 중에 수리 검수 수동 지정이 있는가. */
  mustInspect: boolean;
  /** 영향받는 판(현재 판 · 옮길 판 · 이어 갈 옛 판)에 이미 올라 있는 사람들. */
  routeMemberIds: ReadonlySet<string>;
  /** 영향받는 진행 중 결재 사슬(결재선을 타는 것)의 요청자들. */
  requesterIds: ReadonlySet<string>;
};

/**
 * 이 사람을 결재 이어받을 사람으로 세울 수 없는 이유. 세울 수 있으면 null.
 *
 * 역할 제한은 없다 — 결재선과 대표 지정이 역할을 보지 않기 때문이다
 * (queries/shipment-approval-routes.ts 의 listSelectableApproverCandidates 주석).
 * 검수 수동 지정을 넘겨받을 때만 검수 결재 역할을 요구한다.
 *
 * 사람 자체의 자격(자기 자신 · 계정 · 역할)을 결재선 충돌보다 먼저 본다 — 계정이
 * 잠긴 사람에게 「이미 절차에 있습니다」라고 말하면 절차를 고치면 되는 줄 안다.
 */
export function approvalSuccessorBlock(
  candidate: ApprovalSuccessorFacts,
  context: ApprovalSuccessorContext
): UserDeletionSuccessorBlock | null {
  if (candidate.id === context.targetUserId) {
    return { code: "INVALID_SUCCESSOR", message: "삭제할 계정 자신은 일을 이어받을 수 없습니다." };
  }
  if (candidate.accountBlockReason !== null) {
    return { code: "INVALID_SUCCESSOR", message: `${candidate.name} 님은 ${candidate.accountBlockReason}.` };
  }
  if (context.mustInspect && !candidate.canDecideInspection) {
    return {
      code: "INVALID_SUCCESSOR",
      message: `${candidate.name} 님은 수리 검수 승인을 처리할 수 있는 역할이 아닙니다.`,
    };
  }
  if (context.routeMemberIds.has(candidate.id)) {
    return {
      code: "SUCCESSOR_ALREADY_IN_ROUTE",
      message: `${candidate.name} 님은 이미 그 승인 절차의 다른 단계에 있습니다. 한 사람이 같은 절차에 두 번 설 수 없으니 다른 사람을 골라 주세요.`,
    };
  }
  if (context.requesterIds.has(candidate.id)) {
    return {
      code: "SUCCESSOR_IS_REQUESTER",
      message: `${candidate.name} 님이 올린 진행 중 결재가 ${candidate.name} 님에게 넘어가게 됩니다. 자기가 올린 결재는 자기가 처리할 수 없으니 다른 사람을 골라 주세요.`,
    };
  }
  return null;
}

/** 담당 이어받을 사람이 되어야 하는 역할 — 담당 엔지니어 배정과 같다(mutations/repair-cases.ts). */
export const USER_DELETION_ENGINEER_ROLE = "AS_ENGINEER";

export type EngineerSuccessorFacts = {
  id: string;
  name: string;
  role: string;
  /** approverBlockReason 의 결과. null 이면 계정 조건 넷을 통과했다. */
  accountBlockReason: string | null;
};

/**
 * 이 사람을 담당 이어받을 사람으로 세울 수 없는 이유. 세울 수 있으면 null.
 *
 * 담당 엔지니어 배정(mutations/repair-cases.ts 의 updateRepairCase)은 역할 · 승인 ·
 * 삭제만 본다. 여기는 활성 · 잠기지 않음까지 본다 — 「앞으로 일할 사람」을 고르는
 * 자리라서다(승인 요청의 처리자 지정이 같은 이유로 좁게 본다,
 * mutations/repair-case-approvals.ts). 역할은 승격 없이 진짜 역할을 본다 — 배정
 * 쪽이 그렇게 판정하므로, 넓히면 삭제만 배정할 수 없는 사람을 세우게 된다.
 */
export function engineerSuccessorBlock(
  candidate: EngineerSuccessorFacts,
  context: { targetUserId: string }
): UserDeletionSuccessorBlock | null {
  if (candidate.id === context.targetUserId) {
    return { code: "INVALID_SUCCESSOR", message: "삭제할 계정 자신은 일을 이어받을 수 없습니다." };
  }
  if (candidate.accountBlockReason !== null) {
    return { code: "INVALID_SUCCESSOR", message: `${candidate.name} 님은 ${candidate.accountBlockReason}.` };
  }
  if (candidate.role !== USER_DELETION_ENGINEER_ROLE) {
    return { code: "INVALID_SUCCESSOR", message: `${candidate.name} 님은 A/S 엔지니어가 아닙니다.` };
  }
  return null;
}

/**
 * ============================================================================
 * 이어받을 사람이 필요한가
 * ============================================================================
 */

/** 지울 사람에게 **지정된** 결재 대기의 수 — 승인 종류별. */
export type UserDeletionPendingApprovalCounts = {
  finalShipment: number;
  repairInspection: number;
  partIssue: number;
  quote: number;
};

/**
 * 종류를 가리지 않은 대기 결재의 합.
 *
 * 🔴 **칸을 손으로 더하지 않는다.** 예전에는 부르는 쪽마다 세 칸을 글자로 더했고
 * (`finalShipment + repairInspection + partIssue`), 그래서 종류가 늘어도 타입 오류가
 * 나지 않은 채 확인 창이 **조용히 빠뜨린 건수**를 말할 수 있었다. 여기 한 곳에서
 * 값들을 훑으면 새 칸이 저절로 따라온다.
 */
export function totalPendingApprovals(counts: UserDeletionPendingApprovalCounts): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

export type UserDeletionRequirementFacts = {
  /** 지울 사람이 올라 있는 **현재 판**의 수(용도별로 하나까지). */
  routeSlotCount: number;
  pendingApprovals: UserDeletionPendingApprovalCounts;
  isLastRepresentative: boolean;
  /** 지울 사람이 담당인 접수 건 중 휴지통에 없고 출하 완료로 잠기지 않은 것. */
  openAssignedCaseCount: number;
};

export type UserDeletionRequirements = {
  approvalSuccessor: boolean;
  engineerSuccessor: boolean;
  /** 결재 이어받을 사람이 수리 검수 결재 역할이어야 하는가. */
  approvalSuccessorMustInspect: boolean;
};

/**
 * 어느 이어받을 사람이 필요한가 — 필요한 쪽만 요구한다(메인 판단 2026-09-13).
 *
 * 절차 노드의 담당은 담당 이어받을 사람을 요구하지 않는다 — 삭제는 노드 담당을
 * NULL(「접수 건 담당을 따른다」)로 되돌리고, 그 건이 지울 사람의 것이었으면 접수 건
 * 담당이 넘어가면서 저절로 따라간다.
 *
 * 뒤 단계에만 있는 진행 중 사슬(REPIN)은 따로 세지 않는다 — 그 사슬은 **현재 판**을
 * 따라가므로 지울 사람이 현재 판에 있다는 뜻이고, routeSlotCount 가 이미 참이다.
 */
export function resolveUserDeletionRequirements(facts: UserDeletionRequirementFacts): UserDeletionRequirements {
  const pending = facts.pendingApprovals;
  // 🔴 칸을 손으로 더하지 않는다(totalPendingApprovals 주석). 예전에는 여기가 세 칸을
  // 글자로 더했고, 그래서 **견적서 결재만 걸린 사람이 이어받을 사람 없이 삭제됐다.**
  const hasPending = totalPendingApprovals(pending) > 0;
  return {
    approvalSuccessor: facts.routeSlotCount > 0 || hasPending || facts.isLastRepresentative,
    engineerSuccessor: facts.openAssignedCaseCount > 0,
    approvalSuccessorMustInspect: pending.repairInspection > 0,
  };
}

/**
 * ============================================================================
 * 진행 중인 결재 사슬
 * ============================================================================
 */

/** 넘겨받을 수 있는 결재 대기의 종류 — 접수 건 승인 둘과 부품 불출 · 견적서. */
export const OPEN_APPROVAL_KINDS = ["FINAL_SHIPMENT", "REPAIR_INSPECTION", "PART_ISSUE", "QUOTE"] as const;
export type OpenApprovalKind = (typeof OPEN_APPROVAL_KINDS)[number];

/**
 * 승인 종류 → 그것이 타는 결재선 용도. 수리 검수는 결재선을 타지 않는다(표의
 * CHECK route_only_for_final_shipment).
 *
 * 🔴 Record 로 둔다 — 종류를 하나 더하면 여기 빠진 자리를 컴파일러가 잡는다.
 */
const ROUTE_SCOPE_BY_APPROVAL_KIND: Record<OpenApprovalKind, ShipmentApprovalRouteScope | null> = {
  FINAL_SHIPMENT: "FINAL_SHIPMENT",
  REPAIR_INSPECTION: null,
  PART_ISSUE: "PART_ISSUE",
  // 견적서 결재는 결재선을 탄다. 🔴 그 절차가 **발행을 막지 않는다**는 것과는 별개다
  // (schema/quote-approvals.ts 머리말) — 여기서 보는 것은 「이 행의 뒤 단계가 지울
  // 사람에게 가는가」뿐이고, 그 판정은 다른 둘과 글자 그대로 같다.
  QUOTE: "QUOTE",
};

export function routeScopeForApprovalKind(kind: OpenApprovalKind): ShipmentApprovalRouteScope | null {
  return ROUTE_SCOPE_BY_APPROVAL_KIND[kind];
}

/** 아직 결정되지 않은(REQUESTED) 결재 행 하나에 대한 사실. */
export type OpenApprovalFacts = {
  kind: OpenApprovalKind;
  assignedApproverUserId: string | null;
  /** 그 사슬을 시작한 사람 — 사슬이 나아가도 바뀌지 않는다. */
  requestedByUserId: string;
  /** 붙잡은 판. 결재선을 타지 않는 행이면 null. */
  routeId: string | null;
  /** 지금 열린 단계의 번호. routeId 와 함께 있거나 함께 없다. */
  routeStepOrder: number | null;
  /** 붙잡은 판의 단계 전부. 결재선을 타지 않으면 빈 배열. */
  routeSteps: readonly RouteStepAssignment[];
};

export type OpenApprovalPlan =
  /** 지울 사람과 관계없다. */
  | { action: "NONE" }
  /** 지금 열린 단계가 지울 사람에게 지정됨 — 지정만 이어받을 사람에게. */
  | { action: "REASSIGN" }
  /** 지울 사람이 현재 판의 뒤 단계에 있음 — 새 판으로 옮긴다(열린 단계도 지울 사람이면 지정도 바꾼다). */
  | { action: "REPIN"; reassign: boolean }
  /** 지울 사람이 옛 판의 뒤 단계에 있음 — 삭제를 멈춘다. */
  | { action: "STOP"; code: "IN_FLIGHT_ON_OLD_ROUTE" };

/**
 * 진행 중인 결재 행 하나를 삭제가 어떻게 다룰지(파일 머리말 「진행 중인 결재 사슬」).
 *
 * 「뒤 단계에 있다」는 **실제로 그 사람에게 갈 단계**만 센다 — 요청자 본인 단계는
 * 사슬이 건너뛰므로(isRouteStepSkippedForRequester, 사슬 잇는 자리와 같은 함수)
 * 지울 사람이 그 사슬의 요청자면 그 단계는 오지 않는다. 그걸 세면 아무 일도 안
 * 일어날 사슬 때문에 삭제가 멈춘다.
 *
 * @param context.currentRouteIdByScope 용도별 지금 판의 id(판이 없으면 null).
 */
export function planOpenApproval(
  row: OpenApprovalFacts,
  context: {
    targetUserId: string;
    currentRouteIdByScope: Readonly<Record<ShipmentApprovalRouteScope, string | null>>;
  }
): OpenApprovalPlan {
  const assignedToTarget = row.assignedApproverUserId === context.targetUserId;
  const openStepOrder = row.routeStepOrder;
  const targetAhead =
    row.routeId !== null &&
    openStepOrder !== null &&
    row.routeSteps.some(
      (step) =>
        step.approverUserId === context.targetUserId &&
        step.stepOrder > openStepOrder &&
        !isRouteStepSkippedForRequester(step.approverUserId, row.requestedByUserId)
    );

  if (!targetAhead) return assignedToTarget ? { action: "REASSIGN" } : { action: "NONE" };

  const scope = routeScopeForApprovalKind(row.kind);
  const currentRouteId = scope === null ? null : context.currentRouteIdByScope[scope];
  if (currentRouteId !== null && row.routeId === currentRouteId) {
    return { action: "REPIN", reassign: assignedToTarget };
  }
  return { action: "STOP", code: "IN_FLIGHT_ON_OLD_ROUTE" };
}

/** 삭제가 실제로 손대는 사슬인가(넘기거나 옮기거나). */
export function isActionableOpenApprovalPlan(
  plan: OpenApprovalPlan
): plan is Extract<OpenApprovalPlan, { action: "REASSIGN" | "REPIN" }> {
  return plan.action === "REASSIGN" || plan.action === "REPIN";
}

/**
 * 결재 이어받을 사람으로 세우면 멈추게 되는 사람들 — 영향받는 판에 이미 있는 사람과
 * 영향받는 사슬의 요청자.
 *
 * 영향받는 판: 지울 사람이 올라 있는 **현재 판**들 + 삭제가 손대는 사슬(넘김 · 옮김)이
 * 붙잡은 판. 멈출 사슬(STOP)은 어차피 삭제를 막으므로 넣지 않는다.
 *
 * 요청자는 **결재선을 타는** 사슬만 센다. 수리 검수 수동 지정은 사슬이 아니고, 요청자
 * 본인이 검수를 결재하는 것을 이 저장소는 막지 않는다(mutations/repair-case-
 * approvals.ts 머리말의 「No self-approval restriction」) — 여기서 막으면 삭제만 새
 * 규칙을 만드는 셈이다.
 *
 * 지울 사람 자신은 두 집합 어디에도 넣지 않는다 — 그 사람은 따로 「자기 자신」으로
 * 막힌다.
 */
export function collectSuccessorExclusions(params: {
  targetUserId: string;
  routeSlotSteps: readonly (readonly RouteStepAssignment[])[];
  openApprovals: readonly { facts: OpenApprovalFacts; plan: OpenApprovalPlan }[];
}): { routeMemberIds: Set<string>; requesterIds: Set<string> } {
  const routeMemberIds = new Set<string>();
  const requesterIds = new Set<string>();

  for (const steps of params.routeSlotSteps) {
    for (const step of steps) routeMemberIds.add(step.approverUserId);
  }
  for (const { facts, plan } of params.openApprovals) {
    if (!isActionableOpenApprovalPlan(plan) || facts.routeId === null) continue;
    for (const step of facts.routeSteps) routeMemberIds.add(step.approverUserId);
    requesterIds.add(facts.requestedByUserId);
  }

  routeMemberIds.delete(params.targetUserId);
  requesterIds.delete(params.targetUserId);
  return { routeMemberIds, requesterIds };
}

/**
 * 지울 사람 자리만 이어받을 사람으로 바꾼 승인자 목록 — 단계 순서대로. 새 판을
 * 저장할 때 넘기는 모양(saveShipmentApprovalRouteInTx 의 approverUserIds)이다.
 *
 * 🔴 자리를 옮기지 않는다 — 같은 번호에 사람만 바뀐다. 그래야 현재 판을 따라가던
 * 사슬을 새 판으로 옮겼을 때(REPIN) 열린 단계 번호가 새 판에서도 같은 자리를
 * 가리킨다.
 */
export function replaceApproverInRouteSteps(
  steps: readonly RouteStepAssignment[],
  targetUserId: string,
  successorUserId: string
): string[] {
  return [...steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step) => (step.approverUserId === targetUserId ? successorUserId : step.approverUserId));
}

/**
 * 승인 종류 → 그 종류를 세는 칸.
 *
 * 🔴 **Record 로 둔다 — 여기가 예전에 `else counts.partIssue += 1` 이었다.** 그
 * 모양은 넷째 종류가 생겨도 타입 오류를 내지 않고, 견적서 결재 대기를 조용히
 * 「부품 불출 N건」으로 화면에 띄웠다. 표로 바꿔 두면 종류를 더하는 순간 빠진
 * 자리를 컴파일러가 잡는다(ROUTE_SCOPE_BY_APPROVAL_KIND 와 같은 까닭).
 */
const COUNT_KEY_BY_APPROVAL_KIND: Record<OpenApprovalKind, keyof UserDeletionPendingApprovalCounts> = {
  FINAL_SHIPMENT: "finalShipment",
  REPAIR_INSPECTION: "repairInspection",
  PART_ISSUE: "partIssue",
  QUOTE: "quote",
};

/** 지울 사람에게 지정된 결재 대기를 승인 종류별로 센다. */
export function countPendingApprovalsAssignedTo(
  rows: readonly Pick<OpenApprovalFacts, "kind" | "assignedApproverUserId">[],
  targetUserId: string
): UserDeletionPendingApprovalCounts {
  // 칸 이름을 적은 리터럴이라 칸이 늘면 여기서도 컴파일러가 잡는다.
  const counts: UserDeletionPendingApprovalCounts = {
    finalShipment: 0,
    repairInspection: 0,
    partIssue: 0,
    quote: 0,
  };
  for (const row of rows) {
    if (row.assignedApproverUserId !== targetUserId) continue;
    counts[COUNT_KEY_BY_APPROVAL_KIND[row.kind]] += 1;
  }
  return counts;
}
