"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { acknowledgeNotification } from "@/lib/db/mutations/notification-acknowledgements";
import { checkNotificationAcknowledgementKey } from "@/lib/domain/notification-acknowledgement";

/**
 * ============================================================================
 * 알림 확인 — 서버 액션
 * ============================================================================
 * 종에서 정보성 알림을 눌렀을 때 부른다(화면 연결은 다음 조각). 층을 나누는
 * 방식은 이 폴더의 다른 액션들과 같다:
 *
 *   세션 인가 → **형식만** 검증 → mutation → 예상 못 한 DB 오류 가리기
 *
 * ── 🔴 사용자는 세션에서 푼다 — 입력으로 받지 않는다 ─────────────────────
 * 받는 것은 알림 키 하나뿐이다. 입력 모양에 사용자 id 자리가 아예 없고, 누가 그런
 * 칸을 붙여 보내도 읽지 않는다. 사용자 id 를 입력으로 받으면 **남의 종에서 알림을
 * 대신 지우는 입구**가 된다 — 확인 기록은 그 사람의 알림을 걸러 내는 데 쓰이기
 * 때문이다.
 *
 * 세션 토큰만 믿지 않고 살아 있는 계정을 다시 읽는다(resolveActingUserForSession —
 * 지워졌거나 잠겼거나 비활성이거나, 통합 로그인이 세션을 끊은 계정은 여기서 걸린다).
 * mutation 은 받은 userId 를 그대로 적으므로, 살아 있는지를 볼 자리가 여기뿐이다.
 *
 * ── 역할·권한 영역은 보지 않는다 ────────────────────────────────────────
 * 자기 종에 뜬 알림을 자기가 치우는 일이다. 그 알림을 볼 자격은 알림을 파생할 때
 * (db/queries/notifications.ts) 이미 판정됐고, 확인 기록은 남에게 아무것도 보여
 * 주지도 바꾸지도 않는다. 형식만 맞으면 자기 종에 뜨지 않은 키를 적는 것도 막지
 * 않는다 — 그 행은 자기 종에서만 무언가를 걸러 낼 수 있고, 그 사람에게 뜨지 않는
 * 알림이라면 아무것도 걸러 내지 않는다.
 *
 * ── 캐시 무효화(revalidate)는 이 조각에서 하지 않는다 ─────────────────────
 * 종 화면 연결이 다음 조각이다. 그때 확인 뒤 종이 곧바로 비도록 무효화할지(또는
 * 화면이 제 목록에서 먼저 지울지)를 함께 정한다.
 * ============================================================================
 */

export type NotificationAcknowledgementActionFailure = {
  ok: false;
  code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID_INPUT" | "DATABASE_UNAVAILABLE";
  message: string;
};

export type AcknowledgeNotificationActionResult =
  | { ok: true }
  | NotificationAcknowledgementActionFailure;

export type AcknowledgeNotificationActionInput = {
  notificationKey: string;
};

async function resolveAuthorizedActorId(): Promise<
  { ok: true; userId: string } | { ok: false; result: NotificationAcknowledgementActionFailure }
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
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return { ok: false, result: { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." } };
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return {
      ok: false,
      result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." },
    };
  }
  return { ok: true, userId: actingUser.id };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

/**
 * 예상 못 한 DB 오류를 사람에게 그대로 보여 주지 않는다 — 오류 코드만 서버 로그에
 * 남기고 사람에게는 다시 시도하라고 말한다(같은 층의 다른 액션들과 같은 규약이다).
 */
async function withErrorRedaction<T extends { ok: boolean }>(
  label: string,
  run: () => Promise<T>
): Promise<T | NotificationAcknowledgementActionFailure> {
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
 * 알림 하나를 「확인함」으로 적는다. 이미 확인한 것이어도 성공이다.
 */
export async function acknowledgeNotificationAction(
  input: AcknowledgeNotificationActionInput
): Promise<AcknowledgeNotificationActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;

  // 인자는 화면이 보낸 그대로라 타입 선언을 믿지 않는다 — 객체가 아닐 수도 있다.
  const rawKey =
    typeof input === "object" && input !== null
      ? (input as { notificationKey?: unknown }).notificationKey
      : undefined;
  const checked = checkNotificationAcknowledgementKey(rawKey);
  if (!checked.ok) {
    return { ok: false, code: "INVALID_INPUT", message: checked.message };
  }

  const result = await withErrorRedaction("acknowledgeNotificationAction", () =>
    acknowledgeNotification({ userId: actorCheck.userId, notificationKey: checked.key })
  );
  if (!result.ok) return result;
  // 새로 적었는지(newlyAcknowledged)는 화면에 알릴 이유가 없다 — 사람에게는 둘 다
  // 「사라졌다」로 같다.
  return { ok: true };
}
