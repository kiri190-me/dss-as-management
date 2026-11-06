import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  applyMiscCaseFilters,
  collectMiscCaseCustomerOptions,
  countActiveMiscCaseFilters,
  DEFAULT_MISC_CASE_FILTERS,
  MISC_CASE_DEFAULT_SORT,
  MISC_CASE_EMPTY_LABEL,
  MISC_CASE_NO_MATCH_LABEL,
  MISC_CASE_UNASSIGNED_CUSTOMER_VALUE,
  nextMiscCaseSort,
  sortMiscCases,
  type MiscCaseFilterable,
  type MiscCaseSortable,
} from "./misc-case-list";
import { UNASSIGNED_CUSTOMER_LABEL } from "./domestic-order-list";
import { MISC_CASE_STATUS_LABELS } from "./misc-case-status";

/**
 * ============================================================================
 * 「기타건 현황」의 차례 — 값으로 잰다 (2026-11-06)
 * ============================================================================
 * 「어느 줄이 이 목록에 들어오는가」는 여기서 재지 않는다 — 그것은 조회의 `where`
 * 한 줄이고(queries/domestic-orders.ts 의 listMiscDomesticOrders), DB 를 세워야
 * 잴 수 있다(db/queries/misc-domestic-orders.integration.test.ts).
 *
 * 여기서 재는 것은 **화면이 다시 세우는 차례**다. 서버가 이미 같은 차례로 보내지만
 * 머리글을 눌러 바꿀 수 있어야 하므로 규칙이 화면 쪽에도 있어야 하고, 둘이 갈리면
 * 서버가 그린 첫 HTML 과 화면의 첫 차례가 어긋난다.
 *
 * 🔵 **표본이 비어 공짜로 통과하지 않게** 못을 먼저 박는다 — 「빈 값은 뒤로」를 재려면
 * 표본에 **빈 값이 실제로 들어 있어야** 하고, 「안정 정렬」을 재려면 **같은 값인 줄이
 * 둘 이상** 있어야 한다. 그 사실부터 단언한다.
 * ============================================================================
 */

/** 이 파일이 보는 칸만 가진 줄. 안 주는 칸은 전부 null 이다. */
function row(id: string, fields: Partial<MiscCaseSortable> = {}): MiscCaseSortable & { id: string } {
  return {
    id,
    displayQuoteIssuedDate: null,
    displayQuoteNumber: null,
    modelName: null,
    customerName: null,
    orderIssuedDate: null,
    ...fields,
  };
}

/** 발행일자 셋 + 빈 값 하나. 받은 차례(= 서버의 등록순)가 그대로 id 순이다. */
const SAMPLE = [
  row("a", { displayQuoteIssuedDate: "2026-09-30", displayQuoteNumber: "DSS 2026-120" }),
  row("b", { displayQuoteIssuedDate: "2026-11-02", displayQuoteNumber: "DSS 2026-140" }),
  row("c", { displayQuoteIssuedDate: null, displayQuoteNumber: "DSS 2026-150" }),
  row("d", { displayQuoteIssuedDate: "2026-09-30", displayQuoteNumber: "DSS 2026-121" }),
];

const idsOf = (rows: readonly { id: string }[]) => rows.map((item) => item.id);

test("🔵 못 — 표본에 빈 값과 동점이 실제로 들어 있다", () => {
  assert.equal(
    SAMPLE.filter((item) => item.displayQuoteIssuedDate === null).length,
    1,
    "표본에 빈 발행일자가 없다 — 「빈 값은 뒤로」가 공짜로 통과한다"
  );
  const sameDay = SAMPLE.filter((item) => item.displayQuoteIssuedDate === "2026-09-30");
  assert.equal(sameDay.length, 2, "표본에 같은 날짜인 줄이 둘 없다 — 안정 정렬이 공짜로 통과한다");
  assert.deepEqual(idsOf(sameDay), ["a", "d"], "동점 둘의 받은 차례가 바뀌었다");
});

