import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  QUOTE_EXCEL_PREVIEW_TEXT,
  excelOnlyPreviewLayout,
  fetchQuoteExcelPreview,
  quoteExcelPreviewFailureOf,
  quoteExcelPreviewStateOf,
  quoteExcelPreviewUrl,
  readQuoteExcelPreviewBody,
  shouldFetchQuoteExcelPreview,
  type QuoteExcelPreviewFetch,
  type QuoteExcelPreviewGrid,
  type QuoteExcelPreviewState,
} from "./quote-print-excel-preview";
import type { QuotePrintSignedPdf } from "./quote-attachment-files";

/**
 * ============================================================================
 * 엑셀 전용 미리보기의 클라이언트 — 부르기 · 응답 풀기 · 무엇을 보일지 (견적서 ②b)
 * ============================================================================
 * 네트워크 없이 fetch 를 바꿔 끼워 돈다. 화면(그림)은 quote-print-excel-preview-screen.test.tsx 가 본다.
 * ============================================================================
 */

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const GRID: QuoteExcelPreviewGrid = {
  firstRow: 1,
  lastRow: 1,
  firstColumn: 1,
  lastColumn: 1,
  columnWidthsPt: [60],
  widthPt: 60,
  heightPt: 20,
  rows: [
    {
      row: 1,
      heightPt: 20,
      cells: [
        {
          row: 1,
          column: 1,
          colSpan: 1,
          rowSpan: 1,
          text: "₩3,500,000 ",
          align: "right",
          verticalAlign: null,
          wrap: false,
          bold: false,
          fontSizePt: 11,
          borders: { top: null, right: null, bottom: null, left: null },
          fontColor: null,
          backgroundColor: null,
          valueKind: "number",
        },
      ],
    },
  ],
  pictures: [{ name: "image1.png", leftPt: 0, topPt: 0, widthPt: 10, heightPt: 10, src: PNG_DATA_URI }],
  page: {
    paperSize: 9,
    scale: 0.92,
    orientation: "portrait",
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6 },
    horizontallyCentered: true,
    verticallyCentered: false,
  },
};

type Call = { url: string; init: Parameters<QuoteExcelPreviewFetch>[1] };

function fakeFetch(respond: () => { ok: boolean; status: number; json(): Promise<unknown> }): {
  fetchImpl: QuoteExcelPreviewFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return respond();
    },
  };
}

function jsonResponse(status: number, body: unknown) {
  return () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

describe("부르기", () => {
  test("주소는 견적서 id 하나 — 인코딩한다", () => {
    assert.equal(quoteExcelPreviewUrl("q-1"), "/api/quotes/q-1/excel-preview");
    assert.equal(quoteExcelPreviewUrl("a/b?c"), "/api/quotes/a%2Fb%3Fc/excel-preview");
  });

  test("GET · JSON 을 달라고 · 끊는 신호를 넘긴다", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse(200, { grid: GRID, warnings: [] }));
    const controller = new AbortController();
    await fetchQuoteExcelPreview("q-1", fetchImpl, controller.signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/quotes/q-1/excel-preview");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.headers.Accept, "application/json");
    assert.equal(calls[0].init.signal, controller.signal);
  });

  test("성공 — 격자와 경고", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(200, { grid: GRID, warnings: ["첫 시트를 그렸습니다", 3] }));
    const outcome = await fetchQuoteExcelPreview("q-1", fetchImpl);
    assert.equal(outcome.kind, "ready");
    if (outcome.kind !== "ready") return;
    assert.deepEqual(outcome.grid.rows, GRID.rows);
    assert.deepEqual(outcome.warnings, ["첫 시트를 그렸습니다"], "글자가 아닌 경고는 버린다");
    assert.equal(outcome.grid.pictures[0].src, PNG_DATA_URI);
  });
});

