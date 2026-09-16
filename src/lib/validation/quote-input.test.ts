import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_QUOTE_ITEMS,
  QUOTE_KINDS,
  isQuoteKind,
  isValidExpectedVersion,
  isValidQuoteId,
  quoteExcelOnlyFieldErrors,
  validateQuoteFields,
} from "./quote-input";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

const MINIMAL = {
  quoteNumber: "DSS 2026-077",
  quoteDate: "2026-08-28",
  customerNameText: "ICD Co.,Ltd",
  subject: "CFK300FH-IC2 수리 견적",
};

function ok(raw: Record<string, unknown>) {
  const result = validateQuoteFields(raw);
  assert.equal(result.ok, true, `통과할 줄 알았는데 실패: ${JSON.stringify(result)}`);
  assert.ok(result.ok);
  return result.data;
}

function errors(raw: Record<string, unknown>) {
  const result = validateQuoteFields(raw);
  assert.equal(result.ok, false, "실패할 줄 알았는데 통과했다");
  assert.ok(!result.ok);
  return result.fieldErrors;
}

test("필수 넷만 있으면 통과한다 — 나머지는 전부 비워도 된다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.quoteNumber, "DSS 2026-077");
  assert.equal(data.quoteDate, "2026-08-28");
  assert.equal(data.customerNameText, "ICD Co.,Ltd");
  assert.equal(data.subject, "CFK300FH-IC2 수리 견적");
  // 모델명·L/N·S/N 이 없는 견적(부품만 파는 경우)이 실제로 있다.
  assert.equal(data.modelNameText, null);
  assert.equal(data.lotNumberText, null);
  assert.equal(data.serialNumberText, null);
  assert.deepEqual(data.items, []);
  assert.equal(data.workCost, "0");
});

test("필수 넷이 비면 칸마다 오류가 붙는다", () => {
  const fieldErrors = errors({});
  assert.match(fieldErrors.quoteNumber, /발행번호/);
  assert.match(fieldErrors.quoteDate, /발행일자/);
  assert.match(fieldErrors.customerNameText, /공급처/);
  assert.match(fieldErrors.subject, /품명/);
});

test("공백만 적은 값은 비어 있는 것으로 본다", () => {
  assert.match(errors({ ...MINIMAL, quoteNumber: "   " }).quoteNumber, /발행번호/);
  assert.equal(ok({ ...MINIMAL, modelNameText: "   " }).modelNameText, null);
});

test("발행일자는 실제 달력에 있는 날이어야 한다", () => {
  assert.match(errors({ ...MINIMAL, quoteDate: "2026-02-30" }).quoteDate, /YYYY-MM-DD/);
  assert.match(errors({ ...MINIMAL, quoteDate: "26-08-28" }).quoteDate, /YYYY-MM-DD/);
  assert.equal(ok({ ...MINIMAL, quoteDate: "2024-02-29" }).quoteDate, "2024-02-29");
});

test("유효기간·납기·결재조건은 비면 null — 양식 문구를 그대로 쓴다는 뜻이다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.validity, null);
  assert.equal(data.delivery, null);
  assert.equal(data.payment, null);
  assert.equal(ok({ ...MINIMAL, validity: "발행일로부터 8주" }).validity, "발행일로부터 8주");
});

test("금액: 쉼표를 지우고 문자열 그대로 둔다 — Number 를 거치면 오차가 쌓인다", () => {
  assert.equal(ok({ ...MINIMAL, workCost: "1,200,000" }).workCost, "1200000");
  assert.equal(ok({ ...MINIMAL, workCost: "1234.50" }).workCost, "1234.50");
  assert.equal(ok({ ...MINIMAL, workCost: 1200000 }).workCost, "1200000");
});

test("금액: numeric(15,2) 폭을 넘거나 형식이 아니면 거절한다", () => {
  // 정수부 14자리 — DB 에서 22003 이 나기 전에 여기서 잡는다.
  assert.match(errors({ ...MINIMAL, workCost: "12345678901234" }).workCost, /작업비/);
  assert.match(errors({ ...MINIMAL, workCost: "1.234" }).workCost, /작업비/);
  assert.match(errors({ ...MINIMAL, workCost: "-100" }).workCost, /작업비/);
  assert.match(errors({ ...MINIMAL, workCost: "삼백만" }).workCost, /작업비/);
});

test("부품 줄: 정상 입력", () => {
  const data = ok({
    ...MINIMAL,
    items: [
      { partId: VALID_UUID, partNameText: "Bias Board ASSY", quantity: 1, unitPrice: "1850000" },
      { partId: null, partNameText: "냉각 팬", quantity: 2, unitPrice: "45,000" },
    ],
  });
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].partId, VALID_UUID);
  assert.equal(data.items[1].partId, null);
  assert.equal(data.items[1].unitPrice, "45000");
});

