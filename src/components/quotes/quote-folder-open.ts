import { fileNameFromContentDisposition } from "@/lib/domain/content-disposition-file-name";
import { buildQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import { saveBlobAsDownload } from "./quote-issue-download";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * 편집 화면의 [폴더 열기] — 폴더 위치를 묻고, 도우미 주소를 열고, 도우미가 없으면 설치 파일을 받는다 (견적서 ④b)
 * ============================================================================
 * 브라우저는 탐색기를 직접 열 수 없다. 그래서 PC 마다 한 번 설치하는 도우미가
 * `dss-folder://open/?p=…` 주소를 받아 공유폴더 루트 아래의 폴더만 연다(④a — 보안의 핵심은
 * 도우미 쪽이다: server/quote-folder-helper.ts). 이 파일은 그 앞의 순서 하나다.
 *
 *  1) GET /api/quotes/{id}/archive-folder — 결과별 문장(꺼짐 · 폴더 없음 · 실패 · 요청 실패)
 *  2) found → buildQuoteFolderLink(상대 경로)로 주소를 만들어 **페이지를 떠나지 않고** 연다
 *  3) 약 2초(QUOTE_FOLDER_HELPER_DETECTION_MS) 안에 창이 초점을 잃으면(blur · visibilitychange)
 *     도우미가 있는 것으로 보고 이 브라우저에 「도우미 확인됨」 표시를 적는다
 *  4) 아무 일이 없으면 — 표시가 없을 때만 설치 파일(GET /api/quote-folder-helper/installer)을
 *     곧바로 받는다. 표시가 있으면 받지 않고 [설치 파일 다시 받기]만 내민다.
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
 * · 모르는 주소에도 창을 띄우는 브라우저)가 있어, 초점을 잃은 뒤에도 [설치 파일 다시 받기]를
 * 함께 내민다. 자동 내려받기는 「확인됨」 표시가 없을 때, 한 번 누를 때 한 번만이다.
 *
 * ── 🔴 루트 값을 싣지 않는다 ─────────────────────────────────────────────
 * 서버는 공유폴더 루트(UNC · 컨테이너 경로)를 주지 않고, 이 파일도 응답의 알려진 칸(상대 경로 ·
 * 여럿 여부 · 사유)만 읽는다. 알림에는 상대 경로와 서버의 짧은 문장만 들어간다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────────
 * fetch · 주소 열기 · 창 이벤트 · 시계 · 저장소(localStorage) · 파일 저장을 부르는 쪽이 바꿔 끼울
 * 수 있다 — 네트워크 · DOM 없이 시험한다(quote-folder-open.test.ts). localStorage 는 막혀 있거나
 * 던질 수 있다(사생활 보호 창 · 정책) — 그때는 표시가 없는 것으로 보고 그대로 돈다.
 * ============================================================================
 */

type FolderResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  blob(): Promise<Blob>;
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
  save: (blob: Blob, fileName: string) => void;
};

/** 주소를 연 뒤 초점을 잃기를 기다리는 시간. */
export const QUOTE_FOLDER_HELPER_DETECTION_MS = 2000;

/** 이 브라우저에서 도우미가 한 번이라도 반응했다는 표시. 값은 "1". */
export const QUOTE_FOLDER_HELPER_CONFIRMED_KEY = "dss.quoteFolderHelper.confirmed";

/** 서버가 Content-Disposition 으로 이름을 싣지 않았을 때 — 서버의 이름과 같다. */
export const QUOTE_FOLDER_HELPER_INSTALLER_FALLBACK_FILE_NAME = "install-dss-folder-helper.cmd";

export const QUOTE_FOLDER_HELPER_INSTALLER_URL = "/api/quote-folder-helper/installer";

