import type { NotificationItem } from "./notifications";

/**
 * ============================================================================
 * 브라우저 알림 — 무엇을 띄울지 정하는 계산
 * ============================================================================
 * 화면이 열려 있는 동안 새 알림이 생기면 컴퓨터·폰의 알림창에 띄운다. 이 파일은
 * 그 **판단**만 한다 — `Notification`도, `localStorage`도 여기 들어오지 않는다.
 * 브라우저 API를 부르는 자리는 components/layout/BrowserNotifications.tsx
 * 하나뿐이고, 그래서 이 규칙들이 Node 단위 테스트로 그대로 돌아간다.
 *
 * ── 웹 푸시가 아니다 ────────────────────────────────────────────────────
 * 여기서 만드는 것은 "화면을 열어 둔 동안" 오는 알림이다. 앱을 닫아도 오는
 * 알림(웹 푸시)은 HTTPS와 인터넷과 바깥 푸시 서비스가 필요한데, 이 시스템은
 * 사내망에서 http로 접속하고 나중에 인터넷 없는 NAS에서 도는 것이 전제라
 * 그 갈래는 보류돼 있다 — `PushManager`도 VAPID 키도 이 저장소에 없다.
 *
 * `public/sw.js`는 그것과 **다른 것**이다. 안드로이드 Chrome이 페이지에서
 * 만드는 알림을 금지하기 때문에, 폰에서 알림을 띄우려면 서비스워커를 통로로
 * 써야만 한다. 그 파일은 알림을 띄우고 클릭을 받는 일만 하고 요청을 하나도
 * 가로채지 않는다(자세한 까닭은 그 파일의 머리 주석).
 *
 * ── 같은 알림이 반복해서 뜨지 않게 하는 방법 ────────────────────────────
 * 개수만 비교하면 안 된다 — 하나가 사라지고 하나가 생기면 개수가 같아서 못
 * 잡는다. 그렇다고 새로 그릴 때마다 다 띄우면 새로고침 한 번이 알림 폭탄이
 * 된다. 그래서 **직전 목록의 열쇠를 그 브라우저에 적어 두고 없던 것만** 띄운다.
 *
 * 적어 두는 것은 "지금 목록에 있는 것 전부"다 — 사라진 것은 기억에서도 지운다.
 * 그래야 재고를 채워 알림이 없어졌다가 다시 떨어졌을 때 **다시** 알릴 수 있다.
 * 그건 이미 알린 일이 아니라 다시 생긴 일이다.
 *
 * ── 열쇠는 targetKey가 아니라 id다 ──────────────────────────────────────
 * targetKey는 **배지 숫자를 세는 단위**다. 한 접수 건에 검수 승인과 출하 승인이
 * 둘 다 걸려 있어도 사람에게는 "그 한 건"이라 1로 세려고 일부러 굵게 잡은
 * 값이다(notifications.ts 주석). 세는 일에는 그게 맞지만 알리는 일에는 맞지
 * 않는다 — 그 단위로 기억하면, 검수 승인이 걸려 있는 동안 출하 승인이 새로
 * 붙어도 열쇠가 그대로라 아무 말도 하지 않는다. 결재는 둘이고 실제로 따로
 * 눌러야 한다.
 *
 * id는 반대로 "종 패널에 그려지는 한 줄"과 정확히 1:1이고 종류 이름이 앞에
 * 붙어 있어 종류가 다른 알림끼리 우연히 겹칠 수도 없다. 알림창에 뜨는 것도
 * 그 한 줄이므로, 띄웠는지 여부는 그 한 줄 단위로 기억하는 것이 맞다.
 *
 * 재고 부족의 id는 (품번, 소유자)라 수량이 15→14로 바뀌어도 그대로다 — 수량이
 * 흔들릴 때마다 다시 울리지 않는다는 뜻이고, 그것도 의도한 결과다.
 * ============================================================================
 */

/**
 * 이 브라우저가 이미 띄운 알림의 열쇠.
 *
 * `null`은 **적어 둔 것이 아직 없다**는 뜻이다(첫 방문, 사생활 보호 창, 저장소를
 * 비운 뒤, 다른 사람으로 로그인). 빈 배열과 뜻이 다르다 — 빈 배열은 "지난번에는
 * 알림이 0건이었다"이고, 그때 새 알림이 생기면 띄우는 것이 맞다.
 */
export type SeenNotificationKeys = readonly string[] | null;

export type NotificationToastDecision = {
  /** 지금 알림창에 띄울 것. 적어 둔 것이 없으면(첫 방문) 언제나 비어 있다. */
  toShow: readonly NotificationItem[];
  /** 다음 판정을 위해 적어 둘 열쇠 — 지금 목록에 있는 것 전부. */
  nextSeenKeys: readonly string[];
};