test("부품 줄의 오류는 줄 번호를 낀 키로 온다 — 다섯째가 틀렸는데 첫 줄에 붙으면 안 된다", () => {
  const fieldErrors = errors({
    ...MINIMAL,
    items: [
      { partNameText: "정상", quantity: 1, unitPrice: "100" },
      { partNameText: "", quantity: 1, unitPrice: "100" },
      { partNameText: "수량0", quantity: 0, unitPrice: "100" },
      { partNameText: "단가이상", quantity: 1, unitPrice: "abc" },
    ],
  });
  assert.ok(!fieldErrors["items.0.partNameText"]);
  assert.match(fieldErrors["items.1.partNameText"], /2번째/);
  assert.match(fieldErrors["items.2.quantity"], /3번째/);
  assert.match(fieldErrors["items.3.unitPrice"], /4번째/);
});

test("수량은 1 이상의 정수여야 한다 — CHECK 제약과 같은 규칙", () => {
  assert.match(errors({ ...MINIMAL, items: [{ partNameText: "a", quantity: 0, unitPrice: "1" }] })["items.0.quantity"], /수량/);
  assert.match(errors({ ...MINIMAL, items: [{ partNameText: "a", quantity: -1, unitPrice: "1" }] })["items.0.quantity"], /수량/);
  assert.match(errors({ ...MINIMAL, items: [{ partNameText: "a", quantity: 1.5, unitPrice: "1" }] })["items.0.quantity"], /수량/);
});

/**
 * ============================================================================
 * 케이블 견적서 — 종류 · 규격 · 설명 줄 · 특이사항 (2026-09-16 케이블 ③)
 * ============================================================================
 */
test("🔴 케이블이 고를 수 있는 종류가 됐다 — 이 한 줄이 만들기 · 검증 · 열기 관문을 연다", () => {
  assert.deepEqual([...QUOTE_KINDS], ["DOMESTIC", "OVERHAUL", "CABLE"]);
  assert.equal(isQuoteKind("CABLE"), true);
  assert.equal(ok({ ...MINIMAL, kind: "CABLE" }).kind, "CABLE");
  // 모르는 종류는 여전히 거절한다.
  assert.match(errors({ ...MINIMAL, kind: "ANTENNA" }).kind, /견적서 종류/);
});

test("🔴 설명 줄은 글자 하나뿐이다 — 수량 · 단가 · 규격 · 재고 연결이 NULL 로 못 박힌다", () => {
  const data = ok({
    ...MINIMAL,
    kind: "CABLE",
    items: [
      // 화면은 보내지 않는 값들이다. 그래도 섞여 오면 **버린다** — 남으면 DB 가
      // 그 줄을 거절한다(CHECK quote_items_amounts_item_line_only).
      {
        kind: "NOTE",
        partNameText: "* 20kW RFG 부속케이블 Parts 3종",
        quantity: 3,
        unitPrice: "1000",
        partSpecText: "3M",
        partId: VALID_UUID,
        isOverhaulPart: true,
      },
    ],
  });
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].kind, "NOTE");
  assert.equal(data.items[0].partNameText, "* 20kW RFG 부속케이블 Parts 3종");
  assert.equal(data.items[0].quantity, null);
  assert.equal(data.items[0].unitPrice, null);
  assert.equal(data.items[0].partSpecText, null);
  assert.equal(data.items[0].partId, null);
  assert.equal(data.items[0].isOverhaulPart, false);
});

test("🔴 설명 줄도 글자는 있어야 한다 — 빈 줄은 문서에 적힐 것이 없다", () => {
  const fieldErrors = errors({
    ...MINIMAL,
    kind: "CABLE",
    items: [{ kind: "NOTE", partNameText: "   " }],
  });
  assert.match(fieldErrors["items.0.partNameText"], /1번째 설명 줄/);
});

test("🔴 품목 줄은 종류를 적어도 안 적어도 같다 — 안 적으면 품목 줄이다(DB 기본값과 같은 규칙)", () => {
  const withKind = ok({
    ...MINIMAL,
    items: [{ kind: "ITEM", partNameText: "케이블", quantity: 2, unitPrice: "1000" }],
  });
  const withoutKind = ok({
    ...MINIMAL,
    items: [{ partNameText: "케이블", quantity: 2, unitPrice: "1000" }],
  });
  assert.equal(withKind.items[0].kind, "ITEM");
  assert.equal(withoutKind.items[0].kind, "ITEM");
  assert.deepEqual(withoutKind.items, withKind.items);
});

