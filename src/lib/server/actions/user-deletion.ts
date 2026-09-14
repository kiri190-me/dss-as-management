"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { mayManageDeveloperFlag } from "@/lib/auth/developer-flag-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { deleteUserAccount, type DeleteUserAccountResult } from "@/lib/db/mutations/user-deletion";
import { getUserDeletionPreview, type UserDeletionPreview } from "@/lib/db/queries/user-deletion-impact";
import { validateUserDeletionInput, validateUserDeletionPreviewInput } from "@/lib/validation/user-deletion-input";

/**
 * ============================================================================
 * 사용자 계정 삭제 서버 액션 — 영향 미리보기 · 삭제
 * ============================================================================
 * 층 구조는 형제(developer-flag.ts · shipment-representatives.ts)와 같다: 데이터베이스
 * 모드인가 · 세션이 있는가 · 입력 모양이 맞는가 · mutation 호출 · 결과 반환.
 *
 * 🔴 행위자는 **살아 있는 행**으로 판정한다(resolveActingUserForSession — attachments.ts
 * 본보기). 토큰의 역할은 발급 시점 값이라, 역할이 내려간 최고관리자가 열어 둔 화면에서
 * 누른 삭제를 토큰만 보고 통과시키면 안 된다. 여기서의 mayManageDeveloperFlag 는 빠른
 * 거절일 뿐이고, 실제 판정은 mutation 이 트랜잭션 안에서 행위자를 다시 읽어 한다.
 *
 * 🔴 예기치 못한 DB 오류는 **오류 코드만** 로그에 남긴다 — drizzle 오류 메시지에는 쿼리
 * 인자(사유 · 이름)가 실려 사람이 적은 글이 서버 로그로 샌다(HANDOFF Y16-7). 교착(40P01)
 * · 직렬화 실패(40001)는 동시에 다른 변경이 있었다는 뜻이라 CONFLICT 로 돌려준다.
 *
 * revalidatePath 는 부르지 않는다 — 화면이 성공 뒤 router.refresh() 로 다시 읽는다(형제 관례).
 * ============================================================================
 */

export type UserDeletionActionFailureCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SELF_DELETE_FORBIDDEN"
  | "CONFLICT"
  | "DATABASE_UNAVAILABLE";

type ActionFailure = { ok: false; code: UserDeletionActionFailureCode; message: string };

export type DeleteUserAccountActionInput = {
  targetUserId: string;
  expectedVersion: number;
  reason: string;
  approvalSuccessorUserId?: string | null;
  engineerSuccessorUserId?: string | null;
};

export type DeleteUserAccountActionResult = DeleteUserAccountResult | ActionFailure;
export type UserDeletionPreviewActionResult = UserDeletionPreview | ActionFailure;

const RETRYABLE_PG_CODES = new Set(["40P01", "40001"]);

async function resolveAuthorizedActorId(): Promise<{ ok: true; actorId: string } | { ok: false; result: ActionFailure }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "사용자 정보를 확인할 수 없습니다." } };
  }
  if (!mayManageDeveloperFlag(actingUser)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "사용자 계정을 삭제할 권한이 없습니다." } };
  }
  return { ok: true, actorId: actingUser.id };
}

/** drizzle 은 드라이버 오류를 감싸므로 cause 까지 본다. 값은 보지 않는다 — 코드만. */
function pgErrorCode(err: unknown): string | undefined {
  const own = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
  if (typeof own === "string") return own;
  const cause = err instanceof Error ? err.cause : undefined;
  const nested =
    typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code?: unknown }).code : undefined;
  return typeof nested === "string" ? nested : undefined;
}

function unexpectedFailure(label: string, err: unknown): ActionFailure {
  const code = pgErrorCode(err);
  if (code !== undefined && RETRYABLE_PG_CODES.has(code)) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "동시에 다른 변경이 있었습니다. 새로고침 후 다시 시도해 주세요.",
    };
  }
  console.error(`${label}: unexpected DB error`, { code });
  return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
}

/** 삭제 확인 창이 열릴 때 부른다 — 무엇이 넘어가는지 · 누가 필요한지 · 왜 막히는지. */
export async function getUserDeletionPreviewAction(input: unknown): Promise<UserDeletionPreviewActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  const validated = validateUserDeletionPreviewInput(input);
  if (!validated.ok) return { ok: false, code: "VALIDATION_ERROR", message: validated.message };

  if (validated.targetUserId.toLowerCase() === actorCheck.actorId.toLowerCase()) {
    return { ok: false, code: "SELF_DELETE_FORBIDDEN", message: "자기 자신의 계정은 삭제할 수 없습니다." };
  }

  try {
    return await getUserDeletionPreview(validated.targetUserId, actorCheck.actorId);
  } catch (err) {
    return unexpectedFailure("getUserDeletionPreviewAction", err);
  }
}

export async function deleteUserAccountAction(input: DeleteUserAccountActionInput): Promise<DeleteUserAccountActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  const validated = validateUserDeletionInput(input);
  if (!validated.ok) return { ok: false, code: "VALIDATION_ERROR", message: validated.message };
  const value = validated.value;

  if (value.targetUserId.toLowerCase() === actorCheck.actorId.toLowerCase()) {
    return { ok: false, code: "SELF_DELETE_FORBIDDEN", message: "자기 자신의 계정은 삭제할 수 없습니다." };
  }

  try {
    return await deleteUserAccount({
      targetUserId: value.targetUserId,
      expectedVersion: value.expectedVersion,
      actorUserId: actorCheck.actorId,
      reason: value.reason,
      approvalSuccessorUserId: value.approvalSuccessorUserId,
      engineerSuccessorUserId: value.engineerSuccessorUserId,
    });
  } catch (err) {
    return unexpectedFailure("deleteUserAccountAction", err);
  }
}
