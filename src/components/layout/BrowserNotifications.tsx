"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import type { NotificationItem } from "@/lib/domain/notifications";
import {
  NOTIFICATION_PERMISSION_CHANGED_EVENT,
  NOTIFICATION_REFRESH_INTERVAL_MS,
  decideNotificationToasts,
  notificationSeenStorageKey,
  readSeenNotificationKeys,
  shouldRefreshNotifications,
  writeSeenNotificationKeys,
  type NotificationRefreshEnvironment,
  type SeenKeyStore,
} from "@/lib/domain/notification-toast";

/**
 * ============================================================================
 * 새 알림을 컴퓨터·폰 알림창에 띄운다
 * ============================================================================
 * 화면을 하나도 그리지 않는다(return null). 브라우저 API를 부르는 자리는 이
 * 파일 하나뿐이고, **무엇을 띄울지 정하는 판단은 전부**
 * lib/domain/notification-toast.ts에 있다 — 그래야 그 규칙들을 브라우저 없이
 * 시험할 수 있다.
 *
 * ── 왜 종(NotificationBell) 안이 아닌가 ─────────────────────────────────
 * 이미 띄운 알림은 **로그인한 사람마다 갈라** 적어 둬야 한다(한 컴퓨터를 여럿이
 * 쓰면 앞사람이 본 것을 뒷사람이 못 받는다). 종에는 사용자 id가 없고, 종까지
 * 내려보내려면 AppShell과 TopBar가 쓰지도 않을 값을 날라야 한다. 여기는
 * (app)/layout.tsx가 알림 목록을 만드는 바로 그 자리라서 id를 곧장 받는다.
 *
 * 대신 **권한을 묻는 단추는 종 옆에 있다** — 권한은 브라우저 하나에 하나뿐이라
 * 사람마다 가를 것이 없고, 물어볼 자리는 사람이 알림을 보고 있는 곳이어야 한다.
 * 종에서 허락이 떨어지면 그 사실이 NOTIFICATION_PERMISSION_CHANGED_EVENT로
 * 여기 닿는다.
 *
 * ── 서비스워커·웹 푸시가 아니다 ─────────────────────────────────────────
 * 화면을 열어 둔 동안만 온다. 앱을 닫아도 오는 알림은 HTTPS·인터넷·바깥 푸시
 * 서비스가 필요한데 이 시스템은 사내망 http이고 나중에 인터넷 없는 NAS에서
 * 도는 것이 전제라 그 갈래는 보류돼 있다.
 * ============================================================================
 */

/**
 * 알림을 띄울 수 있는가. `Notification`이 아예 없는 기기(보안 접속이 아닌
 * 사내망 접속이 대개 그렇다)에서도 던지지 않고 false를 돌려준다.
 */
function isNotificationGranted(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.Notification !== "undefined" &&
      window.Notification.permission === "granted"
    );
  } catch {
    return false;
  }
}

/**
 * 이미 띄운 알림을 적어 둘 곳.
 *
 * 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 이 속성을 **읽는 것만으로**
 * 던진다. 그래서 접근 자체를 try/catch로 감싼다 — 저장을 못 하는 것은 알림이
 * 좀 덜 오는 일이지만, 여기서 던지면 화면 전체가 죽는다.
 */
function getSeenKeyStore(): SeenKeyStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readRefreshEnvironment(): NotificationRefreshEnvironment {
  const active = document.activeElement;
  return {
    visibilityState: document.visibilityState,
    focusedTagName: active === null ? null : active.tagName,
    focusedIsContentEditable: active instanceof HTMLElement && active.isContentEditable,
  };
}

/**
 * 알림창 하나를 띄운다.
 *
 * 제목에 **종류 이름**을 붙인다 — 알림창에는 종 패널의 색이 따라가지 않으므로,
 * 무슨 알림인지 알려 주는 것은 글자뿐이다(NOTIFICATION_KIND_META 조회이지
 * 종류별 분기가 아니다).
 *
 * `tag`에 알림의 id를 넣으면 같은 알림이 어떤 이유로 두 번 만들어져도 알림창에는
 * 하나만 남는다(브라우저가 같은 tag를 덮어쓴다).
 */