describe("실패 — 사용자 결정의 셋과 그 밖", () => {
  test("🔴 415 — 옛 .xls: 사용자 결정 1 의 문장 그대로", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(415, { error: "서버 문장", code: "XLS_LEGACY" }));
    const outcome = await fetchQuoteExcelPreview("q-1", fetchImpl);
    assert.deepEqual(outcome, {
      kind: "failed",
      reason: "XLS_LEGACY",
      message:
        "옛 엑셀 형식(.xls)이라 미리보기를 그릴 수 없습니다 — xlsx 로 다시 저장해 올리거나 [견적서 받기]로 받아 보세요",
    });
    // 몸통이 JSON 이 아니어도 415 면 같은 문장.
    const bare = quoteExcelPreviewFailureOf(415, null);
    assert.equal(bare.kind === "failed" && bare.reason, "XLS_LEGACY");
  });

  test("🔴 404 엑셀 없음 — 무엇을 하면 되는지까지", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse(404, { error: "없음", code: "EXCEL_NOT_ATTACHED" }));
    const outcome = await fetchQuoteExcelPreview("q-1", fetchImpl);
    assert.deepEqual(outcome, {
      kind: "failed",
      reason: "EXCEL_NOT_ATTACHED",
      message: QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED,
    });
    assert.ok(QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED.includes("「수기 견적서 엑셀」 칸에 붙여 주세요"));
  });

  test("🔴 403 검사 막힘 — 서버의 판정 문장(검사 중 · 위험), 없으면 이 화면의 문장", () => {
    assert.deepEqual(quoteExcelPreviewFailureOf(403, { error: "악성코드 검사가 끝나지 않았습니다.", code: "SCAN_BLOCKED" }), {
      kind: "failed",
      reason: "SCAN_BLOCKED",
      message: "악성코드 검사가 끝나지 않았습니다.",
    });
    assert.deepEqual(quoteExcelPreviewFailureOf(403, { code: "SCAN_BLOCKED" }), {
      kind: "failed",
      reason: "SCAN_BLOCKED",
      message: QUOTE_EXCEL_PREVIEW_TEXT.SCAN_BLOCKED,
    });
  });

  test("그 밖 — 서버 문장, 없으면 HTTP 상태", () => {
    assert.deepEqual(quoteExcelPreviewFailureOf(404, { error: "해당 견적서를 찾을 수 없습니다.", code: "NOT_FOUND" }), {
      kind: "failed",
      reason: "OTHER",
      message: "해당 견적서를 찾을 수 없습니다.",
    });
    const gateway = quoteExcelPreviewFailureOf(502, null);
    assert.equal(gateway.kind === "failed" && gateway.reason, "OTHER");
    assert.ok(gateway.kind === "failed" && gateway.message.includes("HTTP 502"));
  });

  test("던지지 않는다 — 네트워크가 끊겨도 · JSON 이 아니어도 · 모양이 이상해도", async () => {
    const offline = await fetchQuoteExcelPreview("q-1", async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.deepEqual(offline, { kind: "failed", reason: "OTHER", message: QUOTE_EXCEL_PREVIEW_TEXT.NETWORK });

    const html = await fetchQuoteExcelPreview("q-1", async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    assert.equal(html.kind === "failed" && html.reason, "OTHER");

    const broken = await fetchQuoteExcelPreview("q-1", fakeFetch(jsonResponse(200, { grid: { rows: "x" } })).fetchImpl);
    assert.deepEqual(broken, { kind: "failed", reason: "OTHER", message: QUOTE_EXCEL_PREVIEW_TEXT.BROKEN_RESPONSE });
  });
});

