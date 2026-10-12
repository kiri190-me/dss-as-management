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

/**
 * 🔴 **진행 중** 팝업의 신호 (2026-10-12). 위와 **다른 이름**이라, `showSavePopup` 을 부르던
 * 화면들은 이 길이 생겨도 한 글자도 달라지지 않는다(save-popup-screens.test.ts 가 못 박는다).
 */
export const SAVE_POPUP_PROGRESS_EVENT = "dss:save-popup-progress";

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

/**
 * ============================================================================
 * 🔴 진행 중 팝업 — 끝났다는 신호를 기다린다 (2026-10-12)
 * ============================================================================
 * 사용자 요구: 「[저장] → 팝업 "저장된 엑셀을 PDF 로 바꾸는 중입니다…"(안 닫힌다) →
 * 끝나면 같은 팝업이 "완료되었습니다"로 바뀌고 → 0.5초 뒤 목록으로」.
 *
 * 평범한 저장 팝업과 **다른 점은 하나**다 — 🔴 **저절로 닫히지 않는다.** 엑셀 → PDF 변환은
 * 10초까지 걸리는데(quote-save-pdf-convert.ts) 팝업이 0.5초 만에 사라지면 사람은 끝난 줄
 * 안다. 그래서 진행 중 팝업은 신호를 **기다린다**:
 *
 *  · `start`  — 띄운다. 🔴 0.5초 시계를 **걸지 않는다**(savePopupCountsDownToLeave).
 *  · `finish` — **같은 팝업**의 글자를 바꾸고, **그때부터** 0.5초를 세어 넘긴다.
 *               넘어갈 곳은 `start` 가 준 것을 그대로 쓴다 — 끝났을 때 주소를 다시 받으면
 *               그 한 번을 또 걸러야 하고, 어차피 떠날 곳은 띄울 때 이미 정해져 있다.
 *  · `cancel` — 닫는다. 🔴 **아무 데도 가지 않는다.** 실패는 사람이 읽어야 하는 알림이라
 *               0.5초 팝업으로 전할 수 없다 — 부르는 화면이 제 자리에 적는다(이 저장소가
 *               이미 그렇게 나눠 쓴다: NoticePopup.tsx 머리말).
 *
 * 🔴 `finish` · `cancel` 은 **진행 중 팝업에만** 닿는다. 떠 있는 것이 평범한 저장 팝업이거나
 * 아무것도 없으면 아무 일도 일어나지 않는다 — 늦게 온 신호가 남의 팝업을 닫지 않게.
 * ============================================================================
 */

/** 진행 중 팝업에 보내는 신호 한 장. */
export type SavePopupProgressSignal =
  /** 띄운다. 넘어갈 곳은 여기서 정해져 끝까지 그대로다. */
  | { phase: "start"; message: string; redirectTo: string | null }
  /** 끝났다 — 글자를 이것으로 바꾸고 그때부터 0.5초를 센다. */
  | { phase: "finish"; message: string }
  /** 그만둔다 — 닫고 아무 데도 가지 않는다. */
  | { phase: "cancel" };

/** 떠 있는 팝업 한 장이 들고 있는 것. */
export type SavePopupProgressState = {
  message: string;
  redirectTo: string | null;
  /** 🔴 끝났다는 신호를 기다리는 중인가. 참인 동안은 0.5초 시계를 걸지 않는다. */
  awaitingFinish: boolean;
};

/**
 * 받은 신호를 믿을 수 있는 모양으로 다듬는다. 쓸 수 없으면 null.
 *
 * `start` 의 문구 · 주소는 **평범한 저장 팝업과 같은 자**로 잰다(normalizeSavePopupRequest) —
 * 앱 밖으로 튀는 주소를 거르는 규칙이 두 벌이 되면 한쪽만 고쳐진다.
 */
export function normalizeSavePopupProgressSignal(value: unknown): SavePopupProgressSignal | null {
  if (typeof value !== "object" || value === null) return null;
  const { phase, message } = value as Record<string, unknown>;
  if (phase === "cancel") return { phase: "cancel" };
  if (phase === "start") {
    const request = normalizeSavePopupRequest(value);
    return request === null ? null : { phase: "start", message: request.message, redirectTo: request.redirectTo };
  }
  if (phase === "finish") {
    if (typeof message !== "string" || message.trim() === "") return null;
    return { phase: "finish", message: message.trim() };
  }
  return null;
}

/**
 * 신호 하나를 받아 **다음 팝업**을 낸다. 돌려주는 값이 셋이라는 것이 이 함수의 전부다:
 *
 *  · 팝업       — 그것을 띄운다(글자만 바뀌었으면 **같은 팝업**의 글자만 바뀐다)
 *  · `null`     — 닫는다
 *  · `undefined`— 🔴 **아무것도 하지 않는다**(닫지도 않는다) — 진행 중이 아닌데 온 신호다
 */
export function nextSavePopupOnProgress(
  current: SavePopupProgressState | null,
  signal: SavePopupProgressSignal
): SavePopupProgressState | null | undefined {
  // 띄우는 것은 떠 있던 것과 무관하다 — showSavePopup 도 늘 새로 띄운다.
  if (signal.phase === "start") {
    return { message: signal.message, redirectTo: signal.redirectTo, awaitingFinish: true };
  }
  // 🔴 끝남 · 그만둠은 **기다리는 팝업**에만 닿는다.
  if (current === null || !current.awaitingFinish) return undefined;
  if (signal.phase === "cancel") return null;
  return { message: signal.message, redirectTo: current.redirectTo, awaitingFinish: false };
}

/**
 * 🔴 지금 **0.5초를 세어도 되는가.**
 *
 * 기다리는 중(`awaitingFinish`)이면 세지 않는다 — 그래서 진행 중 팝업은 **뜨자마자 사라지지
 * 않는다.** 팝업이 즉시 닫히는 결함은 이 저장소에서 실제로 겪은 일이라 값으로 못 박는다.
 * 이미 넘기기 시작했으면(`navigating`) 다시 셀 일이 없다.
 *
 * 평범한 저장 팝업은 `awaitingFinish` 가 거짓이라 지금까지와 똑같이 0.5초를 센다.
 */
export function savePopupCountsDownToLeave(popup: { awaitingFinish: boolean; navigating: boolean }): boolean {
  return !popup.awaitingFinish && !popup.navigating;
}
