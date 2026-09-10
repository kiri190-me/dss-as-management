"use server";

import { revalidatePath } from "next/cache";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  cancelPartIssueRequest,
  createPartIssueRequest,
  decidePartIssueRequestApproval,
  type CancelPartIssueRequestResult,
  type CreatePartIssueRequestResult,
  type DecidePartIssueRequestApprovalResult,
} from "@/lib/db/mutations/inventory-part-issue-requests";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import {
  isValidPartIssueApprovalDecision,
  validateCreatePartIssueRequestInput,
  validatePartIssueReasonFormat,
  type PartIssueActionFailure,
} from "@/lib/validation/inventory-part-issue-input";

/**
 * ============================================================================
 * 부품 불출 승인 — 서버 액션
 * ============================================================================
 * 층을 나누는 방식은 server/actions/repair-case-approvals.ts 와 같다:
 *
 *   세션 인가 → **형식만** 검증 → mutation → 예상 못 한 DB 오류 가리기 →
 *   성사됐을 때만 캐시 무효화
 *
 * 🔴 **클라이언트가 보낸 값은 아무것도 믿지 않는다.** 여기서 보는 것은 형식뿐
 * 이고(validation/inventory-part-issue-input.ts), 「이 사람이 이 불출을 신청할 수
 * 있는가」·「그 요청이 지금 불출 가능한가」·「재고가 있는가」·「이 결재를 내가
 * 처리해도 되는가」는 전부 mutation 이 자기 트랜잭션 안에서 다시 판정한다.
 *
 * 🔴 **이 조각(2026-09-10)에서는 이 액션들을 부르는 화면이 아직 없다.** 두 불출
 * 길에 문을 다는 것과 화면은 다음 조각들이므로, 쓰이지 않는 채로 남는 것이
 * 정상이다.
 * ============================================================================
 */

async function resolveAuthorizedActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: PartIssueActionFailure }
> {
  if (getAuthSource() !== "database") {
    return {
      ok: false,
      result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." },
    };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }
  if (session.approvalStatus !== "APPROVED") {
    return {
      ok: false,
      result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." },
    };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * 예상 못 한 DB 오류를 사람에게 그대로 보여 주지 않는다 — 오류 코드만 서버
 * 로그에 남기고 사람에게는 다시 시도하라고 말한다(같은 층의 다른 액션들과 같은
 * 규약이다).
 */
async function withErrorRedaction<T extends { ok: boolean }>(
  label: string,
  run: () => Promise<T>
): Promise<T | PartIssueActionFailure> {
  try {
    return await run();
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error(`${label}: unexpected DB error`, { code });
    return {
      ok: false,
      code: "DATABASE_UNAVAILABLE",
      message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
}

/**
 * 신청·결재가 실제로 성사된 뒤 **그 행동을 한 사람의 다음 렌더**를 새로 계산하게
 * 만든다. 결재를 눌렀는데 배지 숫자가 그대로면 처리가 안 된 줄 알고 다시 누르게
 * 된다.
 *
 * `("/", "layout")` 하나로 두는 이유: 「내게 온 결재 요청」 배지와 종 알림이
 * `(app)/layout.tsx` 에서 페이지마다 계산되고, `(app)` 은 **라우트 그룹이라 URL
 * 에 나타나지 않으므로** 그 레이아웃의 경로는 `/` 다. 재고 화면들도 그 아래에
 * 있어 함께 갱신된다. 화면이 붙는 조각에서 더 좁은 경로가 필요해지면 그때
 * 더한다.
 */
function revalidatePartIssueSurfaces(): void {
  revalidatePath("/", "layout");
}

/**
 * 불출 신청 하나를 올린다. 두 갈래(요청 기반·직접 사용)를 같은 액션이 받는다 —
 * 갈래는 `kind` 가 정하고, 그 형식 검증도 한 함수가 한다.
 */
export async function createPartIssueRequestAction(
  input: unknown
): Promise<CreatePartIssueRequestResult | PartIssueActionFailure> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  const validated = validateCreatePartIssueRequestInput(input);
  if (!validated.ok) {
    return { ok: false, code: "INVALID_INPUT", message: validated.error };
  }

  const result = await withErrorRedaction("createPartIssueRequestAction", () =>
    createPartIssueRequest({ ...validated.input, actorUserId: actorCheck.userId })
  );

  // 성사됐을 때만 — 막힌 신청은 바뀐 것이 없으므로 캐시를 버릴 이유가 없다.
  if (result.ok) revalidatePartIssueSurfaces();
  return result;
}

export type DecidePartIssueApprovalActionInput = {
  issueRequestId: string;
  decision: string;
  reason?: string | null;
};

/** 한 단계를 승인하거나 반려한다. 사슬을 잇는 것은 mutation 의 몫이다. */
export async function decidePartIssueRequestApprovalAction(
  input: DecidePartIssueApprovalActionInput
): Promise<DecidePartIssueRequestApprovalResult | PartIssueActionFailure> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUuid(input.issueRequestId)) {
    return { ok: false, code: "INVALID_INPUT", message: "불출 신청 정보를 확인할 수 없습니다." };
  }
  // 좁힌 값을 지역 상수로 받아 둔다 — 아래 콜백 안에서는 `input.decision` 의
  // 좁힘이 유지되지 않는다.
  const decision = input.decision;
  if (!isValidPartIssueApprovalDecision(decision)) {
    return { ok: false, code: "INVALID_INPUT", message: "결정 종류를 확인할 수 없습니다." };
  }
  const reasonCheck = validatePartIssueReasonFormat(input.reason);
  if (!reasonCheck.ok) {
    return { ok: false, code: "INVALID_INPUT", message: reasonCheck.error };
  }

  const result = await withErrorRedaction("decidePartIssueRequestApprovalAction", () =>
    decidePartIssueRequestApproval({
      issueRequestId: input.issueRequestId,
      decision,
      actorUserId: actorCheck.userId,
      // 🔴 「반려에는 사유가 필수」는 여기서 정하지 않는다 — 상태에 따라 달라지는
      // 판정이라 mutation 이 트랜잭션 안에서 본다(표의 CHECK 이 최종 방어선이다).
      decisionReason: reasonCheck.reason,
    })
  );

  if (result.ok) revalidatePartIssueSurfaces();
  return result;
}

export type CancelPartIssueRequestActionInput = {
  issueRequestId: string;
  reason?: string | null;
};

/** 신청을 무른다 — 신청한 사람인지는 mutation 이 트랜잭션 안에서 확인한다. */
export async function cancelPartIssueRequestAction(
  input: CancelPartIssueRequestActionInput
): Promise<CancelPartIssueRequestResult | PartIssueActionFailure> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUuid(input.issueRequestId)) {
    return { ok: false, code: "INVALID_INPUT", message: "불출 신청 정보를 확인할 수 없습니다." };
  }
  const reasonCheck = validatePartIssueReasonFormat(input.reason);
  if (!reasonCheck.ok) {
    return { ok: false, code: "INVALID_INPUT", message: reasonCheck.error };
  }

  const result = await withErrorRedaction("cancelPartIssueRequestAction", () =>
    cancelPartIssueRequest({
      issueRequestId: input.issueRequestId,
      actorUserId: actorCheck.userId,
      reason: reasonCheck.reason,
    })
  );

  if (result.ok) revalidatePartIssueSurfaces();
  return result;
}
