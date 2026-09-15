import type { QuoteExcelPreviewGrid } from "@/lib/server/services/quote-excel-preview";
import type { QuotePrintSignedPdf } from "./quote-attachment-files";

export type { QuoteExcelPreviewGrid };

/**
 * ============================================================================
 * 엑셀 전용 견적서 미리보기 — 붙인 수기 엑셀의 인쇄 모양을 받아 오는 곳 (견적서 ②b)
 * ============================================================================
 * 미리보기(QuotePrintView 의 엑셀 전용 갈래)가 `quoteId` 로 GET /api/quotes/{id}/excel-preview 를
 * 불러 격자를 받아 그린다. 이 파일은 **부르기 · 응답 풀기 · 무엇을 보일지 가르기**만 한다 —
 * DOM 도 React 도 만지지 않고, fetch 는 부르는 쪽이 바꿔 끼울 수 있다(시험이 네트워크 없이 돈다).
 * 올리기 · 발행 클라이언트(quote-attachment-upload.ts · quote-issue-download.ts)와 같은 모양이다.
 *
 * ── 🔴 편집 폼을 건드리지 않고 스스로 받아 온다 ──────────────────────────────
 * 미리보기는 편집 폼 안에서도(겹쳐 뜬 미리보기) 독립 인쇄 화면에서도 뜬다. 격자를 폼이 들고
 * 넘기게 하면 폼이 바뀌어야 하므로, 미리보기가 견적서 id 로 직접 받아 온다. 저장 전 새 견적서
 * (id 없음)는 붙인 엑셀도 아직 서버에 없으니 부르지 않고 「저장한 뒤 …」를 보인다.
 *
 * ── 결재 PDF 와의 관계 (2026-09-16 사용자 결정 2) ───────────────────────────
 *  · **엑셀 모양이 먼저다.** 결재 PDF 가 있으면 [결재 PDF 보기]로 바꿔 보고, 거기서 [엑셀
 *    모양 보기]로 돌아온다. 결재 PDF 가 없으면 단추가 없다.
 *  · 엑셀을 못 그리면(xls · 엑셀 없음 · 검사 막힘 · 그 밖) 실패 문장과 함께 결재 PDF 칸을
 *    보인다 — 볼 것이 하나라도 있게.
 *
 * ── 던지지 않는다 ────────────────────────────────────────────────────────
 * 네트워크가 끊겨도, 서버가 JSON 이 아닌 실패를 줘도, 응답 모양이 이상해도 까닭을 돌려준다.
 * 🔴 응답의 그림 주소는 `data:image/(png|jpeg|gif);base64,…` 만 받는다 — 그 밖이면 그 그림을 뺀다.
 * ============================================================================
 */

type PreviewResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/** 부르는 쪽이 바꿔 끼울 수 있는 fetch — 쓰는 것만 적었다. 기본은 브라우저의 fetch. */
export type QuoteExcelPreviewFetch = (
  url: string,
  init: { method: "GET"; headers: { Accept: string }; signal?: AbortSignal }
) => Promise<PreviewResponse>;

const browserFetch: QuoteExcelPreviewFetch = (url, init) => fetch(url, init);

/** 화면에 보이는 문장들. XLS_LEGACY 는 사용자 결정(2026-09-16) 문장 그대로다 — 통로의 문장과 같다(시험). */
export const QUOTE_EXCEL_PREVIEW_TEXT = {
  UNSAVED: "저장한 뒤 엑셀 모양으로 미리 볼 수 있습니다",
  LOADING: "붙인 수기 견적서 엑셀을 읽는 중입니다…",
  XLS_LEGACY:
    "옛 엑셀 형식(.xls)이라 미리보기를 그릴 수 없습니다 — xlsx 로 다시 저장해 올리거나 [견적서 받기]로 받아 보세요",
  EXCEL_NOT_ATTACHED:
    "수기 견적서 엑셀이 붙지 않아 엑셀 모양을 그릴 수 없습니다 — 견적서 수정 화면의 「수기 견적서 엑셀」 칸에 붙여 주세요",
  SCAN_BLOCKED: "붙인 엑셀이 악성코드 검사를 통과하지 못해 엑셀 모양을 그릴 수 없습니다",
  NETWORK: "서버에 닿지 못해 엑셀 모양을 그리지 못했습니다(네트워크 상태를 확인해 주세요)",
  BROKEN_RESPONSE:
    "서버의 응답을 읽지 못해 엑셀 모양을 그리지 못했습니다 — 다시 열어 보거나 [견적서 받기]로 받아 확인해 주세요",
} as const;

