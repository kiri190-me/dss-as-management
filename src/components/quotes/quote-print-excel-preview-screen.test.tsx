import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import QuotePrintView, { ExcelOnlyQuotePreviewScreen, type QuotePrintData } from "./QuotePrintView";
import { EXCEL_ONLY_NO_SIGNED_PDF_TEXT, type QuotePrintSignedPdf } from "./quote-attachment-files";
import {
  QUOTE_EXCEL_PREVIEW_TEXT,
  type ExcelOnlyPreviewView,
  type QuoteExcelPreviewGrid,
  type QuoteExcelPreviewState,
} from "./quote-print-excel-preview";

/**
 * ============================================================================
 * 엑셀 전용 견적서 미리보기 — 붙인 수기 엑셀의 인쇄 모양 (견적서 ②b)
 * ============================================================================
 * 읽는 중 · 성공(격자) · 실패 셋 · 저장 전 · 결재 PDF 와의 관계(사용자 결정 2)를 그림으로 본다.
 * 바깥 조각(ExcelOnlyQuotePreview)은 서버 렌더에서 효과가 돌지 않으므로 늘 「읽는 중」·「저장 전」·
 * 「엑셀 없음(이미 앎)」 셋 가운데 하나다. 받은 뒤의 모습은 그림 조각(ExcelOnlyQuotePreviewScreen)에
 * 상태를 넣어 그린다 — 훅이 없어 함수로 불러 요소 나무를 걸을 수도 있다(단추 누르기).
 * 🔴 앱 양식 갈래는 QuotePrintView.test.tsx · quote-print-excel-only.test.tsx 가 그대로 본다.
 * ============================================================================
 */

type Props = Parameters<typeof QuotePrintView>[0];
type ScreenProps = Parameters<typeof ExcelOnlyQuotePreviewScreen>[0];

const HEADER: Props["header"] = {
  companyName: null,
  ceoLine: null,
  address: null,
  tel: null,
  fax: null,
  email: null,
  homepage: null,
  defaultValidity: null,
  defaultDelivery: null,
  defaultPayment: null,
  bankAccount: null,
};

/** 🔴 지어낸 자료다(저장소가 공개다). */
const EXCEL_ONLY: QuotePrintData = {
  quoteNumber: "Q-2026-0001",
  quoteDate: "2026-09-01",
  customerNameText: "가상 고객사",
  subject: "TST-500X 수리",
  validity: null,
  delivery: null,
  payment: null,
  modelNameText: null,
  serialNumberText: null,
  lotNumberText: null,
  workCost: "0",
  items: [],
  isExcelOnly: true,
  manualSupplyAmount: "3500000",
};

const SAVED_PDF: QuotePrintSignedPdf = { kind: "saved", id: "att-pdf", originalFileName: "결재본.pdf" };

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

type Cell = QuoteExcelPreviewGrid["rows"][number]["cells"][number];

function cell(row: number, column: number, overrides: Partial<Cell> = {}): Cell {
  return {
    row,
    column,
    colSpan: 1,
    rowSpan: 1,
    text: "",
    align: null,
    verticalAlign: null,
    wrap: false,
    bold: false,
    fontSizePt: null,
    borders: { top: null, right: null, bottom: null, left: null },
    fontColor: null,
    backgroundColor: null,
    valueKind: null,
    ...overrides,
  };
}

