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
export function toNotificationBellItems(
  items: readonly NotificationItem[]
): NotificationBellItem[] {
  return items.map((item) => ({
    // 목록 전체에서 유일한 열쇠. A/S 알림 id 가 이미 그러하고(`종류:나머지`),
    // 눌린 줄을 되찾는 열쇠이자 확인 기록에 적는 키이기도 하다 — 그래서 key 와
    // id 가 같은 값이다. 포털을 거쳐 온 줄은 `client_id:id` 라 둘이 갈라진다.
    key: item.id,
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