describe("🔴 기본 차례 — 발행일자 내림차순", () => {
  test("처음 그리는 차례는 발행일자 내림차순이다 — 서버 조회와 같은 값", () => {
    assert.deepEqual(MISC_CASE_DEFAULT_SORT, { column: "quoteIssuedDate", direction: "desc" });
  });

  test("최신이 위, 빈 값이 맨 아래", () => {
    assert.deepEqual(idsOf(sortMiscCases(SAMPLE, MISC_CASE_DEFAULT_SORT)), ["b", "a", "d", "c"]);
  });
});

describe("🔴 빈 값은 **방향과 무관하게** 뒤다", () => {
  test("올림차순에서도 빈 값이 맨 아래다", () => {
    const sorted = sortMiscCases(SAMPLE, { column: "quoteIssuedDate", direction: "asc" });
    assert.deepEqual(idsOf(sorted), ["a", "d", "b", "c"]);
    assert.equal(sorted[sorted.length - 1].id, "c", "빈 값이 맨 위로 올라왔다");
  });

  test("공백만 적힌 값도 빈 값이다 — 보이지 않는 글자가 줄을 앞세우지 않는다", () => {
    const blank = [
      row("x", { modelName: "   " }),
      row("y", { modelName: "RFG-7" }),
      row("z", { modelName: null }),
    ];
    assert.deepEqual(idsOf(sortMiscCases(blank, { column: "modelName", direction: "asc" })), [
      "y",
      "x",
      "z",
    ]);
  });

  test("전부 빈 값이면 받은 차례 그대로다", () => {
    const blanks = [row("p"), row("q"), row("r")];
    assert.deepEqual(idsOf(sortMiscCases(blanks, MISC_CASE_DEFAULT_SORT)), ["p", "q", "r"]);
  });
});

describe("🔴 같은 값끼리는 받은 차례가 남는다 — reverse() 가 아니다", () => {
  test("내림차순에서도 동점 둘의 차례가 뒤집히지 않는다", () => {
    const sorted = sortMiscCases(SAMPLE, MISC_CASE_DEFAULT_SORT);
    const sameDay = sorted.filter((item) => item.displayQuoteIssuedDate === "2026-09-30");
    assert.deepEqual(idsOf(sameDay), ["a", "d"], "동점 줄의 차례가 뒤집혔다 — reverse() 로 만든 차례다");
  });

  test("올림차순에서도 같다", () => {
    const sorted = sortMiscCases(SAMPLE, { column: "quoteIssuedDate", direction: "asc" });
    const sameDay = sorted.filter((item) => item.displayQuoteIssuedDate === "2026-09-30");
    assert.deepEqual(idsOf(sameDay), ["a", "d"]);
  });
});

test("🔴 원본 배열을 건드리지 않는다 — 제자리에서 뒤집으면 차례가 누적된다", () => {
  const before = idsOf(SAMPLE);
  sortMiscCases(SAMPLE, MISC_CASE_DEFAULT_SORT);
  sortMiscCases(SAMPLE, { column: "quoteIssuedDate", direction: "asc" });
  assert.deepEqual(idsOf(SAMPLE), before);
});

describe("🔴 세울 수 있는 칸 다섯", () => {
  test("각 칸이 그 칸의 값으로 선다", () => {
    const rows = [
      row("1", { modelName: "나", customerName: "다", displayQuoteNumber: "Q-2", orderIssuedDate: "2026-01-02" }),
      row("2", { modelName: "가", customerName: "나", displayQuoteNumber: "Q-1", orderIssuedDate: "2026-01-01" }),
    ];
    assert.deepEqual(idsOf(sortMiscCases(rows, { column: "modelName", direction: "asc" })), ["2", "1"]);
    assert.deepEqual(idsOf(sortMiscCases(rows, { column: "customerName", direction: "asc" })), ["2", "1"]);
    assert.deepEqual(idsOf(sortMiscCases(rows, { column: "quoteNumber", direction: "asc" })), ["2", "1"]);
    assert.deepEqual(idsOf(sortMiscCases(rows, { column: "orderIssuedDate", direction: "asc" })), ["2", "1"]);
    assert.deepEqual(idsOf(sortMiscCases(rows, { column: "quoteIssuedDate", direction: "asc" })), ["1", "2"]);
  });
});

