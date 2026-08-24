"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { decideRepairCaseApproval, requestRepairCaseApproval } from "@/lib/db/mutations/repair-case-approvals";
import {
  isValidApprovalDecision,
  isValidApprovalType,
  isValidRepairCaseId,
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

  // 갱신은 try 밖에서 한다 — 여기서 나는 오류까지 DB 오류로 접어 넣으면
  // "저장은 됐는데 화면만 안 바뀐 것"을 "저장 실패"라고 사용자에게 말하게 된다.
  let result: ApprovalActionResult;
  try {
    result = await requestRepairCaseApproval(
      input.repairCaseId,
      input.approvalType,
      actorCheck.userId,
      reasonValidation.reason
    );
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("requestRepairCaseApprovalAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }

  // 성사됐을 때만 — 실패한 요청은 바뀐 것이 없으므로 캐시를 버릴 이유가 없다.
  if (result.ok) revalidateApprovalSurfaces(input.repairCaseId);
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
  if (result.ok) revalidateApprovalSurfaces(input.repairCaseId);
  return result;
}
