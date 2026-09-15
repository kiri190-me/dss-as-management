import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_EXCEL_AUTOFILL_FIELDS,
  isBlankFormValue,
  planQuoteExcelAutofill,
  quoteExcelAutofillFieldLabels,
  quoteExcelAutofillNoticeLines,
  quoteExcelConflictText,
  quoteExcelPlanFormValues,
  type QuoteExcelFormValues,
} from "./quote-excel-autofill";
import { QUOTE_EXCEL_LEGACY_XLS_TEXT, type QuoteExcelReadFields } from "./quote-excel-parse";

/**
 * ============================================================================
 * 수기 견적서 엑셀로 폼 칸 채우기 — 채울 계획 · 알림 문장 (견적서 ①b)
 * ============================================================================
 * 「채우는 방식」(2026-09-16 사용자 선택): 빈 칸만 채우고, 이미 적힌 칸이 엑셀과 다르면 덮지 않고
 * 제안한다. 종류도 같다 — 폼의 종류는 늘 「적힌 값」이라 채우지 않고, 읽은 종류가 null 이면
 * 어느 목록에도 넣지 않는다. 값은 전부 지어낸 것이다(실제 고객 파일 · 이름이 아니다).
 * ============================================================================
 */

const ALL_NULL: QuoteExcelReadFields = {
  kind: null,
  quoteNumber: null,
  quoteDate: null,
  customerNameText: null,
  subject: null,
  modelNameText: null,
  lotNumberText: null,
  serialNumberText: null,
  validity: null,
  delivery: null,
  payment: null,
  manualSupplyAmount: null,
};

const EXCEL: QuoteExcelReadFields = {
  kind: "OVERHAUL",
  quoteNumber: "DSS 2026-077",
  quoteDate: "2026-09-10",
  customerNameText: "가나 테크",
  subject: "RFK300 수리 件",
  modelNameText: "RFK300FH-AD1",
  lotNumberText: "L-12",
  serialNumberText: "S-2201",
  validity: "발행일로부터 4주",
  delivery: "발주일로부터 3주 이내",
  payment: "귀사 결제 조건",
  manualSupplyAmount: "3500000",
};

/** 빈 폼 — 종류는 늘 값이 있다(기본 내자). 발행일자도 비워 둔 모양으로 시작한다. */
const BLANK_FORM: QuoteExcelFormValues = {
  kind: "DOMESTIC",
  quoteNumber: "",
  quoteDate: "",
  customerNameText: "",
  subject: "",
  modelNameText: "",
  lotNumberText: "",
  serialNumberText: "",
  validity: "",
  delivery: "",
  payment: "",
  manualSupplyAmount: "",
};

const fieldsOf = (changes: readonly { field: string }[]) => changes.map((change) => change.field);

describe("칸 목록", () => {
  test("읽개의 칸을 빠짐없이, 폼에 놓인 차례로 — 신고증상은 없다", () => {
    assert.deepEqual([...QUOTE_EXCEL_AUTOFILL_FIELDS].sort(), Object.keys(quoteExcelAutofillFieldLabels).sort());
    assert.deepEqual([...QUOTE_EXCEL_AUTOFILL_FIELDS].sort(), Object.keys(ALL_NULL).sort());
    assert.ok(!(QUOTE_EXCEL_AUTOFILL_FIELDS as readonly string[]).includes("faultDescriptionText"));
    assert.equal(QUOTE_EXCEL_AUTOFILL_FIELDS[0], "kind");
    assert.equal(QUOTE_EXCEL_AUTOFILL_FIELDS.at(-1), "manualSupplyAmount");
  });

  test("빈 칸 — 앞뒤 공백뿐이면 빈 칸이다", () => {
    assert.equal(isBlankFormValue(""), true);
    assert.equal(isBlankFormValue("  \t"), true);
    assert.equal(isBlankFormValue(" a "), false);
  });
});

