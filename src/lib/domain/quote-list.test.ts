import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildQuoteSummaryLine,
  formatQuoteSupplyAmount,
  quoteSupplyAmountOf,
  sumQuoteSupplyAmount,
  toAmount,
} from "./quote-list";

const SAMPLE = {
  quoteNumber: "DSS 2026-077",
  customerName: "ICD",
  modelName: "CFK300FH-IC2",
  lotNumber: "WU8042",
  serialNumber: "1612027",
  faultDescription: "Bias Fwd Drop 발생",
};

test("목록 한 줄 — 사용자가 준 예시와 글자까지 같다", () => {
  assert.equal(
    buildQuoteSummaryLine(SAMPLE),
    "DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생"
  );
});

/**
 * 이 시험이 이 파일에서 제일 중요하다. 값의 모양(WU 접두 vs 숫자만)으로 짐작하면
 * 반대로 붙고, 견적서 양식에 박혀 있던 예시가 정확히 그 반대로 읽히게 생겼다.
 * 실제로 한 번 틀렸던 자리다.
 */
test("L/N 이 S/N 보다 앞이다 — 값 모양으로 짐작하지 않는다", () => {
  const line = buildQuoteSummaryLine(SAMPLE);
  assert.ok(
    line.indexOf("WU8042") < line.indexOf("1612027"),
    "WU8042(L/N)가 1612027(S/N)보다 앞에 와야 한다"
  );
});

test("빈 칸은 자리를 남기지 않고 통째로 빠진다", () => {
  assert.equal(
    buildQuoteSummaryLine({ ...SAMPLE, lotNumber: null, faultDescription: null }),
    "DSS 2026-077 ICD CFK300FH-IC2 1612027"
  );
  // 공백만 적힌 값도 없는 것으로 접는다.
  assert.equal(
    buildQuoteSummaryLine({ ...SAMPLE, modelName: "   ", serialNumber: "" }),
    "DSS 2026-077 ICD WU8042 Bias Fwd Drop 발생"
  );
  assert.ok(!buildQuoteSummaryLine({ ...SAMPLE, modelName: null }).includes("  "));
});

test("연결된 수리 건이 없어 정보가 번호와 고객사뿐일 때도 줄이 만들어진다", () => {
  assert.equal(
    buildQuoteSummaryLine({
      quoteNumber: "DSS 2026-078",
      customerName: "INVENIA",
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      faultDescription: null,
    }),
    "DSS 2026-078 INVENIA"
  );
});

test("공급가 = 부품비 + 작업비", () => {
  assert.equal(
    sumQuoteSupplyAmount(
      [
        { quantity: 1, unitPrice: "1850000.00" },
        { quantity: 2, unitPrice: "1100000.00" },
        { quantity: 1, unitPrice: "45000.00" },
      ],
      "1200000.00"
    ),
    5_295_000
  );
  assert.equal(sumQuoteSupplyAmount([], "0"), 0);
});

test("금액 문자열: 못 읽는 값은 0 으로 본다 — 합계가 통째로 안 그려지는 것보다 낫다", () => {
  assert.equal(toAmount("1234.50"), 1234.5);
  assert.equal(toAmount(""), 0);
  assert.equal(toAmount("   "), 0);
  assert.equal(toAmount(null), 0);
  assert.equal(toAmount(undefined), 0);
  assert.equal(toAmount("숫자아님"), 0);
});

// ── 공급가액 한 곳 — 엑셀 전용 견적서 (2026-09-15 Q2) ─────────────────────────

const ITEMS = [
  { quantity: 2, unitPrice: "45000.00" },
  { quantity: 1, unitPrice: "10000.00" },
];

test("일반 견적서의 공급가액은 예전 셈법 그대로다 — 부품 줄 합 + 작업비", () => {
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: false, manualSupplyAmount: null, items: ITEMS, workCost: "1200000.00" }),
    sumQuoteSupplyAmount(ITEMS, "1200000.00")
  );
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: false, manualSupplyAmount: null, items: ITEMS, workCost: "1200000.00" }),
    1_300_000
  );
});

test("엑셀 전용 견적서의 공급가액은 손으로 적은 값이다 — 품목 · 작업비는 보지 않는다", () => {
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "3456789.50", items: ITEMS, workCost: "1200000.00" }),
    3_456_789.5
  );
  // 0 은 무상 견적이라는 실제 값이다 — null 과 다르다.
  assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "0", items: [], workCost: "0" }), 0);
});

test("🔴 엑셀 전용인데 금액이 비어 있으면 null — 0 으로 접지 않는다(화면은 「—」)", () => {
  assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: null, items: [], workCost: "0" }), null);
  assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "  ", items: [], workCost: "0" }), null);
  // 작업비가 남아 있어도 그 값으로 메우지 않는다.
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: null, items: ITEMS, workCost: "1200000.00" }),
    null
  );
});

test("감사 스냅숏 · 내자 정리 금액 칸의 모양 — 소수 둘째 자리, 모르면 null", () => {
  assert.equal(formatQuoteSupplyAmount(1_300_000), "1300000.00");
  assert.equal(formatQuoteSupplyAmount(0), "0.00");
  assert.equal(formatQuoteSupplyAmount(3_456_789.5), "3456789.50");
  assert.equal(formatQuoteSupplyAmount(null), null);
});
