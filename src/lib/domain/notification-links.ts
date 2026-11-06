/**
 * ============================================================================
 * 종 알림을 **다른 사이트로 내보낼 때**의 모양
 * ============================================================================
 * A/S 안에서 그리는 알림의 링크는 상대경로다(`/repair-cases/…`). 그것이 맞다 —
 * 같은 사이트 안에서 움직이는 링크에 주소를 박아 두면 LAN/프록시/NAS 로 옮길
 * 때마다 전부 틀린 값이 된다.
 *
 * 그런데 통합 알림은 **포털이 그린다.** 포털 화면에서 `/repair-cases/…` 를
 * 누르면 포털 안의 없는 주소로 간다 — 404 가 뜨거나, 더 나쁘게는 포털의 엉뚱한
 * 화면이 열린다. 그래서 밖으로 내보내는 길목에서만 자기 주소를 붙인다.
 *
 * 🔴 **domain/notifications.ts 의 8개 빌더는 한 글자도 고치지 않는다.** 그쪽을
 * 고치면 A/S 자기 화면의 링크까지 절대 주소가 되고, 그때부터 주소가 바뀔 때마다
 * 종이 남의 기계로 사람을 보낸다. 변환은 여기 한 곳에서, 내보낼 때만 한다.
 *
 * 이 파일은 순수 계산만 한다 — 기준 주소를 **인자로 받는다.** 어디서 얻을지는
 * 부르는 쪽(config/sso.ts 의 getAppBaseUrl)이 정하고, 여기는 붙이기만 한다.
 * 그래서 Node 단위 시험으로 그대로 돈다.
 * ============================================================================
 */

import { NOTIFICATION_KIND_META } from "./notification-settings";
import type { NotificationItem, NotificationKind } from "./notifications";

/**
 * 밖으로 나가는 알림 한 줄.
 *
 * NotificationItem 에 두 가지가 달라진다:
 *  · `href` 가 **절대 주소**다.
 *  · `kindLabel` 이 붙는다 — 받는 쪽은 A/S 의 종류 코드가 무슨 뜻인지 모른다.
 *    사람이 읽는 이름을 함께 주지 않으면 포털의 종에 `REPAIR_CASE_APPROVAL` 이
 *    그대로 찍힌다(설계서 F-4 와 같은 갈림 — 어휘의 주인은 각 시스템이다).
 *
 * 🔴 **색(toneClassName)은 일부러 보내지 않는다.** 그 값은 Tailwind 클래스
 * 이름이고, Tailwind 는 **자기 저장소의 소스에서 글자로 찾은 것만** CSS 로
 * 만든다(notification-settings.ts 의 그 주석과 같은 규칙). 포털로 건너간
 * `text-amber-700` 은 포털 빌드에 존재하지 않는 클래스라 아무 색도 내지 않는다 —
 * 보내면 「보냈는데 색이 안 나온다」로 조용히 실패한다. 색을 입히는 것은 받는
 * 쪽의 몫이다.
 */
export type ExternalNotificationItem = {
  id: string;
  kind: NotificationKind;
  /** 사람이 읽는 종류 이름. 받는 쪽이 코드표를 갖지 않게 하려고 함께 보낸다. */
  kindLabel: string;
  targetKey: string;
  subject: string;
  detail: string;
  /** 🔴 절대 주소. 다른 사이트에서 눌러도 A/S 로 온다. */
  href: string;
};

/** 스킴이 붙어 있는가(`http:` · `mailto:` 등). 이미 절대 주소면 손대지 않는다. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * 상대경로 하나에 기준 주소를 붙인다.
 *
 * 🔴 앞의 슬래시를 **한 칸으로 줄인다.** `//example.com` 은 브라우저가 스킴만
 * 생략한 절대 주소로 읽는다(프로토콜 상대 주소) — 그대로 이어 붙이면
 * `http://우리주소//example.com` 이 아니라 남의 사이트로 가는 링크가 된다.
 * 지금 8개 빌더가 그런 주소를 만들지는 않지만, 링크를 밖으로 내보내는 함수에서
 * 그 가정에 기대지 않는다.
 *
 * 기준 주소가 비어 있으면 던진다. 조용히 상대경로를 돌려주면 이 함수가 있는
 * 이유가 그대로 사라지고, 증상은 포털에서만 나타난다.
 */
