import { canRenderQuoteDocument, type QuoteDocumentSubject } from "@/lib/domain/quote-document-support";
import { buildQuoteFolderXlsx2PdfLink } from "@/lib/domain/quote-folder-xlsx2pdf-link";
import { openLinkInHiddenFrame, type QuoteFolderFetch } from "./quote-folder-open";
import type { QuoteIssueNoticeLine } from "./quote-issue-messages";

/**
 * ============================================================================
 * [저장] 뒤의 **엑셀 → PDF** — 주소를 열고, 서버가 폴더를 다시 읽어 확인한다 (2026-10-08)
 * ============================================================================
 * 사용자 요구(2026-10-08): 「[저장]을 누르면 그 엑셀을 PDF 로 변환해서 폴더에 저장되는 기능.
 * **진짜 엑셀을 PDF 로 변환**한 PDF 여야 해.」 운영은 리눅스 컨테이너라 서버가 Excel 로 바꿀 수
 * 없다 — **쓰는 분 PC 의 Excel** 이 한다(server/quote-folder-helper.ts 의 `xlsx2pdf/` 명령).
 *
 * 저장이 끝나면 다음 차례다:
 *  1) 🔴 **건너뛸 장은 여기서 끝난다** — 엑셀 전용 · 앱 양식이 없는 종류. 저장 쪽
 *     (services/quote-issue.ts 의 archiveQuoteDocumentOnSave)이 쓰는 **같은 판정**을 가져다
 *     쓴다(domain/quote-document-support.ts). 베껴 적으면 종류가 하나 늘 때 한쪽만 열린다.
 *     건너뛰면 통로를 **부르지도 않고** 주소를 **열지도 않는다**.
 *  2) 통로에 묻는다(GET …/archive-folder/pdf) — 🔴 **주소를 열기 전에 한 번**. 이것이
 *     「전에도 있었다」를 가르는 **기준**이다(아래).
 *  3) `dss-folder://xlsx2pdf/?p=…` 를 **숨은 iframe** 으로 연다 — 기존 열기 흐름과 **같은
 *     방법**이고, 함수도 그것을 가져다 쓴다(quote-folder-open.ts 의 openLinkInHiddenFrame).
 *  4) 🔴 **서버가 폴더를 다시 읽어 확인한다** — 도우미는 답을 주지 않는다(브라우저는 그 주소를
 *     받을 프로그램이 있는지도, 무엇을 했는지도 모른다). 그래서 같은 통로에 **몇 번 더** 묻고,
 *     **상한에서 멈춘다.**
 *
 * ── 🔴 「전에도 있었다」와 「방금 생겼다」를 어떻게 가르나 ─────────────────
 * 폴더에 PDF 가 **있다**는 것만으로 「만들었다」고 말하면 거짓이 된다 — 지난번에 만든 PDF 가
 * 그대로 있을 뿐일 수 있다. 그래서 **주소를 열기 전에** 한 번 물어 기준을 잡는다:
 *   · 기준에 PDF 가 **없었는데** 뒤에 보이면 → **방금 생겼다**
 *   · 기준에 PDF 가 **있었으면** → 수정 시각이 **더 뒤**여야 방금 생긴 것이다
 *     (도우미는 덮어쓸 때 지우고 새로 쓰므로 수정 시각이 반드시 움직인다)
 *   · 🔴 두 시각 가운데 하나라도 **읽지 못했으면**(그 줄의 stat 이 막혔다) **단언하지 않는다** —
 *     「만들었다」가 아니라 「전에 만든 것이 그대로입니다」로 끝낸다. 틀릴 때 **조용한 쪽**이
 *     아니라 **사람이 확인하는 쪽**으로 틀린다.
 * 🔴 수정 시각의 눈금이 거칠면(공유폴더 · 파일시스템에 따라 1 초) **같은 초**에 덮어쓴 변환이
 * 「그대로입니다」로 보일 수 있다. 첫 확인을 1.5 초 뒤로 미루는 까닭 가운데 하나다.
 *
 * ── 🔴 얼마나 기다리나 — 네 번, 모두 합쳐 10 초 ───────────────────────────
 * Excel 은 뜨는 데만 몇 초가 걸리고(처음 띄우는 PC 는 더), 통합문서를 열어 PDF 로 내보내는 데
 * 또 걸린다. 한 번 보고 없다고 단정하면 거의 늘 「안 됐다」가 된다.
 *   · 1.5s → 2.5s → 3s → 3s (누적 1.5 · 4 · 7 · **10 초**)
 *   · 간격을 **늘려 가는** 까닭: 확인 한 번이 곧 **공유폴더 왕복 한 번**이다(통로가 폴더를
 *     읽는다). 일찍 끝나는 PC(이미 Excel 이 떠 있는 PC)는 첫 확인에서 잡고, 늦는 PC 는 적은
 *     횟수로 따라간다.
 *   · 🔴 **10 초에서 멈춘다.** 이 기다림은 사람이 [저장]을 누르고 **화면 앞에 멈춰 서 있는
 *     시간**이다 — 영영 기다리게 할 수 없다. Excel 이 없는 PC 에서는 아무리 기다려도 PDF 가
 *     생기지 않으므로, 상한을 넘기면 「아직 안 보인다」고 사실대로 말하고 끝낸다. 변환이 늦게
 *     끝나면 PDF 는 **나중에** 폴더에 나타난다(그 사실도 문장에 담는다).
 *
 * ── 🔴 저장을 막지 않는다 ────────────────────────────────────────────────
 * 이 모듈은 **저장이 끝난 뒤에** 불린다. 저장 액션을 부르지도, 기다리게 하지도 않는다 —
 * 가져오는 것에 서버 액션이 하나도 없다(quote-save-pdf-convert.test.ts 가 못 박는다).
 * 그리고 어떤 결과에도 **저장은 되돌아가지 않는다** — 돌려주는 것은 사람이 읽을 줄뿐이다.
 *
 * ── 🔴 줄에 경로가 한 글자도 없다 ────────────────────────────────────────
 * 폴더 이름에는 공급처와 S/N 이 들어 있다(domain/quote-archive-naming.ts). 이 모듈이 내는
 * 줄에는 폴더 경로도 파일 이름도 들어가지 않는다 — 서버가 주는 실패 사유도 경로 없는 짧은
 * 문장이다. 시험이 이름을 심어 놓고 **한 글자도 새지 않는지** 본다.
 *
 * ── 던지지 않는다 · 바꿔 끼울 수 있다 ───────────────────────────────────
 * fetch · 주소 열기 · 시계를 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 · DOM 없이 값으로
 * 시험한다(quote-save-pdf-convert.test.ts).
 * ============================================================================
 */

