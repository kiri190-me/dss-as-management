"use server";

import { readSession } from "@/lib/auth/session";
import { getLoginMode } from "@/lib/config/login-mode";
import { getSsoSubjectForUser } from "@/lib/db/queries/users";
import { dismissPortalNotifications } from "@/lib/server/integration/portal-inbox";

/**
 * ============================================================================
 * 알림 지움 — 서버 액션 (「이 알림은 그만 보겠다」)
 * ============================================================================
 * 종의 ✕ 와 「보이는 알림 지우기 n건」이 부른다(NotificationBell.tsx). 지운 줄은
 * **포털에** 적히고, 그러면 어느 사내 시스템의 종에서도 사라진다 — 「확인했다」는
 * 그 알림을 만든 시스템에만 적을 수 있지만(바로 옆
 * notification-acknowledgements.ts), 「그만 보겠다」는 포털 한 곳에 적힌다
 * (2026-10-20 결정, dss-auth/docs/사이트-알림-통로.md).
 *
 * ── 🔴 왜 서버 액션인가 (브라우저용 중계 통로가 아니라) ───────────────────
 * 포털에 지움을 적는 자격은 `client_secret` 이다. 브라우저에서 부를 수 있는 통로
 * (route handler)를 뚫으면 거기서 세션을 다시 검증하고 시크릿을 다시 다뤄야
 * 한다 — **시크릿을 다루는 자리를 하나 더 만드는** 일이다. 그 판단은
 * server/integration/portal-inbox.ts 머리말에 이미 적혀 있고 여기서 깨지 않는다.
 * 서버 액션이면 시크릿은 이 프로세스 밖으로 나가지 않고, 클라이언트 번들로는
 * **이 함수의 이름표**만 나간다(본문은 서버에 남는다 — 그 선은 파일 첫 토큰인
 * `"use server"` 가 긋고, notification-dismissals-source.test.ts 가 지킨다).
 *
 * 🔴 종은 이 파일을 **직접 가져오지 않는다.** 종(NotificationBell.tsx)은
 * `renderToStaticMarkup` 으로 시험되는데, 여기서 세션·DB 사슬을 끌어오면 그
 * 시험이 가져오는 순간 죽는다. 그래서 종은 이 함수를 **인자로 받고**, 넘겨 주는
 * 일은 TopBar.tsx 가 한다 — 확인 기록(acknowledgeNotificationAction)과 똑같은
 * 모양이다.
 *
 * ── 🔴 누구의 지움인지는 **서버가** 정한다 ────────────────────────────────
 * 사람 번호(`sub`)를 인자로 받지 않는다. 받으면 브라우저가 아무 번호나 실어
 * **남의 알림을 지울 수 있다.** 여기서 제 세션을 다시 읽어 그 값을 쓴다 —
 * 레이아웃이 이미 한 번 검증했더라도 서버 액션은 따로 다시 검증한다(옆 액션
 * notification-acknowledgements.ts 의 「사용자는 세션에서 푼다」와 같은 규약).
 *
 * 🔴 **리다이렉트하지 않는 `readSession` 을 쓴다.** 이 함수는 사람이 ✕ 를 누른
 *    **그 순간** 불리는데, 세션이 막 끊긴 경우에 알림 한 줄 때문에 보던 화면이
 *    로그인으로 튀어서는 안 된다. 그때는 아무 일도 일어나지 않는 편이 맞다.
 *
 *    🔵 이 저장소에서 **리다이렉트하는 것은 `auth/area-guard.ts` 하나**다
 *    (`requireAreaAccessForCurrentUser` — 페이지 한 줄짜리 가드라 세션이 없으면
 *    `redirect("/login")` 한다). 그쪽은 **화면을 여는 길**이고 여기는 화면에
 *    머문 채 도는 길이라 쓰면 안 된다. `auth/session.ts` 가 내주는 것은
 *    「못 읽으면 null」인 `readSession` 하나이고, 옆 액션들도 전부 이것을 쓴다.
 *
 * ── 🔴 권한을 따로 보지 않는다 ───────────────────────────────────────────
 * 확인(acknowledge)은 살아 있는 계정인지까지 본다 — 우리 DB 의 확인 기록 표에
 * 줄이 **영구히** 쌓이기 때문이다. 지움은 우리 표에 한 줄도 적지 않고, 포털이
 * **그 사람 몫으로만** 적는다(`sub` 은 바로 위에서 서버가 정했다). 열쇠 모양이
 * 틀리거나 모르는 시스템의 것은 포털이 조용히 버린다. 즉 여기서 할 수 있는
 * 최악이 「제 종에서 제 알림을 지우는 것」이라, 역할로 한 번 더 가르면 막는 것
 * 없이 「되는 사람과 안 되는 사람」만 생긴다.
 *
 * ── 🔴 던지지 않는다 ─────────────────────────────────────────────────────
 * 종이 누름 처리 **한가운데서** 이 함수를 부른다. 못 지우면 그 줄이 새로고침한
 * 뒤 다시 뜰 뿐이고, 던지면 종이, 곧 모든 화면의 머리말이 깨진다. 남기는 것은
 * 오류의 **종류**뿐이다 — 🔴 **열쇠는 찍지 않는다**(수리 건 번호 같은 업무
 * 식별자가 들어 있다).
 *
 * ── 🔵 「누른 즉시 사라진다」는 여기 없다 ─────────────────────────────────
 * 그것은 종이 제 화면 안(메모리)에서 한다. 여기는 **적는 일만** 하고 화면을 다시
 * 그리게 하지도 않는다(`revalidatePath` 를 부르지 않는다) — 줄은 이미 눈앞에서
 * 사라졌고, 레이아웃을 통째로 다시 계산하면 알림 조회와 포털 왕복이 ✕ 한 번마다
 * 다시 돈다. 새로고침하면 포털이 돌려준 `dismissed` 가 그 자리를 잇는다.
 * ============================================================================
 */

