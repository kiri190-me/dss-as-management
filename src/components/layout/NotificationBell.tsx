"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { NotificationBell as SharedNotificationBell } from "@dss/ui";
import type { NotificationBellItem } from "@dss/ui";
import { countNotificationTargets, type NotificationItem } from "@/lib/domain/notifications";
import {
  notificationBellKey,
  toNotificationBellItems,
} from "@/lib/domain/notification-bell-items";
import { isAcknowledgeableNotificationKind } from "@/lib/domain/notification-acknowledgement";
import {
  canDismissNotification,
  dismissableNotificationKeys,
  purgeStoredDismissals,
  type DismissalStore,
} from "@/lib/domain/notification-dismissal";
import {
  EMPTY_PORTAL_INBOX,
  asPortalNotificationInbox,
  type PortalNotificationInbox,
} from "@/lib/domain/portal-notification-inbox";
import {
  NOTIFICATION_PANEL_OPENED_EVENT,
  NOTIFICATION_PERMISSION_CHANGED_EVENT,
  buildNotificationSelfTestToast,
  describeBrowserNotificationStatus,
  describeNotificationToastOutcome,
  resolveBrowserNotificationStatus,
  type BrowserNotificationStatus,
} from "@/lib/domain/notification-toast";
import { showBrowserNotificationToast } from "./BrowserNotifications";

/**
 * ============================================================================
 * 헤더의 종 알림 — 겉은 공용 묶음(@dss/ui), 속은 A/S 의 사정
 * ============================================================================
 * 사이드바의 결재 배지는 **숫자 하나**라 "3건 있다"까지만 말한다. 무엇인지
 * 보려면 목록 페이지를 열어서 다시 찾아야 한다. 종은 건별로 펼쳐 보여 주고
 * 그 건의 상세로 바로 보낸다.
 *
 * ── 🔴 그리는 일은 묶음이 한다 ──────────────────────────────────────────
 * 사내 시스템이 여섯인데(A/S · 포털 · 계측기 · 개선요청 · PO/내자 · 휴가) 종은
 * A/S 에만 있었다. 「어느 시스템에 있든 종 하나를 열면 모든 시스템의 알림이
 * 보인다」로 가기로 해서, 종의 겉모습은 @dss/ui 로 뺐고 다른 네 사이트가 이미
 * 같은 것을 달았다. 이 파일은 그 묶음 종의 **껍데기**다 — 단추도, 펼침 패널도,
 * 목록 마크업도 여기 없다.
 *
 * 묶음 종은 <details>/<summary> 라 여닫기를 **브라우저가** 한다. 그래서 여기
 * 있던 isOpen 상태와 바깥 클릭·Esc 닫기 효과가 사라졌다(묶음의 BellBehavior 가
 * 한다). 덤으로 정적 렌더 시험이 **펼친 속까지** 그대로 본다.
 *
 * ── 종류를 모른다 ───────────────────────────────────────────────────────
 * 이 컴포넌트에는 "결재"라는 말이 한 군데도 없고, 종류를 보고 갈라지는 분기도
 * 없다. 알림 종류가 늘어도 여기는 고치지 않는다 — 종류는
 * db/queries/notifications.ts 의 레지스트리에 등록한다.
 *
 * 그 규칙은 NotificationBell.test.tsx 가 이 파일의 소스를 직접 읽어 지킨다.
 *
 * 종류마다 다른 **이름**은 도메인의 NOTIFICATION_KIND_META 를 읽어 옮겨 담는
 * 자리(domain/notification-bell-items.ts)가 싣는다. **색**은 더 이상 이쪽이
 * 정하지 않는다 — 묶음이 종류 코드를 해시해 제 색 칸을 고른다. 클래스 이름을
 * 그대로 건네면 Tailwind v4 가 node_modules 를 훑지 않아 색이 조용히 사라진다.
 *
 * ── 눌러서 확인하는 알림 ────────────────────────────────────────────────
 * 결재 결과처럼 처리할 것이 없는 정보성 알림은 줄을 누르면 「확인함」을 적고 종에서
 * 뺀다. 🔴 묶음은 **모든 줄에서** 확인 함수를 부른다 — 「눌러서 확인하는 줄인가」는
 * 묶음이 알 수 없는 A/S 안쪽 사정이라, 도메인 판정
 * (isAcknowledgeableNotificationKind) **한 곳**으로 여기서 가린다
 * (handleNotificationPicked). 이동은 평범한 <a href> 가 하므로 확인 저장을
 * 기다리지 않고, 저장이 실패해도 막히지 않는다 — 실패하면 그 줄이 다시 나타날 뿐이다.
 *
 * ── 🔴 「지우기」는 확인 기록과 **다른 것**이다 ──────────────────────────
 * 줄마다 서는 ✕ 와 펼친 칸 아래의 「보이는 알림 지우기」는 **포털에** 적는다
 * (2026-10-20) — A/S 의 표는 한 줄도 건드리지 않고, 어느 사내 시스템에서 지우든
 * **모든 시스템의 종에서** 사라진다. 위 확인 기록(A/S 의 표에 남아 영영
 * 사라진다)과 섞지 마라. 가리는 규칙은 도메인 한 곳에 있고
 * (domain/notification-dismissal.ts), 적는 일은 서버 액션이 한다
 * (server/actions/notification-dismissals.ts — 아래 `dismiss` 프롭).
 *
 * 🔴 포털에서 온 줄은 **누르는 것만으로도** 지워진다. 그 줄은 A/S 가 「확인
 * 했다」를 적을 데가 없어(그 통로가 포털에 없다) 눌러 본 뒤에도 영영 종에
 * 남던 유일한 줄이었다.
 *
 * 🔴 **두 방향이 다 포털로 이어졌다.** 읽는 쪽 — 다른 사내 시스템의 종에서 지운
 * A/S 줄이 포털의 `dismissed` 로 돌아와 여기서도 빠진다(그래서 자기 줄의 열쇠
 * 에도 `rf-service-system:` 접두사가 붙는다 — domain 의 notificationBellKey).
 * 적는 쪽 — 여기서 누른 ✕ 가 그 포털에 그대로 적힌다.
 *
 * 🔵 **「누른 즉시 사라진다」는 A/S 만의 것이고 그대로 둔다.** 다른 여섯 사이트는
 * 서버가 다시 그릴 때(한 박자 뒤) 줄이 빠지지만, 여기서는 아래
 * useDismissedNotifications 가 지운 열쇠를 **이 화면 안(메모리)** 에 들고 있어
 * 곧바로 빠진다. 🔴 그 기억은 **브라우저에 적히지 않는다** — 포털에 적는 것이
 * 실패하면 그 줄은 새로고침했을 때 **다시 뜬다**. 그 편이 정직하다: 안 적혔는데
 * 여기서만 안 보이면 같은 줄이 다른 시스템의 종에는 그대로 있다.
 *
 * ── 묶음에 올 수 없는 것은 footer 로 넣는다 ─────────────────────────────
 * 브라우저 알림 권한 안내와 「시험 알림」 단추는 `navigator`·사람마다 갈라 쓰는
 * localStorage·이 사이트의 아이콘 경로를 문다. 묶음은 제 시험으로 그것들을
 * 금지하므로(그쪽 no-network.test.ts), 자리(`footer`)만 내주고 사이트가 제 것을
 * 끼워 넣는다. 🔴 함수가 아니라 **노드**를 넘긴다.
 *
 * ── 🔴 다른 시스템들의 알림도 이 종에 실린다 ─────────────────────────────
 * 포털(dss-auth)이 개선요청 · 계측기 · PO/내자 · 휴가에 물어 합쳐 준 목록이
 * **자기 목록 뒤에** 이어 붙고 개수도 더해진다. 포털은 부른 사이트 자신에게는
 * 묻지 않으므로(되돌기 · 30초 캐시 — dss-auth/docs/사이트-알림-통로.md) 두
 * 목록은 겹치지 않는다. 그 값이 어떻게 여기까지 오는지는 아래
 * `usePortalNotificationInbox` 주석에 있다.
 *
 * ── 모바일 폭 ───────────────────────────────────────────────────────────
 * TopBar.tsx 의 주석에 적힌 사고(오른쪽 묶음이 폰에서 헤더를 가로로 넘치게
 * 만들어 햄버거조차 누르기 어려웠던 일) 때문에, 종은 햄버거와 같은 아이콘 버튼
 * 하나를 넘지 않고 `ml-auto shrink-0` 으로 오른쪽 끝에 붙어 눌리지 않는다.
 * 펼침 패널이 화면 밖으로 나가지 않게 폭을 제한하는 일은 묶음의 CSS 가 한다.
 * ============================================================================
 */