// ── 상한 ─────────────────────────────────────────────────────────────────

/**
 * 🔴 주소를 연 **뒤** 확인하기까지의 간격(ms). 길이가 곧 **확인 횟수**이고, 합이 곧 상한이다.
 * 까닭은 머리말 「얼마나 기다리나」.
 */
export const QUOTE_SAVE_PDF_CHECK_DELAYS_MS: readonly number[] = [1500, 2500, 3000, 3000];

/** 🔴 모두 합친 기다림의 상한(ms) — 위 간격의 합이다. 시험이 둘을 맞춰 본다. */
export const QUOTE_SAVE_PDF_TOTAL_WAIT_MS = 10_000;

// ── 문장 (🔴 경로 · 파일 이름을 적지 않는다) ──────────────────────────────

/** 🔴 **모든 결과의 첫 줄** — PDF 가 안 돼도 견적서는 저장됐다는 것이 분명해야 한다. */
export const QUOTE_SAVE_PDF_SAVED_TEXT = "견적서는 저장되었습니다.";

export const QUOTE_SAVE_PDF_CREATED_TEXT = "엑셀을 PDF 로 바꿔 같은 폴더에 넣었습니다.";

export const QUOTE_SAVE_PDF_NOT_VISIBLE_TEXT =
  "PDF 가 아직 보이지 않습니다 — 이 PC 에 Excel 이 없거나 폴더 열기 도우미가 예전 것일 수 있습니다";

/** 🔴 「끝」이 아니라 「늦을 수 있다」가 사실이다 — 변환이 끝나면 폴더에 나타난다. */
export const QUOTE_SAVE_PDF_NOT_VISIBLE_HINT_TEXT =
  "변환이 늦게 끝나면 잠시 뒤 공유폴더에 나타납니다 — 계속 안 보이면 [설치 명령 복사]로 도우미를 다시 설치해 주세요";

