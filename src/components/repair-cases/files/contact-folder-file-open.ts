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
 * ── 🔴 설치 안내는 **파일 열기가 되는 PC 에는 내지 않는다** (2026-10-07) ──
 * **예전 도우미는 `openfile` 주소를 모른다.** 받으면 접두어 검사에 걸려 조용히 끝난다
 * (exit 2) — 화면은 그것을 알 수 없다(브라우저는 「이 주소를 받을 프로그램이 있는가」도,
 * 「그 프로그램이 무엇을 했는가」도 알려 주지 않는다). 그래서 오랫동안 **열렸든 안 열렸든**
 * 「열리지 않으면 [설치 명령 복사]로 다시 설치해 주세요」를 함께 냈다. 도우미가 이미 깔린
 * PC 에서도 늘 떴다.
 *
 * 🔴 이제는 신호 하나로 가른다: **「파일 열기로 초점을 잃은 적이 있다」 = 「이 PC 에 파일
 * 열기를 아는 도우미가 있다」.** 예전 도우미는 아무 창도 띄우지 않으니 초점을 뺏지 못하고,
 * 새 도우미만 연결 프로그램을 앞에 띄워 초점을 가져간다. 그 사실을 **능력별·세대별
 * 표시**(CONTACT_FOLDER_FILE_HELPER_KEY)로 적어 두고, 표시가 있으면 안내를 **아예 만들지
 * 않는다** — 줄도 [설치 명령 복사] 단추도 없다. 사람이 [그만 보기]를 눌러도 같은 표시를
 * 적는다(화면 쪽에서 rememberContactFolderFileHelper 를 부른다).
 *
 * 🔴 폴더 열기 쪽 표시(QUOTE_FOLDER_HELPER_CONFIRMED_KEY)는 **그대로 둔다** — 그것은
 * 「도우미가 반응한 적이 있다」는 뜻이고, 네 모듈이 함께 쓴다. 폴더만 열어 본 PC 도 참이
 * 되므로 **파일 열기 능력을 보장하지 못한다.** 성질이 다른 두 표시라 여기서는 새 표시를
 * **더해서** 본다 — 옛 표시의 뜻도 쓰임도 바꾸지 않는다.
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

/**
 * 🔴 **표시가 없는 PC 에만** 내는 줄 — 예전 도우미는 조용히 끝난다(머리말).
 * 문장 자체는 2026-10-07 에도 그대로다. 바뀐 것은 **낼지 말지**뿐이다.
 */
export const CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT =
  "열리지 않으면 [설치 명령 복사]로 도우미를 다시 설치해 주세요 — 예전에 설치한 도우미는 파일 열기를 모릅니다";

/** 사람이 직접 끌 수 있는 단추의 글자 — 누르면 아래 표시를 적는다. */
export const CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT = "이 PC 는 최신입니다 — 그만 보기";

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

// ── 🔴 능력별·세대별 표시 — 「이 PC 는 파일 열기를 안다」 ──────────────────

/**
 * 🔴 **이 번호가 「버전별 관리」다.** 도우미가 아는 것이 바뀌면(루트 추가 · 새 명령) 이
 * 번호를 올린다 → 열쇠 이름이 달라져 **모든 PC 가 다시 한 번 묻는다.** 도우미 쪽에는
 * 버전 개념이 아예 없고(설치 스크립트에 버전 문자열이 없다), 브라우저는 어느 판이 깔렸는지
 * 물어볼 길이 없으므로 — 세어 두는 쪽이 화면이다.
 *
 * **지금 세대 1 이 아는 것**: `dss-folder://open/`(폴더 열기) · `dss-folder://openfile/`
 * (파일 열기) · 설치 때 박히는 **루트 넷**(server/quote-folder-helper.ts).
 */
export const CONTACT_FOLDER_FILE_HELPER_GENERATION = 1;

/**
 * 「이 PC 에 **파일 열기를 아는** 도우미가 있다」는 표시. 값은 "1".
 * 🔴 열쇠 이름에 세대 번호가 들어간다 — 번호를 올리면 옛 표시는 읽히지 않는다.
 * 🔴 폴더 열기용 QUOTE_FOLDER_HELPER_CONFIRMED_KEY 와 **다른 열쇠**다(머리말).
 */
export const CONTACT_FOLDER_FILE_HELPER_KEY = `dss.helper.gen${CONTACT_FOLDER_FILE_HELPER_GENERATION}.openfile`;

/**
 * 표시가 있는가. 🔴 저장소 접근 자체가 던질 수 있어(localStorage 가 막힌 브라우저) 감싼다 —
 * 읽지 못하면 **표시가 없는 것으로** 본다(안내를 내는 쪽이 안전하다).
 */
export function readContactFolderFileHelperKnown(
  storage: ContactFolderFileOpenEnvironment["storage"] = browserStorage
): boolean {
  try {
    return storage()?.getItem(CONTACT_FOLDER_FILE_HELPER_KEY) === "1";
  } catch {
    return false;
  }
}

