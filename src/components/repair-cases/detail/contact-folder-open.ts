import { buildQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  QUOTE_FOLDER_HELPER_MISSING_TEXT,
  type QuoteFolderHelperStorage,
  type QuoteFolderOpenEnvironment,
} from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";

/**
 * ============================================================================
 * 수리 건 상세의 [폴더 열기] — 연락서 폴더 위치를 묻고, 도우미 주소를 연다 (연락서 조각 2)
 * ============================================================================
 * 브라우저는 탐색기를 직접 열 수 없다. PC 마다 한 번 설치하는 도우미가
 * `dss-folder://open/?p=…` 주소를 받아 **설치 때 박힌 루트 아래의 폴더만** 연다. 그 도우미는
 * 견적서 화면이 쓰는 것과 **똑같은 한 벌**이다 — PC 당 한 벌뿐이라 새로 만들지 않는다
 * (server/quote-folder-helper.ts 가 연락서 루트까지 함께 심는다).
 *
 *  1) GET /api/repair-cases/{id}/contact-folder — 결과별 문장(꺼짐 · 없음 · 여럿 · 실패)
 *  2) found → buildQuoteFolderLink(상대 경로)로 주소를 만들어 **페이지를 떠나지 않고** 연다
 *  3) 약 2초 안에 창이 초점을 잃으면 도우미가 있는 것으로 보고 표시를 적는다
 *  4) 아무 일이 없고 표시도 없으면 [설치 명령 복사]로 이끈다
 *
 * ── 🔴 만들기는 **사람이 한 번 더 눌러야** 한다 (조각 5) ────────────────────
 * 없으면 「아직 없습니다」로 끝나고, 그 줄 옆에 [폴더 만들고 열기]가 선다. 누르면
 * runContactFolderCreateAndOpen 이 **POST** 로 하나 만들고 **곧바로 위 열기 흐름을 탄다**
 * (만든 뒤 여는 일은 다시 GET 을 불러서 한다 — 주소 만들기 규칙이 한 자리에만 있게).
 * 🔴 저절로 만들지 않는다 — 폴더가 늘어나는 것은 사람이 보고 정할 일이다. 만들기가
 * 막히는 자리는 **인수번호가 같은 폴더가 이미 있을 때** 하나뿐이다(`found` · `multiple`).
 *
 * ── 🔴 견적서 쪽 [폴더 열기] 흐름 함수를 그대로 쓰지 못한 까닭 ──────────────
 * 네 가지다. (a) 그 함수는 **URL 이 아니라 `quoteId` 를 받아** `/api/quotes/{id}/archive-folder`
 * 를 스스로 만든다. (b) 응답 모양이 다르다 — 견적서는 여럿을 `found` 안의 boolean 으로 접어
 * 이름순 첫째를 열지만, 연락서는 **여럿이면 열지 않는다**(`multiple` — 앱이 고르면 틀렸을 때
 * 조용히 틀린다: pickContactFolder 머리말). (c) 문장이 견적서 전용이다(「… 이 견적서의 폴더가
 * 없습니다」). (d) quote-folder-open-screens.test.ts 가 그 함수 이름을 적은 **화면 원본
 * 파일을 정확히 셋**으로 못 박아 두었다 — 가져다 쓰면 견적서 시험이 깨진다. 그 울타리는
 * 「[폴더 열기]는 편집 화면 머리 한 곳뿐」을 지키는 것이라, 이쪽 사정으로 풀 것이 아니다.
 *
 * 그래서 **쓸 수 있는 것만 그대로 가져온다**: 도우미 확인 표시의 열쇠 · 감지 시간 · 환경
 * 타입 · 「도우미가 없는 것 같습니다」 문장 · 주소 만들기, 그리고 복사 두 길
 * (runQuoteFolderUncPathCopy · runQuoteFolderHelperInstallCommandCopy — 화면이 직접 부른다).
 * 🔴 **견적서 쪽 동작은 한 글자도 바꾸지 않는다.** 숨은 iframe · 초점 감시는 고객사 현황표
 * 패널(CustomerFormExportPanel)이 그랬듯 여기서 한 벌 더 적는다 — 그쪽에서 내보내지 않는
 * 안쪽 조각이라, 내보내게 고치면 그것이 곧 견적서 쪽 공개 API 변경이다.
 *
 * ── 왜 숨은 iframe 인가 ──────────────────────────────────────────────────
 * `location.assign` · `<a>` 클릭은 페이지 자체가 그 주소로 가려고 한다. 도우미가 없는 PC 에서
 * 브라우저에 따라 오류 페이지로 넘어가거나 「떠나기」 확인이 끼어든다 — 수리 건 상세에는
 * 편집 중인 칸이 있을 수 있다. 숨은 iframe 이 받으면 무슨 일이 나도 그 틀 안에서 끝난다.
 *
 * ── 도우미 감지의 한계 ──────────────────────────────────────────────────
 * 브라우저는 「이 주소를 받을 프로그램이 있는가」를 알려 주지 않는다. 초점을 잃는 것은
 * 탐색기가 앞에 뜨거나 브라우저가 묻는 창을 띄울 때다 — 둘 다 도우미가 있다는 뜻이다.
 * 틀릴 수 있어 초점을 잃은 뒤에도 두 단추를 함께 내민다. 🔴 「확인됨」 표시는 견적서 쪽과
 * **같은 열쇠**를 쓴다 — 도우미가 한 벌이므로 한쪽에서 확인했으면 다른 쪽에서도 확인된 것이다.
 *
 * ── 🔴 알림에 루트 값을 싣지 않는다 ───────────────────────────────────────
 * 응답의 알려진 칸(상대 경로 · 폴더 이름 · 사유 · 전체 주소)만 읽는다. 전체 주소는 알림 줄에
 * 넣지 않는다 — 복사가 막혔을 때만 화면에 보인다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────────
 * fetch · 주소 열기 · 창 이벤트 · 시계 · 저장소를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 ·
 * DOM 없이 시험한다(contact-folder-open.test.ts). localStorage 는 막혀 있거나 던질 수 있다 —
 * 그때는 표시가 없는 것으로 보고 그대로 돈다.
 * ============================================================================
 */