test("모르는 줄 종류는 품목 줄로 접지 않고 거절한다 — 접으면 설명이 수량 없는 품목이 된다", () => {
  const fieldErrors = errors({
    ...MINIMAL,
    items: [{ kind: "HEADING", partNameText: "묶음 제목" }],
  });
  assert.match(fieldErrors["items.0.kind"], /1번째 줄의 종류/);
});

test("규격은 없어도 되고, 앞뒤 공백만 있으면 없는 것으로 본다", () => {
  const data = ok({
    ...MINIMAL,
    items: [
      { partNameText: "케이블 A", partSpecText: " 5C-FB 3M ", quantity: 1, unitPrice: "1000" },
      { partNameText: "케이블 B", partSpecText: "   ", quantity: 1, unitPrice: "1000" },
      { partNameText: "케이블 C", quantity: 1, unitPrice: "1000" },
    ],
  });
  assert.equal(data.items[0].partSpecText, "5C-FB 3M");
  assert.equal(data.items[1].partSpecText, null);
  assert.equal(data.items[2].partSpecText, null);
});

test("🔴 특이사항은 여러 줄이 그대로 들어간다 — 비우면 null(양식의 빈 칸)", () => {
  assert.equal(ok(MINIMAL).remarks, null);
  assert.equal(ok({ ...MINIMAL, remarks: "   " }).remarks, null);
  const multiline = "1) 케이블 길이는 발주 시 확정\n2) 부가세 별도";
  assert.equal(ok({ ...MINIMAL, kind: "CABLE", remarks: `  ${multiline}  ` }).remarks, multiline);
});

test("단가 0 은 허용한다 — 무상 교체 부품을 견적서에 적어 보이는 일이 있다", () => {
  const data = ok({ ...MINIMAL, items: [{ partNameText: "무상 교체", quantity: 1, unitPrice: "0" }] });
  assert.equal(data.items[0].unitPrice, "0");
});

test("부품 다섯 줄을 넘어도 통과한다 — 합산은 xlsx 를 만들 때만 일어난다", () => {
  const items = Array.from({ length: 7 }, (_, i) => ({
    partNameText: `부품 ${i + 1}`,
    quantity: 1,
    unitPrice: "10000",
  }));
  assert.equal(ok({ ...MINIMAL, items }).items.length, 7);
});

test("부품 줄 상한을 넘으면 거절한다 — 상한이 곧 안전장치다", () => {
  const items = Array.from({ length: MAX_QUOTE_ITEMS + 1 }, (_, i) => ({
    partNameText: `부품 ${i + 1}`,
    quantity: 1,
    unitPrice: "1",
  }));
  assert.match(errors({ ...MINIMAL, items }).items, new RegExp(String(MAX_QUOTE_ITEMS)));
});

/**
 * ============================================================================
 * 통전작업 제외 — 결정(boolean)과 그때 뺀 금액(numeric)은 서로 다른 칸이다
 * ============================================================================
 * 하나로 합치면 "제외하기로 했으나 통전 공수시간이 없어 빼지 못했다"는 상태를
 * 적을 자리가 없다(schema/quotes.ts 의 그 항목).
 * ============================================================================
 */
test("통전작업 제외: 안 보내면 꺼짐이고 뺀 금액은 null 이다 — 옛 요청이 그대로 동작한다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.powerTestExcluded, false);
  assert.equal(data.laborPowerTestDeduction, null, "null 은 '빼지 않았다'이다");
});

test("통전작업 제외: 켰다고 말한 것만 켜진다 — 140만원이 실수로 빠지면 안 된다", () => {
  assert.equal(ok({ ...MINIMAL, powerTestExcluded: true }).powerTestExcluded, true);
  for (const value of ["true", 1, "on", {}, null, undefined]) {
    assert.equal(
      ok({ ...MINIMAL, powerTestExcluded: value }).powerTestExcluded,
      false,
      `${JSON.stringify(value)} 가 켜짐으로 읽혔다`
    );
  }
});

test("조사작업 뺌: 안 보내면 꺼짐, 켰다고 말한 것만 켜진다 — 옛 요청이 그대로 동작한다", () => {
  assert.equal(ok(MINIMAL).investigationExcluded, false);
  assert.equal(ok({ ...MINIMAL, investigationExcluded: true }).investigationExcluded, true);
  for (const value of ["true", 1, "on", {}, null, undefined]) {
    assert.equal(
      ok({ ...MINIMAL, investigationExcluded: value }).investigationExcluded,
      false,
      `${JSON.stringify(value)} 가 켜짐으로 읽혔다`
    );
  }
});