describe("🔴 머리글을 눌렀을 때의 다음 차례", () => {
  test("다른 칸을 누르면 그 칸의 **내림차순**으로 간다", () => {
    assert.deepEqual(nextMiscCaseSort(MISC_CASE_DEFAULT_SORT, "customerName"), {
      column: "customerName",
      direction: "desc",
    });
  });

  test("같은 칸을 다시 누르면 방향만 뒤집힌다", () => {
    const once = nextMiscCaseSort(MISC_CASE_DEFAULT_SORT, "quoteIssuedDate");
    assert.deepEqual(once, { column: "quoteIssuedDate", direction: "asc" });
    assert.deepEqual(nextMiscCaseSort(once, "quoteIssuedDate"), {
      column: "quoteIssuedDate",
      direction: "desc",
    });
  });
});

test("🔴 0건의 두 말이 서로 다르다 — 「없다」가 두 뜻으로 읽히면 안 된다", () => {
  assert.notEqual(MISC_CASE_EMPTY_LABEL, MISC_CASE_NO_MATCH_LABEL);
  assert.notEqual(MISC_CASE_EMPTY_LABEL.trim(), "");
  assert.notEqual(MISC_CASE_NO_MATCH_LABEL.trim(), "");
});

/**
 * ============================================================================
 * 🔴 거르개 — 상태 · 공급처 (2026-11-06 사용자 요구)
 * ============================================================================
 * 🔵 **「거른 뒤 0건이 아니다」와 「안 맞는 줄이 빠졌다」를 둘 다 잰다.** 한쪽만
 * 재면 「전부 빼기」(늘 0건)도, 「아무것도 안 빼기」(그대로)도 통과한다.
 */
function filterRow(
  id: string,
  fields: Partial<MiscCaseFilterable> = {}
): MiscCaseFilterable & { id: string } {
  return {
    id,
    status: "IN_PROGRESS",
    customerName: null,
    displayIntakeNumber: null,
    purchaseOrderNumber: null,
    displayQuoteNumber: null,
    projectName: null,
    modelName: null,
    serialNumber: null,
    lotNumber: null,
    ...fields,
  };
}

const FILTER_SAMPLE = [
  filterRow("ready", { status: "SHIPMENT_READY", customerName: "가나 테크" }),
  filterRow("pending", { status: "SHIPMENT_APPROVAL_PENDING", customerName: "다라 전자" }),
  filterRow("progress", { status: "IN_PROGRESS", customerName: "가나 테크" }),
  filterRow("noCustomer", { status: "COMPLETED", customerName: null }),
  filterRow("blankCustomer", { status: "IN_PROGRESS", customerName: "   " }),
];

describe("🔴 상태로 거른다", () => {
  test("고른 상태만 남고, 다른 상태는 빠진다", () => {
    const kept = applyMiscCaseFilters(FILTER_SAMPLE, {
      ...DEFAULT_MISC_CASE_FILTERS,
      status: "SHIPMENT_READY",
    });
    // 🔵 둘 다 잰다 — 0건이 아니고(전부 빼기가 아니다), 안 맞는 줄이 빠졌다.
    assert.deepEqual(idsOf(kept), ["ready"]);
    assert.ok(kept.length > 0, "전부 빠졌다");
    assert.equal(kept.length < FILTER_SAMPLE.length, true, "아무것도 안 빠졌다");
  });

  test("`ALL` 은 아무것도 거르지 않는다", () => {
    assert.deepEqual(
      idsOf(applyMiscCaseFilters(FILTER_SAMPLE, DEFAULT_MISC_CASE_FILTERS)),
      idsOf(FILTER_SAMPLE)
    );
  });
});

