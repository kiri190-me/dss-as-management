import { copyText } from "@/components/common/copy-text";
import { buildQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * 편집 화면의 [폴더 열기] — 폴더 위치를 묻고, 도우미 주소를 열고, 없으면 설치 명령을 쥐여 준다 (견적서 ④b·④c)
 * ============================================================================
 * 브라우저는 탐색기를 직접 열 수 없다. 그래서 PC 마다 한 번 설치하는 도우미가
 * `dss-folder://open/?p=…` 주소를 받아 공유폴더 루트 아래의 폴더만 연다(④a — 보안의 핵심은
 * 도우미 쪽이다: server/quote-folder-helper.ts). 이 파일은 그 앞의 순서 하나다.
 *
 *  1) GET /api/quotes/{id}/archive-folder — 결과별 문장(꺼짐 · 폴더 없음 · 실패 · 요청 실패)
 *  2) found → buildQuoteFolderLink(상대 경로)로 주소를 만들어 **페이지를 떠나지 않고** 연다
 *  3) 약 2초(QUOTE_FOLDER_HELPER_DETECTION_MS) 안에 창이 초점을 잃으면(blur · visibilitychange)
 *     도우미가 있는 것으로 보고 이 브라우저에 「도우미 확인됨」 표시를 적는다
 *  4) 아무 일이 없고 표시도 없으면 — 도우미가 없는 것으로 보고 [설치 명령 복사]로 이끈다
 *
 * ── 🔴 화면은 설치 파일을 주지 않는다 (사용자 결정 2026-09-16) ──────────────
 * 설치 파일(.cmd)은 Windows 스마트 앱 컨트롤이 막는다 — [속성] › [차단 해제]를 거쳐야만 열리는데,
 * 그 단계를 사람에게 시키느니 **PowerShell 에 붙여넣는 길 하나로 모으는 편이 낫다**는 판단이다
 * (붙여넣기는 실기 확인을 마쳤다). 그래서 이 파일에는 설치 파일을 받거나 저장하는 코드가 **없다.**
 * 서버 통로(`GET /api/quote-folder-helper/installer`)는 살아 있지만 **화면이 부르지 않는다**
 * (quote-folder-open-screens.test.ts 가 못 박는다).
 *
 * ── 왜 숨은 iframe 인가 ──────────────────────────────────────────────────
 * `location.assign` · `<a>` 클릭은 페이지 자체가 그 주소로 가려고 한다. 도우미가 없는 PC 에서
 * 브라우저에 따라 오류 페이지로 넘어가거나 떠나기 확인이 끼어들 수 있다 — 편집 화면에는 저장하지
 * 않은 변경이 있을 수 있다. 숨은 iframe 이 주소를 받으면 무슨 일이 나도 그 틀 안에서 끝난다.
 *
 * ── 도우미 감지의 한계 ──────────────────────────────────────────────────
 * 브라우저는 「이 주소를 받을 프로그램이 있는가」를 알려 주지 않는다. 초점을 잃는 것은 탐색기가
 * 앞에 뜨거나 브라우저가 「dss-folder 를 열까요?」를 물을 때다 — 둘 다 도우미가 있다는 뜻이다.
 * 틀릴 수 있는 경우(탐색기가 브라우저 뒤에 뜸 · 서버가 늦어 브라우저가 사용자 동작으로 보지 않음
 * · 모르는 주소에도 창을 띄우는 브라우저)가 있어, 초점을 잃은 뒤에도 두 단추를 함께 내민다.
 *
 * ── 🔴 [폴더 열기] 알림에는 루트 값을 싣지 않는다 ─────────────────────────
 * 응답의 알려진 칸(상대 경로 · 여럿 여부 · 사유 · 전체 주소)만 읽는다. [폴더 열기] 알림에
 * 들어가는 것은 **상대 경로와 서버의 짧은 문장뿐**이고, 부르는 통로도 둘(archive-folder ·
 * install-command)뿐이다.
 *
 * ── 파일 없이 가는 두 길 (④c) ────────────────────────────────────────────
 *  · [위치 복사] — 전체 공유폴더 주소(`uncPath`)를 클립보드로. 사람이 탐색기 주소창에 붙여넣으면
 *    **도우미 없이도** 폴더가 열린다. `uncPath` 는 서버 설정이 있을 때만 응답에 붙는다
 *    (없으면 통째로 빠진다) — 그래서 outcome 의 `uncPath` 도 있을 때만 붙고, 단추도 그때만 낸다.
 *  · [설치 명령 복사] — GET /api/quote-folder-helper/install-command 의 한 줄을 클립보드로.
 *    PowerShell 창에 붙여넣으면 설치된다(관리자 권한 없이).
 * 🔴 설치 명령 본문은 **어디에도 싣지 않는다** — 알림 줄에도, 콘솔에도. 사내 공유폴더 주소가
 * base64 로 들어 있고, 길이도 약 10,300자라 화면에 보여 긁게 하는 것은 비현실적이다. 전체 주소는
 * 짧으므로 복사가 막혔을 때만 화면에 보인다.
 *
 * ── 복사가 두 갈래인 까닭 ────────────────────────────────────────────────
 * 운영 서버는 사내 NAS 에 http 로 올라간다 — `navigator.clipboard` 가 없다. 공용 모듈
 * (components/common/copy-text.ts)이 옛 방식까지 두 갈래를 다 본다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────────
 * fetch · 주소 열기 · 창 이벤트 · 시계 · 저장소(localStorage) · 복사를 부르는 쪽이 바꿔 끼울 수
 * 있다 — 네트워크 · DOM 없이 시험한다(quote-folder-open.test.ts). localStorage 는 막혀 있거나
 * 던질 수 있다(사생활 보호 창 · 정책) — 그때는 표시가 없는 것으로 보고 그대로 돈다.
 * ============================================================================
 */

type FolderResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/** 부르는 쪽이 바꿔 끼울 수 있는 fetch(GET) — 쓰는 것만 적었다. */
export type QuoteFolderFetch = (url: string) => Promise<FolderResponse>;

/** 「도우미 확인됨」 표시를 두는 곳 — localStorage 에서 쓰는 두 가지만. */
export type QuoteFolderHelperStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type QuoteFolderOpenEnvironment = {
  fetchImpl: QuoteFolderFetch;
  /** 도우미 주소를 페이지를 떠나지 않고 연다. 기본은 숨은 iframe. */
  openLink: (link: string) => void;
  /** 창이 초점을 잃으면 onLost 를 부른다. 돌려준 함수로 그만 듣는다. */
  watchFocusLoss: (onLost: () => void) => () => void;
  delay: (ms: number) => Promise<void>;
  /** 저장소를 꺼내는 일 자체가 던질 수 있다(localStorage 접근이 막힌 브라우저). */
  storage: () => QuoteFolderHelperStorage | null;
};

/** 주소를 연 뒤 초점을 잃기를 기다리는 시간. */
export const QUOTE_FOLDER_HELPER_DETECTION_MS = 2000;

/** 이 브라우저에서 도우미가 한 번이라도 반응했다는 표시. 값은 "1". */
export const QUOTE_FOLDER_HELPER_CONFIRMED_KEY = "dss.quoteFolderHelper.confirmed";

/** 파일 없이 붙여넣는 설치 명령 한 줄 — `{ command }` (④c). */
export const QUOTE_FOLDER_HELPER_INSTALL_COMMAND_URL = "/api/quote-folder-helper/install-command";

/** 복사 갈래 — 기본은 공용 copyText(두 갈래). 던지지 않고 true · false 만 돌려준다. */
export type QuoteFolderCopy = (text: string) => Promise<boolean>;