/**
 * 확인 기록을 적는 함수 — 서버 액션 acknowledgeNotificationAction
 * (server/actions/notification-acknowledgements.ts)과 같은 모양이다.
 *
 * 🔴 이 파일은 그 서버 액션을 직접 가져오지 않고 **받아서** 쓴다. 서버 액션 파일은
 * `server-only` 사슬(세션·DB)을 물고 있어서, 여기서 가져오면 이 파일을 정적 렌더로
 * 시험하는 NotificationBell.test.tsx 가 가져오는 순간 죽는다. 받아서 쓰면 시험은 가짜
 * 함수를 넘겨 「누가 언제 부르는가」를 그대로 볼 수 있다.
 */
export type AcknowledgeNotification = (input: { notificationKey: string }) => Promise<{ ok: boolean }>;

/**
 * 확인을 가르고 적는 데 필요한 **최소한의 모양**.
 *
 * A/S 의 NotificationItem 과 묶음이 돌려주는 NotificationBellItem 이 둘 다 이것을
 * 만족한다(옮겨 담을 때 id 와 kind 를 그대로 싣는다 — notification-bell-items.ts).
 * 그래서 아래 두 함수는 어느 쪽을 받아도 같은 판단을 한다.
 *
 * 🔴 `sourceId` 는 「어느 시스템에서 온 줄인가」다. **A/S 자신의 알림은 빈
 * 문자열**이고(notification-bell-items.ts 가 그렇게 싣는다), 포털을 거쳐 온 줄만
 * 값이 있다. A/S 안쪽 모양(NotificationItem)에는 이 칸이 아예 없어서 물음표가
 * 붙어 있다 — 없는 것은 「자기 것」으로 읽는다.
 */
export type PickedNotification = { id: string; kind: string; sourceId?: string };

/**
 * 줄 하나를 눌렀을 때 할 일. **이동은 하지 않는다** — 묶음의 줄은 평범한
 * <a href> 라 브라우저가 알아서 나간다.
 *
 * 🔴 묶음은 **모든 줄에서** 이 경로로 들어온다. 확인할지 말지는 도메인 판정 한
 * 곳이 정한다 — 종류 이름을 여기 적거나 종류로 갈라지지 않는다(이 파일 머리말).
 * 할 일 알림은 이 판정에서 거짓이라 확인 액션이 불리지 않는다.
 *
 * 🔴 확인은 기다리지 않는다 — onAcknowledge 는 저장을 **시작만** 하고 곧바로
 * 돌아오고, 그것이 던져도 이동은 그대로 간다.
 */
export function handleNotificationPicked(
  item: PickedNotification,
  handlers: { onAcknowledge?: (item: PickedNotification) => void }
): void {
  // 🔴 **포털에서 온 줄은 여기서 끝난다.** 「확인했다」를 적을 수 있는 곳은 그
  //    알림을 만든 시스템뿐이고, 포털에 그 통로는 아직 없다. 이 갈래가 없으면
  //    남의 시스템 알림 id(`IMPROVEMENT:7` 같은 것)로 A/S 의 확인 기록이 쌓인다
  //    — 아무 오류도 없이, 그 줄은 그대로 남은 채. 줄을 누르면 그 시스템의
  //    화면으로 건너가고, 거기서 일을 마치면 다음 왕복에서 목록이 줄어든다.
  if (item.sourceId) return;
  if (!handlers.onAcknowledge || !isAcknowledgeableNotificationKind(item.kind)) return;
  try {
    handlers.onAcknowledge(item);
  } catch {
    // 확인을 못 적어도 이동은 막지 않는다 — 알림이 종에 남을 뿐이다.
  }
}

/**
 * 줄을 눌렀을 때 **포털에서 온 줄만** 지운 것으로 적는다.
 *
 * 🔴 **바로 위 함수와 길이 다르다. 섞지 마라.**
 *  - 위(handleNotificationPicked)는 **A/S 의 DB** 로 가는 길이다. 포털 줄이 그
 *    길로 들어가면 남의 시스템 알림 id 로 A/S 의 확인 기록이 쌓인다 — 그래서
 *    거기엔 `if (item.sourceId) return;` 이 그대로 남아 있다.
 *  - 여기는 **포털**로 가는 길이다. 우리 표가 아니므로 그 금지에 걸리지 않는다.
 *    오히려 포털 줄은 A/S 가 「확인했다」를 적을 데가 없어서, 눌러 본 줄이 영영
 *    종에 남는 유일한 줄이었다 — 누른 것만으로 치운다.
 *
 * 🔴 **자기 줄은 여기서 끝난다.** 자기 줄을 누른 것은 이미 확인 기록(영구)으로
 * 가고 있고, 같은 누름을 지움으로도 적으면 **확인 저장이 실패해 되살아나야 할
 * 줄이 포털의 지움 기록 때문에 그대로 숨는다** — 그것도 이 시스템에서만이
 * 아니라 모든 사내 시스템의 종에서.
 */
export function handlePortalRowPicked(
  item: { key: string; sourceId?: string },
  handlers: { onDismiss?: (key: string) => void }
): void {
  if (!item.sourceId) return;
  if (!handlers.onDismiss) return;
  try {
    handlers.onDismiss(item.key);
  } catch {
    // 못 지워도 이동은 막지 않는다 — 그 줄이 종에 남을 뿐이다.
  }
}