describe("🔴 빈 칸은 곧바로 채운다", () => {
  test("빈 폼 — 종류를 뺀 모든 칸을 채우고, 종류는 다르면 제안만 한다", () => {
    const plan = planQuoteExcelAutofill(BLANK_FORM, EXCEL);
    assert.deepEqual(fieldsOf(plan.fills), QUOTE_EXCEL_AUTOFILL_FIELDS.filter((field) => field !== "kind"));
    assert.deepEqual(fieldsOf(plan.conflicts), ["kind"], "종류를 채웠거나 빠뜨렸다");
    assert.deepEqual(plan.unchanged, []);
    const byField = Object.fromEntries(plan.fills.map((change) => [change.field, change]));
    assert.equal(byField.quoteNumber.excelValue, "DSS 2026-077");
    assert.equal(byField.quoteDate.excelValue, "2026-09-10", "발행일자는 YYYY-MM-DD 그대로");
    // 공급가액은 폼이 들고 있는 모양(콤마 없음) — 칸이 콤마를 붙여 보여 준다.
    assert.equal(byField.manualSupplyAmount.excelValue, "3500000");
    assert.equal(byField.manualSupplyAmount.excelDisplay, "3,500,000");
    assert.equal(byField.customerNameText.label, "공급처");
  });

  test("앞뒤 공백뿐인 폼 칸도 빈 칸이다 — 엑셀 값은 공백을 걷어 넣는다", () => {
    const plan = planQuoteExcelAutofill(
      { ...BLANK_FORM, customerNameText: "   " },
      { ...ALL_NULL, customerNameText: "  가나 테크  " }
    );
    assert.deepEqual(plan.fills.map((change) => [change.field, change.excelValue]), [["customerNameText", "가나 테크"]]);
    assert.deepEqual(plan.conflicts, []);
  });

  test("소수가 있는 공급가액 — 칸이 만드는 모양 그대로", () => {
    const plan = planQuoteExcelAutofill(BLANK_FORM, { ...ALL_NULL, manualSupplyAmount: "1234567.5" });
    assert.equal(plan.fills[0].excelValue, "1234567.5");
    assert.equal(plan.fills[0].excelDisplay, "1,234,567.5");
  });
});

describe("🔴 같은 값은 다르지 않다 — 공백 · 콤마 차이", () => {
  test("앞뒤 공백만 다른 글자 · 콤마만 다른 금액 · 소수 끝의 0 은 같은 칸이다", () => {
    const plan = planQuoteExcelAutofill(
      {
        ...BLANK_FORM,
        kind: "OVERHAUL",
        quoteNumber: "  DSS 2026-077 ",
        customerNameText: "가나 테크",
        manualSupplyAmount: "3,500,000",
      },
      {
        ...ALL_NULL,
        kind: "OVERHAUL",
        quoteNumber: "DSS 2026-077",
        customerNameText: " 가나 테크 ",
        manualSupplyAmount: "3500000",
      }
    );
    assert.deepEqual(plan.fills, []);
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.unchanged, ["kind", "quoteNumber", "customerNameText", "manualSupplyAmount"]);

    const decimals = planQuoteExcelAutofill({ ...BLANK_FORM, manualSupplyAmount: "3500000.00" }, { ...ALL_NULL, manualSupplyAmount: "3500000" });
    assert.deepEqual(decimals.unchanged, ["manualSupplyAmount"]);
  });

  test("가운데 공백 · 대소문자는 다른 값이다 — 사람이 적은 것을 짐작으로 같다고 하지 않는다", () => {
    const plan = planQuoteExcelAutofill(
      { ...BLANK_FORM, quoteNumber: "DSS2026-077", modelNameText: "rfk300" },
      { ...ALL_NULL, quoteNumber: "DSS 2026-077", modelNameText: "RFK300" }
    );
    assert.deepEqual(fieldsOf(plan.conflicts), ["quoteNumber", "modelNameText"]);
  });
});

