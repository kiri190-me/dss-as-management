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
 * ── 서비스워커·웹 푸시가 아니다 ─────────────────────────────────────────
 * 여기서 만드는 것은 "화면을 열어 둔 동안" 오는 알림이다. 앱을 닫아도 오는
 * 알림(웹 푸시)은 HTTPS와 인터넷과 바깥 푸시 서비스가 필요한데, 이 시스템은
 * 사내망에서 http로 접속하고 나중에 인터넷 없는 NAS에서 도는 것이 전제라
 * 그 갈래는 보류돼 있다. `public/`에 서비스워커가 없는 이유가 그것이다.
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
 * 지금 다시 세도 되는가.
 *
 * ── 화면이 안 보이면 쉰다 ───────────────────────────────────────────────
 * 탭을 열어만 두고 안 보는 동안 서버를 계속 두드릴 이유가 없다. 다시 보게 되면
 * 다음 주기에 저절로 재개된다.
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
