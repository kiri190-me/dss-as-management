/**
 * ============================================================================
 * 저장 팝업 — 저장·등록이 끝났다고 잠깐 알리고 목록으로 넘긴다
 * ============================================================================
 * 2026-09-15 사용자 요청: 「입력값 등록 및 저장 후에 실행됐다는 알림이 뜨고,
 * 목록 창으로 넘어가도록」. 알림은 화면 가운데 팝업이고, 0.5초쯤 떴다가
 * 저절로 목록으로 넘어간다.
 *
 * 이 파일은 **판단**만 한다 — 창 이벤트도, 라우터도 여기 들어오지 않는다.
 * 팝업을 그리고 넘기는 자리는 components/common/SavePopup.tsx 하나뿐이다
 * (notification-toast.ts 와 같은 나눔이고, 그래서 이 규칙들이 Node 시험으로 돈다).
 *
 * ── 누가 넘기는가 ───────────────────────────────────────────────────────
 * 저장한 폼이 아니라 **팝업이** 넘긴다. 폼은 `showSavePopup` 을 한 번 부르고
 * 끝난다. 폼이 0.5초를 직접 기다렸다가 router.push 하면, 그 사이에 폼이
 * 사라지거나(대화상자가 닫힘) 두 번 눌리는 경우를 폼마다 따로 막아야 한다.
 * 팝업은 앱 틀((app)/layout.tsx)에 붙어 있어 화면이 바뀌어도 살아 있고,
 * 떠 있는 동안 모달이라 뒤 화면을 누를 수 없다.
 * ============================================================================
 */

/** 폼이 팝업을 부르는 신호. 이름을 두 파일에 따로 적으면 한쪽만 고쳐졌을 때 조용히 끊기므로 여기 한 번만 적는다. */
export const SAVE_POPUP_EVENT = "dss:save-popup";

/** 팝업이 떠 있는 시간. 사용자가 「0.5초쯤」으로 정했다(2026-09-15). 읽기에 너무 짧으면 여기만 고친다. */
export const SAVE_POPUP_VISIBLE_MS = 500;

/**
 * 넘기기 시작한 뒤 목록이 그려질 때까지 팝업을 붙들어 두는 한도.
 *
 * 0.5초 뒤에 넘기기 시작해도 목록 화면이 서버에서 오는 데는 시간이 걸린다.
 * 그 사이에 팝업이 먼저 사라지면 저장 전 화면이 그대로 보여 「안 됐나?」가
 * 된다. 그래서 도착할 때까지 붙들되, 어떤 까닭으로 도착하지 못해도 팝업이
 * 화면을 영영 막지 않도록 한도를 둔다.
 */
export const SAVE_POPUP_NAVIGATION_TIMEOUT_MS = 5_000;

export type SavePopupRequest = {
  /** 팝업에 적을 한 줄. 예: "고객사를 등록했습니다." */
  message: string;
  /** 0.5초 뒤 넘어갈 목록 주소. null 이면 팝업만 띄우고 그 자리에 머문다. */
  redirectTo: string | null;
};

/**
 * 받은 요청을 믿을 수 있는 모양으로 다듬는다. 쓸 수 없으면 null.
 *
 * 넘어갈 주소는 **이 앱 안의 경로**만 받는다 — `/` 로 시작하고 `//` 로 시작하지
 * 않으며 역슬래시가 없는 것(브라우저는 `/\` 를 `//` 로 읽는다). 지금 부르는
 * 쪽은 전부 코드에 박힌 주소지만, 나중에 누가 되돌아갈 주소를 URL 에서 받아
 * 그대로 넘기면 바깥 사이트로 튀는 길이 된다.
 *
 * 주소가 이상하면 넘기지 않고 **팝업만** 띄운다 — 저장은 이미 끝났으므로
 * 끝났다는 알림까지 버리지는 않는다.
 */
export function normalizeSavePopupRequest(value: unknown): SavePopupRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const { message, redirectTo } = value as Record<string, unknown>;
  if (typeof message !== "string" || message.trim() === "") return null;
  return {
    message: message.trim(),
    redirectTo: isInternalPath(redirectTo) ? redirectTo : null,
  };
}

function isInternalPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  );
}

/** 주소에서 경로만 남긴다 — `?…` 와 `#…` 를 뗀다. */
export function savePopupTargetPathname(redirectTo: string): string {
  const cut = redirectTo.search(/[?#]/);
  return cut === -1 ? redirectTo : redirectTo.slice(0, cut);
}

/**
 * 지금 화면이 이미 넘어갈 곳인가. 끝의 `/` 하나는 같은 곳으로 본다.
 *
 * 이미 그 화면이면 경로가 바뀌지 않아 「도착했다」를 알아챌 길이 없다 —
 * 그때 팝업은 넘기자마자 닫는다(SavePopup.tsx).
 */
export function isAlreadyAtSavePopupTarget(currentPathname: string, redirectTo: string): boolean {
  return trimTrailingSlash(currentPathname) === trimTrailingSlash(savePopupTargetPathname(redirectTo));
}

function trimTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