function showBrowserNotification(item: NotificationItem, onOpen: (href: string) => void) {
  try {
    const meta = NOTIFICATION_KIND_META[item.kind];
    const notification = new window.Notification(`${meta.label} · ${item.subject}`, {
      body: item.detail,
      tag: item.id,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // 창을 앞으로 못 가져와도 이동은 그대로 한다.
      }
      notification.close();
      onOpen(item.href);
    };
  } catch {
    // 알림창을 못 띄워도 종은 그대로다. 여기서 던지면 화면 전체가 죽는다.
  }
}

export default function BrowserNotifications({
  /** 로그인한 사람. 이미 띄운 알림을 이 값으로 갈라 적는다. */
  userKey,
  items = [],
}: {
  userKey: string;
  items?: readonly NotificationItem[];
}) {
  const router = useRouter();
  const [canNotify, setCanNotify] = useState(false);

  // 권한은 브라우저에만 있는 값이라 렌더 중에 읽지 않는다. 이 컴포넌트는 아무것도
  // 그리지 않으므로 서버 렌더와 어긋날 것이 애초에 없고, 마운트 뒤에 한 번 읽어
  // 두면 된다. 그 뒤로는 종에서 허락이 떨어졌다는 신호가 올 때 다시 읽는다.
  useEffect(() => {
    function syncPermission() {
      setCanNotify(isNotificationGranted());
    }
    syncPermission();
    window.addEventListener(NOTIFICATION_PERMISSION_CHANGED_EVENT, syncPermission);
    return () => window.removeEventListener(NOTIFICATION_PERMISSION_CHANGED_EVENT, syncPermission);
  }, []);

  /**
   * 새로 생긴 것만 띄운다.
   *
   * 허락받기 전에는 아무것도 하지 않는다 — 적어 두지도 않는다. 그래서 허락이
   * 떨어진 직후 이 효과가 처음 돌 때는 적어 둔 것이 없는 상태(첫 방문)가 되고,
   * 지금 쌓여 있는 것은 전부 "이미 본 것"으로 조용히 기록된다. 종에 21건이 떠
   * 있는데 허락하자마자 21개가 한꺼번에 뜨는 일이 그래서 일어나지 않는다.
   */
  useEffect(() => {
    if (!canNotify) return;

    const store = getSeenKeyStore();
    const storageKey = notificationSeenStorageKey(userKey);
    const { toShow, nextSeenKeys } = decideNotificationToasts(
      items,
      readSeenNotificationKeys(store, storageKey)
    );
    writeSeenNotificationKeys(store, storageKey, nextSeenKeys);

    for (const item of toShow) {
      showBrowserNotification(item, (href) => router.push(href));
    }
  }, [canNotify, items, userKey, router]);

  /**
   * 다시 세기.
   *
   * 알림은 서버 렌더 때 한 번 계산되어 내려온다 — 새것을 알아채려면 서버 구간을
   * 다시 받아야 하고, 그것이 router.refresh()다. 되돌아온 목록이 위 효과의
   * items로 들어가 판정이 한 번 더 돈다.
   *
   * 허락받은 사람에게만 돈다. 한 번 세는 데 조회가 여러 개 도므로, 알림을 받지
   * 않는 사람의 화면에서까지 1분마다 서버를 두드릴 이유가 없다. 화면이 안 보일
   * 때와 글자를 치는 중일 때 쉬는 규칙은 shouldRefreshNotifications에 있다.
   */
  useEffect(() => {
    if (!canNotify) return;

    const timer = setInterval(() => {
      if (!isNotificationGranted()) {
        // 브라우저 설정에서 도중에 차단됐다. 띄우지도 못하면서 서버만 두드리는
        // 상태가 되지 않게 여기서 멈춘다.
        setCanNotify(false);
        return;
      }
      if (!shouldRefreshNotifications(readRefreshEnvironment())) return;
      router.refresh();
    }, NOTIFICATION_REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [canNotify, router]);

  return null;
}