/**
 * 지금 종에 **보이는 것**과 배지에 찍을 **숫자**를 한 번에 고른다.
 *
 * 순수 함수로 빼 둔 까닭: 지운 줄은 브라우저에서 눌러야 생기는 상태라 정적
 * 렌더로는 만들 수 없다. 🔴 **배지가 함께 줄어드는가**는 눈에 안 보이는
 * 사고다(종을 열면 비었는데 숫자만 붙어 있는 종) — 값으로 시험한다.
 *
 * 🔴 **자기 줄도 받은 줄도 열쇠 모양이 같다** — 둘 다 `client_id:id` 다
 * (notification-bell-items.ts 의 notificationBellKey). 2026-10-19 까지 자기 줄은
 * 접두사 없는 알림 id 였고 그때는 거르는 칸이 서로 달랐다. 지움이 포털 한 곳에
 * 모이면서 모양을 맞췄다 — 안 맞추면 「계측기에서 지웠는데 A/S 종에만 남는다」가
 * 된다. 🔴 그래서 **자기 줄도 `id` 가 아니라 열쇠로 맞춰 본다.** 확인 기록만은
 * 여전히 `id` 로 적히므로 acknowledgedIds 는 `id` 그대로다.
 *
 * ── 🔴 지운 목록이 **둘**이고, 여기서 합친다 ────────────────────────────
 *  ⓐ `dismissedKeys` — **이 화면이 열려 있는 동안** 방금 누른 것(메모리).
 *     포털에 적는 왕복을 기다리지 않고 곧바로 감추기 위한 것이다.
 *  ⓑ `inbox.dismissed` — 포털이 돌려준, 이 사람이 **어느 시스템에서든** 지운
 *     A/S 줄의 열쇠(규격서 「dismissed」절 — 그 사이트 몫만 온다).
 *
 * 🔴 ⓐ 는 새로고침하면 비워지고 ⓑ 가 그 자리를 잇는다. 포털에 적는 것이
 *    실패했으면 그 줄은 그때 **다시 뜬다** — 알고 받아들인 값이다
 *    (useDismissedNotifications 주석).
 *
 * 🔴 **합치는 자리를 여기로 잡은 까닭**: 거르는 일과 세는 일이 이미 이 함수
 * 하나이고, 두 목록은 **같은 모양의 열쇠**라 한 Set 으로 합쳐진다. 바깥(종
 * 컴포넌트)에서 합치면 거르기는 맞아도 **개수를 맞추는 셈이 다른 자리에**
 * 남아 둘이 갈라질 수 있다 — 그 어긋남은 「열면 비었는데 숫자만 붙은 종」으로만
 * 드러난다. 순수 함수 안에 두면 합치기·거르기·세기를 값 하나로 시험할 수 있다.
 *
 * 🔵 ⓑ 에는 **A/S 줄의 열쇠만** 온다(남의 줄은 포털이 제 손으로 걸러 `items`
 * 에서 빼고 `count` 도 줄여 보낸다). 그래서 합쳐 쓴다고 받은 줄이 두 번 빠질
 * 일은 없다 — 접두사가 달라 애초에 맞지 않는다.
 *
 * 🔴 **개수는 두 쪽이 다른 방식으로 센다.**
 *  - 자기 것: 「같은 대상은 한 번만」 센다(countNotificationTargets — 한 건에
 *    결재가 둘 걸려 있어도 1). 사이드바 배지와 같은 헬퍼라 둘이 갈릴 수 없다.
 *    🔴 세는 것은 **지운 줄이 빠진 뒤의 목록**이라(아래 `items`) 줄과 숫자가
 *    저절로 함께 줄어든다 — 따로 빼는 셈이 없다.
 *  - 받은 것: **포털이 센 값 그대로** 더한다. 세는 규칙이 시스템마다 달라서
 *    줄 수로 다시 세면 그 시스템의 종과 이 종이 다른 숫자를 말한다.
 *    다만 **지운 줄만큼은 뺀다** — 안 빼면 사라진 줄이 배지에 남는다. 저쪽의
 *    세는 규칙을 모르므로 「지운 줄 수」를 빼는 것이 할 수 있는 전부이고(한
 *    대상에 두 줄이 걸려 저쪽이 1로 셌다면 2가 빠질 수 있다), 0 아래로는
 *    내려가지 않게 막는다.
 */
export function selectVisibleNotifications(input: {
  items: readonly NotificationItem[];
  inbox: PortalNotificationInbox;
  /** 눌러 확인해 저장이 도는 중인 자기 줄. 🔴 **알림 id** 다(확인 기록의 키). */
  acknowledgedIds: ReadonlySet<string>;
  /** 이 화면에서 방금 지운 줄(종에 실린 열쇠 = `client_id:id`). */
  dismissedKeys: ReadonlySet<string>;
  /**
   * 포털에 등록된 이 시스템의 식별자. 🔴 자기 줄의 열쇠를 **만드는 쪽과 같은
   * 값**이어야 한다(종이 toNotificationBellItems 에 넘기는 그 값) — 어긋나면
   * 아무 오류 없이 「지워지지 않는 알림」만 남는다. 못 읽었으면 빈 문자열이고,
   * 그때는 양쪽 다 접두사 없는 예전 모양이라 여전히 맞는다.
   */
  clientId?: string;
}): {
  items: readonly NotificationItem[];
  inboxItems: readonly NotificationBellItem[];
  count: number;
} {
  const clientId = input.clientId ?? "";
  // ⓐ 와 ⓑ 를 한 Set 으로(위 머리말). 더할 것이 없으면 받은 Set 을 그대로 쓴다 —
  // 렌더마다 새 Set 을 만들지 않기 위해서다.
  const dismissedKeys =
    input.inbox.dismissed.length === 0
      ? input.dismissedKeys
      : new Set([...input.dismissedKeys, ...input.inbox.dismissed]);

  const hidden = input.acknowledgedIds.size === 0 && dismissedKeys.size === 0;
  const items = hidden
    ? input.items
    : input.items.filter(
        (item) =>
          // 🔴 확인 기록은 `id`, 지움은 **열쇠**다. 섞으면 둘 중 하나가 영영
          //    안 맞는다(위 머리말).
          !input.acknowledgedIds.has(item.id) &&
          !dismissedKeys.has(notificationBellKey(item.id, clientId))
      );
  const inboxItems =
    dismissedKeys.size === 0
      ? input.inbox.items
      : input.inbox.items.filter((row) => !dismissedKeys.has(row.key));

  const dismissedInboxCount = input.inbox.items.length - inboxItems.length;
  const count =
    countNotificationTargets(items.map((item) => item.targetKey)) +
    Math.max(0, input.inbox.count - dismissedInboxCount);

  return { items, inboxItems, count };
}