describe("🔴 이미 적힌 칸이 엑셀과 다르면 덮지 않고 제안한다", () => {
  test("다른 칸은 conflicts — 폼 값 · 엑셀 값을 사람이 읽는 모양으로", () => {
    const plan = planQuoteExcelAutofill(
      { ...BLANK_FORM, quoteDate: "2026-09-16", customerNameText: "다라 전자", manualSupplyAmount: "2100000", payment: "" },
      { ...ALL_NULL, quoteDate: "2026-09-10", customerNameText: "가나 테크", manualSupplyAmount: "3500000", payment: "현금" }
    );
    assert.deepEqual(fieldsOf(plan.fills), ["payment"]);
    assert.deepEqual(fieldsOf(plan.conflicts), ["quoteDate", "customerNameText", "manualSupplyAmount"]);
    const customer = plan.conflicts.find((change) => change.field === "customerNameText");
    assert.deepEqual(customer, {
      field: "customerNameText",
      label: "공급처",
      excelValue: "가나 테크",
      formDisplay: "다라 전자",
      excelDisplay: "가나 테크",
    });
    const amount = plan.conflicts.find((change) => change.field === "manualSupplyAmount");
    assert.equal(amount?.excelValue, "3500000");
    assert.equal(quoteExcelConflictText(amount!), "공급가액(폼: 2,100,000 / 엑셀: 3,500,000)");
    assert.equal(quoteExcelConflictText(customer!), "공급처(폼: 다라 전자 / 엑셀: 가나 테크)");
  });

  test("적힌 날짜는 계획 함수만으로는 「적힌 값」이다 — 빈 칸처럼 보는 것은 quoteExcelPlanFormValues 가 정한다", () => {
    const plan = planQuoteExcelAutofill({ ...BLANK_FORM, quoteDate: "2026-09-16" }, { ...ALL_NULL, quoteDate: "2026-09-10" });
    assert.deepEqual(plan.fills, []);
    assert.deepEqual(fieldsOf(plan.conflicts), ["quoteDate"]);
  });

  test("바꾼 뒤(폼이 엑셀 값이 되면) 목록에서 빠진다 — 계획을 지금 값으로 다시 뽑으면 된다", () => {
    const form = { ...BLANK_FORM, customerNameText: "다라 전자", subject: "옛 품명" };
    const excel = { ...ALL_NULL, customerNameText: "가나 테크", subject: "RFK300 수리 件" };
    const before = planQuoteExcelAutofill(form, excel);
    assert.deepEqual(fieldsOf(before.conflicts), ["customerNameText", "subject"]);
    const customer = before.conflicts[0];
    const after = planQuoteExcelAutofill({ ...form, [customer.field]: customer.excelValue }, excel);
    assert.deepEqual(fieldsOf(after.conflicts), ["subject"]);
    assert.deepEqual(after.unchanged, ["customerNameText"]);
  });
});

describe("🔴 견적서 종류", () => {
  test("읽은 종류가 null(매쳐) 이면 건드리지 않고 어느 목록에도 없다", () => {
    for (const kind of ["DOMESTIC", "OVERHAUL"] as const) {
      const plan = planQuoteExcelAutofill({ ...BLANK_FORM, kind }, { ...EXCEL, kind: null });
      assert.ok(!fieldsOf(plan.fills).includes("kind"));
      assert.ok(!fieldsOf(plan.conflicts).includes("kind"));
      assert.ok(!plan.unchanged.includes("kind"));
    }
  });

  test("값이 있고 폼과 같으면 아무것도 하지 않는다", () => {
    const plan = planQuoteExcelAutofill({ ...BLANK_FORM, kind: "OVERHAUL" }, { ...ALL_NULL, kind: "OVERHAUL" });
    assert.deepEqual(plan, { fills: [], conflicts: [], unchanged: ["kind"] });
  });

  test("🔴 값이 있고 폼과 다르면 제안만 한다 — 팝업에서 고른 종류를 말없이 바꾸지 않는다", () => {
    const plan = planQuoteExcelAutofill({ ...BLANK_FORM, kind: "OVERHAUL" }, { ...ALL_NULL, kind: "DOMESTIC" });
    assert.deepEqual(plan.fills, []);
    assert.deepEqual(plan.conflicts, [
      { field: "kind", label: "견적서 종류", excelValue: "DOMESTIC", formDisplay: "OH 견적서", excelDisplay: "내자 견적서" },
    ]);
    assert.equal(quoteExcelConflictText(plan.conflicts[0]), "견적서 종류(폼: OH 견적서 / 엑셀: 내자 견적서)");
  });
});

