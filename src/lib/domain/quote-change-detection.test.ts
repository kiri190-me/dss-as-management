import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  QUOTE_AMOUNT_COLUMN_KEYS,
  canonicalQuoteAmount,
  isQuoteContentUnchanged,
  quoteColumnsEqual,
  quoteItemsEqual,
  quoteRepairTasksEqual,
  quoteWorkScopeLinesEqual,
  type QuoteComparableItem,
  type QuoteComparableRepairTask,
  type QuoteContentSnapshot,
} from "./quote-change-detection";

/**
 * ============================================================================
 * 견적서 저장 — 「정말 바뀌었는가」 (2026-10-31)
 * ============================================================================
 * 여기서 못 박는 것:
 *  1. 🔴 **금액은 값으로 견준다** — `"100"` 과 `"100.00"` 은 같다. 이 한 줄이
 *     없으면 손대지 않은 견적서도 늘 「바뀜」이 되어, 「안 바뀐 저장은 반려하지
 *     않는다」는 사용자 결정이 아무 뜻도 없어진다.
 *  2. 🔴 **글자 칸은 숫자로 보지 않는다** — `"0012"` 와 `"12"` 는 **다르다**.
 *     L/N · S/N 이 걸려 있다.
 *  3. 🔴 **품목 · 수리 작업 · 작업 내역까지 본다** — 칸만 보면 금액이 바뀌어도
 *     「안 바뀜」이 된다.
 *  4. 🔴 **견주는 칸 목록이 저장이 쓰는 칸을 따라간다** — 키를 들어온 쪽에서
 *     뽑는다. 그리고 **금액 칸 목록이 스키마의 numeric 칸과 같은지** 원본을
 *     읽어 맞대어 본다.
 *
 * 🔵 표본이 비어서 공짜로 통과하지 않게, 「무엇을 재는지」를 먼저 단언한다.
 * ============================================================================
 */

// ─────────────────────────────────────────────────────── 금액 표준형

describe("canonicalQuoteAmount — 금액은 값으로 견준다", () => {
  test("🔴 소수 자리가 달라도 같은 금액이다 — DB 는 numeric(15,2), 검증은 안 채운다", () => {
    assert.equal(canonicalQuoteAmount("150000"), canonicalQuoteAmount("150000.00"));
    assert.equal(canonicalQuoteAmount("150000.0"), canonicalQuoteAmount("150000"));
    assert.equal(canonicalQuoteAmount("0150000.000"), canonicalQuoteAmount("150000"));
    // 🔵 무엇을 재는지: 두 글자는 실제로 서로 다르다. 같은 글자를 견주면 공짜다.
    assert.notEqual("150000", "150000.00");
  });

  test("소수점 아래가 **0이 아니면** 다른 금액이다", () => {
    assert.notEqual(canonicalQuoteAmount("150000.01"), canonicalQuoteAmount("150000"));
    assert.notEqual(canonicalQuoteAmount("1500"), canonicalQuoteAmount("15000"));
  });

  test("0 은 한 모양이다 — `0` · `0.00` · `-0`", () => {
    assert.equal(canonicalQuoteAmount("0"), "0");
    assert.equal(canonicalQuoteAmount("0.00"), "0");
    assert.equal(canonicalQuoteAmount("-0.0"), "0");
  });

  test("숫자로 와도(화면이 보낼 수 있다) 같은 금액으로 본다", () => {
    assert.equal(canonicalQuoteAmount(1000), canonicalQuoteAmount("1000.00"));
  });

  test("빈 값은 전부 「없음」 하나다", () => {
    assert.equal(canonicalQuoteAmount(null), null);
    assert.equal(canonicalQuoteAmount(undefined), null);
    assert.equal(canonicalQuoteAmount(""), null);
    assert.equal(canonicalQuoteAmount("   "), null);
  });

  test("🔴 모양을 모르는 글자는 지어내지 않는다 — 있는 그대로 돌려준다", () => {
    assert.equal(canonicalQuoteAmount("1,000"), "1,000");
    assert.equal(canonicalQuoteAmount("1e3"), "1e3");
    // 그래서 `"1,000"` 과 `"1000"` 은 **다른 것**으로 읽힌다 — 저장을 건너뛰지
    // 않는 쪽(안전한 방향)이다.
    assert.notEqual(canonicalQuoteAmount("1,000"), canonicalQuoteAmount("1000"));
  });
});