/**
 * 지금 목록에서 **새로 생긴 것**만 골라낸다.
 *
 * 첫 방문에 지금 있는 것을 전부 띄우면 그것이 곧 폭탄이다(종에 21건이 떠 있는
 * 상태로 처음 켜는 일이 실제로 있다). 그래서 적어 둔 것이 없으면 아무것도
 * 띄우지 않고 **지금 있는 것을 "이미 본 것"으로 적어 두기만** 한다. 알릴 것은
 * 그 뒤에 생기는 것부터다.
 */
export function decideNotificationToasts(
  items: readonly NotificationItem[],
  seenKeys: SeenNotificationKeys
): NotificationToastDecision {
  // 지금 목록에 있는 것이 곧 다음번의 기억이다. 여기 없는 열쇠는 함께 지워진다 —
  // 사라졌다가 다시 생긴 알림을 다시 알릴 수 있게 하는 것이 이 한 줄이다.
  const nextSeenKeys: string[] = [];
  const nextSeen = new Set<string>();
  for (const item of items) {
    if (nextSeen.has(item.id)) continue;
    nextSeen.add(item.id);
    nextSeenKeys.push(item.id);
  }

  if (seenKeys === null) return { toShow: [], nextSeenKeys };

  const alreadySeen = new Set(seenKeys);
  const shown = new Set<string>();
  const toShow: NotificationItem[] = [];
  for (const item of items) {
    if (alreadySeen.has(item.id) || shown.has(item.id)) continue;
    shown.add(item.id);
    toShow.push(item);
  }
  return { toShow, nextSeenKeys };
}

// ────────────────────────────────────────────────── 그 브라우저에 적어 두기

/**
 * `localStorage`처럼 생긴 것. 실물을 직접 부르지 않고 이 모양으로 받는 이유는
 * 두 가지다 — 시험에서 **터지는 저장소**를 그대로 흉내 낼 수 있고, 이 파일이
 * 브라우저 전역에 손대지 않아 Node에서 그대로 돈다.
 */
export type SeenKeyStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * 사람마다 갈라 적는다.
 *
 * 한 컴퓨터를 여럿이 나눠 쓰면(사무실 공용 PC) 앞사람이 본 알림을 뒷사람이
 * 못 받는다 — 뒷사람에게는 그것이 처음 보는 일이다. 로그인한 사람의 id를 열쇠에
 * 넣어 두면 사람이 바뀌는 순간 적어 둔 것이 없는 상태(=첫 방문)로 시작한다.
 *
 * 앞에 붙은 `v1`은 나중에 적어 두는 모양이 바뀌었을 때 옛 값을 잘못 읽지 않기
 * 위한 것이다 — 그때는 열쇠를 v2로 올리면 옛 값이 조용히 무시된다.
 */
export function notificationSeenStorageKey(userKey: string): string {
  return `dss.notifications.seen.v1.${userKey}`;
}

/**
 * 적어 둔 열쇠를 읽는다. **어떤 경우에도 던지지 않는다.**
 *
 * 사생활 보호 창이나 저장을 막아 둔 브라우저에서는 저장소에 손대는 것 자체가
 * 터진다. 그때 화면이 죽으면 알림 하나 때문에 시스템 전체를 못 쓰게 된다.
 * 읽지 못했으면 `null`(적어 둔 것이 없음)이고, 그러면 이번 판정은 첫 방문과
 * 똑같이 아무것도 띄우지 않는다 — 못 읽었을 때 폭탄이 되는 쪽으로 기울지
 * 않는다는 뜻이다. 저장된 값이 깨져 있을 때도 같다.
 */