/**
 * 확인 저장을 뒤에서 시작한다 — 줄은 **먼저** 종에서 빼고(hide), 저장이 실패하면
 * 되돌린다(restore).
 *
 * 먼저 빼는 이유: 누르면 곧바로 다른 화면으로 옮겨 가는데, 서버가 준 목록은 저장이
 * 끝나고 다시 계산될 때까지 그 줄을 그대로 들고 있다. 기다렸다가 빼면 옮겨 간 화면의
 * 종에 방금 누른 줄이 잠깐 남는다. 저장이 성사되면 서버 액션이 종을 다시 계산하게
 * 하므로(revalidatePath) 그 뒤로는 서버가 준 목록에도 그 줄이 없다.
 *
 * 🔴 묶음 종으로 갈아끼운 뒤로는 **누른 줄이 눈에서 곧바로 사라지지는 않는다.**
 * 이동이 <a href> 라 브라우저가 곧장 다음 화면으로 넘어가기 때문이다(상태를 고쳐도
 * 그릴 틈이 없다). 그래도 이 갈래를 그대로 두는 이유는 두 가지다 — 확인 기록을
 * 적는 일 자체가 여기서 시작되고, 같은 화면에 머무는 경우(같은 주소를 다시 누르는
 * 등)에는 여전히 이 목록 거르기가 종과 배지를 맞춰 준다.
 *
 * 결과를 기다리지 않고 곧바로 돌아온다 — 이동을 붙잡지 않기 위해서다.
 */
export function acknowledgeInBackground(
  item: PickedNotification,
  acknowledge: AcknowledgeNotification,
  view: { hide: (id: string) => void; restore: (id: string) => void }
): void {
  view.hide(item.id);
  const restore = () => view.restore(item.id);
  let pending: Promise<{ ok: boolean }>;
  try {
    pending = acknowledge({ notificationKey: item.id });
  } catch {
    restore();
    return;
  }
  void Promise.resolve(pending).then((result) => {
    if (!result?.ok) restore();
  }, restore);
}

/** 창처럼 사건을 던질 수 있는 것. 시험에서는 진짜 EventTarget 을 넣는다. */
export type NotificationPanelAnnounceHost = { dispatchEvent(event: Event): boolean };

/**
 * 🔴 종을 여는 순간 "지금 다시 세라"고 알린다.
 *
 * 여기 그려지는 목록은 서버 렌더 때 한 번 계산돼 내려온 값이라, 그대로 두면
 * 마지막으로 센 뒤에 생긴 알림이 안 보인다. 종을 여는 것은 **사람이 지금 알림을
 * 보겠다는 행동**이므로 그 자리에서 한 번 다시 세게 한다.
 *
 * 실제로 다시 세는 일은 BrowserNotifications 가 한다 — 화면의 다른 가지에 있어
 * 이 state 가 닿지 않으므로 창 전체 신호로 잇는다(권한 신호와 같은 방법이고,
 * 이름은 도메인에 한 번만 적혀 있다). 그쪽은 이 신호를 **권한과 무관하게**
 * 듣는다: 브라우저 알림을 안 받는 사람도 종은 보기 때문이다.
 *
 * 🔴 **닫을 때는 불리지 않는다.** 그것을 가리는 일은 이제 묶음이 한다 — 묶음의
 * `onOpen` 은 펼쳐진 순간에만 불린다(접는 것은 다 봤다는 행동이라 서버를 두드릴
 * 이유가 없다). 여닫기를 연달아 해도 듣는 쪽의 최소 간격이 막는다.
 *
 * 🔴 묶음도 제 창 사건(BELL_OPENED_EVENT)을 같은 순간에 던지지만, **그것을 듣는
 * 코드는 A/S 에 없다.** 여기는 이미 있는 신호를 그대로 쓴다 — 듣는 쪽
 * (BrowserNotifications)을 고치지 않기 위해서다.
 */
export function announceNotificationPanelOpened(host: NotificationPanelAnnounceHost): void {
  try {
    host.dispatchEvent(new Event(NOTIFICATION_PANEL_OPENED_EVENT));
  } catch {
    // 신호를 못 보내도 지금 있는 목록은 그대로 보인다 — 다음 주기에 따라잡는다.
  }
}

/**
 * 펼친 칸 맨 아래 — 컴퓨터·폰 알림창을 쓸 수 있는지, 못 쓴다면 왜인지.
 *
 * 상태 → 문구/단추 판정은 도메인(notification-toast.ts)에 있고 여기는 그대로
 * 그린다. 그래서 정적 렌더로 상태마다 따로 검사할 수 있다.
 *
 * 아무 말도 안 하는 상태가 둘이다 — 이미 허락받았을 때(정상이라 할 말이 없다)와
 * 아직 브라우저에 물어보기 전(UNKNOWN, 서버 렌더)이다. 서버에서 그리지 않는
 * 것이 중요하다: 서버는 이 기기가 보안 접속인지 알 수 없어서, 미리 무언가를
 * 적어 두면 하이드레이션 뒤에 글자가 바뀐다.
 */
export function BrowserNotificationNotice({
  status,
  onAsk,
}: {
  status: BrowserNotificationStatus;
  onAsk: () => void;
}) {
  const notice = describeBrowserNotificationStatus(status);
  if (notice.message === null && !notice.canAsk) return null;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      {notice.canAsk ? (
        <>
          <button
            type="button"
            onClick={onAsk}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            알림 받기
          </button>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            새 알림이 생기면 컴퓨터·폰 알림창에 띄웁니다.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{notice.message}</p>
      )}
    </div>
  );
}

/**
 * 🔴 `시험 알림` — 왜 안 뜨는지 화면이 말해 주는 자리.
 *
 * 알림이 안 뜬다는 신고는 원인이 화면 밖에 있어서 코드로 좇기가 어렵다. 실제로
 * 여러 세션 동안 못 잡은 것이 하나 있었다 — 안드로이드 Chrome은 페이지에서
 * 직접 만드는 알림을 금지하고 `Illegal constructor`를 던지는데, 그것을 빈
 * catch가 삼켜서 폰에서는 아무 일도 안 일어나고 아무 흔적도 안 남았다.
 *
 * 이 단추가 그 침묵을 없앤다. 누르면 알림을 실제로 한 번 띄우고 **그 자리에**
 * 결과를 적는다 — 떴으면 어느 통로로 떴는지, 못 떴으면 왜 못 떴는지. 다음에
 * 같은 신고가 오면 코드를 뒤지지 말고 이것부터 눌러 보면 된다.
 *
 * 띄울 수 있는 상태(GRANTED)에서만 그린다. 허락도 안 받은 상태에서 그리면
 * "권한이 없습니다"만 반복해서 알려 주는 단추가 되는데, 그 안내는 이미 바로
 * 위 BrowserNotificationNotice가 하고 있다.
 *
 * 뜬 결과를 판정하는 말(문구)은 도메인이 정한다 — 여기는 받은 글자를 그릴 뿐이라
 * 정적 렌더로 검사할 수 있다.
 */
export function NotificationSelfTest({
  status,
  onTest,
  result,
}: {
  status: BrowserNotificationStatus;
  onTest: () => void;
  /** 방금 눌러 본 결과. 아직 안 눌렀으면 null. */
  result: string | null;
}) {
  if (status !== "GRANTED") return null;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <button
        type="button"
        onClick={onTest}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        시험 알림
      </button>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {result ?? "눌러 보면 이 기기에서 알림이 뜨는지, 안 뜨면 왜 안 뜨는지 여기에 적습니다."}
      </p>
    </div>
  );
}

