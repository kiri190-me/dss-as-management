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
import {
  countNotificationTargets,
  type NotificationItem,
  type NotificationKind,
} from "./notifications";

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
 * 배지에 찍을 숫자. A/S 의 종과 **같은 규칙으로** 센다 — 같은 대상은 한 번만
 * (domain/notifications.ts 의 countNotificationTargets). 받는 쪽이 목록 길이를
 * 세면 한 접수 건에 결재가 둘 걸린 사람에게 A/S 의 종과 포털의 종이 서로 다른
 * 숫자를 보여 준다.
 */
export function externalNotificationCount(
  items: readonly ExternalNotificationItem[]
): number {
  return countNotificationTargets(items.map((item) => item.targetKey));
}