/** 🔴 전에도 있던 PDF 가 그대로다 — 「만들었다」고 말하지 않는다. */
export const QUOTE_SAVE_PDF_STALE_TEXT = "전에 만든 PDF 가 그대로입니다 — 이번 변환은 아직 보이지 않습니다";

export const QUOTE_SAVE_PDF_DISABLED_TEXT = "공유폴더 저장이 꺼져 있어 PDF 를 만들지 않았습니다";

export const QUOTE_SAVE_PDF_FOLDER_NOT_FOUND_TEXT = "공유폴더에 이 견적서의 폴더가 없어 PDF 를 만들지 못했습니다";

export const QUOTE_SAVE_PDF_FOLDER_MULTIPLE_TEXT =
  "맞는 폴더가 여럿이라 어느 폴더인지 알 수 없어 PDF 를 만들지 않았습니다 — 폴더를 확인해 주세요";

export const QUOTE_SAVE_PDF_FOLDER_FAILED_TEXT = "공유폴더를 읽지 못해 PDF 를 만들지 못했습니다";

export const QUOTE_SAVE_PDF_NO_SOURCE_TEXT = "공유폴더에서 이 견적서의 엑셀을 찾지 못해 PDF 를 만들지 못했습니다";

export const QUOTE_SAVE_PDF_LINK_FAILED_TEXT =
  "이 견적서 엑셀은 PDF 변환 주소로 만들 수 없습니다 — 공유폴더에서 직접 바꿔 주세요";

export const QUOTE_SAVE_PDF_OPEN_FAILED_TEXT = "브라우저가 PDF 변환 주소를 열지 못했습니다";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const UNREADABLE_RESPONSE_REASON = "서버 응답을 읽지 못했습니다";
const UNKNOWN_REASON = "까닭을 알 수 없습니다";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

// ── 통로 ─────────────────────────────────────────────────────────────────