describe("🔴 응답 풀기 — 그림 주소는 data URI 모양만", () => {
  test("png · jpeg · gif 의 base64 data URI 만 남기고, 그 밖의 주소는 뺀다", () => {
    const body = {
      grid: {
        ...GRID,
        pictures: [
          GRID.pictures[0],
          { ...GRID.pictures[0], src: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
          { ...GRID.pictures[0], src: "https://example.invalid/seal.png" },
          { ...GRID.pictures[0], src: "data:image/svg+xml;base64,PHN2Zz4=" },
          { ...GRID.pictures[0], src: "javascript:alert(1)" },
          { ...GRID.pictures[0], src: 'data:image/png;base64,AAAA" onerror="x' },
          { ...GRID.pictures[0] , src: undefined },
        ],
      },
      warnings: [],
    };
    const read = readQuoteExcelPreviewBody(body);
    assert.ok(read);
    assert.deepEqual(
      read.grid.pictures.map((picture) => picture.src),
      [PNG_DATA_URI, "data:image/gif;base64,R0lGODlhAQABAAAAACw="]
    );
  });

  test("그릴 수 없는 모양이면 null — 칸 목록 · 크기 · 인쇄 설정", () => {
    assert.equal(readQuoteExcelPreviewBody(null), null);
    assert.equal(readQuoteExcelPreviewBody({ grid: { ...GRID, rows: null } }), null);
    assert.equal(readQuoteExcelPreviewBody({ grid: { ...GRID, rows: [{ row: 1 }] } }), null);
    assert.equal(readQuoteExcelPreviewBody({ grid: { ...GRID, widthPt: "240" } }), null);
    assert.equal(readQuoteExcelPreviewBody({ grid: { ...GRID, page: null } }), null);
    assert.equal(readQuoteExcelPreviewBody({ grid: { ...GRID, pictures: undefined } }), null);
    assert.ok(readQuoteExcelPreviewBody({ grid: GRID }), "경고가 없어도 그린다");
  });
});

describe("상태 — 부를지 · 무엇을 보일지", () => {
  test("🔴 저장 전(id 없음)은 부르지 않고 「저장한 뒤 …」", () => {
    assert.equal(shouldFetchQuoteExcelPreview({ quoteId: null, hasExcel: true }), false);
    assert.deepEqual(quoteExcelPreviewStateOf({ quoteId: null, hasExcel: true, outcome: null }), { kind: "unsaved" });
    assert.equal(QUOTE_EXCEL_PREVIEW_TEXT.UNSAVED, "저장한 뒤 엑셀 모양으로 미리 볼 수 있습니다");
  });

  test("엑셀이 없다고 이미 알면 부르지 않고 「엑셀 없음」 — 모르면(안 주면) 부른다", () => {
    assert.equal(shouldFetchQuoteExcelPreview({ quoteId: "q-1", hasExcel: false }), false);
    assert.deepEqual(quoteExcelPreviewStateOf({ quoteId: "q-1", hasExcel: false, outcome: null }), {
      kind: "failed",
      reason: "EXCEL_NOT_ATTACHED",
      message: QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED,
    });
    assert.equal(shouldFetchQuoteExcelPreview({ quoteId: "q-1" }), true);
    assert.equal(shouldFetchQuoteExcelPreview({ quoteId: "q-1", hasExcel: true }), true);
  });

  test("받기 전에는 읽는 중, 받으면 그 결과", () => {
    assert.deepEqual(quoteExcelPreviewStateOf({ quoteId: "q-1", hasExcel: true, outcome: null }), { kind: "loading" });
    const ready = { kind: "ready" as const, grid: GRID, warnings: [] };
    assert.equal(quoteExcelPreviewStateOf({ quoteId: "q-1", hasExcel: true, outcome: ready }), ready);
  });
});

describe("🔴 사용자 결정 2 — 엑셀 모양이 먼저, 결재 PDF 는 바꿔 본다", () => {
  const SAVED: QuotePrintSignedPdf = { kind: "saved", id: "att-pdf", originalFileName: "결재본.pdf" };
  const PENDING: QuotePrintSignedPdf = { kind: "pending", fileName: "대기.pdf" };
  const READY: QuoteExcelPreviewState = { kind: "ready", grid: GRID, warnings: [] };
  const LOADING: QuoteExcelPreviewState = { kind: "loading" };
  const FAILURES: QuoteExcelPreviewState[] = [
    { kind: "failed", reason: "XLS_LEGACY", message: "x" },
    { kind: "failed", reason: "EXCEL_NOT_ATTACHED", message: "x" },
    { kind: "failed", reason: "SCAN_BLOCKED", message: "x" },
    { kind: "failed", reason: "OTHER", message: "x" },
    { kind: "unsaved" },
  ];

  test("결재 PDF 가 있으면 — 기본은 엑셀 모양 + [결재 PDF 보기], 바꾸면 결재 PDF 칸 + [엑셀 모양 보기]", () => {
    assert.deepEqual(excelOnlyPreviewLayout({ state: READY, view: "excel", signedPdf: SAVED }), {
      showExcel: true,
      showPdfPanel: false,
      toggle: "SHOW_PDF",
      canPrint: true,
    });
    assert.deepEqual(excelOnlyPreviewLayout({ state: READY, view: "pdf", signedPdf: SAVED }), {
      showExcel: false,
      showPdfPanel: true,
      toggle: "SHOW_EXCEL",
      canPrint: false,
    });
    // 읽는 중에도 같다 — 인쇄만 아직 없다.
    assert.deepEqual(excelOnlyPreviewLayout({ state: LOADING, view: "excel", signedPdf: SAVED }), {
      showExcel: true,
      showPdfPanel: false,
      toggle: "SHOW_PDF",
      canPrint: false,
    });
  });

  test("결재 PDF 가 없으면(올라가지 않은 것 포함) 단추가 없다 — [결재 PDF 보기] 화면으로 갈 수도 없다", () => {
    const withoutSavedPdf: (QuotePrintSignedPdf | null)[] = [null, PENDING];
    for (const signedPdf of withoutSavedPdf) {
      for (const view of ["excel", "pdf"] as const) {
        assert.deepEqual(excelOnlyPreviewLayout({ state: READY, view, signedPdf }), {
          showExcel: true,
          showPdfPanel: false,
          toggle: null,
          canPrint: true,
        });
      }
    }
  });

  test("🔴 엑셀을 못 그리면 — 실패 문장과 함께 결재 PDF 칸(볼 것이 하나라도 있게), 바꿔 볼 단추 · 인쇄 없음", () => {
    const anyPdf: (QuotePrintSignedPdf | null)[] = [SAVED, PENDING, null];
    for (const state of FAILURES) {
      for (const signedPdf of anyPdf) {
        for (const view of ["excel", "pdf"] as const) {
          assert.deepEqual(excelOnlyPreviewLayout({ state, view, signedPdf }), {
            showExcel: true,
            showPdfPanel: true,
            toggle: null,
            canPrint: false,
          });
        }
      }
    }
  });
});
