import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import QuoteIssueButton, { QUOTE_ISSUE_BUTTON_TITLE, QuoteIssueNoticeLines } from "./QuoteIssueButton";
import QuotePrintView, { type QuotePrintData } from "./QuotePrintView";

/**
 * ============================================================================
 * 발행 단추 조각 · 결과 줄 · 🔴 인쇄 미리보기에는 받기가 없다 (2026-10-06)
 * ============================================================================
 * 2026-09-15(견적서 B1c)에는 수정 권한자에게 발행 단추(POST …/issue)를, 보기 권한자에게 링크를
 * 주었다. 같은 날 단추를 없애고 링크만 남겼는데, 사용자가 다시 정했다 — 「내려받기도 아예
 * 없앤다」. 그래서 미리보기 두 갈래(앱 양식 · 엑셀 전용) 모두 **받는 길이 없다.** 견적서
 * 엑셀은 [저장]이 사내 공유폴더에 넣는다(server/actions/quotes.ts). 여기 아래 「인쇄
 * 미리보기」 두 묶음이 그것을 못 박는다 — 링크가 되살아나면 깨진다.
 *
 * 🔴 **[인쇄 · PDF로 저장]은 그대로다** — 미리보기는 없앤 기능이 아니다.
 *
 * 🔴 조각(QuoteIssueButton · QuoteIssueNoticeLines)은 **지우지 않았다** — 통로와 서비스가 살아
 * 있고, 결과 줄은 결재 PDF 올리기 · [폴더 열기]가 그대로 쓴다. 단추 자체를 그리는 화면은 이제
 * 없다. 아래 「단추」 묶음은 그 조각이 홀로 성한지만 본다.
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

/** 🔴 받는 길이 하나도 없다 — 주소 · 글자 · 저장 전 곁말 셋을 함께 본다. */
function assertNoDownload(html: string) {
  assert.ok(!html.includes("/xlsx"), "받기 주소가 되살아났다");
  assert.ok(!html.includes("Excel 받기"), "[Excel 받기]가 되살아났다");
  assert.ok(!html.includes("견적서 받기"), "[견적서 받기]가 되살아났다");
  // 받을 것이 없으니 「저장한 뒤에 받을 수 있습니다」도 가리킬 데가 없다.
  assert.ok(!html.includes("Excel 은 저장한 뒤에"), "옛 곁말이 남았다");
  assert.ok(!html.includes("data-quote-issue"), "발행 단추가 남았다");
}

describe("인쇄 미리보기 — 앱 양식", () => {
  test("🔴 받는 길이 없다 — 인쇄만 남는다", () => {
    const html = render({ quote: NORMAL });
    assertNoDownload(html);
    assert.ok(html.includes(">인쇄 · PDF로 저장</button>"), html);
  });

  test("🔴 저장 전(quoteId 없음)에도 같다 — 갈리던 갈래 자체가 없어졌다", () => {
    const html = render({ quote: NORMAL, quoteId: null, onClose: () => {} });
    assertNoDownload(html);
    assert.ok(html.includes(">인쇄 · PDF로 저장</button>"), html);
  });

  test("겹쳐 뜬 미리보기(편집 폼 안)도 같다 — 돌아가기는 닫기 단추 그대로", () => {
    const html = render({ quote: NORMAL, onClose: () => {} });
    assertNoDownload(html);
    assert.ok(html.includes("← 편집으로 돌아가기"), html);
  });
});

describe("인쇄 미리보기 — 엑셀 전용 갈래도 같다", () => {
  test("🔴 받는 길이 없다 — 올리기 · 지우기도 여전히 없다", () => {
    const html = render({ quote: EXCEL_ONLY, signedPdf: null, hasExcel: true });
    assertNoDownload(html);
    for (const absent of ['type="file"', ">지우기<", ">파일 올리기<", ">바꾸기<"]) {
      assert.ok(!html.includes(absent), `미리보기에 '${absent}' 가 있다`);
    }
  });

  test("🔴 저장 전(quoteId 없음)에도 같다", () => {
    const html = render({ quote: EXCEL_ONLY, quoteId: null, onClose: () => {}, signedPdf: null, hasExcel: true });
    assertNoDownload(html);
  });
});