/**
 * 서류작업 제외(2026-09-16) — 결정만 있고 **뺀 금액 칸이 없다**. 통전에만 있는 짝이고
 * 조사에도 없다(domain/quote-labor-cost.ts 머리말). 문서는 이 칸을 읽지 않는다 —
 * 견적서의 구역은 조사 · 수리 · 통전 셋뿐이라 금액만 빠진다.
 */
test("서류작업 제외: 안 보내면 꺼짐, 켰다고 말한 것만 켜진다 — 옛 요청이 그대로 동작한다", () => {
  assert.equal(ok(MINIMAL).documentExcluded, false);
  assert.equal(ok({ ...MINIMAL, documentExcluded: true }).documentExcluded, true);
  for (const value of ["true", 1, "on", {}, null, undefined]) {
    assert.equal(
      ok({ ...MINIMAL, documentExcluded: value }).documentExcluded,
      false,
      `${JSON.stringify(value)} 가 켜짐으로 읽혔다`
    );
  }
});

test("🔴 세 제외는 서로를 건드리지 않는다 — 하나를 켜도 나머지 둘은 꺼진 채다", () => {
  const flags = ["investigationExcluded", "powerTestExcluded", "documentExcluded"] as const;
  for (const on of flags) {
    const data = ok({ ...MINIMAL, [on]: true });
    for (const flag of flags) {
      assert.equal(data[flag], flag === on, `${on} 을 켰는데 ${flag} 가 함께 움직였다`);
    }
  }
});

test("통전작업 제외: 뺀 금액도 문자열 그대로 둔다 — 다른 금액 칸과 같은 규칙", () => {
  const data = ok({
    ...MINIMAL,
    powerTestExcluded: true,
    laborPowerTestDeduction: "1,400,000",
  });
  assert.equal(data.laborPowerTestDeduction, "1400000");
  assert.equal(
    ok({ ...MINIMAL, laborPowerTestDeduction: "0" }).laborPowerTestDeduction,
    "0",
    "'0' 은 '빼기는 했는데 0원'이라 null 과 다르다"
  );
});

test("통전작업 제외: 음수나 형식이 아닌 뺀 금액은 거절한다 — CHECK 제약과 같은 규칙", () => {
  const bad = errors({ ...MINIMAL, laborPowerTestDeduction: "-1400000" });
  assert.match(bad.laborPowerTestDeduction, /통전작업 제외 금액/);
  assert.match(errors({ ...MINIMAL, laborPowerTestDeduction: "백사십만" }).laborPowerTestDeduction, /통전작업/);
});

test("id 형식", () => {
  assert.equal(isValidQuoteId(VALID_UUID), true);
  assert.equal(isValidQuoteId("nope"), false);
  assert.equal(isValidQuoteId(123), false);
  assert.match(errors({ ...MINIMAL, repairCaseId: "nope" }).repairCaseId, /수리 건/);
  assert.equal(ok({ ...MINIMAL, repairCaseId: "" }).repairCaseId, null);
});

/**
 * ============================================================================
 * 엑셀 전용 견적서 (2026-09-15 Q2) — 줄은 비어야 하고, 공급가액은 필수다
 * ============================================================================
 */
test("엑셀 전용: 안 보내면 꺼짐이고 수기 금액은 null — 옛 요청이 그대로 동작한다", () => {
  const data = ok(MINIMAL);
  assert.equal(data.isExcelOnly, false);
  assert.equal(data.manualSupplyAmount, null);
  for (const value of ["true", 1, "on", {}, null, undefined]) {
    assert.equal(ok({ ...MINIMAL, isExcelOnly: value }).isExcelOnly, false, `${JSON.stringify(value)} 가 켜짐으로 읽혔다`);
  }
});

test("엑셀 전용: 필수 넷 + 공급가액이면 통과한다 — 금액은 다른 금액 칸과 같은 규칙(콤마 허용)", () => {
  const data = ok({ ...MINIMAL, isExcelOnly: true, manualSupplyAmount: "3,456,789.50" });
  assert.equal(data.isExcelOnly, true);
  assert.equal(data.manualSupplyAmount, "3456789.50");
  assert.deepEqual(data.items, []);
  assert.equal(ok({ ...MINIMAL, isExcelOnly: true, manualSupplyAmount: 1200000 }).manualSupplyAmount, "1200000");
  // 0 은 무상 견적 — 허용한다(DB CHECK 와 같은 규칙).
  assert.equal(ok({ ...MINIMAL, isExcelOnly: true, manualSupplyAmount: "0" }).manualSupplyAmount, "0");
  // 필수 넷은 엑셀 전용이어도 그대로 필수다.
  const missing = errors({ isExcelOnly: true, manualSupplyAmount: "1000" });
  assert.match(missing.quoteNumber, /발행번호/);
  assert.match(missing.subject, /품명/);
});

