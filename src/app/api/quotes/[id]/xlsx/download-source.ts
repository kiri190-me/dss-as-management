import { normalizeFileExtension } from "@/lib/domain/attachment-allowlist";
import { liveQuoteAttachmentInSlot, type AttachmentCategory } from "@/lib/domain/attachment-category";
import type { QuoteFileExtension } from "@/lib/domain/quote-file-name";

/**
 * ============================================================================
 * [견적서 받기]가 무엇을 내려줄지 — 앱 양식인가, 붙인 엑셀인가 (2026-09-15 Q2)
 * ============================================================================
 * 엑셀 전용 견적서는 사람이 손으로 만든 엑셀이 곧 보낸 문서다. 그래서 받기
 * (GET /api/quotes/{id}/xlsx)는 앱 양식을 채우지 않고 **붙인 엑셀 파일을 그대로**
 * 내려준다(사용자 결정). 일반 견적서는 지금 그대로 앱 양식을 채운다.
 *
 * 그 고르기를 라우트 안에 두지 않고 이 형제 파일로 뗀 까닭은 download/inline-view.ts 와
 * 같다 — **Next.js 는 route.ts 에서 정해진 이름 말고 다른 것을 export 하지 못하게
 * 한다**(export 하나 때문에 `next build` 가 실패한 적이 있다). 그러면서 이 판단을 이
 * 라우트 곁에 두어 함께 읽히게 한다. 순수하다 — DB 도 요청도 없이 값만 본다.
 *
 * ── 어느 파일인가 ────────────────────────────────────────────────────────
 * 그 견적서의 **엑셀 칸(QUOTE_EXCEL)에 지금 붙어 있는 파일** — 휴지통 것은 빼고, 겹쳐
 * 있으면 가장 나중에 올린 것(domain/attachment-category.ts 의 liveQuoteAttachmentInSlot).
 * 견적서 수정 화면의 칸이 보여 주는 파일과 **같은 고르기**다 — 화면에 보이는 파일과 받은
 * 파일이 다르면 사람은 무엇을 보냈는지 알 수 없다. 결재 PDF 칸은 보지 않는다.
 *
 * 붙인 엑셀이 없으면 MISSING_EXCEL — 라우트가 404 와 사람이 읽는 문장으로 답한다. 앱
 * 양식으로 대신 채우지 않는다: 엑셀 전용 장에는 품목이 없어 빈 견적서가 나간다.
 *
 * ── 확장자 ──────────────────────────────────────────────────────────────
 * 붙인 파일의 확장자를 따른다(xlsx · xls — 분류 허용목록이 그 둘만 받는다). 저장 경로의
 * 확장자를 본다 — 올릴 때 원래 이름에서 뽑아 소문자로 눕힌 값이다(attachment-path.ts).
 * ============================================================================
 */

export type QuoteDownloadSource<T> =
  /** 앱 양식을 채운다 — 일반 견적서, 예전 그대로. */
  | { kind: "TEMPLATE" }
  /** 붙인 엑셀을 그대로 내려준다. */
  | { kind: "ATTACHED_EXCEL"; attachment: T; extension: QuoteFileExtension }
  /** 엑셀 전용인데 붙인 엑셀이 없다. */
  | { kind: "MISSING_EXCEL" };

/** 엑셀 전용 견적서에 붙인 엑셀이 없을 때. 무엇을 하면 되는지까지 말한다. */
export const QUOTE_EXCEL_MISSING_MESSAGE =
  "엑셀 전용 견적서인데 붙인 엑셀 파일이 없습니다. 견적서 수정 화면에서 수기 견적서 엑셀을 올린 뒤 다시 받아 주세요.";

export function decideQuoteDownloadSource<
  T extends {
    id: string;
    category: AttachmentCategory;
    isDeleted: boolean;
    uploadedAt: Date | string;
    storedPath: string;
  },
>(quote: { isExcelOnly: boolean }, attachments: readonly T[]): QuoteDownloadSource<T> {
  if (!quote.isExcelOnly) return { kind: "TEMPLATE" };

  const attachment = liveQuoteAttachmentInSlot(attachments, "QUOTE_EXCEL");
  if (!attachment) return { kind: "MISSING_EXCEL" };

  return { kind: "ATTACHED_EXCEL", attachment, extension: quoteFileExtensionOf(attachment.storedPath) };
}

/** 저장 경로의 확장자 → 내려받을 파일의 확장자. xls 가 아니면 xlsx 다(허용목록이 둘뿐이다). */
function quoteFileExtensionOf(storedPath: string): QuoteFileExtension {
  return normalizeFileExtension(storedPath) === "xls" ? "xls" : "xlsx";
}
