import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import QuotePrintView, { type QuotePrintData } from "./QuotePrintView";
import type { QuotePrintSignedPdf } from "./quote-attachment-files";

/**
 * ============================================================================
 * 미리보기 화면의 엑셀 전용 갈래 (2026-09-15 Q3)
 * ============================================================================
 * 엑셀 전용 견적서는 앱 양식 대신 결재 PDF 를 보인다(없으면 [견적서 받기]로 보낸다).
 * 🔴 일반 견적서는 **한 글자도 달라지지 않아야 한다** — 맨 아래 묶음이 그것을 붙잡는다.
 * 돌아가기 · Excel 받기의 옛 규칙은 QuotePrintView.test.tsx 가 그대로 본다.
 * ============================================================================
 */

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

const EXCEL_ONLY: QuotePrintData = {
  ...NORMAL,
  items: [],
  workCost: "0",
  isExcelOnly: true,
  manualSupplyAmount: "1500000",
};

const SAVED_PDF: QuotePrintSignedPdf = { kind: "saved", id: "att-pdf", originalFileName: "결재본.pdf" };

function render(overrides: Partial<Props> & { quote: QuotePrintData }): string {
  return renderToStaticMarkup(<QuotePrintView header={HEADER} quoteId="q-1" {...overrides} />);
}

describe("엑셀 전용 — 결재 PDF 가 있을 때", () => {
  const html = render({ quote: EXCEL_ONLY, signedPdf: SAVED_PDF, hasExcel: true });

  test("🔴 앱 양식을 그리지 않는다 — 품목 없는 빈 견적서가 나가지 않게", () => {
    assert.ok(!html.includes("견 적 서"), "앱 양식의 제목이 그려졌다");
    assert.ok(!html.includes("부품 비용"), "앱 양식의 품목 표가 그려졌다");
    assert.ok(!html.includes("인쇄 · PDF로 저장"), "앱 양식 인쇄 단추가 있다");
    assert.ok(html.includes("엑셀 전용 견적서"), html);
  });

  test("🔴 결재 PDF 를 새 탭에서 페이지 안으로 연다(view=full) — 내려받기도 곁에", () => {
    assert.ok(
      html.includes('href="/api/attachments/att-pdf/download?view=full" target="_blank" rel="noopener noreferrer"'),
      html
    );
    assert.ok(html.includes("결재 PDF 보기 (새 탭)"), html);
    assert.ok(html.includes('href="/api/attachments/att-pdf/download"'), html);
    assert.ok(html.includes("결재본.pdf"), html);
    // 끼워 보이지 않는 까닭을 적는다(frame-ancestors 'none').
    assert.ok(html.includes("이 화면 안에 끼워 보일 수 없어 새 탭에서 엽니다"), html);
    assert.ok(!html.includes("<iframe") && !html.includes("<object") && !html.includes("<embed"), html);
  });

  test("[견적서 받기]는 받기 통로 그대로(붙인 엑셀을 내려준다) · 손으로 적은 공급가액", () => {
    assert.ok(html.includes('href="/api/quotes/q-1/xlsx"'), html);
    assert.ok(html.includes(">견적서 받기<"), html);
    assert.ok(html.includes("₩1,500,000 (V.A.T. 별도)"), html);
    assert.ok(html.includes("Q-2026-0001") && html.includes("주성 엔지니어링") && html.includes("MBK200-JS3 수리"), html);
    assert.ok(html.includes("2026년 9월 1일"), html);
  });

  test("🔴 보기 권한만 있어도 여는 화면이다 — 올리기 · 지우기 단추가 없다", () => {
    for (const absent of ['type="file"', ">지우기<", ">파일 올리기<", ">바꾸기<"]) {
      assert.ok(!html.includes(absent), `미리보기에 '${absent}' 가 있다`);
    }
  });

  test("엑셀이 붙어 있으면 엑셀 경고가 없다", () => {
    assert.ok(!html.includes("수기 견적서 엑셀도 아직 붙지 않았습니다"), html);
  });
});

