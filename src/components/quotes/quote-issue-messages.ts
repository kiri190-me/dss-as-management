import type { QuoteAttachmentSlotCategory } from "@/lib/domain/attachment-category";
import type {
  QuoteIssueArchiveResult,
  QuoteIssueAttachmentResult,
  QuoteIssueResult,
} from "@/lib/domain/quote-issue-result";

/**
 * ============================================================================
 * [견적서 받기] · 결재 PDF 올리기의 결과 — 사람이 읽는 문장 (순수, 견적서 B1c)
 * ============================================================================
 * 서버는 무엇이 어떻게 됐는지를 모양으로만 준다(domain/quote-issue-result.ts — 공유폴더 ·
 * 수기 견적서 엑셀 칸). 그 모양을 문장으로 바꾸는 곳은 **여기 하나**다. 세 화면(목록 ·
 * 편집 · 인쇄 미리보기)의 [견적서 받기]와 결재 PDF 올리기가 같은 함수를 불러 같은 문장을 쓴다
 * — 화면마다 문장을 지으면 한쪽만 「옛 파일은 첨부 휴지통」을 빠뜨리는 날이 온다.
 *
 * 한 줄마다 결(tone)을 붙인다: 보통 · 흐림(공유폴더 저장이 꺼져 있다 — 알려만 둔다) ·
 * 주의(사람이 확인할 것 — 실패, 맞는 폴더가 여럿). 색은 그리는 쪽(QuoteIssueButton.tsx 의
 * QuoteIssueNoticeLines)이 정한다.
 *
 * 경로 · 사유는 서버가 준 그대로다 — 경로는 공유폴더 루트 기준 상대 경로이고, 사유는 경로
 * 없이 만든 짧은 문장이다(storage/quote-archive.ts 머리말). 괄호 안에 넣으므로 끝의 마침표만
 * 뗀다.
 * ============================================================================
 */

export type QuoteIssueNoticeTone = "normal" | "muted" | "warning";

export type QuoteIssueNoticeLine = { text: string; tone: QuoteIssueNoticeTone };

/** 편집 화면 — 저장하지 않은 변경이 있으면 발행 통로를 부르지 않고 이 문장을 보인다. */
export const QUOTE_ISSUE_UNSAVED_CHANGES_TEXT = "저장하지 않은 변경이 있습니다 — 먼저 [저장]을 눌러 주세요";

/** 파일은 받았는데 결과 헤더가 없거나 해독되지 않았다. */
export const QUOTE_ISSUE_RESULT_UNKNOWN_TEXT = "파일은 내려받았지만 공유폴더 · 엑셀 칸 결과를 확인하지 못했습니다";

/** 결재 PDF 는 칸에 올라갔는데 응답의 공유폴더 칸이 없거나 모양이 다르다. */
export const QUOTE_SIGNED_PDF_ARCHIVE_UNKNOWN_TEXT = "결재 PDF 는 올렸지만 공유폴더 결과를 확인하지 못했습니다";

/** 서버 일은 끝났고 파일도 받았는데, 브라우저에 저장하는 단계가 실패했다. */
export const QUOTE_ISSUE_FILE_NOT_SAVED_TEXT = "파일을 받았지만 브라우저가 저장하지 못했습니다 — 다시 눌러 주세요";

/** 여러 폴더가 맞았다 — 저장 모듈은 이름순 첫째 폴더를 쓴다(storage/quote-archive.ts). */
const MULTIPLE_FOLDERS_SAVED_TEXT = "맞는 폴더가 여럿이라 이름순 첫째에 넣었습니다 — 폴더를 확인해 주세요";
const MULTIPLE_FOLDERS_UNCHANGED_TEXT = "맞는 폴더가 여럿이라 이름순 첫째 폴더를 보았습니다 — 폴더를 확인해 주세요";

/**
 * 공유폴더 결과를 어디서 알리는가 — 실패 문장의 뒷말이 갈린다. 받기는 「파일은
 * 내려받았습니다」, 결재 PDF 올리기는 「결재 PDF 는 칸에 올라갔습니다」(둘 다 공유폴더와
 * 상관없이 그 일은 끝났다는 뜻이다).
 */
export type QuoteArchiveNoticeContext = "download" | "signedPdfUpload";

function reasonText(reason: string): string {
  const trimmed = reason.trim().replace(/\.+$/, "").trim();
  return trimmed === "" ? "까닭을 알 수 없습니다" : trimmed;
}