describe("🔴 엑셀 값이 null 인 칸은 건드리지 않는다", () => {
  test("모든 fields 가 null 이면 아무것도 없다", () => {
    assert.deepEqual(planQuoteExcelAutofill(BLANK_FORM, ALL_NULL), { fills: [], conflicts: [], unchanged: [] });
    assert.deepEqual(
      planQuoteExcelAutofill({ ...BLANK_FORM, customerNameText: "다라 전자", manualSupplyAmount: "100" }, ALL_NULL),
      { fills: [], conflicts: [], unchanged: [] }
    );
  });

  test("공백뿐인 엑셀 값도 없는 것이다", () => {
    const plan = planQuoteExcelAutofill({ ...BLANK_FORM, customerNameText: "다라 전자" }, { ...ALL_NULL, customerNameText: "  ", subject: "" });
    assert.deepEqual(plan, { fills: [], conflicts: [], unchanged: [] });
  });
});

describe("🔴 발행일자 — 새 견적서에서 손대지 않은 기본값(오늘)만 빈 칸처럼 채운다 (2026-09-16 사용자 결정)", () => {
  const TODAY = "2026-09-16";
  const EXCEL_DATE = { ...ALL_NULL, quoteDate: "2026-09-10" };
  const planWith = (
    quoteDate: string,
    flags: { isNewQuote: boolean; touched: boolean },
    excel: QuoteExcelReadFields = EXCEL_DATE
  ) =>
    planQuoteExcelAutofill(quoteExcelPlanFormValues({ ...BLANK_FORM, quoteDate }, flags), excel);

  test("새 견적서 · 손대지 않음 → 엑셀 날짜로 곧바로 채운다(다른 칸 목록에 없다)", () => {
    const plan = planWith(TODAY, { isNewQuote: true, touched: false });
    assert.deepEqual(plan.fills.map((change) => [change.field, change.excelValue]), [["quoteDate", "2026-09-10"]]);
    assert.deepEqual(plan.conflicts, []);
  });

  test("새 견적서 · 손댐 → 제안만", () => {
    const plan = planWith("2026-09-01", { isNewQuote: true, touched: true });
    assert.deepEqual(plan.fills, []);
    assert.deepEqual(fieldsOf(plan.conflicts), ["quoteDate"]);
  });

  test("🔴 새 견적서 · 손댔다가 오늘로 되돌림 → 고친 것은 고친 것 — 제안만", () => {
    const plan = planWith(TODAY, { isNewQuote: true, touched: true });
    assert.deepEqual(plan.fills, []);
    assert.deepEqual(fieldsOf(plan.conflicts), ["quoteDate"]);
    assert.equal(plan.conflicts[0].formDisplay, TODAY);
  });

  test("저장된 견적서 → 늘 「적힌 값」 — 제안만", () => {
    const plan = planWith(TODAY, { isNewQuote: false, touched: false });
    assert.deepEqual(plan.fills, []);
    assert.deepEqual(fieldsOf(plan.conflicts), ["quoteDate"]);
  });

  test("🔴 자동 채우기 뒤 다시 고름 → 제안만(채운 것도 손댐이다)", () => {
    const first = planWith(TODAY, { isNewQuote: true, touched: false });
    assert.deepEqual(fieldsOf(first.fills), ["quoteDate"]);
    // 폼은 채울 때 editQuoteDate 를 타 손댐이 켜진다(화면 시험이 원본으로 본다).
    const second = planWith(first.fills[0].excelValue, { isNewQuote: true, touched: true }, { ...ALL_NULL, quoteDate: "2026-08-31" });
    assert.deepEqual(second.fills, []);
    assert.deepEqual(fieldsOf(second.conflicts), ["quoteDate"]);
  });

  test("빈 칸처럼 보는 것은 날짜 하나뿐 — 다른 칸 · 엑셀 날짜가 없을 때는 그대로", () => {
    const values = { ...BLANK_FORM, quoteDate: TODAY, customerNameText: "다라 전자" };
    assert.deepEqual(quoteExcelPlanFormValues(values, { isNewQuote: true, touched: false }), { ...values, quoteDate: "" });
    assert.equal(quoteExcelPlanFormValues(values, { isNewQuote: true, touched: true }), values);
    assert.equal(quoteExcelPlanFormValues(values, { isNewQuote: false, touched: false }), values);
    // 엑셀에 날짜가 없으면 오늘 날짜는 건드리지 않는다.
    assert.deepEqual(planWith(TODAY, { isNewQuote: true, touched: false }, ALL_NULL), { fills: [], conflicts: [], unchanged: [] });
  });
});

