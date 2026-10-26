"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createApprovalRouteDelegation,
  revokeApprovalRouteDelegation,
} from "@/lib/db/mutations/approval-route-delegations";
import {
  isValidUserId,
  validateDelegationPeriod,
  validateDelegationReason,
  type ApprovalRouteDelegationResult,
} from "@/lib/validation/approval-route-delegation-input";

/**
 * ============================================================================
 * 결재선 단계 위임 — 화면이 부르는 창구
 * ============================================================================
 * 층을 나누는 방식은 옛 위임의 같은 자리(actions/shipment-delegations.ts)와 같다:
 * 여기서는 **누가 눌렀는지**를 세션에서 뽑고 값의 모양만 본다. 「그 사람이 이것을
 * 해도 되는가」는 한 층 아래 mutation 이 **제 트랜잭션 안에서** 판정한다.
 *
 * 🔴 **여기에 권한 판정을 복사해 오지 마라.** 두 곳에서 판정하면 한쪽만 고쳐지는
 * 날이 오고, 그때 증상은 「단추는 보이는데 저장은 거절」(또는 그 반대)이라 화면에
 * 아무 설명도 남지 않는다. 이 창구가 막는 것은 **로그인하지 않은 요청**까지다.
 *
 * 🔵 화면(`.tsx`)은 아직 없다 — 다음 조각이다. 이 파일은 그 화면이 부를 수 있는
 * 자리를 먼저 세워 둔 것이고, 그래서 지금은 시험 말고 부르는 곳이 없다.
 * ============================================================================
 */

export type CreateApprovalRouteDelegationActionInput = {
  /** 누구의 결재권인가. 본인 것을 맡길 때는 자기 `users.id` 를 그대로 넣는다. */
  delegatorUserId: string;
  delegateUserId: string;
  /** ISO 글자. 🔴 끝은 **포함하지 않는다** — 「9월 30일까지」는 10월 1일 0시다. */
  startsAt: string;
  endsAt: string;
  reason?: string | null;
};

export type RevokeApprovalRouteDelegationActionInput = {
  delegationId: string;
};

/**
 * 로그인한 사람의 `users.id`. 🔴 포털 번호(`sub`)가 아니다 — 이 표의 열쇠는 전부
 * `users.id` 이고, 번호를 섞으면 오류 없이 영원히 0건이 된다(표 머리말).
 */
async function resolveActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: ApprovalRouteDelegationResult & { ok: false } }
> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 모드가 아닙니다." } };
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

export async function createApprovalRouteDelegationAction(
  input: CreateApprovalRouteDelegationActionInput
): Promise<ApprovalRouteDelegationResult> {
  const actorCheck = await resolveActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUserId(input.delegatorUserId) || !isValidUserId(input.delegateUserId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "결재권자 또는 대리 결재자를 확인할 수 없습니다." };
  }
  const period = validateDelegationPeriod(input.startsAt, input.endsAt);
  if (!period.ok) {
    return { ok: false, code: "INVALID_TIME_RANGE", message: period.error };
  }
  const reason = validateDelegationReason(input.reason);
  if (!reason.ok) {
    return { ok: false, code: "VALIDATION_ERROR", message: reason.error };
  }

  try {
    return await createApprovalRouteDelegation({
      delegatorUserId: input.delegatorUserId,
      delegateUserId: input.delegateUserId,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      reason: reason.reason,
      actorUserId: actorCheck.userId,
    });
  } catch (err) {
    // 🔴 DB 오류의 내용은 화면에 내보내지 않는다 — 제약 이름·칸 이름이 그대로 나가면
    // 표 구조를 밖에서 읽을 수 있게 된다. 서버 로그에는 코드만 남긴다.
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createApprovalRouteDelegationAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function revokeApprovalRouteDelegationAction(
  input: RevokeApprovalRouteDelegationActionInput
): Promise<ApprovalRouteDelegationResult> {
  const actorCheck = await resolveActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUserId(input.delegationId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "위임 정보를 확인할 수 없습니다." };
  }

  try {
    return await revokeApprovalRouteDelegation({
      delegationId: input.delegationId,
      actorUserId: actorCheck.userId,
    });
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("revokeApprovalRouteDelegationAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