/** 공유폴더 결과 → 줄. 여러 폴더면 경로 줄 뒤에 주의 줄이 하나 더 붙는다. */
export function quoteArchiveNoticeLines(
  archive: QuoteIssueArchiveResult,
  context: QuoteArchiveNoticeContext
): QuoteIssueNoticeLine[] {
  switch (archive.status) {
    case "saved":
      return [
        { text: `공유폴더에 저장했습니다: ${archive.relativePath}`, tone: "normal" },
        ...(archive.multipleFolderMatches ? [{ text: MULTIPLE_FOLDERS_SAVED_TEXT, tone: "warning" as const }] : []),
      ];
    case "unchanged":
      return [
        { text: `공유폴더에 같은 내용의 파일이 이미 있습니다: ${archive.relativePath}`, tone: "normal" },
        ...(archive.multipleFolderMatches ? [{ text: MULTIPLE_FOLDERS_UNCHANGED_TEXT, tone: "warning" as const }] : []),
      ];
    case "failed": {
      const done = context === "download" ? "파일은 내려받았습니다" : "결재 PDF 는 칸에 올라갔습니다";
      return [{ text: `공유폴더에 저장하지 못했습니다(${reasonText(archive.reason)}) — ${done}`, tone: "warning" }];
    }
    case "disabled":
      return [{ text: "공유폴더 저장이 꺼져 있습니다", tone: "muted" }];
  }
}

/**
 * 「수기 견적서 엑셀」 칸 결과 → 줄. 엑셀 전용 견적서(skipped)는 칸을 건드리지 않으므로 말이
 * 없다(null).
 *
 * 🔴 빈 칸에 처음 올려도 서버는 `replaced` 이고 `displacedCount: 0` 이다 — 0 이면 「올렸습니다」,
 * 1 이상이면 옛 파일이 첨부 휴지통으로 간 것이라 「바꿨습니다」.
 */
export function quoteAttachmentNoticeLine(attachment: QuoteIssueAttachmentResult): QuoteIssueNoticeLine | null {
  switch (attachment.status) {
    case "replaced":
      return attachment.displacedCount === 0
        ? { text: "수기 견적서 엑셀 칸에 이 파일을 올렸습니다", tone: "normal" }
        : { text: "수기 견적서 엑셀 칸을 이 파일로 바꿨습니다(옛 파일은 첨부 휴지통)", tone: "normal" };
    case "unchanged":
      return { text: "엑셀 칸은 같은 내용이라 그대로 두었습니다", tone: "normal" };
    case "failed":
      return { text: `엑셀 칸에 올리지 못했습니다(${reasonText(attachment.reason)})`, tone: "warning" };
    case "skipped":
      return null;
  }
}

/**
 * [견적서 받기]가 끝난 뒤의 줄 — 공유폴더 줄(들) 다음에 엑셀 칸 줄. 결과 헤더가 없거나
 * 해독되지 않았으면(null) 그 사실 한 줄이다. 파일은 그래도 내려받았다.
 */
export function quoteIssueNoticeLines(result: QuoteIssueResult | null): QuoteIssueNoticeLine[] {
  if (result === null) return [{ text: QUOTE_ISSUE_RESULT_UNKNOWN_TEXT, tone: "warning" }];
  const attachment = quoteAttachmentNoticeLine(result.attachment);
  return [...quoteArchiveNoticeLines(result.archive, "download"), ...(attachment ? [attachment] : [])];
}

/**
 * 결재 PDF 올리기 뒤의 공유폴더 줄. 수기 엑셀 칸 올리기는 공유폴더에 복사하지 않으므로 줄이
 * 없다(빈 배열). 결재 PDF 인데 응답의 공유폴더 칸을 못 읽었으면(null) 그 사실 한 줄이다.
 */
export function quoteUploadArchiveNoticeLines(
  category: QuoteAttachmentSlotCategory,
  archive: QuoteIssueArchiveResult | null
): QuoteIssueNoticeLine[] {
  if (category !== "SIGNED_QUOTE_PDF") return [];
  if (archive === null) return [{ text: QUOTE_SIGNED_PDF_ARCHIVE_UNKNOWN_TEXT, tone: "warning" }];
  return quoteArchiveNoticeLines(archive, "signedPdfUpload");
}

/** 저장하지 않은 변경이 있어 발행 통로를 부르지 않았다. */
export function quoteIssueBlockedNoticeLines(): QuoteIssueNoticeLine[] {
  return [{ text: QUOTE_ISSUE_UNSAVED_CHANGES_TEXT, tone: "warning" }];
}

/** 받기 자체가 실패했다 — 서버가 준 문장(없으면 받기 클라이언트의 기본 문장). */
export function quoteIssueFailureNoticeLines(reason: string): QuoteIssueNoticeLine[] {
  return [{ text: `견적서 파일을 받지 못했습니다 — ${reason}`, tone: "warning" }];
}
