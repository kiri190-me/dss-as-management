import { fileNameFromContentDisposition } from "@/lib/domain/content-disposition-file-name";
import {
  QUOTE_ISSUE_RESULT_HEADER,
  decodeQuoteIssueResult,
  type QuoteIssueResult,
} from "@/lib/domain/quote-issue-result";
import {
  QUOTE_ISSUE_FILE_NOT_SAVED_TEXT,
  quoteIssueBlockedNoticeLines,
  quoteIssueFailureNoticeLines,
  quoteIssueNoticeLines,
  type QuoteIssueNoticeLine,
} from "./quote-issue-messages";

/**
 * ============================================================================
 * 수정 권한자의 [견적서 받기] — 발행 통로(POST /api/quotes/{id}/issue)를 부르는 곳 하나
 * ============================================================================
 * 보기 권한자는 지금까지의 링크(GET /api/quotes/{id}/xlsx)로 받고 이 파일을 쓰지 않는다.
 * 수정 권한자는 여기로 받는다 — 서버가 파일을 만들며 사내 공유폴더에 저장하고 「수기 견적서
 * 엑셀」 칸을 바꾼 뒤 파일 바이트를 돌려준다(그 route 머리말). 무엇이 어떻게 됐는지는 응답
 * 헤더 한 줄(X-Quote-Issue-Result)에 있다 — 여기서 풀고, 문장은 quote-issue-messages.ts 가 짓는다.
 *
 * ── 링크가 아니라 fetch 인 까닭 ──────────────────────────────────────────
 * 부작용이 있는 통로라 POST 다(링크 한 줄로 공유폴더에 파일이 생기면 안 된다). 그리고 결과
 * 헤더를 읽어야 한다. 그래서 받은 바이트를 `<a download>` 로 저장한다 — 검사·수리 보고서
 * 내려받기(ServiceReportForm 의 handleDownload)와 같은 방법 · 같은 이름 규칙이다.
 *
 * ── 던지지 않는다 ────────────────────────────────────────────────────────
 * 네트워크가 끊겨도, 서버가 JSON 이 아닌 실패(프록시 · 게이트웨이)를 줘도 까닭을 돌려준다.
 * fetch 와 저장은 부르는 쪽이 바꿔 끼울 수 있다 — 네트워크 · DOM 없이 시험한다
 * (quote-issue-download.test.ts). 올리기 클라이언트(quote-attachment-upload.ts)와 같은 모양이다.
 *
 * ── 🔴 저장하지 않은 변경 ───────────────────────────────────────────────
 * 발행 통로는 **DB 에 저장된 값**으로 파일을 만든다. 편집 화면에서 고치고 저장하지 않은 채
 * 부르면 옛 내용이 최종 이름으로 사람의 서류함(공유폴더)에 들어간다. 그래서 runQuoteIssue 는
 * `hasUnsavedChanges` 면 통로를 **부르지 않고** 「먼저 [저장]」을 돌려준다.
 * ============================================================================
 */

type IssueResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  blob(): Promise<Blob>;
  json(): Promise<unknown>;
};

/** 부르는 쪽이 바꿔 끼울 수 있는 fetch — 쓰는 것만 적었다. 기본은 브라우저의 fetch. */
export type QuoteIssueFetch = (url: string, init: { method: "POST" }) => Promise<IssueResponse>;

const browserFetch: QuoteIssueFetch = (url, init) => fetch(url, init);

/** 받은 파일을 사람의 다운로드 폴더로. 기본은 브라우저(saveBlobAsDownload). */
export type QuoteIssueSave = (blob: Blob, fileName: string) => void;

/** 헤더에서 이름을 못 읽었을 때. 서버는 늘 싣는다 — 모자란 응답에서만 쓰인다. */
export const QUOTE_ISSUE_FALLBACK_FILE_NAME = "견적서.xlsx";

const NETWORK_FAILED_REASON = "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)";
const BODY_FAILED_REASON =
  "파일을 받는 중에 연결이 끊겼습니다(공유폴더 · 엑셀 칸에는 이미 반영됐을 수 있습니다) — 다시 눌러 주세요";

function rejectedReason(status: number): string {
  return `서버가 요청을 처리하지 못했습니다(HTTP ${status})`;
}

export type QuoteIssueDownloadResult =
  | { ok: true; blob: Blob; fileName: string; result: QuoteIssueResult | null }
  | { ok: false; reason: string; status: number | null; code: string | null };