function rejectedText(status: number): string {
  return `엑셀 모양을 그리지 못했습니다(HTTP ${status}) — [견적서 받기]로 받아 확인해 주세요`;
}

export type QuoteExcelPreviewFailureReason = "XLS_LEGACY" | "EXCEL_NOT_ATTACHED" | "SCAN_BLOCKED" | "OTHER";

export type QuoteExcelPreviewOutcome =
  | { kind: "ready"; grid: QuoteExcelPreviewGrid; warnings: string[] }
  | { kind: "failed"; reason: QuoteExcelPreviewFailureReason; message: string };

/** 미리보기가 그리는 엑셀 쪽의 상태. */
export type QuoteExcelPreviewState = { kind: "unsaved" } | { kind: "loading" } | QuoteExcelPreviewOutcome;

export function quoteExcelPreviewUrl(quoteId: string): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/excel-preview`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(reason: QuoteExcelPreviewFailureReason, message: string): QuoteExcelPreviewOutcome {
  return { kind: "failed", reason, message };
}

/** 통로를 부르고 격자 또는 까닭을 돌려준다. 던지지 않는다. */
export async function fetchQuoteExcelPreview(
  quoteId: string,
  fetchImpl: QuoteExcelPreviewFetch = browserFetch,
  signal?: AbortSignal
): Promise<QuoteExcelPreviewOutcome> {
  let response: PreviewResponse;
  try {
    response = await fetchImpl(quoteExcelPreviewUrl(quoteId), {
      method: "GET",
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return failed("OTHER", QUOTE_EXCEL_PREVIEW_TEXT.NETWORK);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null; // 프록시 · 게이트웨이의 HTML 실패 따위.
  }

  if (response.ok) {
    const read = readQuoteExcelPreviewBody(body);
    return read === null ? failed("OTHER", QUOTE_EXCEL_PREVIEW_TEXT.BROKEN_RESPONSE) : { kind: "ready", ...read };
  }
  return quoteExcelPreviewFailureOf(response.status, body);
}

/**
 * 실패 응답 → 보일 문장. 사용자 결정의 셋(415 xls · 404 엑셀 없음 · 403 검사)은 코드로 가르고,
 * 그 밖은 서버의 문장(없으면 HTTP 상태)이다. 검사 막힘은 서버의 문장이 더 자세하다(검사 중 ·
 * 위험 판정 — 첨부 내려받기와 같은 판정 함수의 말).
 */
export function quoteExcelPreviewFailureOf(status: number, body: unknown): QuoteExcelPreviewOutcome {
  const code = isRecord(body) && typeof body.code === "string" ? body.code : null;
  const serverMessage =
    isRecord(body) && typeof body.error === "string" && body.error.trim() !== "" ? body.error.trim() : null;

  if (status === 415 || code === "XLS_LEGACY") return failed("XLS_LEGACY", QUOTE_EXCEL_PREVIEW_TEXT.XLS_LEGACY);
  if (code === "EXCEL_NOT_ATTACHED") return failed("EXCEL_NOT_ATTACHED", QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED);
  if (code === "SCAN_BLOCKED") return failed("SCAN_BLOCKED", serverMessage ?? QUOTE_EXCEL_PREVIEW_TEXT.SCAN_BLOCKED);
  return failed("OTHER", serverMessage ?? rejectedText(status));
}

/** 🔴 화면이 `<img src>` 에 넣는 주소 — 통로가 만든 data URI 모양만. */
const SAFE_IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * 성공 응답 `{ grid, warnings }` 을 푼다. 화면이 그리다 멈출 모양(칸 목록 · 크기 · 인쇄 설정이
 * 없음)이면 null. 그림은 data URI 모양인 것만 남긴다. 칸 하나하나는 우리 서버가 만든 것이라
 * 다시 검사하지 않는다.
 */
export function readQuoteExcelPreviewBody(body: unknown): { grid: QuoteExcelPreviewGrid; warnings: string[] } | null {
  if (!isRecord(body) || !isRecord(body.grid)) return null;
  const grid = body.grid;
  const page = grid.page;
  const drawable =
    Array.isArray(grid.rows) &&
    grid.rows.every((row) => isRecord(row) && Array.isArray(row.cells)) &&
    Array.isArray(grid.columnWidthsPt) &&
    typeof grid.widthPt === "number" &&
    typeof grid.heightPt === "number" &&
    Array.isArray(grid.pictures) &&
    isRecord(page) &&
    typeof page.scale === "number" &&
    isRecord(page.margins);
  if (!drawable) return null;

  const pictures = (grid.pictures as unknown[]).filter(
    (picture) => isRecord(picture) && typeof picture.src === "string" && SAFE_IMAGE_DATA_URI.test(picture.src)
  );
  const warnings = Array.isArray(body.warnings)
    ? body.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  return { grid: { ...(grid as QuoteExcelPreviewGrid), pictures: pictures as QuoteExcelPreviewGrid["pictures"] }, warnings };
}

/** 통로를 불러야 하는가 — 저장된 장이고, 엑셀이 없다고 이미 알고 있지 않을 때. */
export function shouldFetchQuoteExcelPreview(params: { quoteId: string | null; hasExcel?: boolean }): boolean {
  return params.quoteId !== null && params.hasExcel !== false;
}

/**
 * 지금 그릴 엑셀 쪽의 상태.
 *  · 저장 전(id 없음) → unsaved — 부르지 않는다.
 *  · 엑셀이 없다고 이미 안다(`hasExcel === false`, 인쇄 화면이 칸을 읽어 넘긴다) → 부르지 않고
 *    「엑셀 없음」.
 *  · 그 밖 → 받은 결과, 아직이면 loading.
 */
export function quoteExcelPreviewStateOf(params: {
  quoteId: string | null;
  hasExcel?: boolean;
  outcome: QuoteExcelPreviewOutcome | null;
}): QuoteExcelPreviewState {
  if (params.quoteId === null) return { kind: "unsaved" };
  if (params.hasExcel === false) return failed("EXCEL_NOT_ATTACHED", QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED);
  return params.outcome ?? { kind: "loading" };
}

/** 엑셀 전용 미리보기의 두 화면 — 엑셀 모양(기본) · 결재 PDF. */
export type ExcelOnlyPreviewView = "excel" | "pdf";

export type ExcelOnlyPreviewLayout = {
  /** 엑셀 쪽(읽는 중 · 격자 · 실패 문장)을 그린다. */
  showExcel: boolean;
  /** 결재 PDF 칸(보기 · 내려받기 · 없음 문장)을 그린다. */
  showPdfPanel: boolean;
  /** 도구모음의 바꿔 보기 단추 — 결재 PDF 가 올라가 있을 때만. */
  toggle: "SHOW_PDF" | "SHOW_EXCEL" | null;
  /** [인쇄 · PDF로 저장] — 격자를 받아 그리고 있을 때만. */
  canPrint: boolean;
};

/** 사용자 결정 2 의 표 그대로(머리말). */
export function excelOnlyPreviewLayout(params: {
  state: QuoteExcelPreviewState;
  view: ExcelOnlyPreviewView;
  signedPdf: QuotePrintSignedPdf | null;
}): ExcelOnlyPreviewLayout {
  const pdfViewable = params.signedPdf?.kind === "saved";
  const excelDrawable = params.state.kind === "loading" || params.state.kind === "ready";

  // 엑셀을 못 그린다 — 실패 문장과 함께 결재 PDF 칸(볼 것이 하나라도 있게). 바꿔 볼 것이 없다.
  if (!excelDrawable) return { showExcel: true, showPdfPanel: true, toggle: null, canPrint: false };
  if (params.view === "pdf" && pdfViewable) {
    return { showExcel: false, showPdfPanel: true, toggle: "SHOW_EXCEL", canPrint: false };
  }
  return {
    showExcel: true,
    showPdfPanel: false,
    toggle: pdfViewable ? "SHOW_PDF" : null,
    canPrint: params.state.kind === "ready",
  };
}
