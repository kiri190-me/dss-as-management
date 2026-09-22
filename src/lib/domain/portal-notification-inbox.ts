/**
 * ============================================================================
 * 포털이 **다른 시스템들에서 모아 보내 주는** 알림 — 받는 쪽의 모양과 검사
 * ============================================================================
 * A/S 의 종은 원래 제 알림만 그렸다. 사내 시스템이 다섯이 되면서(A/S · 개선요청
 * · 계측기 · PO/내자 · 휴가) 「어느 시스템에 있든 종 하나를 열면 다 보인다」로
 * 가기로 했고, 합치는 일은 포털(dss-auth)이 한다. 이 파일은 포털이 준 JSON 을
 * **그릴 수 있는 모양으로 바꾸는 순수 계산**이다.
 *
 * 🔴 여기에 **A/S 자신의 알림은 없다.** 포털은 부른 사이트에게는 묻지 않는다
 *    (되돌기와 30초 캐시 때문이다 — dss-auth/docs/사이트-알림-통로.md). 그래서
 *    화면은 이 목록을 **자기 목록 뒤에 이어 붙이고** 개수도 **더한다**.
 *
 * ── 🔴 이름이 `…Feed` 가 아니라 `…Inbox` 인 까닭 ────────────────────────
 * 이 저장소에는 이미 `PortalNotificationFeed` 가 있다
 * (server/integration/portal-notifications.ts) — 그것은 **반대 방향**이다:
 * 포털이 A/S 에 물어 갈 때 **내주는** 모양이다. 들어오는 것과 나가는 것이 같은
 * 이름이면 import 를 잘못 골라도 tsc 가 한동안 통과한다(칸이 겹친다).
 *
 * ── 왜 한 번 더 거르나 ──────────────────────────────────────────────────
 * 포털은 우리 편이지만 그 답에는 **다른 시스템들이 만든 글자**가 실려 온다.
 * 한 시스템이 이상한 줄을 하나 섞어 보냈다고 머리말이 통째로 깨지면 안 된다 —
 * 그래서 모양이 안 맞는 줄은 **그 줄만** 버린다.
 *
 * 이 파일은 순수 계산만 한다 — 망도, `server-only` 도, 환경변수도 들어오지
 * 않는다. 그래서 Node 단위 시험이 그대로 불러 보고, **클라이언트 조각인 종이
 * 그대로 import 할 수 있다**(server-only 를 물면 빌드가 깨진다).
 * ============================================================================
 */

import { isSafeNotificationHref, type NotificationBellItem } from "@dss/ui";

/**
 * 포털이 합쳐 준 「다른 시스템들의 알림」 한 벌.
 *
 * 칸 이름이 @dss/ui 의 `NotificationBellItem` 과 글자 하나까지 같아서 받은
 * 배열을 그대로 쓴다 — 그 타입 자체가 포털 응답의 거울이라고 그쪽에 적혀 있다
 * (vendor/dss-ui 의 notification-bell/types.ts). 여기서 타입을 새로 적지 않고
 * 빌려 오는 이유가 그것이다: 둘 중 하나가 어긋나면 tsc 가 먼저 말해 준다.
 */
export type PortalNotificationInbox = {
  items: NotificationBellItem[];
  /**
   * 배지에 더할 숫자. 🔴 **포털이 센 값 그대로** 나른다 — 줄 수로 다시 세지
   * 않는다. 세는 규칙은 시스템마다 다르고(A/S 는 같은 대상을 한 번만 센다 —
   * domain/notifications.ts 의 countNotificationTargets), 여기서 다시 세면 그
   * 시스템의 종과 이 종이 서로 다른 숫자를 말하게 된다.
   */
  count: number;
  /**
   * 🔴 「한 곳이라도 못 물어봤다」는 표시. **「알림이 없다」와 다른 말이다.**
   * 지금은 화면에 쓰지 않지만(알림이 없는 것과 똑같이 그린다) 값을 버리지는
   * 않는다 — 나중에 「일부를 못 불러왔습니다」를 보여 주기로 하면 여기 있다.
   */
  degraded: boolean;
};

/**
 * 못 물어봤을 때·아직 못 받았을 때의 답. 🔴 **던지지 않는다** — 알림 하나
 * 때문에 머리말이, 곧 사이트의 모든 화면이 깨지는 일은 없어야 한다.
 *
 * 얼지 않은 새 객체가 아니라 상수 하나를 돌려쓴다: 종이 이것을 useState 의
 * 초깃값으로 쓰는데, 렌더마다 새 객체면 참조가 매번 달라진다.
 */