export function absoluteNotificationHref(href: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base === "") {
    throw new Error("기준 주소가 비어 있습니다. 알림 링크를 절대 주소로 만들 수 없습니다.");
  }
  if (HAS_SCHEME.test(href)) return href;
  const path = href.startsWith("/") ? href.replace(/^\/+/, "/") : `/${href}`;
  return `${base}${path}`;
}

/** 목록 전체를 밖으로 내보낼 모양으로 바꾼다. 순서는 그대로 둔다. */
export function toExternalNotificationItems(
  items: readonly NotificationItem[],
  baseUrl: string
): ExternalNotificationItem[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    kindLabel: NOTIFICATION_KIND_META[item.kind].label,
    targetKey: item.targetKey,
    subject: item.subject,
    detail: item.detail,
    href: absoluteNotificationHref(item.href, baseUrl),
  }));
}

/**
 * 배지에 찍을 숫자 — **내보내는 줄 수**다. A/S 의 종과 같은 규칙이다.
 *
 * ── 🔴 2026-11-06 에 뜻이 뒤집혔다 ──────────────────────────────────────
 * 여기에는 「A/S 의 종과 같은 규칙으로 센다 — **같은 대상은 한 번만**
 * (countNotificationTargets)」이라고 적혀 있었고 실제로 그렇게 셌다. 사용자가
 * 그 설계를 뒤집었다: 「종을 눌렀을 때 나오는 알림의 수와 알림종의 숫자가
 * 동일했으면 좋겠어.」 A/S 의 종이 **보이는 줄**을 세게 됐으므로(components/
 * layout/NotificationBell.tsx 의 selectVisibleNotifications), 「종과 같은 규칙」을
 * 지키는 모양도 줄 수다.
 *
 * ── 🔵 포털은 이제 이 값을 읽지 않는다. 그래도 맞춰 두는 까닭 둘 ───────────
 * 같은 날 포털도 **받은 줄을 제 손으로 센다**(dss-auth 의 parseSourceFeed —
 * 사이트가 보낸 `count` 를 아예 읽지 않는다). 그래도 여기를 그대로 두지 않은
 * 까닭이 둘이다:
 *  1. 🔴 **포털이 아직 낡은 판일 때 이 값이 다시 쓰인다.** 그 전 포털은
 *     `Math.min(사이트가 센 값, 줄 수)` 였다. 건 수를 보내면 포털이 올라가기
 *     전까지 다른 사이트의 종 배지가 A/S 몫만 **적게** 나온다 — 바로 이번에 신고된
 *     그 증상이다. 줄 수를 보내면 min 이 줄 수라 **포털 판이 무엇이든** 맞는다.
 *  2. 같은 이름의 칸(`count`)이 시스템마다 다른 뜻이면 언젠가 그 값으로 다시 세는
 *     사람이 생기고, 그 어긋남은 오류 없이 숫자로만 드러난다.
 *
 * 🔵 `targetKey` 는 내보내는 모양에 그대로 남아 있지만(위 타입) 포털은 그 칸을
 * 옮기지 않는다(dss-auth 의 merge.ts — 「쓸 데가 없는 값을 날라 두면 언젠가
 * 그것으로 다시 세는 사람이 생긴다」). 이제 그 값으로 세는 곳은 **사이드바의
 * 결재 배지** 하나다.
 */
export function externalNotificationCount(
  items: readonly ExternalNotificationItem[]
): number {
  return items.length;
}
