"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import type { NotificationItem } from "@/lib/domain/notifications";
import {
  NOTIFICATION_PANEL_OPENED_EVENT,
  NOTIFICATION_PERMISSION_CHANGED_EVENT,
  NOTIFICATION_REFRESH_INTERVAL_MS,
  NOTIFICATION_TOAST_UNAVAILABLE_REASON,
  buildNotificationToast,
  decideNotificationToasts,
  describeNotificationToastFailure,
  notificationSeenStorageKey,
  readSeenNotificationKeys,
  resolveNotificationToastChannel,
  shouldRefreshNotificationsNow,
  writeSeenNotificationKeys,
  type NotificationRefreshEnvironment,
  type NotificationRefreshTrigger,
  type NotificationToast,
  type NotificationToastOutcome,
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
 * ── 웹 푸시가 아니다 ────────────────────────────────────────────────────
 * 화면을 열어 둔 동안만 온다. 앱을 닫아도 오는 알림은 HTTPS·인터넷·바깥 푸시
 * 서비스가 필요한데 이 시스템은 사내망 http이고 나중에 인터넷 없는 NAS에서
 * 도는 것이 전제라 그 갈래는 보류돼 있다 — `PushManager`도 VAPID 키도 쓰지
 * 않는다.
 *
 * 서비스워커(`public/sw.js`)를 등록하는 것은 그것과 **다른 일**이다. 안드로이드
 * Chrome이 페이지에서 만드는 알림을 금지하기 때문에 폰에서는 서비스워커가
 * 알림을 띄우는 유일한 통로다. 그 파일은 요청을 하나도 가로채지 않는다.
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
 * 알림 한 건을 브라우저에 넘길 모양으로.
 *
 * 제목에 **종류 이름**을 붙인다 — 알림창에는 종 패널의 색이 따라가지 않으므로,
 * 무슨 알림인지 알려 주는 것은 글자뿐이다(NOTIFICATION_KIND_META 조회이지
 * 종류별 분기가 아니다).
 *
 * `tag`·`renotify`·아이콘·클릭 주소를 어떻게 채우는지는 도메인의
 * buildNotificationToast가 정한다 — 그래야 그 계약을 브라우저 없이 시험한다.
 */
function toastForItem(item: NotificationItem): NotificationToast {
  const meta = NOTIFICATION_KIND_META[item.kind];
  return buildNotificationToast({
    title: `${meta.label} · ${item.subject}`,
    body: item.detail,
    tag: item.id,
    href: item.href,
  });
}

// ────────────────────────────────────────────────────── 서비스워커 등록

/**
 * 등록은 한 번만 한다. 여러 곳에서 불러도 같은 약속을 돌려준다.
 *
 * 모듈 수준에 두는 이유: 이 컴포넌트가 다시 그려질 때마다 등록을 다시 부르면
 * 브라우저가 매번 `/sw.js`를 다시 확인한다. 종의 `시험 알림` 단추도 같은 통로를
 * 써야 하므로 컴포넌트 state가 아니라 모듈에 둔다.
 */
let serviceWorkerRegistration: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * 서비스워커 등록이 실패했다면 그 까닭.
 *
 * 🔴 실패를 삼키지 않기 위한 자리다. 등록이 안 되면 안드로이드에서는 알림이
 * 절대 안 뜨는데, 까닭을 안 남기면 화면에는 "안 뜬다"밖에 안 보인다 — 이 문제가
 * 몇 세션째 진단되지 않은 이유가 정확히 그런 침묵이었다.
 */
let serviceWorkerFailure: string | null = null;

/**
 * `/sw.js`를 등록한다. **어떤 경우에도 던지지 않는다.**
 *
 * 등록이 안 되는 브라우저·환경(보안 접속이 아닌 곳, 서비스워커를 끈 브라우저,
 * 사생활 보호 창)에서 여기서 던지면 알림 하나 때문에 시스템 전체를 못 쓰게
 * 된다. 못 하면 null이고, 그러면 페이지 통로로 넘어간다.
 *
 * `updateViaCache: "none"`은 브라우저가 캐시된 옛 `/sw.js`를 쓰지 않게 한다 —
 * 이것이 없으면 파일을 고쳐도 최대 24시간 동안 옛것이 살아 있을 수 있다.
 */
function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (serviceWorkerRegistration !== null) return serviceWorkerRegistration;

  serviceWorkerRegistration = (async () => {
    try {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        serviceWorkerFailure = "이 브라우저에는 서비스워커가 없습니다.";
        return null;
      }
      return await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    } catch (error) {
      serviceWorkerFailure = describeNotificationToastFailure(error);
      return null;
    }
  })();

  return serviceWorkerRegistration;
}