describe("엑셀 전용 — 결재 PDF 가 없을 때", () => {
  test("🔴 사용자가 정한 문장으로 [견적서 받기]를 가리킨다", () => {
    const html = render({ quote: EXCEL_ONLY, signedPdf: null, hasExcel: true });
    assert.ok(html.includes("결재 PDF 가 아직 없습니다 — [견적서 받기]로 붙인 엑셀을 받으세요"), html);
    assert.ok(!html.includes("download?view=full"), html);
  });

  test("엑셀까지 없으면 눈에 띄게 알린다 — 모르면(안 주면) 알리지 않는다", () => {
    const missing = render({ quote: EXCEL_ONLY, signedPdf: null, hasExcel: false });
    assert.ok(missing.includes("수기 견적서 엑셀도 아직 붙지 않았습니다"), missing);
    assert.ok(missing.includes('role="alert"'), missing);
    const unknown = render({ quote: EXCEL_ONLY, signedPdf: null });
    assert.ok(!unknown.includes("수기 견적서 엑셀도 아직 붙지 않았습니다"), unknown);
  });

  test("새 견적서가 들고 있는 결재 PDF 는 저장하면 올라간다고", () => {
    const html = render({
      quote: EXCEL_ONLY,
      quoteId: null,
      onClose: () => {},
      signedPdf: { kind: "pending", fileName: "결재 대기.pdf" },
    });
    assert.ok(html.includes("골라 둔 결재 PDF(결재 대기.pdf)는 [저장]하면 올라갑니다"), html);
    // 저장 전에는 받을 수 없다 — 옛 규칙과 같은 문장.
    assert.ok(html.includes("Excel 은 저장한 뒤에 받을 수 있습니다"), html);
    assert.ok(!html.includes("/xlsx"), html);
  });

  test("🔴 공급가액을 아직 적지 않았으면 「—」 — ₩0 으로 단정하지 않는다", () => {
    const html = render({ quote: { ...EXCEL_ONLY, manualSupplyAmount: null }, signedPdf: null });
    assert.ok(html.includes("— (아직 적지 않았습니다)"), html);
    assert.ok(!html.includes("₩0"), html);
  });
});

describe("엑셀 전용 — 돌아가는 자리", () => {
  test("겹쳐 뜬 미리보기(onClose)는 닫기 단추, 독립 페이지는 넘겨받은 주소", () => {
    const overlay = render({ quote: EXCEL_ONLY, onClose: () => {} });
    assert.ok(overlay.includes("← 편집으로 돌아가기"), overlay);
    assert.ok(!overlay.includes('href="/quotes/q-1"'), overlay);

    const page = render({ quote: EXCEL_ONLY, backHref: "/quotes/q-1?repairCaseId=abc" });
    assert.ok(page.includes('href="/quotes/q-1?repairCaseId=abc"'), page);
    assert.ok(page.includes("← 견적서로 돌아가기"), page);
  });
});

describe("🔴 일반 견적서는 지금 그대로", () => {
  test("엑셀 전용이 꺼져 있으면 결재 PDF · 엑셀 값을 받아도 앱 양식 한 장 그대로다", () => {
    const before = render({ quote: NORMAL });
    const after = render({
      quote: { ...NORMAL, isExcelOnly: false, manualSupplyAmount: null },
      signedPdf: SAVED_PDF,
      hasExcel: false,
    });
    assert.equal(after, before, "일반 견적서의 미리보기가 달라졌다");
    assert.ok(before.includes("견 적 서"));
  });

  test("금액은 quoteSupplyAmountOf 로 셈해도 부품 줄 합 + 작업비 그대로다", () => {
    // 2 × 12,000 + 300,000 = 324,000 — 공급가 · 금액 줄 모두.
    const html = render({ quote: NORMAL });
    assert.ok(html.includes("₩324,000"), html);
    assert.ok(html.includes("₩32,400"), "부가세가 달라졌다");
    assert.ok(html.includes("₩356,400"), "합계가 달라졌다");
  });
});