/**
 * 한 번의 부름으로 받아 주는 열쇠의 **총수**.
 *
 * 🔴 포털의 200 과 다른 값이다. 저것은 「한 요청에 몇 개까지 실을 수 있나」이고
 * (넘으면 보내는 쪽이 나눈다 — portal-inbox.ts 의 DISMISSALS_PER_REQUEST),
 * 이것은 「한 번의 누름이 포털을 몇 번까지 두드릴 수 있나」다. 서버 액션은 누구나
 * 부를 수 있으므로, 이 울타리가 없으면 열쇠 10만 개짜리 부름 하나가 포털로 가는
 * 요청 500개가 된다.
 *
 * 🔵 정상 범위와 한참 떨어뜨려 둔다 — 종에 실리는 줄은 두 자릿수이고, 그 전부를
 * 지우는 「보이는 알림 지우기」조차 여기 닿을 수 없다.
 */
const MAX_DISMISSAL_KEYS_PER_CALL = 2000;

/**
 * 종에서 지운 줄들을 포털에 적는다. 🔴 **아무것도 돌려주지 않고 던지지도 않는다.**
 *
 * 돌려주지 않는 까닭: 종은 이 결과를 기다리지 않고 줄을 이미 감췄다. 「적혔는가」를
 * 돌려주면 다음 사람이 그것으로 줄을 되살리는 장치를 만들게 되는데, 끊긴 POST 는
 * **저쪽이 이미 저장했을 수도** 있어서 「안 됐다」가 참이 아니다.
 */
export async function dismissNotificationsAction(input: { keys: string[] }): Promise<void> {
  try {
    // 데모 모드에는 포털이 없다 — 주소도 자격증명도 없고, 물어볼 곳이 없는 것이
    // 정상이다((app)/layout.tsx 가 묻는 쪽에서 가리는 그 갈래와 같다).
    if (getLoginMode() !== "sso") return;

    // 인자는 브라우저가 보낸 그대로라 타입 선언을 믿지 않는다 — 객체가 아닐 수도,
    // 배열이 아닐 수도 있다.
    const raw =
      typeof input === "object" && input !== null ? (input as { keys?: unknown }).keys : undefined;
    if (!Array.isArray(raw)) return;

    const keys = raw.filter((key): key is string => typeof key === "string" && key !== "");
    // 빈 목록은 포털이 400(`no_keys`)으로 거절한다 — 아예 보내지 않는다.
    if (keys.length === 0) return;
    if (keys.length > MAX_DISMISSAL_KEYS_PER_CALL) return;

    const session = await readSession();
    if (!session) return;

    // 🔴 **여기가 「누구의 지움인가」를 정하는 유일한 자리다.** 인자에는 사람을
    //    가리키는 칸이 아예 없다(위 머리말).
    const subject = await getSsoSubjectForUser(session.userId);
    // 포털 계정에 이어지지 않은 로컬 계정은 적을 곳이 없다(설계서 F-3). 그 사람은
    // 애초에 자기 알림만 보고, 그 지움은 이 화면이 열려 있는 동안만 유지된다.
    if (!subject) return;

    // 🔴 200개씩 나눠 보내는 일은 저 함수가 한다 — 넘기면 포털이 400 으로 통째로
    //    거절한다(portal-inbox.ts 의 DISMISSALS_PER_REQUEST).
    await dismissPortalNotifications(subject, keys);
  } catch (error) {
    // 🔴 남기는 것은 오류의 **종류**뿐이다 — 열쇠에는 수리 건 번호가 들어 있다.
    console.error("dismissNotificationsAction: failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
  }
}
