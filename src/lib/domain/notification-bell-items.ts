import type { NotificationBellItem } from "@dss/ui";
import { NOTIFICATION_KIND_META } from "./notification-settings";
import type { NotificationItem } from "./notifications";

/**
 * ============================================================================
 * A/S 알림 한 줄 → 공용 묶음 종이 받는 한 줄
 * ============================================================================
 * 머리말의 종은 이제 @dss/ui 의 것이다(사내 시스템 여섯이 같은 종을 쓰려고 묶음으로
 * 뺐다). 그 종이 받는 모양은 포털(dss-auth)이 여러 시스템의 알림을 합쳐 내주는
 * 모양이고, A/S 안쪽의 NotificationItem 과 칸이 다르다. 이 파일이 그 사이를 옮겨
 * 담는 **유일한 자리**다.
 *
 * ── 🔴 순수 계산만 한다 ──────────────────────────────────────────────────
 * `server-only` 도, `window` 도, `navigator` 도 물지 않는다. 그래야 화면 없이
 * (npm test) 이 표를 그대로 시험할 수 있고, 화면 쪽은 「옮겨 담기가 맞는가」를
 * 다시 검사하지 않아도 된다.
 *
 * ── 🔴 개수는 여기서 세지 않는다 ─────────────────────────────────────────
 * 묶음 타입에는 `targetKey` 가 **없다**. 그것은 「같은 대상은 한 번만 센다」는
 * A/S 안쪽 규칙의 재료인데(한 건에 결재가 둘 걸려 있어도 1), 묶음 종은 받은
 * 숫자를 그대로 찍을 뿐 다시 세지 않기 때문이다. 그래서 배지 숫자는 **옮겨
 * 담기 전 원본**에서 countNotificationTargets 로 세어 따로 넘긴다
 * (components/layout/NotificationBell.tsx).
 *
 * ── 🔴 색 **클래스**는 옮기지 않는다. 대신 **칸 번호**를 넘긴다 ──────────
 * NOTIFICATION_KIND_META 에는 toneClassName 이 함께 있지만 그것은 Tailwind 클래스
 * 이름이라 묶음으로 건너가면 **조용히 사라진다**(Tailwind v4 는 node_modules 를
 * 훑지 않아 규칙 자체가 만들어지지 않고, 오류도 나지 않는다). 그 값은 지금도
 * 건너가지 않는다 — notification-bell-items.test.ts 가 글자 단위로 막는다.
 *
 * 묶음에 건너가는 것은 **숫자 하나**(toneIndex)다. 묶음의 CSS 가 제 변수로 그
 * 칸의 색을 칠하므로 Tailwind 와 아무 상관이 없고, 사라질 클래스도 없다.
 *
 * 🔴 **왜 번호를 넘기게 됐나**: 안 넘기면 묶음이 종류 코드를 해시해 열여섯 칸
 * 중 하나를 집는데(@dss/ui 의 tone.ts), 그 셈은 「종류마다 다른 색」만 지키고
 * 뜻은 지키지 못한다 — 실제로 「재고 부족」이 초록, 「승인 완료」가 분홍,
 * 「반려됨」이 청록으로 나왔다. 어느 종류가 경고인지 아는 것은 A/S 뿐이라
 * 이쪽이 고른다(2026-10-19). 종류별 분기는 여전히 없다 — 표 조회 한 줄이다.
 *
 * 사람이 읽는 **이름**도 함께 넘어가고, 그 이름은 색과 함께 **글자로도**
 * 그려진다(색약·흑백 인쇄).
 *
 * ── 시스템 이름을 비워 보내는 이유 ───────────────────────────────────────
 * `sourceId`·`sourceName` 은 「어느 시스템에서 왔는가」다. 지금 이 종에 실리는
 * 것은 **A/S 자신의 알림뿐**이라, 보는 사람이 이미 A/S 안에 있다. 묶음은 빈
 * 문자열을 받으면 그 칸을 아예 안 그린다(없는 값은 `undefined` 가 아니라 빈
 * 문자열이다 — 포털이 그렇게 싣고 묶음 타입이 그것을 거울처럼 따른다).
 * 다른 시스템 알림을 포털에서 끌어오게 되면 그때 이 두 칸이 채워진다.
 * ============================================================================
 */