/** 표시를 적는다 — 초점을 잃었을 때 · 사람이 [그만 보기]를 눌렀을 때, 이 둘뿐이다. */
export function rememberContactFolderFileHelper(
  storage: ContactFolderFileOpenEnvironment["storage"] = browserStorage
): void {
  try {
    storage()?.setItem(CONTACT_FOLDER_FILE_HELPER_KEY, "1");
  } catch {
    // 적지 못해도 이번 조작은 끝났다 — 다음에 또 묻게 될 뿐이다.
  }
}

/**
 * 안내를 그릴 것인가 — 표시가 없을 때만 참이다.
 * 🔴 부르는 화면은 **마운트 뒤에** 불러야 한다. 서버 렌더에는 이 값이 없어 바로 읽으면
 * hydration 이 어긋난다. 기본을 「안 그림」으로 두고 효과에서 켠다 — 안내는 부차적 정보라
 * 늦게 나타나는 쪽이 낫다(반대로 하면 최신 PC 에서 안내가 깜빡 보였다 사라진다).
 */
export function shouldOfferContactFolderFileHelperInstall(
  storage: ContactFolderFileOpenEnvironment["storage"] = browserStorage
): boolean {
  return !readContactFolderFileHelperKnown(storage);
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
  /**
   * 반응이 없었지만 이 브라우저에 표시가 있다 — 프로그램이 뒤에 떴을 수 있다.
   * 🔴 **표시 둘 가운데 아무 쪽이어도** 여기로 온다(설계 e): 파일 열기 표시가 있으면
   * 「전에 열렸는데 이번엔 연결 프로그램이 이미 떠 있어 초점을 안 뺀」 PC 이고, 폴더 열기
   * 표시만 있으면 도우미는 있으나 파일 열기를 아는지 모르는 PC 다.
   */
  | "NO_RESPONSE_CONFIRMED"
  /** 반응도 표시도 없다 — 도우미가 없거나 예전 것으로 보고 [설치 명령 복사]로 이끈다. */
  | "NO_RESPONSE";

export type ContactFolderFileOpenOutcome = {
  kind: ContactFolderFileOpenOutcomeKind;
  lines: QuoteIssueNoticeLine[];
  /**
   * 🔴 **파일 열기 표시가 있으면 모든 결과에서 거짓이다**(머리말 · 2026-10-07). 참일 때만
   * 화면이 「다시 설치」 줄과 [설치 명령 복사] · [그만 보기]를 그린다.
   */
  offerHelperInstall: boolean;
};

/**
 * 사람이 [그만 보기]를 누른 뒤 — **이미 그려진 결과**에서 안내 줄과 단추를 걷어낸다.
 * 🔴 표시를 적는 것은 부르는 쪽이 따로 한다(rememberContactFolderFileHelper) — 이 함수는
 * 저장소를 만지지 않는 순수 함수다.
 */
export function contactFolderFileOutcomeWithoutHelperOffer(
  outcome: ContactFolderFileOpenOutcome
): ContactFolderFileOpenOutcome {
  if (!outcome.offerHelperInstall) return outcome;
  return {
    ...outcome,
    lines: outcome.lines.filter((line) => line.text !== CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT),
    offerHelperInstall: false,
  };
}

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
  //    늘려 내려가는 길을 여기서 끊는다(목록이 주는 이름에는 `/` 가 없다). 조각 10 에서
  //    화면이 하위 폴더 안으로 들어갈 수 있게 됐지만, 그때 늘어나는 것은 **폴더 쪽 경로**이고
  //    이 규칙은 그대로다.
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

  // 🔴 표시가 있으면(또는 지금 붙었으면) 이 줄을 **아예 만들지 않는다**(머리말 · 설계 d).
  const reinstall: QuoteIssueNoticeLine = { text: CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT, tone: "muted" };
  const opening: QuoteIssueNoticeLine = { text: contactFolderFileOpeningText(fileName), tone: "normal" };

  if (watched === "FOCUS_LOST") {
    // 초점을 잃었다 = 연결 프로그램이 앞에 떴다 = **이 PC 의 도우미가 파일 열기를 안다.**
    markHelperConfirmed(env.storage);
    rememberContactFolderFileHelper(env.storage);
    // 🔴 방금 표시를 적었으니 「표시가 있다」와 같은 상태다 — 안내를 내지 않는다.
    return { kind: "OPENED", lines: [opening], offerHelperInstall: false };
  }

  // 🔴 설계 e — 반응이 없을 때도 **파일 열기 표시를 함께 본다.** 전에 열렸던 PC 가
  //    「안 열렸습니다」 경고를 받지 않게(연결 프로그램이 이미 떠 있으면 초점이 안 빠진다).
  if (readContactFolderFileHelperKnown(env.storage)) {
    return { kind: "NO_RESPONSE_CONFIRMED", lines: [opening], offerHelperInstall: false };
  }

  if (readHelperConfirmed(env.storage)) {
    // 도우미는 반응한 적이 있으나 **파일 열기를 아는지는 모른다** — 안내를 함께 낸다.
    return { kind: "NO_RESPONSE_CONFIRMED", lines: [opening, reinstall], offerHelperInstall: true };
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
