import {
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  type QuoteFolderHelperStorage,
} from "@/components/quotes/quote-folder-open";
import type { QuoteIssueNoticeLine } from "@/components/quotes/quote-issue-messages";
import { buildQuoteFolderFileLink, isOpenableQuoteFolderFileName } from "@/lib/domain/quote-folder-file-link";

/**
 * ============================================================================
 * 공유폴더 목록의 [열기] — 그 파일을 이 PC 의 프로그램으로 연다 (연락서 조각 4)
 * ============================================================================
 * 조각 3 이 보여 주기만 하던 줄에 [열기]가 붙었다. 누르면 `dss-folder://openfile/?p=…` 주소를
 * 열고, PC 의 도우미가 **설치 때 박힌 루트 아래의, 허용 목록에 든 확장자의 파일 하나**를
 * 연결 프로그램(엑셀 · PDF 뷰어 · 한글 …)으로 연다.
 *
 * ── 🔴 서버가 파일을 중계하지 않는다 ─────────────────────────────────────
 * 이 흐름에는 fetch 가 **하나도 없다.** 여는 것은 그 PC 가 한다. 목록은 이미 받아 두었으므로
 * (ContactFolderSection) 서버에 다시 물을 것도 없다 — 폴더 이름과 파일 이름을 이어 주소를
 * 만들 뿐이다. 파일 바이트가 우리 출처(same-origin)로 흐르는 길은 이 조각에도 없다.
 *
 * ── 🔴 마지막 울타리는 도우미다 ──────────────────────────────────────────
 * 여기서 주소를 만들지 못하면(허용 목록 밖 · 이름이 규칙 밖) 열지 않는다. 그렇다고 화면의
 * 판단이 안전을 만드는 것은 아니다 — 주소는 아무 웹페이지나 만들 수 있으므로 **검사 일곱은
 * 전부 PowerShell 도우미 안에 있다**(server/quote-folder-helper.ts 머리말 (a)).
 *
 * ── 🔴 늘 「설치 명령 복사」로 이끈다 ────────────────────────────────────
 * **예전 도우미는 `openfile` 주소를 모른다.** 받으면 접두어 검사에 걸려 조용히 끝난다
 * (exit 2) — 화면은 그것을 알 수 없다(브라우저는 「이 주소를 받을 프로그램이 있는가」도,
 * 「그 프로그램이 무엇을 했는가」도 알려 주지 않는다). 그래서 **열렸든 안 열렸든** 결과 줄에
 * 「열리지 않으면 [설치 명령 복사]로 도우미를 다시 설치해 주세요」를 함께 낸다. 현황표가
 * 새 루트를 더할 때 쓴 바로 그 방법이다.
 *
 * ── 왜 숨은 iframe 인가 · 감지의 한계 ────────────────────────────────────
 * 조각 2(detail/contact-folder-open.ts)와 같다. `location.assign` · `<a>` 클릭은 페이지 자체가
 * 그 주소로 가려고 해서, 도우미가 없는 PC 에서 오류 페이지나 「떠나기」 확인이 끼어든다.
 * 초점을 잃는 것은 연결 프로그램이 앞에 뜨거나 브라우저가 묻는 창을 띄울 때다 — 둘 다
 * 도우미가 있다는 뜻이다. 틀릴 수 있어 「확인됨」 표시를 함께 본다(견적서 쪽과 **같은 열쇠** —
 * 도우미가 PC 당 한 벌이다).
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────
 * 주소 열기 · 창 이벤트 · 시계 · 저장소를 부르는 쪽이 바꿔 끼울 수 있다 — DOM 없이 값으로
 * 시험한다(contact-folder-file-open.test.ts).
 * ============================================================================
 */

// ── 문장 ─────────────────────────────────────────────────────────────────

/** 🔴 열렸든 안 열렸든 **늘** 함께 내는 줄 — 예전 도우미는 조용히 끝난다. */
export const CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT =
  "열리지 않으면 [설치 명령 복사]로 도우미를 다시 설치해 주세요 — 예전에 설치한 도우미는 파일 열기를 모릅니다";

/** 허용 목록 밖 · 이름이 규칙 밖이라 주소를 만들지 못했다. (화면은 애초에 단추를 그리지 않는다.) */
export const CONTACT_FOLDER_FILE_UNOPENABLE_TEXT =
  "이 파일은 열 수 없습니다 — 공유폴더에서 직접 열어 주세요";

const OPEN_LINK_FAILED_REASON = "브라우저가 파일 열기 주소를 열지 못했습니다";

export function contactFolderFileOpeningText(fileName: string): string {
  return `파일을 엽니다: ${fileName}`;
}

export function contactFolderFileAttemptedText(fileName: string): string {
  return `열려던 파일: ${fileName}`;
}

/** 🔴 견적서 · 연락서 폴더 열기와 **같은 문장**을 쓰지 않는다 — 여기는 파일이다. */
export const CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT =
  "이 PC 에서 파일이 열리지 않았습니다 — [설치 명령 복사]를 눌러 PowerShell 창에 붙여넣어 주세요. 관리자 권한은 필요 없습니다";

function failureText(reason: string): string {
  return `파일을 열지 못했습니다 — ${reason}`;
}

// ── 바꿔 끼울 수 있는 것 ──────────────────────────────────────────────────

export type ContactFolderFileOpenEnvironment = {
  /** 도우미 주소를 페이지를 떠나지 않고 연다. 기본은 숨은 iframe. */
  openLink: (link: string) => void;
  /** 창이 초점을 잃으면 onLost 를 부른다. 돌려준 함수로 그만 듣는다. */
  watchFocusLoss: (onLost: () => void) => () => void;
  delay: (ms: number) => Promise<void>;
  /** 저장소를 꺼내는 일 자체가 던질 수 있다(localStorage 접근이 막힌 브라우저). */
  storage: () => QuoteFolderHelperStorage | null;
};

