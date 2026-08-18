import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyMyWorkFilters,
  collectMyWorkFilterOptions,
  DEFAULT_MY_WORK_FILTERS,
  type MyWorkFilterState,
} from "./my-active-work-filter";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

function row(overrides: Partial<MyActiveWorkRow>): MyActiveWorkRow {
  return {
    id: "id",
    intakeNumber: "D260101",
    receivedAt: "2026-01-01",
    customerId: "cust-1",
    customerName: "한빛전자",
    endUserName: "한빛전자 부산공장",
    productCategory: "Matcher",
    billingType: "PAID",
    modelName: "TG-200",
    serialNumber: "SN-001",
    lotNumber: "LN-001",
    status: "IN_REPAIR",
    currentWorkflowStepLabel: "수리",
    exceptionStatus: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    customerRequestedDueDate: null,
    lastActivityAt: null,
    activePartsRequestStatus: null,
    ...overrides,
  };
}

/** 기본 필터 위에 이 시험이 관심 있는 항목만 덮어쓴다 — 필터가 늘어날 때마다 모든 호출부를 고치지 않으려고 둔다. */
function filters(overrides: Partial<MyWorkFilterState>): MyWorkFilterState {
  return { ...DEFAULT_MY_WORK_FILTERS, ...overrides };
}

test("no filters returns everything", () => {
  const rows = [row({ id: "1" }), row({ id: "2" })];
  assert.equal(applyMyWorkFilters(rows, DEFAULT_MY_WORK_FILTERS).length, 2);
});

test("status filter matches exact RepairStatus", () => {
  const rows = [row({ id: "repair", status: "IN_REPAIR" }), row({ id: "shipment", status: "WAITING_SHIPMENT" })];
  const result = applyMyWorkFilters(rows, filters({ query: "", status: "WAITING_SHIPMENT" }));
  assert.deepEqual(result.map((r) => r.id), ["shipment"]);
});

test("search matches intake number", () => {
  const rows = [row({ id: "match", intakeNumber: "D260813" }), row({ id: "other", intakeNumber: "D260701" })];
  const result = applyMyWorkFilters(rows, filters({ query: "260813", status: "ALL" }));
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches customer", () => {
  const rows = [row({ id: "match", customerName: "대성RF시스템" }), row({ id: "other", customerName: "동해정밀" })];
  const result = applyMyWorkFilters(rows, filters({ query: "대성", status: "ALL" }));
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches End-User, including when null on the non-matching row", () => {
  const rows = [row({ id: "match", endUserName: "부산공장" }), row({ id: "other", endUserName: null })];
  const result = applyMyWorkFilters(rows, filters({ query: "부산", status: "ALL" }));
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches model", () => {
  const rows = [row({ id: "match", modelName: "TG-350" }), row({ id: "other", modelName: "TG-150" })];
  const result = applyMyWorkFilters(rows, filters({ query: "350", status: "ALL" }));
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches S/N", () => {
  const rows = [row({ id: "match", serialNumber: "SN-ABC" }), row({ id: "other", serialNumber: "SN-XYZ" })];
  const result = applyMyWorkFilters(rows, filters({ query: "abc", status: "ALL" }));
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches L/N", () => {
  const rows = [row({ id: "match", lotNumber: "LOT-777" }), row({ id: "other", lotNumber: "LOT-999" })];
  const result = applyMyWorkFilters(rows, filters({ query: "777", status: "ALL" }));
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search and status combine (AND, not OR)", () => {
  const rows = [
    row({ id: "both", intakeNumber: "D260813", status: "IN_REPAIR" }),
    row({ id: "search-only", intakeNumber: "D260813", status: "WAITING_SHIPMENT" }),
  ];
  const result = applyMyWorkFilters(rows, filters({ query: "260813", status: "IN_REPAIR" }));
  assert.deepEqual(result.map((r) => r.id), ["both"]);
});