// ─────────────────────────────────────────────────────── 칸 묶음

describe("quoteColumnsEqual — 칸 묶음", () => {
  const stored = {
    quoteNumber: "DSS 2096-001",
    subject: "품명",
    modelNameText: null,
    lotNumberText: "0012",
    workCost: "150000.00",
    manualSupplyAmount: null,
    isExcelOnly: false,
    // 저장이 건드리지 않는 칸들 — 견주는 쪽이 보지 않아야 한다.
    id: "11111111-1111-4111-8111-111111111111",
    version: 7,
    isDeleted: false,
  };

  test("🔵 무엇을 재는지 — 표본에 금액 칸과 글자 칸이 둘 다 있다", () => {
    assert.ok(QUOTE_AMOUNT_COLUMN_KEYS.includes("workCost"));
    assert.ok(!QUOTE_AMOUNT_COLUMN_KEYS.includes("lotNumberText" as never));
  });

  test("🔴 금액은 소수 자리가 달라도 같다", () => {
    const next = { quoteNumber: "DSS 2096-001", workCost: "150000" };
    assert.equal(quoteColumnsEqual(next, stored), true);
  });

  test("🔴 L/N 같은 글자 칸은 앞의 0을 지우면 **바뀐 것**이다", () => {
    const next = { lotNumberText: "12" };
    assert.equal(quoteColumnsEqual(next, stored), false, "0012 와 12 를 같게 보면 안 된다");
    assert.equal(quoteColumnsEqual({ lotNumberText: "0012" }, stored), true);
  });

  test("빈 값은 한 모양이다 — null · 빈 글자 · 공백만", () => {
    assert.equal(quoteColumnsEqual({ modelNameText: "" }, stored), true);
    assert.equal(quoteColumnsEqual({ modelNameText: "   " }, stored), true);
    assert.equal(quoteColumnsEqual({ modelNameText: null }, stored), true);
    assert.equal(quoteColumnsEqual({ modelNameText: "A" }, stored), false);
  });

  test("글자 앞뒤 공백은 같은 값이다 — 검증이 떼고 저장하기 때문이다", () => {
    assert.equal(quoteColumnsEqual({ subject: "  품명  " }, stored), true);
  });

  test("🔴 도는 키는 **들어온 쪽**이다 — 저장이 안 쓰는 칸은 견주지 않는다", () => {
    // version 이 달라도 「바뀜」이 아니다. 들어온 묶음에 그 이름이 없기 때문이다.
    assert.equal(quoteColumnsEqual({ subject: "품명" }, { ...stored, version: 999 }), true);
  });

  test("🔴 들어온 쪽에만 있는 이름은 「바뀜」이다 — 저장을 건너뛰지 않는 쪽", () => {
    assert.equal(quoteColumnsEqual({ brandNewColumn: "값" }, stored), false);
  });

  test("불리언은 그대로 견준다", () => {
    assert.equal(quoteColumnsEqual({ isExcelOnly: false }, stored), true);
    assert.equal(quoteColumnsEqual({ isExcelOnly: true }, stored), false);
  });
});

/**
 * 🔴 **금액 칸 목록이 스키마를 따라가는가.** 칸이 하나 늘어도 비교 자체는
 * 저절로 따라가지만(키를 들어온 쪽에서 뽑는다), **금액으로 볼지**는 이 목록이
 * 정한다. 목록에서 빠지면 그 칸은 글자로 견주어져 `"0"` 과 `"0.00"` 이 다른
 * 값이 되고, 그때 증상은 「손대지 않았는데 늘 바뀜으로 읽힌다」다.
 *
 * 🔵 원본은 서브모듈 안의 스키마 파일이다 — **글자로 읽는다**(그 파일을 import
 * 하면 drizzle 사슬이 따라온다).
 */
