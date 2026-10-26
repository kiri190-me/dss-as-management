"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "@/lib/db/mutations/repair-case-approvals";
import { resolveActingDelegateUserIds } from "@/lib/db/queries/approval-route-delegations";
import {
  getCurrentApprovalsForCase,
  listInspectionApproverCandidates,
} from "@/lib/db/queries/repair-case-approvals";
import {
  listShipmentDelegations,
  listUsersForRepresentativeManagement,
  resolveShipmentDecideAuthorization,
} from "@/lib/db/queries/shipment-delegations";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
import { notifyRepairCaseApprovalCreated } from "@/lib/server/integration/approval-created-notice";
import { notifyPortalApprovalCreated } from "@/lib/server/integration/portal-inbox";
import {
  isValidApprovalDecision,
  isValidApprovalType,
  isValidRepairCaseId,
  validateAssignedApproverId,
  validateReasonFormat,
  type ApprovalActionResult,
  type ApprovalDecisionCode,
  type RepairCaseApprovalType,
} from "@/lib/validation/repair-case-approval-input";

/**
 * Server Actions for database-backed approval request/decision, same
 * auth + format-validation + error-redaction layering as
 * transition-workflow.ts. Never trusts a client-supplied approval status —
 * the mutation layer re-reads and re-evaluates everything from the DB.
 */

export type RequestApprovalActionInput = {
  repairCaseId: string;
  approvalType: RepairCaseApprovalType;
  reason?: string | null;
  /**
   * 「누구에게 보낼까」 — 선택이다. 주지 않거나 `null`이면 지정 없음이고,
   * 그것이 기본값이자 이 칸이 생기기 전과 같은 동작이다. 여기서는 형식만
   * 보고(UUID 모양), 그 사람이 실제로 처리할 수 있는지는 mutation이 자기
   * 트랜잭션 안에서 판정한다 — 클라이언트가 보낸 값은 아무것도 신뢰하지
   * 않는다는 이 파일의 원칙 그대로다.
   */
  assignedApproverUserId?: string | null;
};

export type DecideApprovalActionInput = {
  repairCaseId: string;
  approvalType: RepairCaseApprovalType;
  decision: ApprovalDecisionCode;
  reason?: string | null;
};