export function quoteArchiveFolderUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/archive-folder`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const QUOTE_FOLDER_DISABLED_TEXT = "공유폴더 저장이 꺼져 있습니다";
export const QUOTE_FOLDER_NOT_FOUND_TEXT =
  "아직 공유폴더에 이 견적서의 폴더가 없습니다 — [견적서 받기]를 먼저 눌러 주세요";
export const QUOTE_FOLDER_MULTIPLE_TEXT = "맞는 폴더가 여럿이라 이름순 첫째를 엽니다 — 폴더를 확인해 주세요";
export const QUOTE_FOLDER_HELPER_MISSING_FAILED_TEXT =
  "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — 설치 파일을 받지 못했습니다";

/** 설치 파일을 받은 뒤의 안내 — 자동으로 받았을 때. */
export function quoteFolderHelperInstalledText(fileName: string): string {
  return `이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — 설치 파일(${fileName})을 받았습니다. 한 번 더블클릭해 설치한 뒤 [폴더 열기]를 다시 눌러 주세요`;
}

/** 설치 파일을 받은 뒤의 안내 — [설치 파일 다시 받기]로 받았을 때. */
export function quoteFolderHelperRedownloadedText(fileName: string): string {
  return `설치 파일(${fileName})을 받았습니다 — 한 번 더블클릭해 설치한 뒤 [폴더 열기]를 다시 눌러 주세요`;
}

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
const INSTALLER_BODY_FAILED_REASON = "설치 파일을 받는 중에 연결이 끊겼습니다";
const INSTALLER_NOT_SAVED_REASON = "설치 파일을 받았지만 브라우저가 저장하지 못했습니다";

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
  | { status: "found"; relativePath: string; multipleFolderMatches: boolean }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 알림까지 오지 않는다. 모양이 다르면 null. */
function readArchiveFolderAnswer(payload: unknown): ArchiveFolderAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found":
      if (typeof payload.relativePath !== "string") return null;
      return {
        status: "found",
        relativePath: payload.relativePath,
        multipleFolderMatches: payload.multipleFolderMatches === true,
      };
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

// ── 4) 설치 파일 ─────────────────────────────────────────────────────────

/** 설치 파일을 받아 저장한다. 던지지 않는다. */
async function downloadInstaller(
  env: Pick<QuoteFolderOpenEnvironment, "fetchImpl" | "save">
): Promise<{ ok: true; fileName: string } | { ok: false; reason: string }> {
  let response: FolderResponse;
  try {
    response = await env.fetchImpl(QUOTE_FOLDER_HELPER_INSTALLER_URL);
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { ok: false, reason: await failureReason(response) };

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return { ok: false, reason: INSTALLER_BODY_FAILED_REASON };
  }
  const fileName =
    fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ??
    QUOTE_FOLDER_HELPER_INSTALLER_FALLBACK_FILE_NAME;
  try {
    env.save(blob, fileName);
  } catch {
    return { ok: false, reason: INSTALLER_NOT_SAVED_REASON };
  }
  return { ok: true, fileName };
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
  save: saveBlobAsDownload,
};

// ── 부르는 곳 ────────────────────────────────────────────────────────────

export type QuoteFolderOpenOutcomeKind =
  | "DISABLED"
  | "NOT_FOUND"
  | "FAILED"
  /** 초점을 잃었다 — 도우미가 반응했다. 「확인됨」 표시를 적었다. */
  | "OPENED"
  /** 반응이 없었지만 이 브라우저에 「확인됨」 표시가 있다 — 받지 않았다. */
  | "NO_RESPONSE_CONFIRMED"
  /** 반응도 표시도 없어 설치 파일을 받았다. */
  | "NO_RESPONSE_INSTALLER_SAVED"
  /** 반응도 표시도 없어 설치 파일을 받으려 했지만 못 받았다. */
  | "NO_RESPONSE_INSTALLER_FAILED";

export type QuoteFolderOpenOutcome = {
  kind: QuoteFolderOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /** 「탐색기가 열리지 않았다면 [설치 파일 다시 받기]」를 내미는가. */
  offerInstallerDownload: boolean;
};

function failed(reason: string): QuoteFolderOpenOutcome {
  return { kind: "FAILED", lines: [{ text: folderFailureText(reason), tone: "warning" }], offerInstallerDownload: false };
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
      return { kind: "DISABLED", lines: [{ text: QUOTE_FOLDER_DISABLED_TEXT, tone: "muted" }], offerInstallerDownload: false };
    case "not-found":
      return { kind: "NOT_FOUND", lines: [{ text: QUOTE_FOLDER_NOT_FOUND_TEXT, tone: "warning" }], offerInstallerDownload: false };
    case "failed":
      return failed(answer.reason);
    case "found":
      break;
  }

  const link = buildQuoteFolderLink(answer.relativePath);
  if (link === null) return failed(UNOPENABLE_LINK_REASON);

  const multiple: QuoteIssueNoticeLine[] = answer.multipleFolderMatches
    ? [{ text: QUOTE_FOLDER_MULTIPLE_TEXT, tone: "warning" }]
    : [];
  const opening: QuoteIssueNoticeLine[] = [{ text: openingText(answer.relativePath), tone: "normal" }, ...multiple];

  const watched = await openAndWatch(link, env);
  if (watched === "OPEN_FAILED") return failed(OPEN_LINK_FAILED_REASON);

  if (watched === "FOCUS_LOST") {
    markHelperConfirmed(env.storage);
    return { kind: "OPENED", lines: opening, offerInstallerDownload: true };
  }

  // 반응이 없었다. 이 브라우저에서 도우미가 반응한 적이 있으면 받지 않는다(탐색기가 뒤에 떴을 수 있다).
  if (readHelperConfirmed(env.storage)) {
    return { kind: "NO_RESPONSE_CONFIRMED", lines: opening, offerInstallerDownload: true };
  }

  // 🔴 표시가 없을 때만, 한 번 누를 때 한 번 — 설치 파일을 곧바로 받는다.
  const attempted: QuoteIssueNoticeLine[] = [{ text: attemptedText(answer.relativePath), tone: "muted" }, ...multiple];
  const installer = await downloadInstaller(env);
  if (installer.ok) {
    return {
      kind: "NO_RESPONSE_INSTALLER_SAVED",
      lines: [{ text: quoteFolderHelperInstalledText(installer.fileName), tone: "warning" }, ...attempted],
      offerInstallerDownload: false,
    };
  }
  return {
    kind: "NO_RESPONSE_INSTALLER_FAILED",
    lines: [
      { text: QUOTE_FOLDER_HELPER_MISSING_FAILED_TEXT, tone: "warning" },
      { text: installer.reason, tone: "warning" },
      ...attempted,
    ],
    offerInstallerDownload: false,
  };
}

/** [설치 파일 다시 받기] — 사람이 눌러서 받는다. 던지지 않는다. */
export async function runQuoteFolderHelperInstallerDownload({
  env: overrides = {},
}: {
  env?: Partial<Pick<QuoteFolderOpenEnvironment, "fetchImpl" | "save">>;
} = {}): Promise<QuoteIssueNoticeLine[]> {
  const installer = await downloadInstaller({ ...BROWSER_ENVIRONMENT, ...overrides });
  return installer.ok
    ? [{ text: quoteFolderHelperRedownloadedText(installer.fileName), tone: "normal" }]
    : [{ text: `설치 파일을 받지 못했습니다 — ${installer.reason}`, tone: "warning" }];
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
