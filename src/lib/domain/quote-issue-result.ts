/**
 * ============================================================================
 * [견적서 받기](수정 권한자)의 결과 — 공유폴더 · 첨부 칸이 어떻게 됐는가 (순수)
 * ============================================================================
 * POST /api/quotes/{id}/issue 는 몸통으로 파일 바이트를 돌려준다. 그래서 「공유폴더에
 * 저장했는가 · 첨부 칸을 바꿨는가」는 몸통이 아니라 **응답 헤더 한 줄**로 싣는다
 * (X-Quote-Issue-Result). 결재 PDF 올리기 응답(JSON)의 `archive` 칸도 같은 모양이다.
 * 서버(server/services/quote-issue.ts)와 화면이 이 파일 하나를 함께 불러 쓴다.
 *
 * ── 헤더 값은 ASCII 로만 ─────────────────────────────────────────────────
 * 공유폴더 경로에는 한글이 들어간다. 헤더 값은 바이트 그대로 latin-1 로 읽히므로
 * `encodeURIComponent(JSON.stringify(...))` 로 접어 싣는다 — 결과는 ASCII 뿐이다.
 *
 * ── 헤더 이름은 새 이름이다 ─────────────────────────────────────────────
 * 전역 보안 헤더(next.config.ts)와 이름이 같으면 Next 가 라우트의 값을 조용히 버린다.
 * `X-Quote-Issue-Result` 는 그 목록에 없는 이름이다.
 *
 * ── 해독은 던지지 않는다 ────────────────────────────────────────────────
 * 헤더가 없거나 · 잘렸거나 · 모양이 다르면 null 이다. 화면은 null 이면 결과 안내만
 * 생략하고 내려받기는 그대로 한다. 알려진 칸만 새 객체로 옮겨 담는다(모르는 칸은 버린다) —
 * 부호화도 같다.
 *
 * 값에 절대 경로 · 루트는 없다 — relativePath 는 공유폴더 루트 기준이고, reason 은 경로
 * 없이 만든 짧은 문장이다(storage/quote-archive.ts 머리말).
 * ============================================================================
 */

/** 응답 헤더 이름. 전역 보안 헤더와 겹치지 않는 새 이름이다. */
export const QUOTE_ISSUE_RESULT_HEADER = "X-Quote-Issue-Result";

/** 공유폴더 쪽 결과 — 저장 모듈의 결과(saved · unchanged · failed)에 「꺼짐」을 더한 것. */
export type QuoteIssueArchiveResult =
  /** 새 파일을 썼다. relativePath 는 루트 기준 슬래시 경로다. */
  | { status: "saved"; relativePath: string; multipleFolderMatches: boolean }
  /** 같은 바이트의 파일이 이미 있어 새로 쓰지 않았다 — relativePath 는 그 파일이다. */
  | { status: "unchanged"; relativePath: string; multipleFolderMatches: boolean }
  /** 저장하지 못했다. 내려받기 · 첨부는 그대로 됐다. */
  | { status: "failed"; reason: string }
  /** 공유폴더 저장이 꺼져 있다(QUOTE_ARCHIVE_DIR 가 비었다). */
  | { status: "disabled" };

/** 「수기 견적서 엑셀」 칸 쪽 결과. */
export type QuoteIssueAttachmentResult =
  /** 새 파일을 칸에 올렸다. displacedCount 는 첨부 휴지통으로 간 옛 파일 수(빈 칸이었으면 0). */
  | { status: "replaced"; displacedCount: number }
  /** 칸의 파일이 새 바이트와 같아(sha256) 올리지 않았다. */
  | { status: "unchanged" }
  /** 올리지 못했다. 내려받기는 그대로 됐다. */
  | { status: "failed"; reason: string }
  /** 엑셀 전용 견적서 — 붙인 엑셀이 곧 문서라 칸을 건드리지 않는다. */
  | { status: "skipped" };

export type QuoteIssueResult = {
  archive: QuoteIssueArchiveResult;
  attachment: QuoteIssueAttachmentResult;
};

/** 헤더 값으로 접는다 — ASCII 뿐이다. 알려진 칸만 싣는다. */
export function encodeQuoteIssueResult(result: QuoteIssueResult): string {
  const wire: QuoteIssueResult = {
    archive: pickArchive(result.archive),
    attachment: pickAttachment(result.attachment),
  };
  return encodeURIComponent(JSON.stringify(wire));
}

/** 헤더 값을 푼다. 없거나 · 잘렸거나 · 모양이 다르면 null — **던지지 않는다.** */
export function decodeQuoteIssueResult(value: string | null | undefined): QuoteIssueResult | null {
  if (typeof value !== "string" || value.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const archive = parseQuoteIssueArchiveResult(parsed.archive);
  const attachment = parseQuoteIssueAttachmentResult(parsed.attachment);
  if (archive === null || attachment === null) return null;
  return { archive, attachment };
}

/**
 * 공유폴더 결과 한 칸을 읽는다(결재 PDF 올리기 응답의 `archive` 도 이것으로 읽는다).
 * 모양이 다르면 null.
 */
export function parseQuoteIssueArchiveResult(value: unknown): QuoteIssueArchiveResult | null {
  if (!isRecord(value)) return null;
  switch (value.status) {
    case "saved":
    case "unchanged":
      if (typeof value.relativePath !== "string" || typeof value.multipleFolderMatches !== "boolean") return null;
      return { status: value.status, relativePath: value.relativePath, multipleFolderMatches: value.multipleFolderMatches };
    case "failed":
      if (typeof value.reason !== "string") return null;
      return { status: "failed", reason: value.reason };
    case "disabled":
      return { status: "disabled" };
    default:
      return null;
  }
}

/** 첨부 칸 결과 한 칸을 읽는다. 모양이 다르면 null. */
export function parseQuoteIssueAttachmentResult(value: unknown): QuoteIssueAttachmentResult | null {
  if (!isRecord(value)) return null;
  switch (value.status) {
    case "replaced":
      if (typeof value.displacedCount !== "number" || !Number.isSafeInteger(value.displacedCount) || value.displacedCount < 0) {
        return null;
      }
      return { status: "replaced", displacedCount: value.displacedCount };
    case "unchanged":
      return { status: "unchanged" };
    case "failed":
      if (typeof value.reason !== "string") return null;
      return { status: "failed", reason: value.reason };
    case "skipped":
      return { status: "skipped" };
    default:
      return null;
  }
}

function pickArchive(archive: QuoteIssueArchiveResult): QuoteIssueArchiveResult {
  switch (archive.status) {
    case "saved":
    case "unchanged":
      return {
        status: archive.status,
        relativePath: archive.relativePath,
        multipleFolderMatches: archive.multipleFolderMatches,
      };
    case "failed":
      return { status: "failed", reason: archive.reason };
    case "disabled":
      return { status: "disabled" };
  }
}

function pickAttachment(attachment: QuoteIssueAttachmentResult): QuoteIssueAttachmentResult {
  switch (attachment.status) {
    case "replaced":
      return { status: "replaced", displacedCount: attachment.displacedCount };
    case "unchanged":
      return { status: "unchanged" };
    case "failed":
      return { status: "failed", reason: attachment.reason };
    case "skipped":
      return { status: "skipped" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