export function quoteArchiveFolderUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/archive-folder`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const QUOTE_FOLDER_DISABLED_TEXT = "공유폴더 저장이 꺼져 있습니다";
export const QUOTE_FOLDER_NOT_FOUND_TEXT =
  "아직 공유폴더에 이 견적서의 폴더가 없습니다 — [견적서 받기]를 먼저 눌러 주세요";
export const QUOTE_FOLDER_MULTIPLE_TEXT = "맞는 폴더가 여럿이라 이름순 첫째를 엽니다 — 폴더를 확인해 주세요";

/**
 * 🔴 반응도 표시도 없을 때 — 도우미가 없는 것으로 본다. 설치 파일을 주지 않고
 * [설치 명령 복사]로 이끈다(사용자 결정 2026-09-16). 관리자 권한을 쓰라고 하지 않는다 —
 * 도우미는 지금 로그인한 사람(HKCU)에게만 설치되므로 관리자 계정으로 돌리면 엉뚱한 계정에
 * 조용히 설치된다.
 */
export const QUOTE_FOLDER_HELPER_MISSING_TEXT =
  "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — [설치 명령 복사]를 눌러 PowerShell 창에 붙여넣어 주세요. 관리자 권한은 필요 없습니다";

// ── ④c 복사 두 갈래의 문장 ───────────────────────────────────────────────

/** [위치 복사] — 됐을 때. */
export const QUOTE_FOLDER_UNC_PATH_COPIED_TEXT =
  "폴더 위치를 복사했습니다 — 탐색기 주소창에 붙여넣고 Enter 를 눌러 주세요";

/** 🔴 두 갈래 다 막혔을 때 — 주소는 짧으니 다음 줄에 보여 긁어 가게 한다. */
export const QUOTE_FOLDER_UNC_PATH_COPY_BLOCKED_TEXT =
  "이 브라우저에서는 자동 복사가 막혀 있습니다 — 아래 주소를 직접 긁어 복사해 주세요";

/** [설치 명령 복사] — 됐을 때. */
export const QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPIED_TEXT =
  "설치 명령을 복사했습니다 — PowerShell 창을 열어 붙여넣고 Enter 를 눌러 주세요. 관리자 권한은 필요 없습니다";

/**
 * 🔴 두 갈래 다 막혔을 때 — 명령은 약 10,300자라 화면에 보여 긁게 할 수 없다. 남은 길은
 * 복사가 되는 브라우저로 옮기거나, 도우미 없이 [위치 복사]로 여는 것뿐이다.
 */
export const QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPY_BLOCKED_TEXT =
  "이 브라우저에서는 자동 복사가 막혀 있습니다 — 설치 명령은 너무 길어 화면에 보여 드릴 수 없습니다. 다른 브라우저에서 다시 시도하시거나, 관리자에게 설치를 부탁해 주세요";

/** 통로가 실패했을 때 함께 내미는 줄 — 사람이 혼자 풀 수 없는 종류다(설정 · 권한). */
export const QUOTE_FOLDER_HELPER_INSTALL_COMMAND_ADMIN_HINT_TEXT = "문제가 이어지면 관리자에게 알려 주세요";

function openingText(relativePath: string): string {
  return `탐색기로 폴더를 엽니다: ${relativePath}`;
}

function attemptedText(relativePath: string): string {
  return `열려던 폴더: ${relativePath}`;
}

function folderFailureText(reason: string): string {
  return `폴더를 열지 못했습니다 — ${reason}`;
}

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";
const UNOPENABLE_LINK_REASON = "이 폴더 이름은 도우미 주소로 만들 수 없습니다. 공유폴더에서 직접 열어 주세요";
const OPEN_LINK_FAILED_REASON = "브라우저가 폴더 열기 주소를 열지 못했습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 실패 응답 `{ error, code }` 의 문장 — 🔴 409(공유폴더 주소 설정 없음)도 서버 문장 그대로다. */
async function failureReason(response: FolderResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

// ── 1) 폴더 위치 ─────────────────────────────────────────────────────────

type ArchiveFolderAnswer =
  /** 🔴 `uncPath`(전체 공유폴더 주소)는 서버 설정이 있을 때만 붙는다 — 없으면 칸이 통째로 없다. */
  | { status: "found"; relativePath: string; multipleFolderMatches: boolean; uncPath?: string }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 알림까지 오지 않는다. 모양이 다르면 null. */
function readArchiveFolderAnswer(payload: unknown): ArchiveFolderAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      if (typeof payload.relativePath !== "string") return null;
      // 설정이 없으면 이 칸이 통째로 빠진다 — 빈 글자도 없는 것으로 본다.
      const uncPath = typeof payload.uncPath === "string" && payload.uncPath.trim() !== "" ? payload.uncPath : undefined;
      return {
        status: "found",
        relativePath: payload.relativePath,
        multipleFolderMatches: payload.multipleFolderMatches === true,
        ...(uncPath === undefined ? {} : { uncPath }),
      };
    }
    case "not-found":
      return { status: "not-found" };
    case "disabled":
      return { status: "disabled" };
    case "failed": {
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
      return { status: "failed", reason: reason === "" ? UNKNOWN_REASON : reason };
    }
    default:
      return null;
  }
}

async function askArchiveFolder(
  quoteId: string,
  fetchImpl: QuoteFolderFetch
): Promise<{ ok: true; answer: ArchiveFolderAnswer } | { ok: false; reason: string }> {
  let response: FolderResponse;
  try {
    response = await fetchImpl(quoteArchiveFolderUrl(quoteId));
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { ok: false, reason: await failureReason(response) };
  const answer = readArchiveFolderAnswer(await response.json().catch(() => null));
  return answer === null ? { ok: false, reason: UNREADABLE_RESPONSE_REASON } : { ok: true, answer };
}

// ── 3) 「도우미 확인됨」 표시 — 저장소가 던져도 돈다 ──────────────────────────

function readHelperConfirmed(storage: QuoteFolderOpenEnvironment["storage"]): boolean {
  try {
    return storage()?.getItem(QUOTE_FOLDER_HELPER_CONFIRMED_KEY) === "1";
  } catch {
    return false;
  }
}

function markHelperConfirmed(storage: QuoteFolderOpenEnvironment["storage"]): void {
  try {
    storage()?.setItem(QUOTE_FOLDER_HELPER_CONFIRMED_KEY, "1");
  } catch {
    // 적지 못해도 폴더는 열렸다 — 다음에 또 감지할 뿐이다.
  }
}

/**
 * 주소를 열고, 정해진 시간 안에 창이 초점을 잃는지 본다. 듣기는 여는 것보다 **먼저** 건다 —
 * 확인창 · 탐색기는 여는 즉시 뜰 수 있다. 끝나면 듣기를 푼다(늦은 blur 는 세지 않는다).
 */
async function openAndWatch(
  link: string,
  env: QuoteFolderOpenEnvironment
): Promise<"FOCUS_LOST" | "NO_RESPONSE" | "OPEN_FAILED"> {
  let lost = false;
  let signalLost: () => void = () => {};
  const lostSignal = new Promise<void>((resolve) => {
    signalLost = resolve;
  });
  let stopWatching: () => void = () => {};
  try {
    stopWatching = env.watchFocusLoss(() => {
      lost = true;
      signalLost();
    });
  } catch {
    // 들을 수 없으면 감지하지 못한 것으로 — 시간만 기다린다.
  }
  const stop = () => {
    try {
      stopWatching();
    } catch {
      // 풀지 못해도 결과는 이미 정했다.
    }
  };

  try {
    env.openLink(link);
  } catch {
    stop();
    return "OPEN_FAILED";
  }

  if (!lost) await Promise.race([lostSignal, env.delay(QUOTE_FOLDER_HELPER_DETECTION_MS)]);
  stop();
  return lost ? "FOCUS_LOST" : "NO_RESPONSE";
}

// ── 브라우저 기본값 — 부를 때만 window · document 를 만진다 ─────────────────

/** 숨은 iframe 을 늦게 치운다 — 곧바로 떼면 주소 넘기기가 취소될 수 있다. */
const HIDDEN_FRAME_RELEASE_MS = 10_000;

function openLinkInHiddenFrame(link: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
  frame.src = link;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), HIDDEN_FRAME_RELEASE_MS);
}

function watchWindowFocusLoss(onLost: () => void): () => void {
  const handleVisibility = () => {
    if (document.visibilityState === "hidden") onLost();
  };
  window.addEventListener("blur", onLost);
  document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    window.removeEventListener("blur", onLost);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

function browserStorage(): QuoteFolderHelperStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

const BROWSER_ENVIRONMENT: QuoteFolderOpenEnvironment = {
  fetchImpl: (url) => fetch(url),
  openLink: openLinkInHiddenFrame,
  watchFocusLoss: watchWindowFocusLoss,
  delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  storage: browserStorage,
};

// ── 부르는 곳 ────────────────────────────────────────────────────────────

export type QuoteFolderOpenOutcomeKind =
  | "DISABLED"
  | "NOT_FOUND"
  | "FAILED"
  /** 초점을 잃었다 — 도우미가 반응했다. 「확인됨」 표시를 적었다. */
  | "OPENED"
  /** 반응이 없었지만 이 브라우저에 「확인됨」 표시가 있다 — 탐색기가 뒤에 떴을 수 있다. */
  | "NO_RESPONSE_CONFIRMED"
  /** 반응도 표시도 없다 — 도우미가 없는 것으로 보고 [설치 명령 복사]로 이끈다. */
  | "NO_RESPONSE";

export type QuoteFolderOpenOutcome = {
  kind: QuoteFolderOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /** 「탐색기가 열리지 않았다면 …」 곁말과 두 단추를 내미는가 — 폴더를 찾은 뒤에만. */
  offerHelperInstall: boolean;
  /**
   * 폴더를 찾았고 **서버에 공유폴더 주소 설정이 있을 때만** 있는 전체 주소
   * (`\\서버\공유\연도 폴더\견적서 폴더`). 있을 때만 [위치 복사]를 낸다.
   * 🔴 알림 줄에는 넣지 않는다 — 복사가 막혔을 때만 화면에 보인다.
   */
  uncPath?: string;
};

function failed(reason: string): QuoteFolderOpenOutcome {
  return { kind: "FAILED", lines: [{ text: folderFailureText(reason), tone: "warning" }], offerHelperInstall: false };
}

/**
 * [폴더 열기] 한 번. 던지지 않는다. `env` 에 준 것만 바꿔 끼우고 나머지는 브라우저 기본값이다.
 */
export async function runQuoteFolderOpen({
  quoteId,
  env: overrides = {},
}: {
  quoteId: string;
  env?: Partial<QuoteFolderOpenEnvironment>;
}): Promise<QuoteFolderOpenOutcome> {
  const env: QuoteFolderOpenEnvironment = { ...BROWSER_ENVIRONMENT, ...overrides };

  const asked = await askArchiveFolder(quoteId, env.fetchImpl);
  if (!asked.ok) return failed(asked.reason);

  const { answer } = asked;
  switch (answer.status) {
    case "disabled":
      return { kind: "DISABLED", lines: [{ text: QUOTE_FOLDER_DISABLED_TEXT, tone: "muted" }], offerHelperInstall: false };
    case "not-found":
      return { kind: "NOT_FOUND", lines: [{ text: QUOTE_FOLDER_NOT_FOUND_TEXT, tone: "warning" }], offerHelperInstall: false };
    case "failed":
      return failed(answer.reason);
    case "found":
      break;
  }

  // 🔴 찾은 뒤의 모든 결과에 전체 주소를 붙인다 — 도우미가 막혀도 [위치 복사]로 갈 수 있게.
  //    설정이 없으면 칸 자체가 없다(undefined). 알림 줄에는 넣지 않는다.
  const withUncPath: { uncPath?: string } = answer.uncPath === undefined ? {} : { uncPath: answer.uncPath };

  const link = buildQuoteFolderLink(answer.relativePath);
  if (link === null) return { ...failed(UNOPENABLE_LINK_REASON), ...withUncPath };

  const multiple: QuoteIssueNoticeLine[] = answer.multipleFolderMatches
    ? [{ text: QUOTE_FOLDER_MULTIPLE_TEXT, tone: "warning" }]
    : [];
  const opening: QuoteIssueNoticeLine[] = [{ text: openingText(answer.relativePath), tone: "normal" }, ...multiple];

  const watched = await openAndWatch(link, env);
  if (watched === "OPEN_FAILED") return { ...failed(OPEN_LINK_FAILED_REASON), ...withUncPath };

  if (watched === "FOCUS_LOST") {
    markHelperConfirmed(env.storage);
    return { kind: "OPENED", lines: opening, offerHelperInstall: true, ...withUncPath };
  }

  // 반응이 없었다. 이 브라우저에서 도우미가 반응한 적이 있으면 「없다」고 말하지 않는다
  // (탐색기가 브라우저 뒤에 떴을 수 있다) — 단추만 곁에 둔다.
  if (readHelperConfirmed(env.storage)) {
    return { kind: "NO_RESPONSE_CONFIRMED", lines: opening, offerHelperInstall: true, ...withUncPath };
  }

  // 🔴 반응도 표시도 없다 — 설치 파일을 주지 않고 [설치 명령 복사]로 이끈다(사용자 결정 2026-09-16).
  return {
    kind: "NO_RESPONSE",
    lines: [
      { text: QUOTE_FOLDER_HELPER_MISSING_TEXT, tone: "warning" },
      { text: attemptedText(answer.relativePath), tone: "muted" },
      ...multiple,
    ],
    offerHelperInstall: true,
    ...withUncPath,
  };
}

// ── ④c 파일 없이 가는 두 길 ──────────────────────────────────────────────

/** 복사는 던지지 않아야 한다 — 바꿔 끼운 갈래가 던져도 「못 했다」로 본다. */
async function copySafely(text: string, copy: QuoteFolderCopy): Promise<boolean> {
  try {
    return (await copy(text)) === true;
  } catch {
    return false;
  }
}

/**
 * [위치 복사] — 전체 공유폴더 주소를 클립보드로. 붙여넣으면 **도우미 없이도** 폴더가 열린다.
 * 막히면 주소를 줄로 내려 긁어 가게 한다(주소는 짧다). 던지지 않는다.
 */
export async function runQuoteFolderUncPathCopy({
  uncPath,
  copy = copyText,
}: {
  uncPath: string;
  copy?: QuoteFolderCopy;
}): Promise<QuoteIssueNoticeLine[]> {
  return (await copySafely(uncPath, copy))
    ? [{ text: QUOTE_FOLDER_UNC_PATH_COPIED_TEXT, tone: "normal" }]
    : [
        { text: QUOTE_FOLDER_UNC_PATH_COPY_BLOCKED_TEXT, tone: "warning" },
        { text: uncPath, tone: "muted" },
      ];
}

/**
 * 설치 명령 한 줄을 받아 온다. 🔴 본문은 돌려주기만 하고 **어디에도 싣지 않는다** —
 * 알림 줄에도, 콘솔에도. 사내 공유폴더 주소가 들어 있다.
 */
async function fetchInstallCommand(
  fetchImpl: QuoteFolderFetch
): Promise<{ ok: true; command: string } | { ok: false; reason: string }> {
  let response: FolderResponse;
  try {
    response = await fetchImpl(QUOTE_FOLDER_HELPER_INSTALL_COMMAND_URL);
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { ok: false, reason: await failureReason(response) };

  const payload = await response.json().catch(() => null);
  const command = isRecord(payload) && typeof payload.command === "string" ? payload.command : "";
  return command.trim() === "" ? { ok: false, reason: UNREADABLE_RESPONSE_REASON } : { ok: true, command };
}

/**
 * [설치 명령 복사] — 도우미를 설치하는 **유일한** 길. 받은 한 줄을 곧바로 클립보드로 넣는다.
 * 🔴 복사가 막혀도 명령을 화면에 쏟지 않는다(약 10,300자) — 짧은 안내 한 줄만 낸다.
 * 던지지 않는다.
 */
export async function runQuoteFolderHelperInstallCommandCopy({
  env: overrides = {},
}: {
  env?: Partial<Pick<QuoteFolderOpenEnvironment, "fetchImpl">> & { copy?: QuoteFolderCopy };
} = {}): Promise<QuoteIssueNoticeLine[]> {
  const fetchImpl = overrides.fetchImpl ?? BROWSER_ENVIRONMENT.fetchImpl;
  const copy = overrides.copy ?? copyText;

  const asked = await fetchInstallCommand(fetchImpl);
  if (!asked.ok) {
    return [
      { text: `설치 명령을 받지 못했습니다 — ${asked.reason}`, tone: "warning" },
      { text: QUOTE_FOLDER_HELPER_INSTALL_COMMAND_ADMIN_HINT_TEXT, tone: "muted" },
    ];
  }

  return (await copySafely(asked.command, copy))
    ? [{ text: QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPIED_TEXT, tone: "normal" }]
    : [{ text: QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPY_BLOCKED_TEXT, tone: "warning" }];
}

// ── Windows 인가 (순수) ──────────────────────────────────────────────────

/** 판단에 쓰는 브라우저 값. 없으면 빈 글자 · null. */
export type QuoteFolderClientPlatform = {
  userAgent: string;
  platform: string;
  /** navigator.userAgentData.platform — Chromium 계열만 준다. */
  userAgentDataPlatform: string | null;
  /** navigator.userAgentData.mobile */
  userAgentDataMobile: boolean | null;
};

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  userAgentData?: { platform?: string; mobile?: boolean };
};

export function readQuoteFolderClientPlatform(source: NavigatorLike): QuoteFolderClientPlatform {
  const data = source.userAgentData;
  return {
    userAgent: typeof source.userAgent === "string" ? source.userAgent : "",
    platform: typeof source.platform === "string" ? source.platform : "",
    userAgentDataPlatform: typeof data?.platform === "string" ? data.platform : null,
    userAgentDataMobile: typeof data?.mobile === "boolean" ? data.mobile : null,
  };
}

/**
 * 🔴 도우미는 Windows PC 에만 설치된다 — 그 밖의 기기(휴대폰 · Mac · Linux)에서는 [폴더 열기]를
 * 감춘다. 휴대 기기 표시가 먼저다(Windows Phone · 「데스크톱 사이트」로 바꾼 휴대폰). 그다음
 * Chromium 의 userAgentData.platform, 없으면 navigator.platform(`Win32`) · userAgent(`Windows NT`).
 */
export function isWindowsDesktopClient(client: QuoteFolderClientPlatform): boolean {
  if (client.userAgentDataMobile === true) return false;
  if (/Windows Phone|Windows Mobile|IEMobile|Windows CE|Android|iPhone|iPad|iPod/i.test(client.userAgent)) return false;
  const hint = client.userAgentDataPlatform?.trim() ?? "";
  if (hint !== "") return hint === "Windows";
  return /^Win/i.test(client.platform) || /Windows NT/i.test(client.userAgent);
}
