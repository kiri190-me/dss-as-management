"use server";

import { revalidatePath } from "next/cache";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getLoginMode } from "@/lib/config/login-mode";
import { acknowledgeNotification } from "@/lib/db/mutations/notification-acknowledgements";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
import { checkNotificationAcknowledgementKey } from "@/lib/domain/notification-acknowledgement";
import { acknowledgePortalNotification } from "@/lib/server/integration/portal-inbox";

/**
 * ============================================================================
 * 알림 확인 — 서버 액션
 * ============================================================================
 * 🔴 **이 파일에 확인 액션이 둘이다**(2026-10-22). 이것은 **A/S 자신의 줄**을
 * A/S 의 표에 적는 쪽이고, 파일 아래쪽의 acknowledgePortalNotificationAction 은
 * **포털에서 온 줄**을 포털에 적는 쪽이다. 적히는 곳이 다르고 가르는 자리는 종
 * 한 곳이다 — 섞지 마라.
 *
 * 종에서 정보성 알림(승인 완료·반려됨)을 눌렀을 때 부른다(NotificationBell). 층을
 * 나누는 방식은 이 폴더의 다른 액션들과 같다:
 *
 *   세션 인가 → 키의 형식·종류 검증 → mutation → 예상 못 한 DB 오류 가리기
 *   → 종이 다시 계산되게 무효화
 *
 * 키 검증은 domain/notification-acknowledgement.ts 하나가 한다 — 형식이 맞아도
 * 「눌러서 확인하는 종류」가 아니면(할 일 알림의 키면) INVALID_INPUT 으로 거절한다.
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
 * 주지도 바꾸지도 않는다. 형식·종류만 맞으면 자기 종에 뜨지 않은 키를 적는 것도
 * 막지 않는다 — 그 행은 자기 종에서만 무언가를 걸러 낼 수 있고, 그 사람에게 뜨지 않는
 * 알림이라면 아무것도 걸러 내지 않는다.
 *
 * ── 확인한 뒤 종이 비는 길은 둘이다 ────────────────────────────────────
 *  1. 화면이 먼저 지운다 — 종(NotificationBell)은 누른 줄을 저장 결과를 기다리지
 *     않고 제 목록에서 곧바로 뺀다. 저장이 실패하면 되돌려 놓는다.
 *  2. 여기서 무효화한다 — 저장이 성사되면 `revalidatePath("/", "layout")` 로 종
 *     목록을 만드는 (app)/layout.tsx 를 다시 계산하게 한다(불출·결재 액션이 쓰는
 *     그 방식이다 — `(app)` 은 라우트 그룹이라 그 레이아웃의 경로가 `/` 다). 줄을
 *     누르면 곧바로 다른 화면으로 옮겨 가므로 이 액션의 결과는 대개 그 이동에 밀려
 *     버려지는데, 그때도 Next 가 무효화된 것을 기억해 이동이 끝난 뒤 한 번 새로
 *     받는다 — 다음 렌더부터는 서버가 준 목록에도 그 줄이 없다.
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
  // 이미 확인한 것이었어도(newlyAcknowledged=false) 무효화한다 — 다른 기기에서 먼저
  // 눌러 둔 알림이 이 기기의 낡은 목록에 남아 있던 경우라, 새로 받는 것이 맞다.
  revalidatePath("/", "layout");
  // 새로 적었는지(newlyAcknowledged)는 화면에 알릴 이유가 없다 — 사람에게는 둘 다
  // 「사라졌다」로 같다.
  return { ok: true };
}

/**
 * ============================================================================
 * 알림 확인 — **포털에서 온 줄** (2026-10-22)
 * ============================================================================
 * 종의 줄을 눌렀는데 그것이 **남의 시스템 알림**이면(`sourceId` 가 있으면) 종이
 * 위 acknowledgeNotificationAction 대신 **이 액션**을 부른다. 가르는 자리는 종
 * 한 곳이다(components/layout/NotificationBell.tsx 의 handlePortalRowPicked).
 *
 * ── 🔴 위 액션과 적히는 곳이 다르다. 섞지 마라 ────────────────────────────
 *  · 위는 **A/S 의 표**(notification_acknowledgements)에 적는다. 그 길에는
 *    `if (item.sourceId) return;` 가드가 그대로 있어서 포털 줄이 들어갈 수 없다
 *    — 남의 시스템 알림 id 로 우리 표가 쌓이면 아무 오류 없이 영영 남는다.
 *  · 여기는 **포털**에 적는다. 우리 DB 에는 한 줄도 쓰지 않는다 — 그 알림을
 *    만든 시스템이 우리가 아니기 때문이다.
 *
 * ── 🔴 ✕ 지움(notification-dismissals.ts)과도 다르다 ─────────────────────
 * 모양은 거의 같지만 **수명이 정반대**다. ✕ 는 「지금은 그만 보겠다」라
 * 재로그인하면 돌아오고, 줄을 누르는 것은 「확인했다」라 안 돌아온다. 포털의
 * 표도 그래서 둘이다(규격서 「acknowledged」절). 🔴 **그래서 여기서 지움을
 * 함께 적지 않는다** — 둘 다 적으면 동작이 필요한 줄(결재 승인·부품 요청)이
 * 눌린 순간 지움으로 숨어 「해소될 때까지 남아 있게」라는 요구가 깨진다.
 *
 * ── 위 액션과 같은 것 ────────────────────────────────────────────────────
 * 서버 액션인 까닭 · 세션을 다시 읽는 까닭 · 던지지 않는 까닭은 위 머리말과
 * 옆 액션(notification-dismissals.ts)에 있다 — 되풀이하지 않는다.
 *
 * ── 🔴 다른 것 셋 ────────────────────────────────────────────────────────
 *  · **사람을 가리키는 칸이 없다.** 누구의 확인인지는 서버가 제 세션에서 읽는다
 *    — 받으면 브라우저가 아무 번호나 실어 남의 알림을 확인 처리할 수 있다.
 *  · **권한을 따로 보지 않는다.** 위 액션은 살아 있는 계정인지까지 본다(우리 표에
 *    줄이 영구히 쌓이므로). 여기는 우리 표에 아무것도 안 쓰고, 포털이 **그 사람
 *    몫으로만** 적는다 — 지움 액션과 같은 판단이다.
 *  · **열쇠 모양을 다시 가리지 않는다.** 위 액션은 우리 모양인지 다시 보지만
 *    (우리 표에 쓰레기가 쌓이면 안 되므로) 모르는 모양은 포털이 제 손으로 버린다.
 *    빈 문자열만 걸러 포털에 거절 한 줄을 쌓는 헛걸음을 막는다.
 *
 * ── 🔵 다시 그리게 하지 않는다 ───────────────────────────────────────────
 * `revalidatePath` 를 부르지 않는다(옆 지움 액션과 같다). 이 줄의 주소는 다른
 * 시스템의 **절대 주소**라 누르면 이 페이지를 통째로 떠나고, 돌아왔을 때는
 * 포털이 제 목록에서 그 줄을 이미 빼고 준다. 여기서 레이아웃을 다시 계산하면
 * 줄 한 번 누르기마다 알림 조회와 포털 왕복이 통째로 다시 돈다.
 * ============================================================================
 */