/**
 * 🔴 **지금 보이는 것 전부 지우기** — 일괄 지우기의 자리.
 *
 * ── 왜 묶음에 일괄용 자리를 더하지 않았나 ───────────────────────────────
 * 묶음이 이미 `footer` 를 내주고 있고, 그 자리는 펼친 칸 **맨 아래에 붙어**
 * 있다(sticky — 목록이 길어도 따라온다). 단추 하나를 거기 넣으면 되는 일에
 * 묶음의 자리를 또 늘리면 일곱 사이트가 함께 지는 약속만 늘어난다.
 *
 * 🔴 **자리가 하나라 차례는 A/S 가 정한다.** 이것이 맨 위다 — 바로 위에 있는
 * 목록에 대한 단추이고, 아래 둘(권한 안내 · 시험 알림)은 이 기기의 설정에
 * 대한 것이라 성격이 다르다.
 *
 * 지울 수 있는 줄이 하나도 없으면 **아무것도 그리지 않는다** — 눌러도 아무
 * 일이 없는 단추를 남기지 않는다.
 */
export function NotificationDismissAll({
  count,
  onDismissAll,
}: {
  /** 지금 보이는 줄 가운데 **지울 수 있는** 것의 수. */
  count: number;
  onDismissAll?: () => void;
}) {
  if (!onDismissAll || count <= 0) return null;

  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <button
        type="button"
        onClick={onDismissAll}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        보이는 알림 지우기 {count}건
      </button>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        사내 시스템 전체의 종에서 사라집니다. 아직 끝나지 않은 일 자체는 그대로 남습니다.
      </p>
    </div>
  );
}

/**
 * 묶음 종의 `footer` 자리에 들어가는 A/S 의 것 — 위 셋을 **이 차례로** 묶는다.
 *
 * 아래 둘이 한꺼번에 보이는 상태는 없다(권한 안내는 아직 못 띄우는 상태에서,
 * 시험 단추는 띄울 수 있는 상태에서만 그린다). 그래도 한 조각으로 묶어 두는
 * 것은, 묶음이 내주는 자리가 **하나**이고 그 안의 차례를 여기서 정해야 하기
 * 때문이다.
 *
 * 🔴 지우기 쪽 둘은 **선택**이다. 안 넘기면 그 칸이 아예 없다 — 지울 곳을
 * 모르는 상태(로그인 시각을 못 받은 종)에서 단추만 서지 않게 한다.
 */
export function NotificationBellFooter({
  status,
  onAsk,
  onTest,
  selfTestResult,
  dismissableCount = 0,
  onDismissAll,
}: {
  status: BrowserNotificationStatus;
  onAsk: () => void;
  onTest: () => void;
  selfTestResult: string | null;
  dismissableCount?: number;
  onDismissAll?: () => void;
}) {
  return (
    <>
      <NotificationDismissAll count={dismissableCount} onDismissAll={onDismissAll} />
      <BrowserNotificationNotice status={status} onAsk={onAsk} />
      <NotificationSelfTest status={status} onTest={onTest} result={selfTestResult} />
    </>
  );
}

/**
 * 이 브라우저가 지금 알림을 띄울 수 있는가 — 서버 렌더와 어긋나지 않게 알아내는 방법.
 *
 * 렌더 중에 `Notification`을 직접 만지면 서버에서 터진다(이 파일은 클라이언트
 * 컴포넌트지만 서버에서 한 번 그려진다). useSyncExternalStore에 서버용
 * 스냅샷("모른다")과 브라우저용 스냅샷을 따로 주면, 서버·하이드레이션 때는
 * 모르는 것으로 그리고 그 뒤에 실제 값으로 한 번 맞춰진다 —
 * EditSectionActions.tsx가 클립보드 유무에 쓰는 그 방법 그대로다.
 *
 * 돌려주는 값이 문자열 하나라서 렌더마다 새 객체가 생기지 않는다(객체를
 * 돌려주면 참조가 매번 달라져 무한 렌더가 된다). 세 함수 모두 모듈 수준에 두어
 * 렌더마다 새로 만들지 않는다.
 */
const subscribeToNothing = () => () => {};

function readBrowserNotificationStatus(): BrowserNotificationStatus {
  if (typeof window === "undefined") return "UNKNOWN";
  const hasNotificationApi = typeof window.Notification !== "undefined";
  return resolveBrowserNotificationStatus({
    isSecureContext: window.isSecureContext === true,
    hasNotificationApi,
    permission: hasNotificationApi ? window.Notification.permission : null,
  });
}

const unknownOnServer = (): BrowserNotificationStatus => "UNKNOWN";

/** 알림이 하나도 없을 때 펼친 칸에 적는 말. 🔴 묶음은 기본값을 두지 않는다. */
const EMPTY_LABEL = "처리할 알림이 없습니다.";

/**
 * 지움을 **포털에 적는** 서버 액션 — dismissNotificationsAction
 * (server/actions/notification-dismissals.ts)과 같은 모양이다.
 *
 * 🔴 위 AcknowledgeNotification 과 같은 까닭으로 **받아서** 쓴다: 그 서버 액션
 * 파일은 `server-only` 사슬(세션·DB·포털)을 물고 있어서, 여기서 가져오면 이
 * 파일을 정적 렌더로 시험하는 NotificationBell.test.tsx 가 가져오는 순간 죽는다.
 * 넘겨 주는 일은 TopBar.tsx 가 한다.
 *
 * 🔴 **사람을 가리키는 칸이 없다.** 누구의 지움인지는 서버가 제 세션에서 다시
 * 읽는다 — 인자로 받으면 브라우저가 아무 번호나 실어 남의 알림을 지울 수 있다
 * (그 액션 머리말).
 *
 * 🔴 이 값이 없으면 **지우기 단추가 아예 그려지지 않는다.** 적을 곳을 모르는 채
 * 단추만 서면 눌러도 아무 일이 없다.
 */
export type DismissNotifications = (input: { keys: string[] }) => Promise<void>;

/**
 * 브라우저에 **남아 있던 옛 지움 기록**을 치울 곳.
 *
 * 🔴 **여기에 적지 않는다.** 2026-10-20부터 지움은 포털에 적히고
 * (domain/notification-dismissal.ts 머리말), 이 저장소에 남은 칸들은 영영
 * 안 쓰인다 — 한 번 치우고 끝이다.
 *
 * 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 이 속성을 **읽는 것만으로**
 * 던진다. 그래서 접근 자체를 try/catch 로 감싼다 — 여기서 던지면 머리말이, 곧
 * 모든 화면이 죽는다(BrowserNotifications 의 getSeenKeyStore 와 같은 처방).
 */
function getDismissalStore(): DismissalStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 아무것도 안 지운 상태. 🔴 **하나를 돌려쓴다** — 서버 렌더가 매번 같아야 한다. */
const NO_DISMISSALS: ReadonlySet<string> = new Set();