async function resolveAuthorizedActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: ApprovalActionResult & { ok: false } }
> {
  if (getRepairCaseWriteSource() !== "database" || getRepairCaseReadSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * 결재 요청·결정이 실제로 성사된 뒤, **그 행동을 한 사람의 다음 렌더**를 새로
 * 계산하게 만든다. 요청을 보내 놓고 새로 고쳐도 자기 화면이 그대로인 상태를
 * 없애는 것이 목적이다.
 *
 * 닿아야 할 곳이 두 군데다:
 *  - 사이드바 "내게 온 결재 요청" 배지와 헤더 종 알림 — `(app)/layout.tsx`가
 *    페이지마다 계산한다. `(app)`은 **라우트 그룹이라 URL에 나타나지 않으므로**
 *    그 레이아웃의 경로는 `/(app)`이 아니라 `/`다. "layout"으로 무효화하면 그
 *    아래 모든 화면이 다음 방문에서 다시 계산된다.
 *  - 그 접수 건의 상세 화면과 탭들(`/repair-cases/<id>` 아래) — 승인 카드와
 *    "출하까지 남은 결재" 체크리스트가 여기 있다. 위의 `/` 호출에 이미
 *    포함되지만 따로 적어 둔다: 나중에 `/` 호출을 더 좁은 것으로 바꾸더라도
 *    상세 화면 갱신이 조용히 사라지지 않게 하기 위해서다.
 *
 * 여기서 할 수 있는 것은 딱 여기까지다 — 서버 캐시를 무효화해 **행위자 본인의**
 * 다음 렌더를 최신으로 만들 뿐, 다른 사람이 이미 열어 둔 브라우저에 밀어 넣지는
 * 못한다. 그건 폴링/푸시가 있어야 하는 별개의 일이다.
 */
function revalidateApprovalSurfaces(repairCaseId: string): void {
  revalidatePath("/", "layout");
  revalidatePath(`/repair-cases/${repairCaseId}`, "layout");
}

/**
 * 결재가 저장된 **뒤** 포털을 한 번 쿡 찔러, 지금 차례인 사람에게 결재 메일이
 * 바로 나가게 한다(2026-10-24 사용자 요청. 그 전에는 밤에 도는 주기 작업이
 * 물어 갈 때까지 기다렸다).
 *
 * 🔴 **여기가 액션 계층인 것이 핵심이다.** mutation 은 통째로 트랜잭션 하나이고,
 * 그 안에서 포털을 부르면 ① 포털이 느릴 때 결재 저장이 함께 느려지고 ② 포털이
 * 죽으면 **결재 자체가 실패한다.** 그래서 mutation 은 이 파일을 한 글자도 알지
 * 못하고, 부르는 자리는 `await requestRepairCaseApproval(...)`/
 * `await decideRepairCaseApproval(...)` 이 **값을 돌려준 뒤**다 — 그 시점에는
 * 커밋이 끝나 있다. (revalidateApprovalSurfaces 가 같은 자리에 있는 것과 같은
 * 까닭이다.)
 *
 * 🔴 판정을 여기서 짓지 않는다 — 조회를 그대로 꽂아 넘길 뿐이고, 고르는 규칙은
 * server/integration/approval-created-notice.ts 하나에 있다. 🔴 던지지 않는다:
 * 그 함수가 제 안에서 전부 삼킨다(결재는 이미 저장됐다).
 */
async function notifyPortalOfApprovalTurn(
  repairCaseId: string,
  approvalType: RepairCaseApprovalType
): Promise<void> {
  await notifyRepairCaseApprovalCreated(repairCaseId, approvalType, {
    readCurrentApprovals: getCurrentApprovalsForCase,
    listInspectionApprovers: listInspectionApproverCandidates,
    listRepresentativeCandidates: listUsersForRepresentativeManagement,
    listDelegations: listShipmentDelegations,
    resolveShipmentDecide: resolveShipmentDecideAuthorization,
    // 🔴 결재선 단계 위임 — 지정된 사람을 지금 대신할 수 있는 사람들(2026-10-26).
    //    여기만 그대로 못 꽂고 한 겹 감싸는 것은 그 조회가 **「지금」을 인자로
    //    받기** 때문이다(트랜잭션 안에서 읽는 자리와 같은 함수를 쓰려고 그렇게 돼
    //    있다 — queries/approval-route-delegations.ts). 알림은 트랜잭션 밖이라
    //    그 순간의 답이면 충분하다.
    //    🔴 **옛 출하 대표 위임(listDelegations)과 다른 표다.** 둘은 쓰이는 때가
    //    갈려 있어 한쪽으로 합칠 수 없다(표 머리말).
    listRouteDelegatesFor: (approverUserId) =>
      resolveActingDelegateUserIds(approverUserId, new Date()),
    readPortalSubject: getSsoSubjectForUser,
    notifyPortal: notifyPortalApprovalCreated,
  });
}

export async function requestRepairCaseApprovalAction(
  input: RequestApprovalActionInput
): Promise<ApprovalActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidApprovalType(input.approvalType)) {
    return { ok: false, code: "INVALID_APPROVAL_TYPE", message: "승인 종류를 확인할 수 없습니다." };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }
  const assigneeValidation = validateAssignedApproverId(input.assignedApproverUserId);
  if (!assigneeValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: assigneeValidation.error };
  }

  // 갱신은 try 밖에서 한다 — 여기서 나는 오류까지 DB 오류로 접어 넣으면
  // "저장은 됐는데 화면만 안 바뀐 것"을 "저장 실패"라고 사용자에게 말하게 된다.
  let result: ApprovalActionResult;
  try {
    result = await requestRepairCaseApproval(
      input.repairCaseId,
      input.approvalType,
      actorCheck.userId,
      reasonValidation.reason,
      assigneeValidation.userId
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("requestRepairCaseApprovalAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 성사됐을 때만 — 실패한 요청은 바뀐 것이 없으므로 캐시를 버릴 이유가 없다.
  if (result.ok) {
    revalidateApprovalSurfaces(input.repairCaseId);
    // 결재가 **새로 생긴** 자리다 — 처음 요청과 반려 뒤 재요청이 둘 다 여기로 온다.
    await notifyPortalOfApprovalTurn(input.repairCaseId, input.approvalType);
  }
  return result;
}

export async function decideRepairCaseApprovalAction(
  input: DecideApprovalActionInput
): Promise<ApprovalActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidApprovalType(input.approvalType)) {
    return { ok: false, code: "INVALID_APPROVAL_TYPE", message: "승인 종류를 확인할 수 없습니다." };
  }
  if (!isValidApprovalDecision(input.decision)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "결정 종류를 확인할 수 없습니다." };
  }
  const reasonValidation = validateReasonFormat(input.reason);
  if (!reasonValidation.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };
  }

  let result: ApprovalActionResult;
  try {
    result = await decideRepairCaseApproval(
      input.repairCaseId,
      input.approvalType,
      input.decision,
      actorCheck.userId,
      reasonValidation.reason
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("decideRepairCaseApprovalAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 승인·반려가 성사되면 결재자 자신의 배지·종 알림에서 그 건이 곧바로 빠져야
  // 한다 — 눌렀는데 숫자가 그대로면 처리가 안 된 줄 알고 다시 누르게 된다.
  if (result.ok) {
    revalidateApprovalSurfaces(input.repairCaseId);
    // 🔴 **결재가 생기는 자리는 여기도다.** 결재선을 타는 최종 출하 승인은 한
    // 단계가 승인되면 저장 경로가 **다음 단계 요청 행을 이어 만든다**
    // (mutations/repair-case-approvals.ts 의 「사슬을 잇는다」). 그 순간
    // 다음 사람에게 **새로** 차례가 오므로 그 사람도 메일을 받아야 한다.
    // 사슬이 끝났거나(마지막 단계 승인) 반려면 가장 최근 행이 REQUESTED 가
    // 아니라서 아무것도 나가지 않는다 — 그 판단은 부르는 쪽이 아니라
    // notifyRepairCaseApprovalCreated 안에 있다.
    await notifyPortalOfApprovalTurn(input.repairCaseId, input.approvalType);
  }
  return result;
}