function readHelperConfirmed(storage: ContactFolderFileOpenEnvironment["storage"]): boolean {
  try {
    return storage()?.getItem(QUOTE_FOLDER_HELPER_CONFIRMED_KEY) === "1";
  } catch {
    return false;
  }
}

function markHelperConfirmed(storage: ContactFolderFileOpenEnvironment["storage"]): void {
  try {
    storage()?.setItem(QUOTE_FOLDER_HELPER_CONFIRMED_KEY, "1");
  } catch {
    // 적지 못해도 파일은 열렸다 — 다음에 또 감지할 뿐이다.
  }
}

/**
 * 주소를 열고, 정해진 시간 안에 창이 초점을 잃는지 본다. 듣기는 여는 것보다 **먼저** 건다 —
 * 확인창 · 연결 프로그램은 여는 즉시 뜰 수 있다. 끝나면 듣기를 푼다(늦은 blur 는 세지 않는다).
 */
async function openAndWatch(
  link: string,
  env: ContactFolderFileOpenEnvironment
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

const BROWSER_ENVIRONMENT: ContactFolderFileOpenEnvironment = {
  openLink: openLinkInHiddenFrame,
  watchFocusLoss: watchWindowFocusLoss,
  delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  storage: browserStorage,
};

// ── 부르는 곳 ────────────────────────────────────────────────────────────

export type ContactFolderFileOpenOutcomeKind =
  /** 주소를 만들지 못했다 · 브라우저가 주소를 열지 못했다. */
  | "FAILED"
  /** 초점을 잃었다 — 도우미가 반응했다. 「확인됨」 표시를 적었다. */
  | "OPENED"
  /** 반응이 없었지만 이 브라우저에 「확인됨」 표시가 있다 — 프로그램이 뒤에 떴을 수 있다. */
  | "NO_RESPONSE_CONFIRMED"
  /** 반응도 표시도 없다 — 도우미가 없거나 예전 것으로 보고 [설치 명령 복사]로 이끈다. */
  | "NO_RESPONSE";

export type ContactFolderFileOpenOutcome = {
  kind: ContactFolderFileOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /** 🔴 **한 번이라도 열어 본 결과에는 늘 참이다** — 예전 도우미는 조용히 끝난다(머리말). */
  offerHelperInstall: boolean;
};

/**
 * 폴더 이름과 파일 이름을 이어 도우미가 받을 **상대 경로**를 만든다.
 * 🔴 두 이름을 그대로 `/` 로 잇는다 — 둘 가운데 하나라도 규칙 밖이면 주소 만들기가 거절한다.
 */
export function contactFolderFileRelativePath(folderName: string, fileName: string): string {
  return `${folderName}/${fileName}`;
}

/**
 * [열기] 한 번. 던지지 않는다. `env` 에 준 것만 바꿔 끼우고 나머지는 브라우저 기본값이다.
 */
export async function runContactFolderFileOpen({
  folderName,
  fileName,
  env: overrides = {},
}: {
  folderName: string;
  fileName: string;
  env?: Partial<ContactFolderFileOpenEnvironment>;
}): Promise<ContactFolderFileOpenOutcome> {
  const env: ContactFolderFileOpenEnvironment = { ...BROWSER_ENVIRONMENT, ...overrides };

  // 🔴 파일 이름은 **그 폴더 안에서의 이름 하나**여야 한다 — `하위/연락서.pdf` 처럼 마디를
  //    늘려 내려가는 길을 여기서 끊는다(목록이 주는 이름에는 `/` 가 없다. 하위 폴더로
  //    내려가는 것은 이 조각의 범위 밖이다).
  const link = isOpenableQuoteFolderFileName(fileName)
    ? buildQuoteFolderFileLink(contactFolderFileRelativePath(folderName, fileName))
    : null;
  if (link === null) {
    // 🔴 여기서는 설치를 권하지 않는다 — 도우미를 다시 깔아도 이 파일은 열리지 않는다.
    return {
      kind: "FAILED",
      lines: [{ text: CONTACT_FOLDER_FILE_UNOPENABLE_TEXT, tone: "warning" }],
      offerHelperInstall: false,
    };
  }

  const watched = await openAndWatch(link, env);
  if (watched === "OPEN_FAILED") {
    return {
      kind: "FAILED",
      lines: [{ text: failureText(OPEN_LINK_FAILED_REASON), tone: "warning" }],
      offerHelperInstall: false,
    };
  }

  // 🔴 여기부터는 **무슨 결과든** 다시 설치로 이끄는 줄을 함께 낸다.
  const reinstall: QuoteIssueNoticeLine = { text: CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT, tone: "muted" };

  if (watched === "FOCUS_LOST") {
    markHelperConfirmed(env.storage);
    return {
      kind: "OPENED",
      lines: [{ text: contactFolderFileOpeningText(fileName), tone: "normal" }, reinstall],
      offerHelperInstall: true,
    };
  }

  if (readHelperConfirmed(env.storage)) {
    return {
      kind: "NO_RESPONSE_CONFIRMED",
      lines: [{ text: contactFolderFileOpeningText(fileName), tone: "normal" }, reinstall],
      offerHelperInstall: true,
    };
  }

  return {
    kind: "NO_RESPONSE",
    lines: [
      { text: CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT, tone: "warning" },
      { text: contactFolderFileAttemptedText(fileName), tone: "muted" },
      reinstall,
    ],
    offerHelperInstall: true,
  };
}