export const EMPTY_PORTAL_INBOX: PortalNotificationInbox = Object.freeze({
  items: [],
  count: 0,
  degraded: true,
});

/** 한 줄의 아홉 칸. 하나라도 글자가 아니면 그 줄만 버린다. */
function toBellItem(row: unknown): NotificationBellItem | null {
  if (typeof row !== "object" || row === null) return null;
  const { key, sourceId, sourceName, id, kind, kindLabel, subject, detail, href } =
    row as Record<string, unknown>;
  if (
    typeof key !== "string" ||
    typeof sourceId !== "string" ||
    typeof sourceName !== "string" ||
    typeof id !== "string" ||
    typeof kind !== "string" ||
    typeof kindLabel !== "string" ||
    typeof subject !== "string" ||
    typeof detail !== "string" ||
    typeof href !== "string"
  ) {
    return null;
  }
  // 🔴 그릴 수 없는 주소는 **그 줄만** 버린다. 이 값은 남의 시스템에서 온
  //    글자다 — `javascript:` 가 섞여 들어오면 클릭 한 번이 이 화면에서 남의
  //    코드를 돌리는 문이 된다. 포털이 한 번 걸러 보내지만, 이 파일이 포털
  //    JSON 이 우리 화면 안으로 들어오는 **유일한 문**이라 여기서 다시 본다
  //    (검사 자체는 @dss/ui 의 것을 쓴다 — 다섯 사이트가 같은 줄을 긋는다).
  if (!isSafeNotificationHref(href)) return null;
  return { key, sourceId, sourceName, id, kind, kindLabel, subject, detail, href };
}

/**
 * 포털의 답(JSON 을 푼 값)을 그릴 수 있는 모양으로 만든다.
 *
 * 무엇이 들어와도 던지지 않는다 — 배열이 아니어도, null 이어도, 칸이 비어도
 * 빈 목록이 나간다.
 */
export function normalizePortalNotificationFeed(body: unknown): PortalNotificationInbox {
  if (typeof body !== "object" || body === null) return EMPTY_PORTAL_INBOX;
  const answer = body as Record<string, unknown>;

  const items: NotificationBellItem[] = [];
  if (Array.isArray(answer.items)) {
    for (const row of answer.items) {
      const item = toBellItem(row);
      if (item) items.push(item);
    }
  }

  // 🔴 숫자가 아니면 **0** 이다(줄 수로 대신 세지 않는다 — 위 count 주석).
  // 0 이면 배지에 더해지는 것이 없을 뿐 목록은 그대로 보인다.
  const count =
    typeof answer.count === "number" && Number.isFinite(answer.count) && answer.count > 0
      ? answer.count
      : 0;

  // 여기까지 왔으면 **물어보기는 했다.** degraded 는 포털이 「일부 시스템에
  // 못 물어봤다」고 말할 때만 참이다.
  return { items, count, degraded: answer.degraded === true };
}

/**
 * 🔴 화면이 값을 받을 때의 **마지막 한 겹**.
 *
 * 종은 이 값을 서버에서 넘어오는 Promise 로 받는다(NotificationBell.tsx 의
 * 그 주석). 그 Promise 가 어떤 이유로든 어그러지거나, 풀린 값이 기대한 모양이
 * 아니면 **빈 것으로 친다** — 머리말은 모든 화면에 딸려 오므로 여기서 던지면
 * 사이트 전체가 빈 화면이 된다.
 *
 * 순수 함수로 따로 둔 이유: 「어떤 답이 와도 빈 목록」을 시험이 값으로 직접
 * 확인할 수 있게 하기 위해서다.
 */
export function asPortalNotificationInbox(value: unknown): PortalNotificationInbox {
  if (typeof value !== "object" || value === null) return EMPTY_PORTAL_INBOX;
  const candidate = value as Partial<PortalNotificationInbox>;
  if (!Array.isArray(candidate.items)) return EMPTY_PORTAL_INBOX;
  return {
    items: candidate.items,
    count:
      typeof candidate.count === "number" && Number.isFinite(candidate.count) && candidate.count > 0
        ? candidate.count
        : 0,
    degraded: candidate.degraded === true,
  };
}