/**
 * 알림 id → 종 한 줄의 **열쇠**(`key`).
 *
 * ── 🔴 왜 `id` 와 다른 값이 되었나 (2026-10-20) ──────────────────────────
 * 2026-10-19 까지 「이 알림 그만 보겠다」는 각 사이트의 **브라우저**에 적혔고,
 * 그래서 우리 줄은 `key` 와 `id` 가 같아도 아무 탈이 없었다. 지금 그 기록은
 * **포털 한 곳**에 쌓인다 — 어느 시스템에서 지우든 사내 시스템 전부의 종에서
 * 사라지게 하려는 것이다(dss-auth/docs/사이트-알림-통로.md).
 *
 * 포털에 적히는 열쇠는 **`{client_id}:{id}`** 다. 접두사가 없으면 같은 알림이
 * A/S 종에서는 `{id}`, 계측기 종에서는 `rf-service-system:{id}` 로 보여서
 * **계측기에서 지워도 A/S 종에는 그대로 남는다** — 다른 곳에서는 사라지는데
 * 여기서만 남는, 제일 헷갈리는 모양이다.
 *
 * 🔴 **`id` 는 건드리지 않는다.** 확인 기록(notification_acknowledgements)과
 * 알림을 잇는 것은 `id` 하나뿐이고 그 표는 **영구**다. 확인을 적는 쪽이
 * `item.key` 를 쓰게 바뀌면 옛 기록과 모양이 달라져 **이미 확인한 알림이 전부
 * 다시 뜨고**, 되돌릴 수도 없다(사람들이 다시 확인해야 한다). 확인 경로는 지금도
 * `item.id` 를 쓴다(components/layout/NotificationBell.tsx 의
 * acknowledgeInBackground).
 *
 * 🔴 접두사가 **빈 문자열이면 붙이지 않는다** — 설정(SSO_CLIENT_ID)을 못 읽었을
 * 때 물러서는 자리다. 그때 잃는 것은 제 줄 지움이 포털과 안 통하는 것 하나뿐이고
 * 종은 예전 그대로 그려진다.
 *
 * 🔴 **열쇠를 짓는 자리는 여기 하나다.** 거르는 쪽(화면의
 * selectVisibleNotifications)도 이 함수를 불러 맞춰 본다 — 두 곳에서 따로
 * 조립하면 갈라졌을 때 오류 없이 「지워지지 않는 알림」만 남는다.
 */
export function notificationBellKey(id: string, clientId: string): string {
  return clientId === "" ? id : `${clientId}:${id}`;
}

/**
 * @param clientId 포털에 등록된 이 시스템의 식별자(`SSO_CLIENT_ID`). 🔴 `key` 의
 *                 접두사이고, **빈 문자열이면 접두사 없이**(2026-10-20 이전
 *                 모양) 만든다 — 위 notificationBellKey 머리말.
 */
export function toNotificationBellItems(
  items: readonly NotificationItem[],
  clientId = ""
): NotificationBellItem[] {
  return items.map((item) => ({
    // 목록 전체에서 유일한 열쇠 — `{client_id}:{id}` 다. 포털에 지움이 적히는
    // 그 열쇠이고(notificationBellKey), 눌린 줄을 되찾는 열쇠이기도 하다.
    //
    // 🔴 **확인 기록에 적히는 것은 이 `key` 가 아니라 아래 `id` 다.**
    //    (acknowledge({ notificationKey: item.id }) — NotificationBell.tsx).
    //    2026-10-19 까지 둘이 같은 값이라 헷갈리게 적혀 있었는데, 접두사가
    //    붙으면서 **갈라졌다.** 여기를 확인 기록의 키로 읽고 되돌리면 운영 DB 에
    //    쌓인 열쇠와 모양이 달라져 이미 확인한 알림이 전부 다시 뜬다.
    key: notificationBellKey(item.id, clientId),
    sourceId: "",
    sourceName: "",
    id: item.id,
    kind: item.kind,
    // 종류별 분기가 아니라 표 조회다 — 종류가 늘어도 이 줄은 그대로다.
    kindLabel: NOTIFICATION_KIND_META[item.kind].label,
    // 🔴 색 칸 번호. 안 실으면 묶음이 해시로 아무 칸이나 집는다(머리말).
    //    여기도 표 조회라 종류가 늘어도 이 줄은 그대로다.
    tone: NOTIFICATION_KIND_META[item.kind].toneIndex,
    subject: item.subject,
    detail: item.detail,
    href: item.href,
  }));
}