export function contactFolderUrl(repairCaseId: string): string {
  return `/api/repair-cases/${encodeURIComponent(repairCaseId)}/contact-folder`;
}

// ── 문장 ─────────────────────────────────────────────────────────────────

export const CONTACT_FOLDER_DISABLED_TEXT = "연락서 공유폴더 위치가 설정되지 않았습니다 — 관리자에게 알려 주세요";

/** 🔴 저절로 만들지 않는다 — 「없습니다」로 끝나고, 만들려면 사람이 한 번 더 누른다. */
export const CONTACT_FOLDER_NOT_FOUND_TEXT = "아직 이 수리 건의 연락서 폴더가 없습니다";

/** 🔴 앱이 고르지 않는다 — 열지 않고 사람에게 넘긴다(견적서 쪽과 다른 점이다). */
export const CONTACT_FOLDER_MULTIPLE_TEXT =
  "인수번호가 같은 폴더가 여럿이라 열지 않았습니다 — 공유폴더에서 하나로 정리해 주세요";

/** 만든 뒤의 첫 줄. 🔴 **만든 폴더 이름을 그대로** 보인다. */
function createdText(folderName: string): string {
  return `연락서 폴더를 만들었습니다: ${folderName}`;
}

/** 누르는 사이에 생겼거나 사람이 먼저 만들어 두었다 — 만들지 않고 그것을 연다. */
function alreadyThereText(folderName: string): string {
  return `이미 폴더가 있어 새로 만들지 않았습니다: ${folderName}`;
}

/** 🔴 견적서 쪽과 **같은 문장**을 쓴다 — 설치되는 도우미가 똑같은 한 벌이다. */
export const CONTACT_FOLDER_HELPER_MISSING_TEXT = QUOTE_FOLDER_HELPER_MISSING_TEXT;

function openingText(folderName: string): string {
  return `탐색기로 폴더를 엽니다: ${folderName}`;
}