describe("알림 문장 — 한 함수", () => {
  test("채운 칸 · 다른 칸 · 경고를 사람이 읽는 줄로", () => {
    const lines = quoteExcelAutofillNoticeLines({
      kind: "read",
      filled: ["quoteNumber", "customerNameText", "manualSupplyAmount"],
      readCount: 5,
      conflictCount: 2,
      warnings: ["공급가 칸(H40)의 금액이 글자로 적혀 있어 숫자로 읽었습니다."],
    });
    assert.deepEqual(lines, [
      { text: "엑셀에서 빈 칸 3개를 채웠습니다: 발행번호 · 공급처 · 공급가액", tone: "normal" },
      {
        text: "폼에 이미 적힌 값과 다른 칸 2개는 덮지 않았습니다 — 아래 목록에서 엑셀 값으로 바꿀 수 있습니다",
        tone: "warning",
      },
      { text: "공급가 칸(H40)의 금액이 글자로 적혀 있어 숫자로 읽었습니다.", tone: "warning" },
    ]);
  });

  test("다른 칸을 다 바꾸면 그 줄이 사라진다 — 지금 수로 셈한다", () => {
    const lines = quoteExcelAutofillNoticeLines({ kind: "read", filled: ["quoteNumber"], readCount: 3, conflictCount: 0, warnings: [] });
    assert.deepEqual(lines, [{ text: "엑셀에서 빈 칸 1개를 채웠습니다: 발행번호", tone: "normal" }]);
  });

  test("읽은 값이 없다 · 폼이 이미 같다", () => {
    assert.deepEqual(
      quoteExcelAutofillNoticeLines({ kind: "read", filled: [], readCount: 0, conflictCount: 0, warnings: ["경고"] }),
      [
        { text: "엑셀에서 읽은 값이 없어 칸을 채우지 않았습니다", tone: "warning" },
        { text: "경고", tone: "warning" },
      ]
    );
    assert.deepEqual(quoteExcelAutofillNoticeLines({ kind: "read", filled: [], readCount: 4, conflictCount: 0, warnings: [] }), [
      { text: "폼의 칸이 엑셀과 같습니다 — 채울 칸이 없습니다", tone: "normal" },
    ]);
  });

  test("🔴 실패는 사유 한 줄 — 옛 .xls 는 정한 문장 그대로", () => {
    assert.deepEqual(quoteExcelAutofillNoticeLines({ kind: "failed", reason: QUOTE_EXCEL_LEGACY_XLS_TEXT, code: "XLS_LEGACY" }), [
      { text: "옛 엑셀 형식이라 칸을 채우지 못했습니다 — 엑셀에서 xlsx 로 다시 저장해 올리면 채워집니다", tone: "warning" },
    ]);
    assert.deepEqual(
      quoteExcelAutofillNoticeLines({ kind: "failed", reason: "견적서 시트를 찾지 못했습니다.", code: "NO_QUOTE_SHEET" }),
      [{ text: "엑셀을 읽지 못해 칸을 채우지 못했습니다 — 견적서 시트를 찾지 못했습니다", tone: "warning" }]
    );
    assert.deepEqual(quoteExcelAutofillNoticeLines({ kind: "failed", reason: "  ", code: null }), [
      { text: "엑셀을 읽지 못해 칸을 채우지 못했습니다 — 까닭을 알 수 없습니다", tone: "warning" },
    ]);
  });
});