/** 사람이 만든 견적서 엑셀을 본뜬 격자 — A4 가로 · 가로 가운데 아님 · 색 · 그림 한 장. */
const GRID: QuoteExcelPreviewGrid = {
  firstRow: 1,
  lastRow: 2,
  firstColumn: 1,
  lastColumn: 3,
  columnWidthsPt: [60, 80, 100],
  widthPt: 240,
  heightPt: 40,
  rows: [
    {
      row: 1,
      heightPt: 20,
      cells: [
        cell(1, 1, {
          colSpan: 3,
          text: "견 적 서",
          bold: true,
          fontSizePt: 20,
          align: "center",
          fontColor: "#1F4E79",
          backgroundColor: "#FFFF00",
          borders: { top: null, right: null, bottom: "medium", left: null },
        }),
      ],
    },
    {
      row: 2,
      heightPt: 20,
      cells: [
        cell(2, 1, { text: " 단 가 " }),
        cell(2, 2, { text: "₩3,500,000 ", align: "right" }),
        cell(2, 3, { text: "2026년 9월 15일" }),
      ],
    },
  ],
  pictures: [{ name: "image1.png", leftPt: 10, topPt: 5, widthPt: 30, heightPt: 30, src: PNG_DATA_URI }],
  page: {
    paperSize: 9,
    scale: 0.92,
    orientation: "landscape",
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6 },
    horizontallyCentered: false,
    verticallyCentered: false,
  },
};

const READY: QuoteExcelPreviewState = { kind: "ready", grid: GRID, warnings: ["그림 1장은 빼고 그렸습니다."] };

function screenProps(overrides: Partial<ScreenProps> = {}): ScreenProps {
  return {
    quote: EXCEL_ONLY,
    quoteId: "q-1",
    signedPdf: SAVED_PDF,
    hasExcel: true,
    canIssue: false,
    hasUnsavedChanges: false,
    excel: READY,
    view: "excel",
    onViewChange: () => {},
    ...overrides,
  };
}

function renderScreen(overrides: Partial<ScreenProps> = {}): string {
  return renderToStaticMarkup(<ExcelOnlyQuotePreviewScreen {...screenProps(overrides)} />);
}

function renderView(overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <QuotePrintView header={HEADER} quote={EXCEL_ONLY} quoteId="q-1" signedPdf={SAVED_PDF} hasExcel {...overrides} />
  );
}

function* walk(node: ReactNode): Generator<ReactElement<{ children?: ReactNode; onClick?: () => void }>> {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) yield* walk(child);
    return;
  }
  if (!isValidElement(node)) return;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  yield element;
  yield* walk(element.props.children);
}

function buttonLabelled(tree: ReactNode, label: string) {
  return [...walk(tree)].filter((element) => element.type === "button" && element.props.children === label);
}

describe("읽는 중 — 바깥 조각이 처음 그리는 모습", () => {
  test("저장된 장 · 엑셀 있음 → 읽는 중(role=status), 격자 · 인쇄 단추는 아직 없다", () => {
    const html = renderView();
    assert.ok(html.includes('role="status"') && html.includes(QUOTE_EXCEL_PREVIEW_TEXT.LOADING), html);
    assert.ok(!html.includes("qxp-table"), html);
    assert.ok(!html.includes("인쇄 · PDF로 저장"), html);
    // 결재 PDF 가 있으니 바꿔 보는 단추는 있다(결정 2).
    assert.ok(html.includes(">결재 PDF 보기</button>"), html);
  });

  test("🔴 저장 전 새 견적서 → 「저장한 뒤 엑셀 모양으로 미리 볼 수 있습니다」 + 결재 PDF 칸", () => {
    const html = renderView({ quoteId: null, onClose: () => {}, signedPdf: { kind: "pending", fileName: "대기.pdf" } });
    assert.ok(html.includes("저장한 뒤 엑셀 모양으로 미리 볼 수 있습니다"), html);
    assert.ok(!html.includes(QUOTE_EXCEL_PREVIEW_TEXT.LOADING), "저장 전에는 부르지 않는다");
    assert.ok(html.includes("골라 둔 결재 PDF(대기.pdf)는 [저장]하면 올라갑니다"), html);
    assert.ok(!html.includes(">결재 PDF 보기</button>"), "올라가지 않은 PDF 로는 바꿔 볼 수 없다");
  });

  test("엑셀이 없다고 이미 알면 부르지 않고 「엑셀 없음」 — 결재 PDF 칸과 함께", () => {
    const html = renderView({ hasExcel: false });
    assert.ok(html.includes(QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED), html);
    assert.ok(html.includes('data-excel-preview-failure="EXCEL_NOT_ATTACHED"'), html);
    assert.ok(html.includes("download?view=full"), "볼 것이 하나라도 있게 결재 PDF 칸을 보인다");
  });
});