/**
 * 지운 줄들과, 지우는 함수.
 *
 * ── 🔴 기억하는 곳이 **둘**이고 역할이 다르다 ───────────────────────────
 *  ⓐ **이 화면 안(메모리)** — 누른 즉시 줄을 감추기 위한 것. 새로고침하면
 *     사라진다. 🔴 브라우저에 **적지 않는다**(2026-10-20 에 localStorage 를
 *     걷어냈다 — domain/notification-dismissal.ts 머리말).
 *  ⓑ **포털** — 진짜 기록. 어느 사내 시스템에서 지우든 모든 종에서 사라진다.
 *     돌아오는 길은 포털이 주는 `dismissed` 다(selectVisibleNotifications).
 *
 * 🔴 **치르는 값**: ⓑ 가 실패하면 그 줄은 새로고침했을 때 **다시 뜬다**(전에는
 * 브라우저에 남아 안 떴다). 그 편이 정직하다 — 안 적혔는데 여기서만 안 보이면
 * 같은 줄이 다른 시스템의 종에는 그대로 있다.
 *
 * 🔴 **결과를 기다리지 않는다.** 서버 액션은 어떤 일이 있어도 던지지 않지만
 * (그 파일 머리말), 부르는 자체가 망을 타므로 거절을 한 겹 더 받아 둔다 —
 * 삼키지 않으면 「처리되지 않은 거절」이 모든 화면의 머리말에서 터진다.
 *
 * ── 옛 기록 치우기 ──────────────────────────────────────────────────────
 * 브라우저에 쌓여 있던 옛 칸을 **한 번** 치운다(까닭은
 * domain/notification-dismissal.ts 의 purgeStoredDismissals). 저장소를 **고치는**
 * 일이라 그리는 동안이 아니라 붙은 뒤에 한다.
 */
function useDismissedNotifications(record: DismissNotifications | undefined) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(NO_DISMISSALS);

  useEffect(() => {
    purgeStoredDismissals(getDismissalStore());
  }, []);

  const dismiss = useCallback(
    (keys: readonly string[]) => {
      if (!record || keys.length === 0) return;

      // 🔴 **먼저 감춘다.** 포털의 답을 기다리면 ✕ 를 눌러도 한 박자 동안
      //    아무 일이 없고, 그 사이에 같은 줄을 또 누르게 된다.
      setDismissed((prev) => {
        const next = new Set(prev);
        for (const key of keys) next.add(key);
        return next;
      });

      try {
        // 🔵 열쇠가 몇 개든 **한 번만** 부른다 — 200개씩 나눠 보내는 일은 서버가
        //    한다(server/integration/portal-inbox.ts 의 DISMISSALS_PER_REQUEST).
        void Promise.resolve(record({ keys: [...keys] })).catch(() => {
          // 못 적었으면 새로고침했을 때 그 줄이 다시 뜬다(위 머리말).
        });
      } catch {
        // 부르는 것 자체가 터져도 감춘 것은 그대로 둔다 — 같은 까닭이다.
      }
    },
    [record]
  );

  // 적을 곳을 아는 종만 지울 수 있다 — 모르면 단추를 그리지 않는다.
  return { dismissed, dismiss, enabled: record !== undefined };
}

/**
 * 종의 **속** — 포털 목록을 이미 풀린 **값으로** 받아 그린다.
 *
 * 겉(아래 기본 내보내기)과 갈라 둔 까닭이 둘이다:
 *  1. 약속을 푸는 일과 그리는 일은 서로 다른 관심사다. 겉은 값이 도착하는 길만
 *     알고, 여기는 「자기 것 앞 · 받은 것 뒤 · 개수는 더한다」만 안다.
 *  2. 🔴 **시험이 그림을 볼 수 있다.** 정적 렌더(renderToStaticMarkup)는
 *     약속을 기다려 주지 않으므로, 겉만 있으면 「이어 붙인 목록」과 「더한
 *     배지」를 마크업으로 확인할 길이 없다.
 */
