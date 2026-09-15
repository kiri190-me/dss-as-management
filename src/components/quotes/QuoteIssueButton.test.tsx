import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import QuoteIssueButton, { QUOTE_ISSUE_BUTTON_TITLE, QuoteIssueNoticeLines } from "./QuoteIssueButton";
import QuotePrintView, { type QuotePrintData } from "./QuotePrintView";

/**
 * ============================================================================
 * 수정 권한자의 [견적서 받기] 단추 · 인쇄 미리보기의 두 갈래 (견적서 B1c)
 * ============================================================================
 * 단추는 발행 통로(POST)를 부르므로 **링크가 아니다** — 주소 한 줄로 공유폴더에 파일이 생기면
 * 안 된다. 인쇄 미리보기는 보기 권한자도 들어오므로 `canIssue` 를 받은 경우에만 단추이고,
 * 안 받으면 지금 링크 그대로다(QuotePrintView.test.tsx · quote-print-excel-only.test.tsx 가
 * 그 옛 규칙을 그대로 본다). 누른 뒤의 흐름(저장하지 않은 변경 · 결과 줄)은 runQuoteIssue 를
 * 값으로 보는 quote-issue-download.test.ts 에 있다.
 * ============================================================================
 */

describe("단추", () => {
  test("🔴 링크가 아니라 단추다 — 설명(title)을 달고, 받기 주소가 어디에도 없다", () => {
    const html = renderToStaticMarkup(<QuoteIssueButton quoteId="q-1" label="견적서 받기" className="btn" />);
    assert.ok(html.includes('<button type="button"'), html);
    assert.ok(html.includes(">견적서 받기</button>"), html);
    assert.ok(html.includes("data-quote-issue"), html);
    assert.ok(html.includes(`title="${QUOTE_ISSUE_BUTTON_TITLE}"`), html);
    assert.ok(!html.includes("href="), html);
    assert.ok(!html.includes("/api/quotes/"), html);
  });

  test("잠그라면 잠긴다(저장 중 · 충돌)", () => {
    const html = renderToStaticMarkup(<QuoteIssueButton quoteId="q-1" label="견적서 받기" className="btn" disabled />);
    assert.ok(html.includes('disabled=""'), html);
  });

  test("누르기 전에는 결과 줄이 없다 — 부르는 쪽이 그리면 감싸는 상자도 없다", () => {
    const beside = renderToStaticMarkup(<QuoteIssueButton quoteId="q-1" label="견적서 받기" className="btn" />);
    assert.ok(!beside.includes('role="status"'), beside);
    const parent = renderToStaticMarkup(
      <QuoteIssueButton quoteId="q-1" label="견적서 받기" className="btn" showNotice={false} />
    );
    assert.ok(parent.startsWith("<button"), parent);
  });
});

describe("결과 줄", () => {
  test("결마다 색이 다르다 — 흐림 · 주의", () => {
    const html = renderToStaticMarkup(
      <QuoteIssueNoticeLines
        lines={[
          { text: "공유폴더에 저장했습니다: 2026/견적서/a.xlsx", tone: "normal" },
          { text: "공유폴더 저장이 꺼져 있습니다", tone: "muted" },
          { text: "엑셀 칸에 올리지 못했습니다(x)", tone: "warning" },
        ]}
      />
    );
    assert.ok(html.includes('role="status"'), html);
    assert.ok(html.includes("text-zinc-400") && html.includes("공유폴더 저장이 꺼져 있습니다"), html);
    assert.ok(html.includes("text-amber-700"), html);
    assert.ok(html.includes("break-all"), "긴 경로가 줄바꿈되지 않는다");
  });

  test("🔴 흰 종이 위(onPaper)에서는 다크 모드 색을 쓰지 않는다", () => {
    const html = renderToStaticMarkup(
      <QuoteIssueNoticeLines onPaper lines={[{ text: "공유폴더 저장이 꺼져 있습니다", tone: "muted" }]} />
    );
    assert.ok(!html.includes("dark:"), html);
  });

  test("줄이 없으면 아무것도 그리지 않는다", () => {
    assert.equal(renderToStaticMarkup(<QuoteIssueNoticeLines lines={[]} />), "");
  });
});