describe("성공 — 붙인 엑셀의 인쇄 모양", () => {
  const html = renderScreen();

  test("🔴 격자를 공용 그리기로 그린다 — 칸 글자 · 병합 · 글자 색 · 배경 · 그림(data URI)", () => {
    assert.ok(html.includes('class="qxp-sheet"') && html.includes('class="qxp-table"'), html);
    assert.ok(html.includes('colSpan="3"'), html);
    assert.ok(html.includes("견 적 서") && html.includes("₩3,500,000 ") && html.includes("2026년 9월 15일"), html);
    assert.ok(html.includes("color:#1F4E79") && html.includes("background-color:#FFFF00"), html);
    assert.ok(html.includes(`class="qxp-picture" src="${PNG_DATA_URI}"`), html);
    // 앞뒤 공백을 지우지 않는다 — 회계 서식이 비워 둔 자리다.
    assert.ok(html.includes("> 단 가 <"), html);
    assert.ok(!html.includes("부품 비용"), "앱 양식이 섞였다");
  });

  test("🔴 [인쇄 · PDF로 저장] — 용지 · 방향 · 여백은 엑셀의 인쇄 설정(A4 가로)", () => {
    assert.ok(html.includes(">인쇄 · PDF로 저장</button>"), html);
    assert.ok(html.includes("@page { size: 297.00mm 210.00mm; margin: 15.24mm 10.16mm 15.24mm 10.16mm; }"), html);
    // 가로 가운데가 아닌 엑셀 — 왼쪽에 붙인다.
    assert.ok(html.includes("margin: 0;"), html);
    // 칸 배경이 인쇄에서도 나오게.
    assert.ok(html.includes("print-color-adjust: exact"), html);
    // 격자 말고는 인쇄에 나가지 않는다.
    assert.ok(html.includes("print:hidden"), html);
  });

  test("경고는 화면에만 — 목록으로", () => {
    assert.ok(html.includes('role="note"') && html.includes("그림 1장은 빼고 그렸습니다."), html);
  });

  test("결재 PDF 칸은 아직 안 보이고 [결재 PDF 보기] 단추 · 파일 이름 한 줄", () => {
    assert.ok(!html.includes("download?view=full"), html);
    assert.ok(html.includes(">결재 PDF 보기</button>"), html);
    assert.ok(html.includes("결재본.pdf — [결재 PDF 보기]로 볼 수 있습니다"), html);
  });

  test("엑셀의 배율로 한 장에 안 들어가면 줄였다고 알린다", () => {
    const tall = renderScreen({
      excel: { kind: "ready", grid: { ...GRID, heightPt: 2000, page: { ...GRID.page, scale: 1 } }, warnings: [] },
    });
    assert.ok(tall.includes("종이 한 장에 들어가도록 엑셀의 배율(100%)보다 줄여"), tall);
    assert.ok(!html.includes("종이 한 장에 들어가도록"), "배율 그대로면 알리지 않는다");
    const centered = renderScreen({
      excel: { kind: "ready", grid: { ...GRID, page: { ...GRID.page, horizontallyCentered: true } }, warnings: [] },
    });
    assert.ok(centered.includes("margin: 0 auto;\n  /* 칸마다의"), "가로 가운데 엑셀은 가운데");
  });

  test("결재 PDF 가 없으면 바꿔 보는 단추가 없고, 사용자가 정한 문장을 한 줄로", () => {
    const none = renderScreen({ signedPdf: null });
    assert.ok(!none.includes(">결재 PDF 보기</button>"), none);
    assert.ok(none.includes(EXCEL_ONLY_NO_SIGNED_PDF_TEXT), none);
    assert.ok(none.includes(">인쇄 · PDF로 저장</button>"), none);
  });
});