export async function acknowledgePortalNotificationAction(input: {
  notificationKey: string;
}): Promise<{ ok: boolean }> {
  try {
    // 데모 모드에는 포털이 없다 — 적을 곳이 없는 것이 정상이다(옆 지움 액션과
    // 같은 갈래).
    if (getLoginMode() !== "sso") return { ok: false };

    // 인자는 브라우저가 보낸 그대로라 타입 선언을 믿지 않는다 — 객체가 아닐
    // 수도 있다.
    const raw =
      typeof input === "object" && input !== null
        ? (input as { notificationKey?: unknown }).notificationKey
        : undefined;
    const notificationKey = typeof raw === "string" ? raw : "";
    if (notificationKey === "") return { ok: false };

    const session = await readSession();
    if (!session) return { ok: false };

    // 🔴 **여기가 「누구의 확인인가」를 정하는 유일한 자리다.** 인자에는 사람을
    //    가리키는 칸이 아예 없다(위 머리말).
    const subject = await getSsoSubjectForUser(session.userId);
    // 포털 계정에 이어지지 않은 로컬 계정은 적을 곳이 없다(설계서 F-3).
    if (!subject) return { ok: false };

    return { ok: await acknowledgePortalNotification(subject, notificationKey) };
  } catch (error) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다 — 열쇠에는 업무 식별자가 들어 있다.
    console.error("acknowledgePortalNotificationAction: failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false };
  }
}