test("엑셀 전용: 공급가액이 비면 거절한다 — 품목이 없으니 금액이 나올 곳이 이 칸뿐이다", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.match(
      errors({ ...MINIMAL, isExcelOnly: true, manualSupplyAmount: value }).manualSupplyAmount,
      /공급가액/,
      JSON.stringify(value)
    );
  }
});

test("엑셀 전용: 공급가액의 형식 · 폭 · 음수는 다른 금액 칸과 같이 거절하고, 형식 오류 문장을 덮지 않는다", () => {
  for (const value of ["-1", "12345678901234", "1.234", "삼백만"]) {
    assert.match(
      errors({ ...MINIMAL, isExcelOnly: true, manualSupplyAmount: value }).manualSupplyAmount,
      /0 이상의 금액/,
      value
    );
  }
});

test("🔴 엑셀 전용: 부품 · 작업 내역 · 수리 작업 줄이 있으면 거절한다 — 조용히 지우지 않는다", () => {
  const fieldErrors = errors({
    ...MINIMAL,
    isExcelOnly: true,
    manualSupplyAmount: "1000000",
    items: [{ partNameText: "Bias Board ASSY", quantity: 1, unitPrice: "1850000" }],
    workScopeLines: [{ section: "INVESTIGATION", text: "외관 및 내부 검사" }],
    repairTasks: [{ taskId: null, taskName: "바리콘 교환", hours: 3, hourlyRate: "100000" }],
  });
  assert.match(fieldErrors.items, /엑셀 전용/);
  assert.match(fieldErrors.workScopeLines, /엑셀 전용/);
  assert.match(fieldErrors.repairTasks, /엑셀 전용/);
  // 빈 작업 내역 줄은 원래 조용히 버려진다(적힐 것이 없다) — 엑셀 전용을 막지 않는다.
  const data = ok({
    ...MINIMAL,
    isExcelOnly: true,
    manualSupplyAmount: "1000000",
    workScopeLines: [{ section: "INVESTIGATION", text: "   " }],
  });
  assert.deepEqual(data.workScopeLines, []);
});

test("🔴 엑셀 전용이 아니면 수기 공급가액을 받지 않는다 — DB CHECK 와 같은 규칙을 먼저 본다", () => {
  assert.match(errors({ ...MINIMAL, manualSupplyAmount: "1000000" }).manualSupplyAmount, /엑셀 전용/);
  assert.match(errors({ ...MINIMAL, isExcelOnly: false, manualSupplyAmount: 0 }).manualSupplyAmount, /엑셀 전용/);
  // 비어 있으면 괜찮다 — 화면이 빈 칸을 그대로 보내도 저장된다.
  assert.equal(ok({ ...MINIMAL, manualSupplyAmount: "" }).manualSupplyAmount, null);
  assert.equal(ok({ ...MINIMAL, manualSupplyAmount: null }).manualSupplyAmount, null);
});

test("엑셀 전용 규칙 함수 — 검증과 mutation 이 함께 보는 한 곳", () => {
  const empty = { items: [], workScopeLines: [], repairTasks: [] };
  assert.deepEqual(quoteExcelOnlyFieldErrors({ isExcelOnly: true, manualSupplyAmount: "0", ...empty }), {});
  assert.deepEqual(quoteExcelOnlyFieldErrors({ isExcelOnly: false, manualSupplyAmount: null, ...empty }), {});
  // 일반 견적서는 줄이 있어도 이 규칙에 걸리지 않는다.
  assert.deepEqual(
    quoteExcelOnlyFieldErrors({ isExcelOnly: false, manualSupplyAmount: null, items: [{}], workScopeLines: [{}], repairTasks: [{}] }),
    {}
  );
  assert.deepEqual(Object.keys(quoteExcelOnlyFieldErrors({ isExcelOnly: true, manualSupplyAmount: null, ...empty })), [
    "manualSupplyAmount",
  ]);
});

test("expectedVersion 은 1 이상의 정수다", () => {
  assert.equal(isValidExpectedVersion(1), true);
  assert.equal(isValidExpectedVersion(0), false);
  assert.equal(isValidExpectedVersion(-1), false);
  assert.equal(isValidExpectedVersion(1.5), false);
  assert.equal(isValidExpectedVersion("1"), false);
});
