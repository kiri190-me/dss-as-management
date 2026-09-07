"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { setDeveloperFlag, type DeveloperFlagResult } from "@/lib/db/mutations/developer-flag";
import { isValidUserId } from "@/lib/validation/shipment-delegation-input";

/**
 * users.is_developer 표시의 서버 액션 — 형제(shipment-representatives.ts)와 같은
 * 층 구조다: 데이터베이스 모드인가 · 세션이 있는가 · 입력 모양이 맞는가 ·
 * mutation 호출 · 결과 반환. 예기치 못한 DB 오류는 코드만 남기고 문구는 가린다.
 *
 * 🔴 토큰의 역할로 미리 거르지 않는다. 토큰의 역할은 발급 시점 값이고, 화면
 * (users/page.tsx)은 살아 있는 행으로 판정한다. 토큰이 낡았을 때 여기서 먼저
 * 거절하면 「단추는 보이는데 저장은 거절」이 된다. 판정은 mutation 이 살아 있는
 * 행위자를 다시 읽어 한 번 한다(auth/developer-flag-authorization.ts).
 *
 * revalidatePath 를 부르지 않는다 — 화면이 성공 뒤 router.refresh() 로 페이지의
 * 서버 조회를 다시 돌린다(형제 화면과 같다).
 */

export type SetDeveloperFlagActionInput = {
  targetUserId: string;
  flag: boolean;
};

async function resolveAuthorizedActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: DeveloperFlagResult & { ok: false } }
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

export async function setDeveloperFlagAction(input: SetDeveloperFlagActionInput): Promise<DeveloperFlagResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  if (!isValidUserId(input.targetUserId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "대상 사용자를 확인할 수 없습니다." };
  }
  if (typeof input.flag !== "boolean") {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청 값을 확인할 수 없습니다." };
  }

  try {
    return await setDeveloperFlag(input.targetUserId, input.flag, actorCheck.userId);
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("setDeveloperFlagAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