describe("🔴 실패 셋 — 실패 문장과 함께 결재 PDF 를 보인다", () => {
  const cases: { name: string; excel: QuoteExcelPreviewState; expected: string }[] = [
    {
      name: "415 옛 .xls",
      excel: { kind: "failed", reason: "XLS_LEGACY", message: QUOTE_EXCEL_PREVIEW_TEXT.XLS_LEGACY },
      expected:
        "옛 엑셀 형식(.xls)이라 미리보기를 그릴 수 없습니다 — xlsx 로 다시 저장해 올리거나 [견적서 받기]로 받아 보세요",
    },
    {
      name: "404 엑셀 없음",
      excel: { kind: "failed", reason: "EXCEL_NOT_ATTACHED", message: QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED },
      expected: QUOTE_EXCEL_PREVIEW_TEXT.EXCEL_NOT_ATTACHED,
    },
    {
      name: "403 검사 막힘",
      excel: { kind: "failed", reason: "SCAN_BLOCKED", message: "악성코드 검사가 끝나지 않았습니다." },
      expected: "악성코드 검사가 끝나지 않았습니다.",
    },
  ];

  for (const { name, excel, expected } of cases) {
    test(`${name} — 문장(role=alert) + 결재 PDF 칸, 바꿔 볼 단추 · 인쇄 없음`, () => {
      for (const view of ["excel", "pdf"] as const) {
        const html = renderScreen({ excel, view });
        assert.ok(html.includes('role="alert"') && html.includes(expected), html);
        assert.ok(html.includes('href="/api/attachments/att-pdf/download?view=full"'), html);
        assert.ok(!html.includes(">결재 PDF 보기</button>") && !html.includes(">엑셀 모양 보기</button>"), html);
        assert.ok(!html.includes("인쇄 · PDF로 저장"), html);
        assert.ok(!html.includes("qxp-table"), html);
      }
    });
  }

  test("결재 PDF 도 없으면 — 실패 문장과 결재 PDF 칸의 「없음」 문장", () => {
    const html = renderScreen({ excel: cases[0].excel, signedPdf: null });
    assert.ok(html.includes(cases[0].expected), html);
    assert.ok(html.includes(EXCEL_ONLY_NO_SIGNED_PDF_TEXT), html);
  });
});

describe("🔴 결정 2 — [결재 PDF 보기] ↔ [엑셀 모양 보기]", () => {
  test("[결재 PDF 보기] 화면 — 결재 PDF 칸 + 돌아오는 단추, 격자 · 인쇄 없음", () => {
    const html = renderScreen({ view: "pdf" });
    assert.ok(html.includes('href="/api/attachments/att-pdf/download?view=full"'), html);
    assert.ok(html.includes(">엑셀 모양 보기</button>"), html);
    assert.ok(!html.includes("qxp-table") && !html.includes("인쇄 · PDF로 저장"), html);
  });

  test("단추를 누르면 보기가 바뀐다 — 엑셀 → 결재 PDF → 엑셀", () => {
    const seen: ExcelOnlyPreviewView[] = [];
    const onViewChange = (view: ExcelOnlyPreviewView) => seen.push(view);

    const excelTree = ExcelOnlyQuotePreviewScreen(screenProps({ onViewChange }));
    const toPdf = buttonLabelled(excelTree, "결재 PDF 보기");
    assert.equal(toPdf.length, 1);
    toPdf[0].props.onClick?.();

    const pdfTree = ExcelOnlyQuotePreviewScreen(screenProps({ view: "pdf", onViewChange }));
    const toExcel = buttonLabelled(pdfTree, "엑셀 모양 보기");
    assert.equal(toExcel.length, 1);
    toExcel[0].props.onClick?.();

    assert.deepEqual(seen, ["pdf", "excel"]);
  });

  test("받기 단추는 그대로 — 보기 권한자 링크 · 수정 권한자 발행 단추", () => {
    assert.ok(renderScreen().includes('href="/api/quotes/q-1/xlsx"'));
    const issue = renderScreen({ canIssue: true });
    assert.ok(issue.includes("data-quote-issue") && !issue.includes('href="/api/quotes/q-1/xlsx"'), issue);
  });
});