describe("🔴 공급처로 거른다", () => {
  test("이름이 같은 줄만 남는다", () => {
    const kept = applyMiscCaseFilters(FILTER_SAMPLE, {
      ...DEFAULT_MISC_CASE_FILTERS,
      customerName: "가나 테크",
    });
    assert.deepEqual(idsOf(kept), ["ready", "progress"]);
    assert.equal(kept.length < FILTER_SAMPLE.length, true, "안 맞는 줄이 안 빠졌다");
  });

  test("🔴 「미지정」은 **공백만 적힌 줄까지** 함께 고른다", () => {
    const kept = applyMiscCaseFilters(FILTER_SAMPLE, {
      ...DEFAULT_MISC_CASE_FILTERS,
      customerName: MISC_CASE_UNASSIGNED_CUSTOMER_VALUE,
    });
    // 보이지 않는 한 칸짜리 이름이 고객사가 되면, 화면에는 빈칸인데 「미지정」에서
    // 빠지는 줄이 생긴다.
    assert.deepEqual(idsOf(kept), ["noCustomer", "blankCustomer"]);
  });

  test("상태와 공급처는 **함께** 걸린다(AND)", () => {
    const kept = applyMiscCaseFilters(FILTER_SAMPLE, {
      ...DEFAULT_MISC_CASE_FILTERS,
      status: "IN_PROGRESS",
      customerName: "가나 테크",
    });
    assert.deepEqual(idsOf(kept), ["progress"]);
  });

  test("글자 찾기와도 함께 걸린다 — 내자 정리와 같은 함수를 쓴다", () => {
    const rows = [
      filterRow("a", { customerName: "가나 테크", purchaseOrderNumber: "PO-1" }),
      filterRow("b", { customerName: "가나 테크", purchaseOrderNumber: "PO-2" }),
    ];
    assert.deepEqual(
      idsOf(applyMiscCaseFilters(rows, { ...DEFAULT_MISC_CASE_FILTERS, query: "po-2" })),
      ["b"]
    );
  });
});

describe("🔴 고를 수 있는 공급처", () => {
  test("자료에 있는 이름만, 가나다순으로 — 미지정은 맨 뒤", () => {
    const options = collectMiscCaseCustomerOptions(FILTER_SAMPLE);
    assert.deepEqual(
      options.map((option) => option.value),
      ["가나 테크", "다라 전자", MISC_CASE_UNASSIGNED_CUSTOMER_VALUE]
    );
    // 내자 정리가 같은 줄을 묶을 때 쓰는 **그 글자**를 나눠 쓴다.
    assert.equal(options[options.length - 1].label, UNASSIGNED_CUSTOMER_LABEL);
  });

  test("🔴 빈 공급처가 하나도 없으면 「미지정」 자리를 내밀지 않는다", () => {
    const options = collectMiscCaseCustomerOptions([
      filterRow("a", { customerName: "가나 테크" }),
      filterRow("b", { customerName: "다라 전자" }),
    ]);
    assert.deepEqual(options.map((option) => option.value), ["가나 테크", "다라 전자"]);
  });

  test("같은 이름은 한 번만 — 공백 차이로 갈라지지 않는다", () => {
    const options = collectMiscCaseCustomerOptions([
      filterRow("a", { customerName: "가나 테크" }),
      filterRow("b", { customerName: " 가나 테크 " }),
    ]);
    assert.deepEqual(options.map((option) => option.value), ["가나 테크"]);
  });
});

test("🔴 걸린 조건 수에 검색어는 안 센다 — 검색칸은 늘 보인다", () => {
  assert.equal(countActiveMiscCaseFilters(DEFAULT_MISC_CASE_FILTERS), 0);
  assert.equal(countActiveMiscCaseFilters({ ...DEFAULT_MISC_CASE_FILTERS, query: "가나" }), 0);
  assert.equal(countActiveMiscCaseFilters({ ...DEFAULT_MISC_CASE_FILTERS, status: "COMPLETED" }), 1);
  assert.equal(
    countActiveMiscCaseFilters({
      ...DEFAULT_MISC_CASE_FILTERS,
      status: "COMPLETED",
      customerName: "가나 테크",
    }),
    2
  );
});

test("🔵 거르개가 내미는 상태 글자는 전부 말이 있다 — 빈 칸이 선택지에 서지 않는다", () => {
  for (const [status, label] of Object.entries(MISC_CASE_STATUS_LABELS)) {
    assert.notEqual(label.trim(), "", `${status} 의 글자가 비었다`);
  }
});