export function NotificationBellWithInbox({
  items = [],
  acknowledge,
  inbox = EMPTY_PORTAL_INBOX,
  dismiss: record,
  notificationClientId = "",
}: {
  items?: readonly NotificationItem[];
  /**
   * 확인 기록을 적는 서버 액션. 넘기지 않으면 눌러서 확인하는 줄도 이동만 하고
   * 종에서 빠지지 않는다(저장하지 않은 것을 뺀 것처럼 보이게 하지 않는다).
   */
  acknowledge?: AcknowledgeNotification;
  /** 포털이 모아 준 **다른 시스템들의** 알림. 아직 못 받았으면 빈 것이다. */
  inbox?: PortalNotificationInbox;
  /**
   * 지움을 **포털에 적는** 서버 액션(위 타입 주석). 안 넘기면 지우기 단추가
   * 아예 없는 예전 종이다 — 적을 곳을 모르는 채 ✕ 만 서면 눌러도 아무 일이 없다.
   */
  dismiss?: DismissNotifications;
  /**
   * 포털에 등록된 이 시스템의 식별자(`SSO_CLIENT_ID`). 🔴 자기 줄 열쇠의
   * **접두사**다(domain 의 notificationBellKey). 서버가 내려준다 — 이 조각은
   * 클라이언트라 환경변수를 읽을 수 없다.
   *
   * 🔴 **빈 문자열은 정상이다**: 설정을 못 읽은 서버(데모 모드 등)에서 물러서는
   * 자리이고, 그때는 접두사 없는 예전 모양으로 그려진다. 잃는 것은 제 줄 지움이
   * 포털과 안 통하는 것 하나뿐이다.
   */
  notificationClientId?: string;
}) {
  /**
   * 눌러서 확인했고 저장이 진행 중이거나 끝난 줄. 서버가 준 목록이 다시 계산되기
   * 전까지 여기 든 줄은 그리지도 세지도 않는다(acknowledgeInBackground 주석).
   * 저장이 실패하면 빠진다 — 그 줄이 다시 나타난다.
   */
  const [acknowledgedIds, setAcknowledgedIds] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * **지운** 줄들. 확인 기록(위)과 달리 A/S 의 표에는 한 줄도 적지 않는다 —
   * 적히는 곳은 포털이고(그래서 모든 사내 시스템의 종에서 사라진다), 여기 든
   * 것은 **누른 즉시 감추기 위한 이 화면의 기억**이다.
   */
  const { dismissed, dismiss, enabled: canDismissHere } = useDismissedNotifications(record);

  // 🔴 거르는 일과 세는 일은 **위 순수 함수 하나**가 한다 — 지운 줄은 눌러야
  //    생기는 상태라 정적 렌더로는 만들 수 없어서, 값으로 시험할 수 있어야 한다.
  const visible = selectVisibleNotifications({
    items,
    inbox,
    acknowledgedIds,
    dismissedKeys: dismissed,
    // 🔴 열쇠를 **만드는 쪽**(아래 toNotificationBellItems)과 같은 값이어야
    //    한다. 갈라지면 오류 없이 「지워지지 않는 알림」만 남는다.
    clientId: notificationClientId,
  });

  const detectedStatus = useSyncExternalStore(
    subscribeToNothing,
    readBrowserNotificationStatus,
    unknownOnServer
  );
  /**
   * 방금 물어보고 알게 된 답. 위 스냅샷에는 구독할 것이 없어서(권한이 바뀌었다고
   * 알려 주는 표준 신호가 모든 브라우저에 있지는 않다) 물어본 직후의 답만
   * 여기에 따로 담아 덮어쓴다.
   */
  const [statusAfterAsking, setStatusAfterAsking] = useState<BrowserNotificationStatus | null>(null);
  const notificationStatus = statusAfterAsking ?? detectedStatus;
  /** `시험 알림`을 눌러 본 결과. 아직 안 눌렀으면 null. */
  const [selfTestResult, setSelfTestResult] = useState<string | null>(null);

  // 🔴 종에 실제로 실리는 줄 — **자기 것 앞, 포털에서 온 것 뒤.** 지금 이
  //    시스템에서 일하는 사람의 할 일이 먼저 보여야 하고, 받은 목록은 다시
  //    섞지 않는다(포털이 정한 차례가 있다).
  const bellItems = [
    ...toNotificationBellItems(visible.items, notificationClientId),
    ...visible.inboxItems,
  ];
  // 일괄 지우기가 집는 것. 🔴 **지금 보이는 것 가운데 지울 수 있는 것만**이다
  // (가리는 규칙은 도메인 한 곳 — domain/notification-dismissal.ts).
  const dismissableKeys = canDismissHere ? dismissableNotificationKeys(bellItems) : [];

  function handleAcknowledge(item: PickedNotification) {
    if (!acknowledge) return;
    acknowledgeInBackground(item, acknowledge, {
      hide: (id) => setAcknowledgedIds((prev) => new Set(prev).add(id)),
      restore: (id) =>
        setAcknowledgedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
    });
  }

  /**
   * 🔴 권한은 **사람이 이 단추를 눌렀을 때만** 묻는다.
   *
   * 페이지가 열리자마자 예고 없이 물으면 대개 거절당하고, 한 번 거절하면
   * 브라우저 설정을 뒤져야 되돌릴 수 있다. 단추는 물어볼 수 있는 상태에서만
   * 그려지므로(describeBrowserNotificationStatus) 여기 닿는 것은 사람이 실제로
   * 누른 경우뿐이다.
   */
  async function handleAskForNotificationPermission() {
    try {
      await window.Notification.requestPermission();
    } catch {
      // 요청 자체가 조용히 막히는 브라우저가 있다. 아래에서 지금 상태를 다시
      // 읽어 화면에 반영한다 — 눌렀는데 아무 일도 없는 것처럼 보이지 않게.
    }

    const status = readBrowserNotificationStatus();
    setStatusAfterAsking(status);

    if (status === "GRANTED") {
      // 실제로 알림창을 띄우는 쪽(BrowserNotifications)은 화면의 다른 가지에
      // 있어서 이 state가 닿지 않는다. 알려 주지 않으면 방금 허락했는데도
      // 다음 주기(1분)까지 모른다.
      try {
        window.dispatchEvent(new Event(NOTIFICATION_PERMISSION_CHANGED_EVENT));
      } catch {
        // 신호를 못 보내도 저쪽이 다음 주기에 스스로 알아챈다.
      }
    }
  }

  /**
   * 🔴 알림을 실제로 한 번 띄워 보고 결과를 화면에 적는다.
   *
   * 실제로 띄우는 일은 BrowserNotifications.tsx가 한다 — 브라우저 알림 API를
   * 부르는 자리는 그 파일 하나라는 규칙을 여기서도 지킨다. 그쪽은 던지지 않고
   * **까닭을 돌려주므로**, 이 화면이 그것을 그대로 적을 수 있다.
   */
  async function handleNotificationSelfTest() {
    setSelfTestResult("알림을 띄우는 중…");
    const outcome = await showBrowserNotificationToast(buildNotificationSelfTestToast());
    setSelfTestResult(describeNotificationToastOutcome(outcome));
  }

  return (
    <SharedNotificationBell
      // 🔴 **자기 것 앞, 포털에서 온 것 뒤.** 지금 이 시스템에서 일하는 사람의
      //    할 일이 먼저 보여야 하고, 받은 목록은 **다시 섞지 않는다** — 포털이
      //    정한 차례가 있다(시스템 순서 · 그 안의 차례).
      items={bellItems}
      // 🔴 **세는 규칙은 묶음이 모른다** — 받은 숫자를 그대로 찍는다. 자기 것은
      //    옮겨 담기 전 원본에서 「같은 대상은 한 번만」 세고, 받은 것은 포털이
      //    센 값에서 지운 줄만큼만 뺀다(selectVisibleNotifications 주석).
      count={visible.count}
      // 🔴 `ml-auto shrink-0` 은 묶음 종에 **그대로** 건넨다. TopBar 에 래퍼를
      //    하나 더 두면 펼침 패널의 기준(position: relative)이 두 겹이 된다
      //    (TopBar.tsx 의 그 자리 주석). shrink-0 이 빠지면 좁은 폭에서 아이콘이
      //    깎여 손가락에 안 잡힌다 — 그 선은 service-menu-bar.test.ts 가 지킨다.
      className="ml-auto shrink-0"
      // 🔴 colorScheme 은 넘기지 않는다. 기본값 "host" 가 사이트를 따라가는데,
      //    A/S 의 다크는 <html class="dark"> 라 그것이 정확히 맞는 값이다.
      //
      // 🔴 알림이 0건이어도 종을 그린다 — 묶음의 기본값(그리지 않음)과 다르다.
      //    머리말의 아이콘 자리가 들쭉날쭉하면 안 되고, 아래 footer 는 알림이
      //    없을 때도 보여야 한다(권한 안내가 바로 그 자리다).
      showWhenEmpty
      emptyLabel={EMPTY_LABEL}
      onOpen={() => announceNotificationPanelOpened(window)}
      // 🔴 묶음은 **모든 줄에서** 이것을 부른다. 가리는 일은 A/S 가 한다 —
      //    눌러서 확인하는 종류인가(도메인 판정)와, 애초에 **우리 줄인가**
      //    (sourceId)를 그 함수 한 곳에서 본다.
      //
      // 🔴 한 번 누른 것이 **두 길로** 갈린다. 섞지 마라:
      //    자기 줄 → 확인 기록(서버 DB, 영구) · 포털 줄 → 지우기(이 브라우저).
      //    두 함수가 각자 「제 줄이 아니면 그냥 돌아간다」를 갖고 있어서, 어느
      //    줄을 눌러도 한쪽만 일한다(그 둘의 주석).
      onAcknowledge={(picked: NotificationBellItem) => {
        handleNotificationPicked(picked, {
          onAcknowledge: acknowledge ? handleAcknowledge : undefined,
        });
        handlePortalRowPicked(picked, {
          onDismiss: canDismissHere ? (key) => dismiss([key]) : undefined,
        });
      }}
      // 🔴 줄마다 서는 지우기 단추. 적을 곳을 아는 종에만 그려진다 —
      //    안 넘기면 묶음이 단추를 아예 그리지 않는다(그쪽 README 「지우기」).
      onDismiss={canDismissHere ? (picked: NotificationBellItem) => dismiss([picked.key]) : undefined}
      // 🔴 어느 줄에 단추를 그릴지. 가리는 규칙은 도메인 한 곳이다 — 이 화면은
      //    종류를 보지 않는다(파일 머리말).
      canDismiss={canDismissNotification}
      footer={
        <NotificationBellFooter
          status={notificationStatus}
          onAsk={() => void handleAskForNotificationPermission()}
          onTest={() => void handleNotificationSelfTest()}
          selfTestResult={selfTestResult}
          dismissableCount={dismissableKeys.length}
          onDismissAll={canDismissHere ? () => dismiss(dismissableKeys) : undefined}
        />
      }
    />
  );
}