function attemptedText(folderName: string): string {
  return `열려던 폴더: ${folderName}`;
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

type FolderResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/** 실패 응답 `{ error, code }` 의 문장 — 서버 문장 그대로다. */
async function failureReason(response: FolderResponse): Promise<string> {
  const payload = await response.json().catch(() => null);
  const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
  return error !== "" ? error : rejectedReason(response.status);
}

// ── 1) 폴더 위치 ─────────────────────────────────────────────────────────

type ContactFolderAnswer =
  /** 🔴 `uncPath`(전체 주소)는 서버 설정이 있을 때만 붙는다 — 없으면 칸이 통째로 없다. */
  | { status: "found"; relativePath: string; folderName: string; uncPath?: string }
  | { status: "multiple"; folderNames: string[] }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 알림까지 오지 않는다. 모양이 다르면 null. */
function readContactFolderAnswer(payload: unknown): ContactFolderAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      if (typeof payload.relativePath !== "string") return null;
      // 폴더 이름 칸이 없거나 빈 글자면 상대 경로를 그대로 보인다(둘은 같은 값이다).
      const folderName =
        typeof payload.folderName === "string" && payload.folderName !== "" ? payload.folderName : payload.relativePath;
      // 설정이 없으면 이 칸이 통째로 빠진다 — 빈 글자도 없는 것으로 본다.
      const uncPath = typeof payload.uncPath === "string" && payload.uncPath.trim() !== "" ? payload.uncPath : undefined;
      return {
        status: "found",
        relativePath: payload.relativePath,
        folderName,
        ...(uncPath === undefined ? {} : { uncPath }),
      };
    }
    case "multiple": {
      const names = Array.isArray(payload.folderNames)
        ? payload.folderNames.filter((name): name is string => typeof name === "string")
        : [];
      return { status: "multiple", folderNames: names };
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

async function askContactFolder(
  repairCaseId: string,
  fetchImpl: QuoteFolderOpenEnvironment["fetchImpl"]
): Promise<{ ok: true; answer: ContactFolderAnswer } | { ok: false; reason: string }> {
  let response: FolderResponse;
  try {
    response = await fetchImpl(contactFolderUrl(repairCaseId));
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) return { ok: false, reason: await failureReason(response) };
  const answer = readContactFolderAnswer(await response.json().catch(() => null));
  return answer === null ? { ok: false, reason: UNREADABLE_RESPONSE_REASON } : { ok: true, answer };
}

// ── 2~3) 「도우미 확인됨」 표시 — 저장소가 던져도 돈다 ──────────────────────

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

export type ContactFolderOpenOutcomeKind =
  | "DISABLED"
  | "NOT_FOUND"
  /** 🔴 맞는 폴더가 여럿이다 — 열지 않았다. 사람이 공유폴더를 정리해야 한다. */
  | "MULTIPLE"
  | "FAILED"
  /** 초점을 잃었다 — 도우미가 반응했다. 「확인됨」 표시를 적었다. */
  | "OPENED"
  /** 반응이 없었지만 이 브라우저에 「확인됨」 표시가 있다 — 탐색기가 뒤에 떴을 수 있다. */
  | "NO_RESPONSE_CONFIRMED"
  /** 반응도 표시도 없다 — 도우미가 없는 것으로 보고 [설치 명령 복사]로 이끈다. */
  | "NO_RESPONSE";

export type ContactFolderOpenOutcome = {
  kind: ContactFolderOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /** 「탐색기가 열리지 않았다면 …」 곁말과 두 단추를 내미는가 — 폴더를 찾아 연 뒤에만. */
  offerHelperInstall: boolean;
  /**
   * 🔴 [폴더 만들고 열기]를 내미는가 — **`not-found` 일 때만** 참이다. 이미 열렸거나
   * 여럿이거나 실패했을 때는 내밀지 않는다(만들어서 풀릴 일이 아니다).
   */
  offerCreate?: boolean;
  /**
   * 🔴 서버에 연락서 공유폴더 주소 설정이 있을 때만 있는 전체 주소. 있을 때만 [위치 복사]를
   * 낸다. 알림 줄에는 넣지 않는다 — 복사가 막혔을 때만 화면에 보인다.
   */
  uncPath?: string;
};

function failed(reason: string): ContactFolderOpenOutcome {
  return { kind: "FAILED", lines: [{ text: folderFailureText(reason), tone: "warning" }], offerHelperInstall: false };
}

/**
 * [폴더 열기] 한 번. 던지지 않는다. `env` 에 준 것만 바꿔 끼우고 나머지는 브라우저 기본값이다.
 */
export async function runContactFolderOpen({
  repairCaseId,
  env: overrides = {},
}: {
  repairCaseId: string;
  env?: Partial<QuoteFolderOpenEnvironment>;
}): Promise<ContactFolderOpenOutcome> {
  const env: QuoteFolderOpenEnvironment = { ...BROWSER_ENVIRONMENT, ...overrides };

  const asked = await askContactFolder(repairCaseId, env.fetchImpl);
  if (!asked.ok) return failed(asked.reason);

  const { answer } = asked;
  switch (answer.status) {
    case "disabled":
      return {
        kind: "DISABLED",
        lines: [{ text: CONTACT_FOLDER_DISABLED_TEXT, tone: "muted" }],
        offerHelperInstall: false,
      };
    case "not-found":
      // 🔴 여기서 만들지 않는다 — 단추를 하나 내밀 뿐이다(사람이 한 번 더 누른다).
      return {
        kind: "NOT_FOUND",
        lines: [{ text: CONTACT_FOLDER_NOT_FOUND_TEXT, tone: "warning" }],
        offerHelperInstall: false,
        offerCreate: true,
      };
    case "multiple":
      // 🔴 열지 않는다. 이름을 그대로 보여 사람이 어느 쪽을 지울지 고르게 한다.
      return {
        kind: "MULTIPLE",
        lines: [
          { text: CONTACT_FOLDER_MULTIPLE_TEXT, tone: "warning" },
          ...answer.folderNames.map((name) => ({ text: name, tone: "muted" as const })),
        ],
        offerHelperInstall: false,
      };
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

  const opening: QuoteIssueNoticeLine[] = [{ text: openingText(answer.folderName), tone: "normal" }];

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

  // 🔴 반응도 표시도 없다 — 설치 파일을 주지 않고 [설치 명령 복사]로 이끈다(견적서 쪽과 같다).
  return {
    kind: "NO_RESPONSE",
    lines: [
      { text: CONTACT_FOLDER_HELPER_MISSING_TEXT, tone: "warning" },
      { text: attemptedText(answer.folderName), tone: "muted" },
    ],
    offerHelperInstall: true,
    ...withUncPath,
  };
}

// ── [폴더 만들고 열기] — 🔴 사람이 한 번 더 누른 그때만 (조각 5) ────────────

/**
 * 만들기 요청. 🔴 **POST 다** — 읽기(fetchImpl)와 **다른 자리**에 둔다. 한 자리로 묶으면
 * 다음 사람이 읽기 흐름에서 실수로 만들기를 부를 수 있다.
 */
export type ContactFolderCreateEnvironment = QuoteFolderOpenEnvironment & {
  createImpl: (url: string) => Promise<FolderResponse>;
};

type ContactFolderCreateAnswer =
  | { status: "created"; folderName: string }
  | { status: "found"; folderName: string }
  | { status: "multiple"; folderNames: string[] }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

function readFolderNames(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

/** 🔴 알려진 칸만 옮긴다 — 모양이 다르면 null(알림까지 오지 않는다). */
function readContactFolderCreateAnswer(payload: unknown): ContactFolderCreateAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "created":
    case "found": {
      if (typeof payload.folderName !== "string" || payload.folderName === "") return null;
      return { status: payload.status, folderName: payload.folderName };
    }
    case "multiple":
      return { status: "multiple", folderNames: readFolderNames(payload.folderNames) };
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

const BROWSER_CREATE_ENVIRONMENT: ContactFolderCreateEnvironment = {
  ...BROWSER_ENVIRONMENT,
  createImpl: (url) => fetch(url, { method: "POST" }),
};

/**
 * [폴더 만들고 열기] 한 번. 던지지 않는다.
 *
 *  1) POST — 🔴 **폴더 하나를 만든다**(인수번호가 같은 폴더가 이미 있으면 만들지 않는다)
 *  2) 만들었거나 이미 있었으면 **곧바로 열기 흐름**을 탄다(runContactFolderOpen)
 *  3) 🔴 여럿이면 **열지도 만들지도 않고** 이름들을 보인다
 */
export async function runContactFolderCreateAndOpen({
  repairCaseId,
  env: overrides = {},
}: {
  repairCaseId: string;
  env?: Partial<ContactFolderCreateEnvironment>;
}): Promise<ContactFolderOpenOutcome> {
  const env: ContactFolderCreateEnvironment = { ...BROWSER_CREATE_ENVIRONMENT, ...overrides };

  let response: FolderResponse;
  try {
    response = await env.createImpl(contactFolderUrl(repairCaseId));
  } catch {
    return failed(NETWORK_FAILED_REASON);
  }
  if (!response.ok) return failed(await failureReason(response));

  const answer = readContactFolderCreateAnswer(await response.json().catch(() => null));
  if (answer === null) return failed(UNREADABLE_RESPONSE_REASON);

  switch (answer.status) {
    case "disabled":
      return {
        kind: "DISABLED",
        lines: [{ text: CONTACT_FOLDER_DISABLED_TEXT, tone: "muted" }],
        offerHelperInstall: false,
      };
    case "multiple":
      return {
        kind: "MULTIPLE",
        lines: [
          { text: CONTACT_FOLDER_MULTIPLE_TEXT, tone: "warning" },
          ...answer.folderNames.map((name) => ({ text: name, tone: "muted" as const })),
        ],
        offerHelperInstall: false,
      };
    case "failed":
      return failed(answer.reason);
    case "created":
    case "found":
      break;
  }

  // 🔴 만든 뒤 바로 조각 2 의 열기 흐름을 탄다 — 주소를 만드는 규칙은 거기 한 자리뿐이다.
  const opened = await runContactFolderOpen({ repairCaseId, env });
  const first: QuoteIssueNoticeLine = {
    text: answer.status === "created" ? createdText(answer.folderName) : alreadyThereText(answer.folderName),
    tone: "normal",
  };
  return { ...opened, lines: [first, ...opened.lines] };
}