export function quoteArchivePdfUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/archive-folder/pdf`;
}

/** 🔴 알려진 칸만 옮긴다 — 응답에 다른 칸이 끼어 있어도 줄까지 오지 않는다. */
type ArchivePdfAnswer =
  | {
      status: "found";
      relativePath: string;
      sourceName: string;
      /** 지금 폴더에 그 PDF 가 있는가. */
      pdfExists: boolean;
      /** 수정 시각(에포크 ms). 칸이 없거나 읽히지 않으면 null — **단언하지 않는다.** */
      pdfModifiedAtMs: number | null;
    }
  | { status: "no-source" }
  | { status: "multiple" }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modifiedAtMsOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

function readArchivePdfAnswer(payload: unknown): ArchivePdfAnswer | null {
  if (!isRecord(payload)) return null;
  switch (payload.status) {
    case "found": {
      if (typeof payload.relativePath !== "string" || typeof payload.sourceName !== "string") return null;
      return {
        status: "found",
        relativePath: payload.relativePath,
        sourceName: payload.sourceName,
        pdfExists: payload.pdfExists === true,
        pdfModifiedAtMs: modifiedAtMsOf(payload.pdfModifiedAt),
      };
    }
    case "no-source":
      return { status: "no-source" };
    case "multiple":
      return { status: "multiple" };
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

async function askArchivePdf(quoteId: string, fetchImpl: QuoteFolderFetch): Promise<ArchivePdfAnswer> {
  let response;
  try {
    response = await fetchImpl(quoteArchivePdfUrl(quoteId));
  } catch {
    return { status: "failed", reason: NETWORK_FAILED_REASON };
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = isRecord(payload) && typeof payload.error === "string" ? payload.error.trim() : "";
    return { status: "failed", reason: error !== "" ? error : rejectedReason(response.status) };
  }
  const answer = readArchivePdfAnswer(await response.json().catch(() => null));
  return answer === null ? { status: "failed", reason: UNREADABLE_RESPONSE_REASON } : answer;
}

// ── 바꿔 끼울 수 있는 것 ──────────────────────────────────────────────────

export type QuoteSavePdfEnvironment = {
  fetchImpl: QuoteFolderFetch;
  /** 도우미 주소를 페이지를 떠나지 않고 연다. 🔴 기본은 **기존 숨은 iframe 그대로**다. */
  openLink: (link: string) => void;
  delay: (ms: number) => Promise<void>;
};

const BROWSER_ENVIRONMENT: QuoteSavePdfEnvironment = {
  fetchImpl: (url) => fetch(url),
  openLink: openLinkInHiddenFrame,
  delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
};

// ── 결과 ─────────────────────────────────────────────────────────────────

export type QuoteSavePdfOutcomeKind =
  /** 🔴 할 일이 없는 장 — 엑셀 전용 · 앱 양식이 없는 종류. **아무것도 하지 않았다.** */
  | "SKIPPED"
  /** 공유폴더 저장이 꺼져 있다 — 🔴 통로에 묻기만 하고 주소를 열지 않았다. */
  | "DISABLED"
  | "FOLDER_NOT_FOUND"
  | "FOLDER_MULTIPLE"
  | "FOLDER_FAILED"
  /** 폴더는 있는데 바꿀 엑셀이 없다. */
  | "NO_SOURCE"
  /** 이름이 규칙 밖이라 변환 주소를 만들지 못했다 — 주소를 지어내지 않는다. */
  | "LINK_FAILED"
  | "OPEN_FAILED"
  /** 🔴 **방금 생겼다** — 기준과 견주어 확인했다. */
  | "CREATED"
  /** 상한까지 봤는데 PDF 가 보이지 않는다. */
  | "NOT_VISIBLE"
  /** 🔴 PDF 는 있는데 **전에 있던 그것**이다(또는 새것인지 잴 수 없다). */
  | "STALE";

export type QuoteSavePdfOutcome = {
  kind: QuoteSavePdfOutcomeKind;
  /** 🔴 사람이 읽는 줄. 경로 · 파일 이름이 한 글자도 들어가지 않는다. */
  lines: QuoteIssueNoticeLine[];
  /** 주소를 연 **뒤** 폴더를 다시 읽어 본 횟수. 0 이면 열지 않았다(건너뛰었다 · 못 열었다). */
  checks: number;
};

function notice(kind: QuoteSavePdfOutcomeKind, lines: QuoteIssueNoticeLine[], checks = 0): QuoteSavePdfOutcome {
  return { kind, lines, checks };
}

/** 🔴 결과마다 첫 줄은 「저장됐다」다 — 건너뛴 장만 줄이 없다(할 말이 없다). */
function savedFirst(...lines: QuoteIssueNoticeLine[]): QuoteIssueNoticeLine[] {
  return [{ text: QUOTE_SAVE_PDF_SAVED_TEXT, tone: "normal" }, ...lines];
}

/**
 * 🔴 **방금 생겼는가.** 기준(주소를 열기 전의 답)과 지금 답을 견준다. 잴 수 없으면 **거짓**이다 —
 * 모르는 것을 「만들었다」고 말하지 않는다(머리말).
 */
export function isFreshQuoteSavePdf(
  baseline: { pdfExists: boolean; pdfModifiedAtMs: number | null },
  current: { pdfExists: boolean; pdfModifiedAtMs: number | null }
): boolean {
  if (!current.pdfExists) return false;
  // 전에는 없었다 — 지금 있으면 이번에 생긴 것이다.
  if (!baseline.pdfExists) return true;
  // 전에도 있었다 — 수정 시각이 **더 뒤**여야 한다. 둘 중 하나라도 못 읽었으면 단언하지 않는다.
  if (baseline.pdfModifiedAtMs === null || current.pdfModifiedAtMs === null) return false;
  return current.pdfModifiedAtMs > baseline.pdfModifiedAtMs;
}

// ── 부르는 곳 ────────────────────────────────────────────────────────────

/**
 * [저장]이 끝난 뒤 한 번. **던지지 않는다** — 무슨 일이 나도 결과 하나로 끝나고, 저장은
 * 되돌아가지 않는다. `env` 에 준 것만 바꿔 끼우고 나머지는 브라우저 기본값이다.
 */
export async function runQuoteSavePdfConvert({
  quoteId,
  subject,
  env: overrides = {},
}: {
  quoteId: string;
  /** 🔴 저장 쪽과 **같은 판정**에 쓰는 값(종류 · 엑셀 전용). */
  subject: QuoteDocumentSubject;
  env?: Partial<QuoteSavePdfEnvironment>;
}): Promise<QuoteSavePdfOutcome> {
  // 🔴 1) 건너뛰는 장 — 저장 쪽(archiveQuoteDocumentOnSave)과 **같은 차례 · 같은 판정**이다.
  //    엑셀 전용을 먼저 본다: canRenderQuoteDocument 는 엑셀 전용이면 종류와 무관하게 참이다.
  //    여기서 끝나면 통로를 부르지도, 주소를 열지도 않는다.
  if (subject.isExcelOnly || !canRenderQuoteDocument(subject)) return notice("SKIPPED", []);

  const env: QuoteSavePdfEnvironment = { ...BROWSER_ENVIRONMENT, ...overrides };

  // 🔴 2) 주소를 열기 **전에** 한 번 — 이것이 「전에도 있었다」를 가르는 기준이다.
  const baseline = await askArchivePdf(quoteId, env.fetchImpl);
  switch (baseline.status) {
    // 🔴 설정이 비면 여기서 끝난다 — 주소를 열지 않는다(설계 f).
    case "disabled":
      return notice("DISABLED", savedFirst({ text: QUOTE_SAVE_PDF_DISABLED_TEXT, tone: "muted" }));
    case "not-found":
      return notice("FOLDER_NOT_FOUND", savedFirst({ text: QUOTE_SAVE_PDF_FOLDER_NOT_FOUND_TEXT, tone: "warning" }));
    case "multiple":
      return notice("FOLDER_MULTIPLE", savedFirst({ text: QUOTE_SAVE_PDF_FOLDER_MULTIPLE_TEXT, tone: "warning" }));
    case "no-source":
      return notice("NO_SOURCE", savedFirst({ text: QUOTE_SAVE_PDF_NO_SOURCE_TEXT, tone: "warning" }));
    case "failed":
      return notice(
        "FOLDER_FAILED",
        savedFirst(
          { text: QUOTE_SAVE_PDF_FOLDER_FAILED_TEXT, tone: "warning" },
          { text: baseline.reason, tone: "muted" }
        )
      );
    case "found":
      break;
  }

  // 🔴 3) 주소는 **규칙이 만든다** — 못 만들면 지어내지 않는다.
  const link = buildQuoteFolderXlsx2PdfLink(`${baseline.relativePath}/${baseline.sourceName}`);
  if (link === null) {
    return notice("LINK_FAILED", savedFirst({ text: QUOTE_SAVE_PDF_LINK_FAILED_TEXT, tone: "warning" }));
  }
  try {
    env.openLink(link);
  } catch {
    return notice("OPEN_FAILED", savedFirst({ text: QUOTE_SAVE_PDF_OPEN_FAILED_TEXT, tone: "warning" }));
  }

  // 🔴 4) 서버가 폴더를 다시 읽어 확인한다 — 몇 번 보고 **상한에서 멈춘다.**
  let checks = 0;
  let lastFound: { pdfExists: boolean; pdfModifiedAtMs: number | null } = baseline;
  for (const waitMs of QUOTE_SAVE_PDF_CHECK_DELAYS_MS) {
    await env.delay(waitMs);
    checks += 1;
    const answer = await askArchivePdf(quoteId, env.fetchImpl);
    // 한 번 못 읽었다고 그만두지 않는다 — 다음 차례에 다시 본다(상한이 막아 준다).
    if (answer.status !== "found") continue;
    lastFound = answer;
    if (isFreshQuoteSavePdf(baseline, answer)) {
      return notice("CREATED", savedFirst({ text: QUOTE_SAVE_PDF_CREATED_TEXT, tone: "normal" }), checks);
    }
  }

  // 🔴 상한에 닿았다. PDF 가 보이긴 하는데 새것이라고 **잴 수 없으면** 그렇게 말한다.
  if (lastFound.pdfExists) {
    return notice("STALE", savedFirst({ text: QUOTE_SAVE_PDF_STALE_TEXT, tone: "warning" }), checks);
  }
  return notice(
    "NOT_VISIBLE",
    savedFirst(
      { text: QUOTE_SAVE_PDF_NOT_VISIBLE_TEXT, tone: "warning" },
      { text: QUOTE_SAVE_PDF_NOT_VISIBLE_HINT_TEXT, tone: "muted" }
    ),
    checks
  );
}