/**
 * 🔴 서버에서 넘어온 **약속**을 푼다 — 기다리지 않는다.
 *
 * ── 왜 값이 아니라 약속으로 받나 ─────────────────────────────────────────
 * 포털에 묻는 일은 서버에서만 할 수 있다(자격이 client_secret 이다 —
 * server/integration/portal-inbox.ts). 그런데 그 왕복을 (app)/layout.tsx 가
 * `await` 하면 **모든 화면 이동이 그만큼 느려진다** — 머리말은 이 앱의 모든
 * 화면에 딸려 오기 때문이다. 그래서 레이아웃은 값이 아니라 약속을 내려보내고,
 * 이 갈래가 도착한 뒤에 목록을 이어 붙인다. 머리말 · 본문 · **A/S 자신의
 * 알림**은 예전과 똑같은 시점에 뜨고, 포털이 느리거나 죽어도 사람이 기다리는
 * 시간은 늘지 않는다.
 *
 * ── 🔴 왜 `use()` + `<Suspense>` 가 아닌가 ──────────────────────────────
 * 계측기 사이트는 그 길을 골랐다(njlee 의 PortalNotificationBell). 그 사이트에는
 * **자체 알림이 없어** 종이 통째로 늦게 떠도 잃는 것이 없다. A/S 는 다르다:
 *  1. `use()` 로 풀면 Suspense 경계가 `<SharedNotificationBell>` 을 감싸야
 *     하고(목록과 개수를 넘기는 자리가 거기 하나다), 그러면 **자기 알림도 함께
 *     늦어지거나**(fallback 이 빈 것일 때) 도착하는 순간 종이 **다시 만들어진다**
 *     (fallback 에 종을 둘 때 — 펼쳐 둔 패널이 눈앞에서 닫힌다. 여닫기는
 *     <details> 가 들고 있어 자리가 바뀌면 그대로 접힌다).
 *  2. `use()` 는 약속이 깨지면 **그것을 다시 던진다.** 그러면 error boundary 가
 *     없는 이 머리말에서 사이트 전체가 빈 화면이 된다. 여기서는 `.then` 의 두
 *     갈래를 다 받아 **깨져도 빈 것**으로 친다 — 그것이
 *     asPortalNotificationInbox 주석이 못 박은 계약이다.
 * 그래서 이 조각에는 Suspense 경계가 **없다.** 아무것도 지연(suspend)되지
 * 않으므로 둘 곳도 없다 — 머리말이 포털을 기다리지 않는다는 성질은 「경계를
 * 잘 두었다」가 아니라 **약속을 아예 붙잡지 않는다**에서 나온다.
 *
 * 값은 첫 렌더에서 빈 것이다(EMPTY_PORTAL_INBOX — 그 상수를 돌려쓰는 이유가
 * 이것이다: 렌더마다 새 객체면 참조가 매번 달라진다). 그래서 서버 렌더와
 * 하이드레이션 때의 그림이 같고, 포털 줄은 그 뒤에 한 번 더 그려져 들어온다.
 *
 * ── 다시 묻는 주기를 두지 않는다 ────────────────────────────────────────
 * 포털이 30초 캐시를 들고 있어 더 자주 물으면 **같은 답**을 받는다. 약속은
 * 레이아웃이 만든 것이라 화면을 옮겨 다니는 동안 그대로이고(레이아웃은 다시
 * 그려지지 않는다), 새로 열거나 서버가 종을 다시 계산할 때 새 약속이 온다.
 */
function usePortalNotificationInbox(
  portalInbox: Promise<unknown> | undefined
): PortalNotificationInbox {
  const [inbox, setInbox] = useState<PortalNotificationInbox>(EMPTY_PORTAL_INBOX);

  useEffect(() => {
    if (!portalInbox) return;
    // 늦게 도착한 답이 이미 떠난 화면에 setState 하지 않게 한다.
    let alive = true;
    // 🔴 **두 갈래를 다 받는다.** 두 번째 인자가 없으면 약속이 깨지는 순간
    //    「처리되지 않은 거절」이 되고, 개발 중에는 화면에 오류판이 뜬다.
    //    포털에 묻는 함수는 어떤 거절도 삼키므로 실제로 여기 오지 않지만,
    //    이 값은 모든 화면의 머리말에 실린다 — 두 겹으로 막는다.
    portalInbox.then(
      (value) => {
        if (alive) setInbox(asPortalNotificationInbox(value));
      },
      () => {
        if (alive) setInbox(EMPTY_PORTAL_INBOX);
      }
    );
    return () => {
      alive = false;
    };
  }, [portalInbox]);

  return inbox;
}

/**
 * 머리말이 그리는 종 — 겉. 약속을 푸는 일만 하고 그리는 일은 속에 맡긴다.
 *
 * 🔴 `portalInbox` 가 없는 것은 **정상**이다: 데모 모드(포털이 없다)와 포털
 * 계정에 이어지지 않은 계정((app)/layout.tsx 의 그 자리 주석)에서는 묻지 않고
 * 자기 알림만 그린다 — 예전과 완전히 같은 종이다.
 */
export default function NotificationBell({
  items = [],
  acknowledge,
  portalInbox,
  dismiss,
  notificationClientId = "",
}: {
  items?: readonly NotificationItem[];
  acknowledge?: AcknowledgeNotification;
  /**
   * 자기 줄 열쇠의 접두사 — 이 시스템의 `SSO_CLIENT_ID`(위 속 조각의 같은 이름
   * 주석). 🔴 서버가 내려준다. 없으면 접두사 없는 예전 모양이다.
   */
  notificationClientId?: string;
  /**
   * 지움을 포털에 적는 서버 액션(위 DismissNotifications). 🔴 없는 것은
   * **정상**이다 — 그때는 지우기 단추가 없는 예전 종 그대로다.
   */
  dismiss?: DismissNotifications;
  /**
   * 포털이 모아 준 다른 시스템들의 알림. 🔴 **서버에서 넘어오는 약속**이고
   * (값이 아니다) 풀린 값은 못 믿을 것으로 보고 한 겹 더 거른다
   * (asPortalNotificationInbox) — 그 안의 글자는 남의 시스템이 만든 것이다.
   */
  portalInbox?: Promise<unknown>;
}) {
  const inbox = usePortalNotificationInbox(portalInbox);
  return (
    <NotificationBellWithInbox
      items={items}
      acknowledge={acknowledge}
      inbox={inbox}
      dismiss={dismiss}
      notificationClientId={notificationClientId}
    />
  );
}