type Props = Parameters<typeof QuotePrintView>[0];

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

const NORMAL: QuotePrintData = {
  quoteNumber: "Q-2026-0001",
  quoteDate: "2026-09-01",
  customerNameText: "주성 엔지니어링",
  subject: "MBK200-JS3 수리",
  validity: null,
  delivery: null,
  payment: null,
  modelNameText: "MBK200-JS3",
  serialNumberText: "1708075",
  lotNumberText: null,
  workCost: "300000",
  items: [{ partId: null, partNameText: "커넥터 SMA", isOverhaulPart: false, quantity: 2, unitPrice: "12000" }],
};

const EXCEL_ONLY: QuotePrintData = { ...NORMAL, items: [], workCost: "0", isExcelOnly: true, manualSupplyAmount: "1500000" };

function render(overrides: Partial<Props> & { quote: QuotePrintData }): string {
  return renderToStaticMarkup(<QuotePrintView header={HEADER} quoteId="q-1" {...overrides} />);
}

describe("인쇄 미리보기 — 앱 양식", () => {
  test("🔴 수정 권한(canIssue)이면 「Excel 받기」가 발행 단추다 — 링크가 없다", () => {
    const html = render({ quote: NORMAL, canIssue: true });
    assert.ok(html.includes("data-quote-issue"), html);
    assert.ok(html.includes(">Excel 받기</button>"), html);
    assert.ok(!html.includes("/xlsx"), "보기 권한자의 링크가 함께 그려졌다");
  });

  test("🔴 권한을 안 주거나 거짓이면 지금 링크 그대로 — 보기 권한자 화면에 부작용 단추가 없다", () => {
    for (const html of [render({ quote: NORMAL }), render({ quote: NORMAL, canIssue: false })]) {
      assert.ok(html.includes('href="/api/quotes/q-1/xlsx"'), html);
      assert.ok(!html.includes("data-quote-issue"), html);
    }
    assert.equal(render({ quote: NORMAL, canIssue: false }), render({ quote: NORMAL }), "안 준 것과 거짓은 같은 화면이다");
  });

  test("저장 전(quoteId 없음)에는 수정 권한이어도 받을 수 없다고 적는다", () => {
    const html = render({ quote: NORMAL, quoteId: null, onClose: () => {}, canIssue: true });
    assert.ok(html.includes("Excel 은 저장한 뒤에 받을 수 있습니다"), html);
    assert.ok(!html.includes("data-quote-issue"), html);
  });

  test("겹쳐 뜬 미리보기(편집 폼 안)에서도 같은 단추다 — 돌아가기는 닫기 단추 그대로", () => {
    const html = render({ quote: NORMAL, onClose: () => {}, canIssue: true, hasUnsavedChanges: true });
    assert.ok(html.includes("data-quote-issue"), html);
    assert.ok(html.includes("← 편집으로 돌아가기"), html);
    assert.ok(!html.includes("/xlsx"), html);
  });
});

describe("인쇄 미리보기 — 엑셀 전용 갈래도 같다", () => {
  test("🔴 수정 권한이면 「견적서 받기」가 발행 단추다", () => {
    const html = render({ quote: EXCEL_ONLY, canIssue: true, signedPdf: null, hasExcel: true });
    assert.ok(html.includes("data-quote-issue"), html);
    assert.ok(html.includes(">견적서 받기</button>"), html);
    assert.ok(!html.includes("/api/quotes/q-1/xlsx"), html);
    // 올리기 · 지우기 단추는 여전히 없다 — 받기 단추 하나만 바뀌었다.
    for (const absent of ['type="file"', ">지우기<", ">파일 올리기<", ">바꾸기<"]) {
      assert.ok(!html.includes(absent), `미리보기에 '${absent}' 가 있다`);
    }
  });

  test("권한을 안 주면 링크 그대로", () => {
    const html = render({ quote: EXCEL_ONLY, signedPdf: null, hasExcel: true });
    assert.ok(html.includes('href="/api/quotes/q-1/xlsx"'), html);
    assert.ok(!html.includes("data-quote-issue"), html);
  });
});