describe("🔴 금액 칸 목록 ↔ 스키마의 numeric 칸", () => {
  const source = readFileSync(
    new URL("../../../vendor/dss-core/src/schema/quotes.ts", import.meta.url),
    "utf8"
  );
  // `quotes` 표의 몸통만 자른다 — 뒤의 quoteItems(unitPrice)는 줄 안의 칸이라
  // 이 목록이 아니라 전용 비교가 집는다(그 파일의 상수 주석).
  const start = source.indexOf("export const quotes = pgTable(");
  const end = source.indexOf("export const quoteItemKindEnum");
  const quotesTable = source.slice(start, end);
  const numericColumns = [...quotesTable.matchAll(/(\w+):\s*numeric\(/g)].map((m) => m[1]);

  test("🔵 무엇을 재는지 — 원본에서 numeric 칸을 실제로 찾아냈다", () => {
    assert.ok(start >= 0 && end > start, "스키마에서 quotes 표를 찾지 못했다");
    assert.ok(numericColumns.length >= 4, `numeric 칸을 못 읽었다: ${JSON.stringify(numericColumns)}`);
  });

  test("목록이 스키마와 **글자 그대로** 같다", () => {
    assert.deepEqual([...numericColumns].sort(), [...QUOTE_AMOUNT_COLUMN_KEYS].sort());
  });
});

// ─────────────────────────────────────────────────────── 품목 줄

function item(overrides: Partial<QuoteComparableItem> = {}): QuoteComparableItem {
  return {
    partId: null,
    kind: "ITEM",
    partNameText: "냉각 팬",
    partSpecText: null,
    isOverhaulPart: false,
    quantity: 2,
    unitPrice: "1000.00",
    inventoryPartNo: null,
    ...overrides,
  };
}

describe("quoteItemsEqual — 품목 줄", () => {
  test("🔵 무엇을 재는지 — 표본이 비어 있지 않다", () => {
    assert.equal(item().partNameText, "냉각 팬");
  });

  test("단가의 소수 자리만 다른 줄은 같은 줄이다", () => {
    assert.equal(quoteItemsEqual([item({ unitPrice: "1000" })], [item()]), true);
  });

  test("🔴 수량이 바뀌면 바뀐 것이다 — 금액이 달라진다", () => {
    assert.equal(quoteItemsEqual([item({ quantity: 3 })], [item()]), false);
  });

  test("🔴 단가가 바뀌면 바뀐 것이다", () => {
    assert.equal(quoteItemsEqual([item({ unitPrice: "1200" })], [item()]), false);
  });

  test("줄 수가 다르면 바뀐 것이다", () => {
    assert.equal(quoteItemsEqual([item(), item()], [item()]), false);
    assert.equal(quoteItemsEqual([], [item()]), false);
  });

  test("🔴 차례가 바뀌면 바뀐 것이다 — 설명 줄이 어디 붙는지가 뜻이다", () => {
    const a = item({ partNameText: "A" });
    const b = item({ partNameText: "B" });
    assert.equal(quoteItemsEqual([a, b], [b, a]), false);
    assert.equal(quoteItemsEqual([a, b], [a, b]), true);
  });

  test("OH 표시 · 종류 · 규격 · 재고 번호도 본다", () => {
    assert.equal(quoteItemsEqual([item({ isOverhaulPart: true })], [item()]), false);
    assert.equal(quoteItemsEqual([item({ kind: "NOTE" })], [item()]), false);
    assert.equal(quoteItemsEqual([item({ partSpecText: "2sq" })], [item()]), false);
    assert.equal(quoteItemsEqual([item({ inventoryPartNo: 7 })], [item()]), false);
  });
});

// ─────────────────────────────────────────────────────── 수리 작업

function task(overrides: Partial<QuoteComparableRepairTask> = {}): QuoteComparableRepairTask {
  return { taskId: null, taskNameText: "바리콘 교환", hours: 3, hourlyRate: "100000.00", ...overrides };
}

describe("quoteRepairTasksEqual — 고른 수리 작업", () => {
  test("시간당 단가는 값으로, 공수시간은 그대로 견준다", () => {
    assert.equal(quoteRepairTasksEqual([task({ hourlyRate: "100000" })], [task()]), true);
    assert.equal(quoteRepairTasksEqual([task({ hours: 4 })], [task()]), false);
  });

  test("작업 이름이 바뀌면 바뀐 것이다", () => {
    assert.equal(quoteRepairTasksEqual([task({ taskNameText: "다른 작업" })], [task()]), false);
  });
});

// ─────────────────────────────────────────────────────── 작업 내역

describe("quoteWorkScopeLinesEqual — 작업 내역", () => {
  const stored = [
    { section: "INVESTIGATION", text: "외관 검사" },
    { section: "INVESTIGATION", text: "통전 확인" },
    { section: "REPAIR", text: "바리콘 교환" },
  ];

  test("🔵 무엇을 재는지 — 묶음이 둘, 줄이 셋이다", () => {
    assert.equal(stored.length, 3);
    assert.equal(new Set(stored.map((line) => line.section)).size, 2);
  });

  test("같은 줄들이면 같다", () => {
    assert.equal(quoteWorkScopeLinesEqual([...stored], stored), true);
  });

  test("🔴 **묶음 안의** 차례가 바뀌면 바뀐 것이다", () => {
    const swapped = [stored[1], stored[0], stored[2]];
    assert.equal(quoteWorkScopeLinesEqual(swapped, stored), false);
  });

  test("🔵 묶음끼리의 앞뒤는 저장에 남지 않는다 — 그래서 같다", () => {
    // 저장은 묶음마다 1부터 번호를 다시 매긴다(replaceWorkScopeLines).
    const reordered = [stored[2], stored[0], stored[1]];
    assert.equal(quoteWorkScopeLinesEqual(reordered, stored), true);
  });

  test("줄이 늘거나 줄면 바뀐 것이다", () => {
    assert.equal(quoteWorkScopeLinesEqual([...stored, { section: "POWER_TEST", text: "통전" }], stored), false);
    assert.equal(quoteWorkScopeLinesEqual(stored.slice(0, 2), stored), false);
  });
});

// ─────────────────────────────────────────────────────── 한 벌

describe("isQuoteContentUnchanged — 넷을 모두 넘어야 「안 바뀜」이다", () => {
  function snapshot(overrides: Partial<QuoteContentSnapshot> = {}): QuoteContentSnapshot {
    return {
      columns: { quoteNumber: "DSS 2096-001", subject: "품명", workCost: "150000.00" },
      items: [item()],
      repairTasks: [task()],
      workScopeLines: [{ section: "REPAIR", text: "바리콘 교환" }],
      ...overrides,
    };
  }

  test("🔵 무엇을 재는지 — 표본의 네 자리가 전부 차 있다", () => {
    const sample = snapshot();
    assert.ok(Object.keys(sample.columns).length > 0);
    assert.ok(sample.items.length > 0);
    assert.ok(sample.repairTasks.length > 0);
    assert.ok(sample.workScopeLines.length > 0);
  });

  test("한 글자도 안 바뀐 저장은 「안 바뀜」이다(금액 표기가 달라도)", () => {
    const incoming = snapshot({
      columns: { quoteNumber: "DSS 2096-001", subject: "품명", workCost: "150000" },
      items: [item({ unitPrice: "1000" })],
      repairTasks: [task({ hourlyRate: "100000" })],
    });
    assert.equal(isQuoteContentUnchanged(incoming, snapshot()), true);
  });

  test("🔴 네 자리 **어디가 바뀌어도** 「바뀜」이다", () => {
    assert.equal(
      isQuoteContentUnchanged(snapshot({ columns: { quoteNumber: "DSS 2096-001", subject: "다른 품명", workCost: "150000" } }), snapshot()),
      false,
      "칸이 바뀐 것을 못 잡았다"
    );
    assert.equal(
      isQuoteContentUnchanged(snapshot({ items: [item({ quantity: 9 })] }), snapshot()),
      false,
      "🔴 품목이 바뀐 것을 못 잡았다 — 금액이 바뀌어도 「안 바뀜」이 된다"
    );
    assert.equal(
      isQuoteContentUnchanged(snapshot({ repairTasks: [] }), snapshot()),
      false,
      "수리 작업이 빠진 것을 못 잡았다"
    );
    assert.equal(
      isQuoteContentUnchanged(snapshot({ workScopeLines: [] }), snapshot()),
      false,
      "작업 내역이 빠진 것을 못 잡았다"
    );
  });
});