/** 실패 안내에 등록 실패 까닭을 덧붙인다 — 다음에 볼 곳이 하나 더 생긴다. */
function withServiceWorkerFailure(reason: string): string {
  return serviceWorkerFailure === null ? reason : `${reason} (서비스워커 등록 실패: ${serviceWorkerFailure})`;
}

/**
 * 알림창 하나를 띄운다. **여기가 브라우저 알림 API를 부르는 유일한 자리다.**
 *
 * 🔴 실패를 삼키지 않고 **까닭을 돌려준다.** 부르는 쪽이 화면에 적을 수 있어야
 * 한다 — 종의 `시험 알림` 단추가 그것으로 진단 장치가 된다. 던지지는 않는다:
 * 알림 하나 때문에 화면이 죽으면 안 된다는 규칙은 그대로다.
 *
 * 통로 선택은 도메인(resolveNotificationToastChannel)이 하고 여기는 고른 대로
 * 부르기만 한다.
 */
export async function showBrowserNotificationToast(
  toast: NotificationToast,
  /** 페이지 통로로 띄웠을 때 클릭 처리. 서비스워커 통로에서는 `sw.js`가 한다. */
  onOpen?: (href: string) => void
): Promise<NotificationToastOutcome> {
  const registration = await registerNotificationServiceWorker();
  const channel = resolveNotificationToastChannel({
    hasServiceWorkerRegistration: registration !== null,
    hasNotificationConstructor:
      typeof window !== "undefined" && typeof window.Notification !== "undefined",
  });

  if (channel === "UNAVAILABLE") {
    return { ok: false, reason: withServiceWorkerFailure(NOTIFICATION_TOAST_UNAVAILABLE_REASON) };
  }

  try {
    if (channel === "SERVICE_WORKER" && registration !== null) {
      // 클릭은 페이지가 아니라 sw.js의 notificationclick으로 간다 — 갈 주소는
      // toast.options.data.href에 실려 있다.
      await registration.showNotification(toast.title, toast.options);
      return { ok: true, channel };
    }

    const notification = new window.Notification(toast.title, toast.options);
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // 창을 앞으로 못 가져와도 이동은 그대로 한다.
      }
      notification.close();
      onOpen?.(toast.options.data.href);
    };
    return { ok: true, channel: "PAGE" };
  } catch (error) {
    return { ok: false, reason: withServiceWorkerFailure(describeNotificationToastFailure(error)) };
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
      void showBrowserNotificationToast(toastForItem(item), (href) => router.push(href)).then(
        (outcome) => {
          // 🔴 실패를 삼키지 않는다. 저절로 뜨는 알림에는 결과를 적을 화면이
          // 없으므로(이 컴포넌트는 아무것도 그리지 않는다) 콘솔에 남긴다 —
          // 폰을 USB로 연결해 원격 디버깅할 때 이 한 줄이 출발점이 된다.
          // 사람이 직접 확인하는 길은 종의 `시험 알림` 단추다.
          if (!outcome.ok) console.warn("[알림] 알림창을 띄우지 못했습니다:", outcome.reason);
        }
      );
    }
  }, [canNotify, items, userKey, router]);

  /**
   * 허락받았으면 서비스워커를 미리 등록해 둔다.
   *
   * 🔴 안드로이드 Chrome은 페이지에서 만드는 알림을 금지하므로, 등록이 없으면
   * 폰에서는 무엇을 해도 안 뜬다. 알림을 띄우는 순간에도 등록을 기다리지만
   * (showBrowserNotificationToast가 await 한다) 그때 처음 등록하면 첫 알림이
   * 등록 시간만큼 늦는다.
   *
   * 허락받기 전에는 등록하지 않는다 — 알림을 안 쓰는 사람의 브라우저에 서비스
   * 워커를 심어 둘 이유가 없다. 실패해도 조용히 넘어간다.
   */
  useEffect(() => {
    if (!canNotify) return;
    void registerNotificationServiceWorker();
  }, [canNotify]);

  /**
   * 다시 센 시각. 최소 간격을 재는 기준이다.
   *
   * state가 아니라 ref인 이유: 이 값이 바뀌었다고 화면이 달라질 것이 없고(이
   * 컴포넌트는 아무것도 그리지 않는다), state로 두면 다시 셀 때마다 아래 효과들이
   * 전부 다시 붙어 1분 주기 타이머가 그때마다 처음부터 다시 시작한다.
   */
  const lastRefreshedAtRef = useRef<number | null>(null);

  /**
   * 다시 세기.
   *
   * 알림은 서버 렌더 때 한 번 계산되어 내려온다 — 새것을 알아채려면 서버 구간을
   * 다시 받아야 하고, 그것이 router.refresh()다. 되돌아온 목록이 위 효과의
   * items로 들어가 판정이 한 번 더 돈다.
   *
   * 지금 세도 되는지는 도메인(shouldRefreshNotificationsNow)이 정한다 — 화면이
   * 안 보일 때 어느 계기까지 여는지도, 글자를 치는 중일 때 쉬는 규칙도, 연달아
   * 두드리지 않게 하는 최소 간격(보이는 동안과 안 보이는 동안이 다르다)도 거기
   * 있다. 여기는 계기와 시각을 넘기고 결과대로 부르기만 한다.
   */
  const refreshNotifications = useCallback(
    (trigger: NotificationRefreshTrigger) => {
      const now = Date.now();
      const allowed = shouldRefreshNotificationsNow({
        trigger,
        env: readRefreshEnvironment(),
        lastRefreshedAt: lastRefreshedAtRef.current,
        now,
      });
      if (!allowed) return;

      lastRefreshedAtRef.current = now;
      router.refresh();
    },
    [router]
  );

  /**
   * 1분 주기.
   *
   * 허락받은 사람에게만 돈다. 한 번 세는 데 조회가 여러 개 도므로, 알림을 받지
   * 않는 사람의 화면에서까지 1분마다 서버를 두드릴 이유가 없다.
   *
   * 🔴 이 타이머는 **창을 최소화해 두어도 계속 돈다.** 그래야 안 보는 동안 생긴
   * 알림이 알림창에 뜬다 — 띄우는 것 자체는 화면이 보이는지와 상관없다. 다만
   * 브라우저가 숨은 탭의 타이머를 스스로 조이고(Chrome은 1분에 한 번, 5분 넘게
   * 숨어 있으면 5분에 한 번까지), 우리 쪽 최소 간격도 그동안은 더 길다. 그래서
   * 최소화 상태의 알림은 즉시가 아니라 **몇 분 안에** 오는 것이 정상이다.
   * 무엇을 열고 무엇을 막을지는 전부 shouldRefreshNotificationsNow가 정한다.
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
      refreshNotifications("INTERVAL");
    }, NOTIFICATION_REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [canNotify, refreshNotifications]);

  /**
   * 🔴 화면으로 돌아오는 순간 즉시 한 번.
   *
   * 폰은 다른 앱으로 수시로 나갔다 들어온다. 나가 있는 동안은 주기가 느슨하게만
   * 돌고(숨은 상태의 최소 간격이 더 길다 + 브라우저가 타이머를 조인다), 이 효과가
   * 없으면 **돌아와도 다음 주기까지 최대 1분** 낡은 값을 본다 — "새로고침을 해야만
   * 알림이 바뀐다"는 신고의 정체가 그 1분이다. 주기를 짧게 하는 대신 돌아온 그
   * 순간에 한 번 센다.
   *
   * 주기와 같은 이유로 허락받은 사람에게만 붙인다(저절로 도는 갱신을 원하는
   * 사람이다). 연달아 오가도 최소 간격이 막는다.
   */
  useEffect(() => {
    if (!canNotify) return;

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (!isNotificationGranted()) {
        // 나가 있는 동안 브라우저 설정에서 차단당했을 수 있다. 주기 쪽과 같은 처리.
        setCanNotify(false);
        return;
      }
      refreshNotifications("VISIBLE");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [canNotify, refreshNotifications]);

  /**
   * 🔴 종을 여는 순간 즉시 한 번 — **알림 권한과 무관하게** 듣는다.
   *
   * 브라우저 알림을 안 받는 사람도 종은 본다. 오히려 그 사람에게는 종이 새것을
   * 아는 유일한 창구다. 사람이 직접 누른 것이므로 서버를 한 번 두드릴 이유가
   * 충분하고, 연타는 최소 간격이 막는다.
   *
   * 🔴 그래서 이 효과에 canNotify 조건을 달면 안 된다. 그 조건이 붙는 순간 알림을
   * 안 받는 사람의 종은 다시 "새로고침해야 바뀌는" 종으로 되돌아간다.
   *
   * 신호 이름은 도메인에 한 번만 적혀 있다(NOTIFICATION_PANEL_OPENED_EVENT).
   */
  useEffect(() => {
    function handlePanelOpened() {
      refreshNotifications("BELL_OPENED");
    }

    window.addEventListener(NOTIFICATION_PANEL_OPENED_EVENT, handlePanelOpened);
    return () => window.removeEventListener(NOTIFICATION_PANEL_OPENED_EVENT, handlePanelOpened);
  }, [refreshNotifications]);

  return null;
}