// ─────────────────────────────────────────── 2026-08-19 추가 필터

test("제품 구분 필터는 표시 문자열과 정확히 일치하는 건만 남긴다", () => {
  const rows = [row({ id: "gen", productCategory: "Generator" }), row({ id: "tc", productCategory: "Total Controller" })];
  const result = applyMyWorkFilters(rows, filters({ productCategory: "Generator" }));
  assert.deepEqual(result.map((r) => r.id), ["gen"]);
});

test("고객사 필터는 이름이 아니라 id로 판정한다", () => {
  // 이름이 같은 고객사가 둘 있어도 서로 섞이지 않아야 한다.
  const rows = [
    row({ id: "a", customerId: "c-1", customerName: "한빛전자" }),
    row({ id: "b", customerId: "c-2", customerName: "한빛전자" }),
  ];
  const result = applyMyWorkFilters(rows, filters({ customerId: "c-2" }));
  assert.deepEqual(result.map((r) => r.id), ["b"]);
});

test("예외 상태 '예외 없음'은 예외가 걸린 건을 모두 제외한다", () => {
  const rows = [
    row({ id: "clean", exceptionStatus: null }),
    row({ id: "waiting", exceptionStatus: "WAITING_KYOSAN_RESPONSE" }),
  ];
  const result = applyMyWorkFilters(rows, filters({ exceptionStatus: "NONE" }));
  assert.deepEqual(result.map((r) => r.id), ["clean"]);
});

test("예외 상태를 하나 고르면 그 예외만 남는다", () => {
  const rows = [
    row({ id: "clean", exceptionStatus: null }),
    row({ id: "waiting", exceptionStatus: "WAITING_KYOSAN_RESPONSE" }),
  ];
  const result = applyMyWorkFilters(rows, filters({ exceptionStatus: "WAITING_KYOSAN_RESPONSE" }));
  assert.deepEqual(result.map((r) => r.id), ["waiting"]);
});

test("여러 필터는 함께 적용된다(AND)", () => {
  const rows = [
    row({ id: "hit", productCategory: "Generator", customerId: "c-1", status: "IN_REPAIR" }),
    row({ id: "wrong-status", productCategory: "Generator", customerId: "c-1", status: "WAITING_PO" }),
    row({ id: "wrong-customer", productCategory: "Generator", customerId: "c-2", status: "IN_REPAIR" }),
  ];
  const result = applyMyWorkFilters(rows, filters({ productCategory: "Generator", customerId: "c-1", status: "IN_REPAIR" }));
  assert.deepEqual(result.map((r) => r.id), ["hit"]);
});

// ─────────────────────────────────────────── 선택 항목 만들기

test("선택 항목은 담당 건에 실제로 있는 값만, 중복 없이 이름순으로 만든다", () => {
  const options = collectMyWorkFilterOptions([
    row({ id: "1", productCategory: "Total Controller", customerId: "c-2", customerName: "동해정밀", exceptionStatus: null }),
    row({ id: "2", productCategory: "Generator", customerId: "c-1", customerName: "한빛전자", exceptionStatus: "WAITING_KYOSAN_RESPONSE" }),
    row({ id: "3", productCategory: "Generator", customerId: "c-1", customerName: "한빛전자", exceptionStatus: "WAITING_KYOSAN_RESPONSE" }),
  ]);
  assert.deepEqual(options.productCategories, ["Generator", "Total Controller"]);
  assert.deepEqual(options.customers, [
    { id: "c-2", name: "동해정밀" },
    { id: "c-1", name: "한빛전자" },
  ]);
  assert.deepEqual(options.exceptionStatuses, ["WAITING_KYOSAN_RESPONSE"], "예외 없음(null)은 항목이 되지 않는다");
});

test("담당 건이 없으면 선택 항목도 비어 있다", () => {
  const options = collectMyWorkFilterOptions([]);
  assert.deepEqual(options, { productCategories: [], customers: [], exceptionStatuses: [] });
});