export function quoteIssueUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/issue`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 발행 통로를 부르고 파일 · 이름 · 결과를 돌려준다. 저장은 하지 않는다. 던지지 않는다. */
export async function downloadIssuedQuote(
  quoteId: string,
  fetchImpl: QuoteIssueFetch = browserFetch
): Promise<QuoteIssueDownloadResult> {
  let response: IssueResponse;
  try {
    response = await fetchImpl(quoteIssueUrl(quoteId), { method: "POST" });
  } catch {
    return { ok: false, reason: NETWORK_FAILED_REASON, status: null, code: null };
  }

  if (!response.ok) {
    // 통로의 실패는 `{ error, code }` JSON 이다. JSON 이 아닌 실패도 있다 — 그때는 기본 문장.
    const payload = await response.json().catch(() => null);
    const record = isRecord(payload) ? payload : null;
    const error = typeof record?.error === "string" && record.error.trim() !== "" ? record.error : null;
    return {
      ok: false,
      reason: error ?? rejectedReason(response.status),
      status: response.status,
      code: typeof record?.code === "string" ? record.code : null,
    };
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return { ok: false, reason: BODY_FAILED_REASON, status: response.status, code: null };
  }

  return {
    ok: true,
    blob,
    fileName: fileNameFromContentDisposition(response.headers.get("Content-Disposition")) ?? QUOTE_ISSUE_FALLBACK_FILE_NAME,
    // 없거나 · 잘렸거나 · 모양이 다르면 null — 파일은 그대로 저장하고 결과 안내만 달라진다.
    result: decodeQuoteIssueResult(response.headers.get(QUOTE_ISSUE_RESULT_HEADER)),
  };
}

/**
 * 클릭이 브라우저의 내려받기로 넘어간 뒤에 주소를 놓아 준다 — ServiceReportForm 의
 * OBJECT_URL_RELEASE_MS 와 같은 까닭 · 같은 값(곧바로 놓으면 저장이 취소되는 일이 있다).
 */
const OBJECT_URL_RELEASE_MS = 1000;

/** 받은 바이트를 `<a download>` 로 저장한다. 이름은 서버가 Content-Disposition 으로 정한 것. */
export function saveBlobAsDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_RELEASE_MS);
}

export type QuoteIssueRunOutcome =
  /** 🔴 저장하지 않은 변경이 있어 통로를 부르지 않았다. */
  | { kind: "BLOCKED_UNSAVED_CHANGES"; lines: QuoteIssueNoticeLine[] }
  /** 받지 못했다(권한 · 없는 견적서 · 엑셀 없음 · 네트워크 …). */
  | { kind: "FAILED"; reason: string; status: number | null; code: string | null; lines: QuoteIssueNoticeLine[] }
  /** 서버 일이 끝났다. `fileSaved` 가 거짓이면 브라우저 저장만 실패했다. */
  | {
      kind: "ISSUED";
      fileName: string;
      result: QuoteIssueResult | null;
      fileSaved: boolean;
      lines: QuoteIssueNoticeLine[];
    };

/**
 * [견적서 받기] 한 번 — 세 화면의 단추(QuoteIssueButton)가 이것 하나를 부른다. 저장하지 않은
 * 변경이 있으면 통로를 부르지 않는다. 받으면 저장하고, 사람이 읽을 줄을 함께 돌려준다.
 * 던지지 않는다.
 */
export async function runQuoteIssue({
  quoteId,
  hasUnsavedChanges,
  fetchImpl = browserFetch,
  save = saveBlobAsDownload,
}: {
  quoteId: string;
  hasUnsavedChanges: boolean;
  fetchImpl?: QuoteIssueFetch;
  save?: QuoteIssueSave;
}): Promise<QuoteIssueRunOutcome> {
  if (hasUnsavedChanges) return { kind: "BLOCKED_UNSAVED_CHANGES", lines: quoteIssueBlockedNoticeLines() };

  const download = await downloadIssuedQuote(quoteId, fetchImpl);
  if (!download.ok) {
    return {
      kind: "FAILED",
      reason: download.reason,
      status: download.status,
      code: download.code,
      lines: quoteIssueFailureNoticeLines(download.reason),
    };
  }

  let fileSaved = true;
  try {
    save(download.blob, download.fileName);
  } catch {
    fileSaved = false;
  }
  const lines = quoteIssueNoticeLines(download.result);
  return {
    kind: "ISSUED",
    fileName: download.fileName,
    result: download.result,
    fileSaved,
    lines: fileSaved ? lines : [{ text: QUOTE_ISSUE_FILE_NOT_SAVED_TEXT, tone: "warning" }, ...lines],
  };
}

/**
 * 받은 뒤 「수기 견적서 엑셀」 칸을 다시 그려 와야 하는가 — 칸이 바뀌었거나(replaced), 결과를
 * 못 읽어 모를 때. 발행 통로가 올린 새 파일은 응답에 id 가 없어 화면이 들고 있을 수 없다 —
 * 서버에서 다시 읽는다(편집 화면의 칸 · 목록의 표시).
 */
export function shouldReloadSlotsAfterIssue(outcome: QuoteIssueRunOutcome): boolean {
  if (outcome.kind !== "ISSUED") return false;
  return outcome.result === null || outcome.result.attachment.status === "replaced";
}