export function readSeenNotificationKeys(
  store: SeenKeyStore | null,
  storageKey: string
): SeenNotificationKeys {
  if (!store) return null;
  try {
    const raw = store.getItem(storageKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((value): value is string => typeof value === "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 적어 둔다. 읽기와 같은 이유로 **어떤 경우에도 던지지 않는다**(저장 공간이 꽉 찬 경우 포함). */
export function writeSeenNotificationKeys(
  store: SeenKeyStore | null,
  storageKey: string,
  keys: readonly string[]
): void {
  if (!store) return;
  try {
    store.setItem(storageKey, JSON.stringify(keys));
  } catch {
    // 적어 두지 못했으면 다음번이 첫 방문처럼 보일 뿐이다 — 그래도 아무것도
    // 띄우지 않는 쪽이라 조용할지언정 시끄러워지지는 않는다.
  }
}

// ──────────────────────────────────────────── 이 브라우저가 띄울 수 있는가

/**
 * 지금 이 브라우저의 알림 상태. 화면은 이 값 하나만 보고 무엇을 그릴지 정한다.
 *
 * `UNKNOWN`은 서버 렌더와 하이드레이션 때의 값이다 — 렌더 중에 `Notification`을
 * 직접 만지면 서버에서 터지므로, 서버에서는 "모른다"로 그리고 브라우저에서 한 번
 * 맞춘다(EditSectionActions.tsx가 클립보드 유무에 쓰는 그 방법이다).
 */
export type BrowserNotificationStatus =
  /** 아직 브라우저에 물어보기 전. 서버 렌더·하이드레이션. */
  | "UNKNOWN"
  /** 보안 접속(HTTPS/localhost)이 아니라 브라우저가 아예 물어보지도 않는다. */
  | "INSECURE_CONTEXT"
  /** 보안 접속인데 이 브라우저에 알림 기능 자체가 없다. */
  | "UNSUPPORTED"
  /** 아직 묻지 않았다 — 사람이 단추를 누르면 그때 묻는다. */
  | "ASKABLE"
  /** 허락받았다. 띄울 수 있다. */
  | "GRANTED"
  /** 거절당했다. 다시 물어도 브라우저가 창을 띄우지 않는다 — 설정에서만 되돌린다. */
  | "DENIED";

/**
 * 브라우저에서 읽어 온 사실을 상태 하나로 접는다.
 *
 * ── 왜 보안 접속을 따로 보는가 ──────────────────────────────────────────
 * 브라우저 알림은 **보안 컨텍스트(HTTPS 또는 localhost)**를 요구한다. 이 시스템은
 * 사내망에서 `http://192.168.x.x:3000`으로 접속하므로 대개 그것이 아니고, 그런
 * 곳에서는 `Notification`이 아예 없거나 권한 요청이 조용히 실패한다.
 *
 * 그때 화면이 아무 말도 안 하면 "왜 내 폰에는 안 뜨지"가 되고 사람들은 고장으로
 * 여긴다. 그래서 **미리 단정하지 않고 실제로 확인해서** 말한다 — 몇몇 폰은
 * Chrome 설정에 예외를 걸어 두어 이 주소를 보안 컨텍스트로 취급하고, 그 기기에서는
 * 정말로 뜬다. "이 시스템은 http니까 안 된다"고 코드에 박아 두면 그 기기에서
 * 되는 기능을 안 된다고 거짓말하게 된다.
 */
export function resolveBrowserNotificationStatus(env: {
  isSecureContext: boolean;
  hasNotificationApi: boolean;
  /** `Notification.permission`. 기능이 없으면 null. */
  permission: "default" | "granted" | "denied" | null;
}): BrowserNotificationStatus {
  // 이미 허락받은 상태라면 그것이 곧 "된다"는 증거다 — 보안 컨텍스트 판정보다
  // 앞선다. 예외를 걸어 둔 기기에서 실제로 뜨고 있는데 안 된다고 적는 일을
  // 막는 순서다.
  if (env.hasNotificationApi && env.permission === "granted") return "GRANTED";
  if (!env.isSecureContext) return "INSECURE_CONTEXT";
  if (!env.hasNotificationApi) return "UNSUPPORTED";
  if (env.permission === "denied") return "DENIED";
  return "ASKABLE";
}

/**
 * 종 옆에서 `알림 받기`를 눌러 허락이 떨어졌을 때 창 전체에 알리는 신호.
 *
 * 종(NotificationBell)과 실제로 알림을 띄우는 쪽(BrowserNotifications)은 화면의
 * 서로 다른 가지에 있어서 한쪽의 state가 다른 쪽에 닿지 않는다. 이 신호가 없으면
 * 방금 허락했는데도 띄우는 쪽이 다음 주기(1분)까지 그것을 모른다. 이름을 두
 * 파일에 각각 적어 두면 한쪽만 고쳐졌을 때 조용히 끊기므로 여기 한 번만 적는다.
 */
export const NOTIFICATION_PERMISSION_CHANGED_EVENT = "dss:notification-permission-changed";

export type BrowserNotificationNotice = {
  /** 화면에 적을 안내. 할 말이 없으면 null이다. */
  message: string | null;
  /** `알림 받기` 단추를 그릴 것인가. */
  canAsk: boolean;
};

/**
 * 상태마다 사람에게 뭐라고 말할 것인가.
 *
 * 🔴 페이지가 열리자마자 권한을 묻지 않는다. 예고 없이 물으면 대개 거절당하고,
 * 한 번 거절하면(=DENIED) 사람이 브라우저 설정을 뒤져야 되돌릴 수 있다. 그래서
 * `ASKABLE`일 때만 단추를 그리고, 묻는 것은 그 단추를 눌렀을 때뿐이다.
 *
 * 이미 허락했으면 단추도 안내도 없다 — 아무 말이 없는 것이 정상 동작이다.
 */
export function describeBrowserNotificationStatus(
  status: BrowserNotificationStatus
): BrowserNotificationNotice {
  switch (status) {
    case "INSECURE_CONTEXT":
      return {
        message: "이 기기에서는 알림을 띄울 수 없습니다 — 보안 접속(HTTPS)이 아닙니다.",
        canAsk: false,
      };
    case "UNSUPPORTED":
      return { message: "이 브라우저에는 알림 기능이 없어 띄울 수 없습니다.", canAsk: false };
    case "DENIED":
      return {
        message: "알림이 차단돼 있습니다 — 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.",
        canAsk: false,
      };
    case "ASKABLE":
      return { message: null, canAsk: true };
    case "GRANTED":
    case "UNKNOWN":
      return { message: null, canAsk: false };
  }
}

// ──────────────────────────────────── 어느 통로로 알림창에 넘길 것인가

/**
 * 알림창을 띄우는 통로.
 *
 * ── 왜 통로가 둘인가 ────────────────────────────────────────────────────
 * 🔴 안드로이드 Chrome은 페이지에서 직접 만드는 알림을 **금지**한다.
 * `new Notification(...)`을 부르면 그 자리에서 던진다:
 *
 *     TypeError: Failed to construct 'Notification': Illegal constructor.
 *                Use ServiceWorkerRegistration.showNotification() instead.
 *
 * 그래서 폰에서는 서비스워커(`public/sw.js`)를 통로로 써야 하고, 서비스워커가
 * 없거나 등록에 실패한 곳에서는 종전대로 페이지에서 만든다. 데스크톱 Chrome·
 * Firefox·Edge는 둘 다 되므로 서비스워커 쪽을 쓴다 — 통로가 하나로 모이면
 * 클릭 처리도 한 군데(`sw.js`의 notificationclick)로 모인다.
 */
export type NotificationToastChannel =
  /** `registration.showNotification(...)`. 안드로이드에서 되는 유일한 길이다. */
  | "SERVICE_WORKER"
  /** `new Notification(...)`. 서비스워커가 없는 환경의 예비 통로. */
  | "PAGE"
  /** 둘 다 없다. 띄울 수 없다. */
  | "UNAVAILABLE";

/**
 * 지금 이 환경에서 어느 통로를 쓸 것인가.
 *
 * 입력은 **사실 두 개**뿐이고 브라우저 전역을 만지지 않는다 — 그래서 이 판정이
 * Node 시험으로 그대로 돈다. 실제로 `navigator.serviceWorker`를 두드리고
 * `window.Notification`이 있는지 보는 일은
 * components/layout/BrowserNotifications.tsx가 한다.
 */
export function resolveNotificationToastChannel(env: {
  /** `/sw.js` 등록에 성공했는가. 실패했거나 서비스워커가 없는 브라우저면 false. */
  hasServiceWorkerRegistration: boolean;
  /** `new Notification(...)`을 만들 수 있는가(있다는 뜻이지 되는 뜻은 아니다). */
  hasNotificationConstructor: boolean;
}): NotificationToastChannel {
  if (env.hasServiceWorkerRegistration) return "SERVICE_WORKER";
  if (env.hasNotificationConstructor) return "PAGE";
  return "UNAVAILABLE";
}

// ────────────────────────────────────────── 브라우저에 넘길 알림 한 건

/** 폰 알림창은 아이콘 자리가 비면 볼품이 없다. PWA 아이콘을 그대로 쓴다. */
export const NOTIFICATION_TOAST_ICON = "/icons/icon-192.png";

/**
 * 브라우저에 그대로 넘길 설정.
 *
 * DOM의 `NotificationOptions`를 쓰지 않고 이 모양을 따로 두는 이유가 둘이다 —
 * 이 파일이 브라우저 타입에 기대지 않아야 Node에서 돌고, `renotify`가 표준에는
 * 있는데 TypeScript의 `NotificationOptions`에는 아직 없어서 그 쪽 타입으로는
 * 이 값을 담을 수도 없다.
 */
export type NotificationToastOptions = {
  body: string;
  /**
   * 같은 알림이 두 번 만들어져도 알림창에 하나만 남게 하는 열쇠.
   *
   * 🔴 `renotify`는 `tag` 없이 주면 브라우저가 던진다. 둘은 반드시 함께 간다.
   */
  tag: string;
  /**
   * 🔴 같은 `tag`로 다시 와도 **다시 알린다**(소리/진동/팝업).
   *
   * 기본값은 false이고, 그때 브라우저는 같은 tag의 알림을 **조용히 대체**한다.
   * 재고 부족 알림의 id는 `PART_STOCK_BELOW_MINIMUM:{품번}:{소유자}`라 재고를
   * 채워 사라졌다가 다시 부족해져도 **똑같다** — 그래서 종에는 새로 뜨는데
   * 알림창에서는 아무 소리도 안 나는 일이 실제로 있었다. 이 한 줄이 그 처방이다.
   */
  renotify: true;
  icon: string;
  /**
   * 누르면 갈 곳.
   *
   * 서비스워커로 띄우면 클릭이 **페이지가 아니라 서비스워커에** 닿는다 —
   * 페이지의 `notification.onclick`은 불리지 않는다. 그래서 주소를 알림에
   * 실어 보내고 `sw.js`의 notificationclick이 그것을 연다.
   */
  data: { href: string };
};

export type NotificationToast = {
  title: string;
  options: NotificationToastOptions;
};

/**
 * 알림 한 건을 브라우저에 넘길 모양으로 접는다.
 *
 * 순수 함수라서 **브라우저 없이** 시험할 수 있다 — `renotify`가 켜져 있는지,
 * `tag`가 함께 있는지 같은 계약이 여기서 붙잡힌다. 실제로 넘기는 일만
 * BrowserNotifications.tsx가 한다.
 */
export function buildNotificationToast(input: {
  title: string;
  body: string;
  tag: string;
  href: string;
}): NotificationToast {
  return {
    title: input.title,
    options: {
      body: input.body,
      tag: input.tag,
      renotify: true,
      icon: NOTIFICATION_TOAST_ICON,
      data: { href: input.href },
    },
  };
}

/** 시험 알림의 `tag`. 늘 같은 값이라 두 번 눌러도 `renotify` 덕에 두 번 울린다. */
export const NOTIFICATION_SELF_TEST_TAG = "dss.notification.self-test";

/**
 * 종 패널의 `시험 알림` 단추가 띄우는 알림.
 *
 * 이 단추가 이번 작업의 **진단 장치**다. 다음에 또 "폰에 알림이 안 뜬다"가
 * 올라왔을 때 코드를 뒤지지 않고 이것을 눌러 보면 된다 — 뜨면 알림 통로는
 * 멀쩡하고 판정 쪽 문제이고, 안 뜨면 그 자리에 까닭이 적힌다.
 */
export function buildNotificationSelfTestToast(): NotificationToast {
  return buildNotificationToast({
    title: "시험 알림",
    body: "이 알림창이 보이면 이 기기에서 알림이 정상으로 뜹니다.",
    tag: NOTIFICATION_SELF_TEST_TAG,
    href: "/",
  });
}

// ──────────────────────────────────────────── 못 띄웠을 때 뭐라고 말할 것인가

/**
 * 알림창에 넘긴 결과.
 *
 * 🔴 실패를 **삼키지 않는다.** 이 문제가 몇 세션째 진단되지 않은 원인이 정확히
 * 그것이었다 — 안드로이드에서 던지는 `Illegal constructor`를 빈 catch가 조용히
 * 먹어 버려서, 폰에서는 아무 일도 안 일어나고 아무 흔적도 안 남았다.
 */
export type NotificationToastOutcome =
  | { ok: true; channel: "SERVICE_WORKER" | "PAGE" }
  | { ok: false; reason: string };

/** 통로가 아예 없을 때. */
export const NOTIFICATION_TOAST_UNAVAILABLE_REASON =
  "이 브라우저에서는 알림창을 띄울 수 없습니다 — 서비스워커도, 페이지에서 만드는 알림도 쓸 수 없습니다.";

function notificationToastErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  if (typeof error === "string" && error !== "") return error;
  try {
    const text = String(error);
    return text === "" ? "알 수 없는 까닭" : text;
  } catch {
    // 문자열로 바꾸는 것조차 던지는 값이 있다(toString이 깨진 객체).
    return "알 수 없는 까닭";
  }
}

/**
 * 브라우저가 던진 것을 **사람이 읽을 한 줄**로 바꾼다.
 *
 * 원문은 영어 한 줄짜리 예외 메시지라 사무실에서 그대로 보여 줘 봐야 "고장"으로
 * 읽힌다. 아는 까닭은 무엇을 해야 하는지까지 적고, 모르는 까닭은 원문을 그대로
 * 붙여 둔다 — 숨기는 것보다 낫다.
 */
export function describeNotificationToastFailure(error: unknown): string {
  const raw = notificationToastErrorMessage(error);

  // 🔴 안드로이드 Chrome. 페이지에서 `new Notification(...)`을 만들면 이것을
  // 던진다. 신고 ①("폰에서 알림이 안 뜬다")의 정체가 이 한 줄이었다.
  if (raw.includes("Illegal constructor")) {
    return "이 브라우저는 페이지에서 직접 알림을 못 만듭니다 — 서비스워커로 띄워야 합니다(안드로이드 Chrome). 서비스워커 등록이 안 된 상태입니다.";
  }
  // `renotify`를 `tag` 없이 준 경우. 지금 코드로는 날 수 없지만, 누가 tag를
  // 떼면 여기로 온다 — 그때 원문만 보면 무슨 말인지 알기 어렵다.
  if (raw.includes("renotify")) {
    return "알림 설정이 잘못됐습니다 — 다시 알리기(renotify)를 켰는데 태그가 비어 있습니다.";
  }
  if (/permission|not\s*allowed/i.test(raw)) {
    return "알림 권한이 없습니다 — 브라우저 설정에서 이 사이트의 알림을 허용해 주세요.";
  }
  return `알림창을 띄우지 못했습니다 — ${raw}`;
}

/**
 * 결과를 종 패널에 적을 한 줄로.
 *
 * 성공했을 때도 할 말이 있다. 브라우저는 "띄웠다"까지만 알고, 그 뒤에 기기의
 * 알림 설정(안드로이드의 앱 알림 스위치, 윈도우의 집중 지원/방해 금지)이
 * 가로막으면 **아무 오류 없이** 안 보인다. 그때 다음에 볼 곳을 함께 적어 둔다.
 */
export function describeNotificationToastOutcome(outcome: NotificationToastOutcome): string {
  if (!outcome.ok) return outcome.reason;

  const channel = outcome.channel === "SERVICE_WORKER" ? "서비스워커" : "페이지";
  return `알림을 띄웠습니다(${channel} 통로). 알림창이 보이지 않으면 기기의 알림 설정에서 이 브라우저의 알림이 꺼져 있거나 방해 금지가 켜져 있는지 확인해 주세요.`;
}

// ─────────────────────────────────────────────────────────────── 다시 세기

/**
 * 다시 세는 주기.
 *
 * 알림은 서버 렌더 때 **한 번** 계산되어 내려온다 — 새것을 알아채려면 다시
 * 세야 한다. 한 번 세는 데 여러 조회가 도므로 주기를 짧게 잡으면 그 값이 그대로
 * 서버 부담이 된다. 1분보다 짧게 하지 않는다.
 */
export const NOTIFICATION_REFRESH_INTERVAL_MS = 60_000;

export type NotificationRefreshEnvironment = {
  /** `document.visibilityState`. */
  visibilityState: string;
  /** `document.activeElement`의 태그 이름(대문자). 없으면 null. */
  focusedTagName: string | null;
  /** 그 요소가 contenteditable인가. */
  focusedIsContentEditable: boolean;
};

/**
 * 지금 다시 세도 되는가 — **화면을 보고 있는 동안**의 규칙.
 *
 * 🔴 숨은 화면은 이 문을 지나지 않는다. 최소화해 둔 창에도 새 알림이 뜨게 하려고
 * 숨은 상태의 주기(INTERVAL)를 따로 열어 두었고, 그 길은
 * shouldRefreshNotificationsNow가 낸다. 그러니 여기서 안 보이는 화면에 false를
 * 주는 것은 "아무것도 세지 않는다"가 아니라, **아래 규칙들이 보고 있는 사람을
 * 위한 것**이라 볼 사람이 없으면 물을 것도 없다는 뜻이다.
 *
 * ── 화면이 안 보이면 여기서는 쉰다 ──────────────────────────────────────
 * 사람이 보고 있다는 뜻의 계기(화면 복귀·종 열기)는 안 보이는 화면에서 돌 이유가
 * 없다. 그 둘을 여기서 한 번에 막는다.
 *
 * ── 글자를 치는 중이면 쉰다 ─────────────────────────────────────────────
 * 다시 세는 방법은 `router.refresh()`다 — 서버 구간을 다시 받아 화면을 다시
 * 그린다. 이 저장소의 화면들은 적어 두던 내용을 자기 state에 들고 있고 서버
 * 값과 합쳐 그리므로(예: 절차 편집기의 pending 초안) 다시 그려도 잃을 것이
 * 없지만, 한창 치는 중에 화면이 다시 그려지는 것 자체가 불쾌하고 한글 조합
 * 중이면 더 그렇다. 입력칸에 커서가 있는 동안은 건너뛰고 다음 주기를 기다린다 —
 * 손을 떼는 순간 따라잡는다.
 *
 * SELECT는 막지 않는다. 고른 값은 DOM이 들고 있어 다시 그려도 그대로고, 글자를
 * 치는 중이라는 뜻도 아니다.
 */
export function shouldRefreshNotifications(env: NotificationRefreshEnvironment): boolean {
  if (env.visibilityState !== "visible") return false;
  if (env.focusedIsContentEditable) return false;
  if (env.focusedTagName === "INPUT" || env.focusedTagName === "TEXTAREA") return false;
  return true;
}

// ──────────────────────────────────────── 주기를 기다리지 않고 즉시 다시 세기

/**
 * 무엇 때문에 다시 세는가.
 *
 * 1분 주기만으로는 폰에서 "새로고침을 해야만 알림이 바뀐다"가 된다. 다른 앱에
 * 나가 있는 동안은 화면이 안 보여 쉬고, 돌아와도 **다음 주기까지 최대 1분**을 더
 * 기다리기 때문이다. 그 사이에 사람이 보는 숫자는 낡은 값이다.
 *
 * 처방은 주기를 짧게 하는 것이 아니라(한 번 세는 데 조회가 여러 개 돈다)
 * **사람의 행동에 맞춰** 그 자리에서 한 번 더 세는 것이다.
 */
export type NotificationRefreshTrigger =
  /** 1분 주기가 돌아왔다. */
  | "INTERVAL"
  /** 다른 앱·다른 탭에 있다가 이 화면으로 돌아왔다. */
  | "VISIBLE"
  /** 사람이 종을 열었다 — 지금 알림을 보겠다는 뜻이다. */
  | "BELL_OPENED";

/**
 * 다시 센 지 이만큼 안 됐으면 건너뛴다 — **화면이 보이는 동안**의 값이다.
 * (안 보이는 동안은 NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS로 더 길게 잡는다.)
 *
 * 즉시 다시 세는 계기가 둘 늘었으므로(화면 복귀·종 열기) 이 값이 이번 변경의
 * **안전장치**다. 폰에서 앱을 빠르게 오가거나 종을 연달아 열고 닫는 것은 몇 초
 * 안에 일어나는 일이라, 그것을 그대로 서버에 흘리면 한 사람이 1분에 수십 번까지
 * 두드릴 수 있다.
 *
 * 10초로 잡은 까닭:
 * - **연타를 접기에 충분하다.** 앱을 오가거나 종을 여닫는 연속 동작은 대개 몇 초
 *   안에 끝난다. 그 묶음이 한 번으로 접힌다.
 * - **사람이 낡았다고 느낄 만큼 길지 않다.** 잠깐 다른 앱을 보고 오는 데 보통
 *   10초는 넘게 걸리고, 그런 복귀에는 언제나 새로 센 값이 나온다. 10초 안에 돌아온
 *   사람에게 건너뛴 값은 10초도 안 된 값이라 사실상 지금 값이다.
 * - **최악을 셀 수 있다.** 한 사람이 아무리 연타해도 1분에 6번을 넘지 못한다
 *   (60초 ÷ 10초). 주기 1번도 같은 문을 지나므로 그 6번 안에 든다.
 */
export const NOTIFICATION_REFRESH_MIN_GAP_MS = 10_000;

/**
 * 🔴 **화면이 안 보이는 동안**의 최소 간격 — 보이는 동안보다 길다.
 *
 * 숨은 탭에서도 주기가 돌게 되면서(최소화해 두어도 알림이 뜨게 하려는 것이 그
 * 변경이다) 새로 필요해진 안전장치다. 안 보는 탭을 열어 둔 채 퇴근하는 사람이
 * 사무실에 여럿이면 **아무도 안 보는 화면의 수만큼** 서버 부담이 는다. 우리 쪽에
 * 상한이 없으면 그 값을 셀 수조차 없다.
 *
 * 3분으로 잡은 까닭:
 * - **브라우저의 조임에 맞춰 세지 않는다.** Chrome은 숨은 탭의 타이머를 스스로
 *   1분에 한 번으로 조이고, 5분 넘게 숨어 있고 손을 안 대면 5분에 한 번까지
 *   조인다. 우리 값을 그 5분에 맞춰 버리면 두 주기가 서로 어긋나는 순간(간격이
 *   1ms 모자라는 순간)에 한 번을 통째로 건너뛰어 실제 지연이 10분으로 뛴다.
 *   브라우저가 조인 간격보다 **짧게** 잡아야 그쪽 박자가 늘 이 문을 통과한다.
 * - **최악을 셀 수 있다.** 스스로 조이지 않는 브라우저에서도 숨은 탭 하나가
 *   시간당 20번(3600초 ÷ 180초)을 넘지 못한다 — 보이는 탭의 주기(시간당 60번)의
 *   3분의 1이다.
 * - **사람이 기다릴 만하다.** 최소화해 둔 창에 새 알림이 늦어도 3분 안에 뜬다.
 *   Chrome에서는 어차피 브라우저가 조이는 만큼(대개 1~5분) 걸리므로, 이 값이
 *   체감을 더 늦추는 일은 거의 없다.
 */
export const NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS = 180_000;

/**
 * 지금 다시 세도 되는가 — 계기와 마지막으로 센 시각까지 함께 보고 정한다.
 *
 * 🔴 지금 시각을 **인자로 받는다.** 안에서 `Date.now()`를 부르면 이 판정을
 * 시험할 수 없다(이 파일이 브라우저 전역에도 시계에도 손대지 않는다는 규칙이
 * 그래서 있다).
 *
 * ── 종만 입력 여부를 묻지 않는다 ────────────────────────────────────────
 * 저절로 도는 것들(주기·화면 복귀)은 글자를 치는 중이면 쉰다 —
 * shouldRefreshNotifications 그대로다. 종은 다르다. **사람이 직접 누른 것**이고
 * 그 사람이 지금 보려는 것이 바로 그 목록이라, 여기서 건너뛰면 방금 연 패널이
 * 낡은 채로 남는다("새로고침을 해야만 바뀐다"가 되는 그 자리다).
 *
 * ── 🔴 화면이 안 보여도 주기는 돈다 ─────────────────────────────────────
 * 창을 최소화해 두어도 새 알림이 알림창에 떠야 한다. 알림창을 띄우는 것 자체는
 * 화면이 보이는지와 상관없고 — 숨은 탭에서도 잘 뜬다 — 막고 있던 것은 오직
 * "안 보이면 다시 세지 않는다"였다. 셀 것이 없으니 띄울 것도 없었던 것이다.
 *
 * 그래서 숨은 화면에서는 **주기(INTERVAL)만** 연다. 나머지 둘은 그대로 막는다:
 * 화면 복귀도 종 열기도 **사람이 화면을 보고 있다**는 뜻의 계기라, 안 보이는
 * 화면에서 도는 것 자체가 말이 안 된다.
 *
 * 🔴 숨어 있을 때는 「입력칸에 커서가 있으면 쉰다」를 **적용하지 않는다.** 그
 * 규칙의 까닭은 한창 글자를 치는 중에 화면이 다시 그려지면 불쾌하다는 것인데,
 * 창이 최소화돼 있으면 아무도 안 치고 있다. 그대로 두면 **검색칸에 커서를 둔 채
 * 최소화한 사람은 알림을 영영 못 받는다** — 커서는 최소화해도 그 자리에 남는다.
 *
 * 대신 숨어 있을 때의 최소 간격은 더 길다
 * (NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS). Chrome은 숨은 탭의 타이머를 알아서
 * 조이지만 모든 브라우저가 그러지는 않으므로, 아무도 안 보는 화면이 서버를 얼마나
 * 두드릴 수 있는지는 우리 쪽에서도 정해 두어야 한다.
 *
 * ── 마지막으로 센 적이 없으면 통과 ──────────────────────────────────────
 * `lastRefreshedAt`이 null이면 이 화면에서 아직 한 번도 다시 센 적이 없다는
 * 뜻이라 최소 간격이 걸릴 것이 없다.
 */
export function shouldRefreshNotificationsNow(input: {
  trigger: NotificationRefreshTrigger;
  env: NotificationRefreshEnvironment;
  /** 마지막으로 다시 센 시각. 아직 없으면 null. */
  lastRefreshedAt: number | null;
  /** 지금 시각(`Date.now()`). 부르는 쪽이 넘긴다. */
  now: number;
}): boolean {
  const hidden = input.env.visibilityState !== "visible";

  if (hidden) {
    // 사람이 보고 있다는 뜻의 계기는 안 보이는 화면에서 돌지 않는다.
    if (input.trigger !== "INTERVAL") return false;
    // 입력 여부는 묻지 않는다 — 최소화된 창에서는 아무도 글자를 치고 있지 않다.
  } else {
    const env =
      input.trigger === "BELL_OPENED"
        ? { ...input.env, focusedTagName: null, focusedIsContentEditable: false }
        : input.env;
    if (!shouldRefreshNotifications(env)) return false;
  }

  const minGapMs = hidden
    ? NOTIFICATION_REFRESH_HIDDEN_MIN_GAP_MS
    : NOTIFICATION_REFRESH_MIN_GAP_MS;

  if (input.lastRefreshedAt !== null) {
    const elapsed = input.now - input.lastRefreshedAt;
    // 시계가 뒤로 간 경우(음수)에는 막지 않는다. 막아 버리면 시계가 다시 따라잡을
    // 때까지 영영 안 세는 화면이 된다 — 사람이 시간을 고치거나 절전에서 깨어난
    // 기기에서 실제로 일어날 수 있는 일이다.
    if (elapsed >= 0 && elapsed < minGapMs) return false;
  }

  return true;
}

/**
 * 종을 열었으니 지금 다시 세라고 창 전체에 알리는 신호.
 *
 * 종(NotificationBell)과 다시 세는 쪽(BrowserNotifications)은 화면의 서로 다른
 * 가지에 있어 한쪽의 state가 다른 쪽에 닿지 않는다 —
 * NOTIFICATION_PERMISSION_CHANGED_EVENT와 똑같은 사정이고, 그래서 같은 방법을
 * 쓴다. 이름을 두 파일에 각각 적어 두면 한쪽만 고쳐졌을 때 조용히 끊기므로
 * 여기 한 번만 적는다.
 *
 * 🔴 이 신호는 **알림 권한과 무관하다.** 브라우저 알림을 안 받는 사람도 종은
 * 본다. 사람이 직접 누른 것이므로 서버를 한 번 두드릴 이유가 충분하다.
 */
export const NOTIFICATION_PANEL_OPENED_EVENT = "dss:notification-panel-opened";
