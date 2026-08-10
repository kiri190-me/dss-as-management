import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMyWorkFilters, DEFAULT_MY_WORK_FILTERS } from "./my-active-work-filter";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

function row(overrides: Partial<MyActiveWorkRow>): MyActiveWorkRow {
  return {
    id: "id",
    intakeNumber: "D260101",
    receivedAt: "2026-01-01",
    customerName: "한빛전자",
    endUserName: "한빛전자 부산공장",
    productCategory: "Matcher",
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

test("no filters returns everything", () => {
  const rows = [row({ id: "1" }), row({ id: "2" })];
  assert.equal(applyMyWorkFilters(rows, DEFAULT_MY_WORK_FILTERS).length, 2);
});

test("status filter matches exact RepairStatus", () => {
  const rows = [row({ id: "repair", status: "IN_REPAIR" }), row({ id: "shipment", status: "WAITING_SHIPMENT" })];
  const result = applyMyWorkFilters(rows, { query: "", status: "WAITING_SHIPMENT" });
  assert.deepEqual(result.map((r) => r.id), ["shipment"]);
});

test("search matches intake number", () => {
  const rows = [row({ id: "match", intakeNumber: "D260813" }), row({ id: "other", intakeNumber: "D260701" })];
  const result = applyMyWorkFilters(rows, { query: "260813", status: "ALL" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches customer", () => {
  const rows = [row({ id: "match", customerName: "대성RF시스템" }), row({ id: "other", customerName: "동해정밀" })];
  const result = applyMyWorkFilters(rows, { query: "대성", status: "ALL" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches End-User, including when null on the non-matching row", () => {
  const rows = [row({ id: "match", endUserName: "부산공장" }), row({ id: "other", endUserName: null })];
  const result = applyMyWorkFilters(rows, { query: "부산", status: "ALL" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches model", () => {
  const rows = [row({ id: "match", modelName: "TG-350" }), row({ id: "other", modelName: "TG-150" })];
  const result = applyMyWorkFilters(rows, { query: "350", status: "ALL" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches S/N", () => {
  const rows = [row({ id: "match", serialNumber: "SN-ABC" }), row({ id: "other", serialNumber: "SN-XYZ" })];
  const result = applyMyWorkFilters(rows, { query: "abc", status: "ALL" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search matches L/N", () => {
  const rows = [row({ id: "match", lotNumber: "LOT-777" }), row({ id: "other", lotNumber: "LOT-999" })];
  const result = applyMyWorkFilters(rows, { query: "777", status: "ALL" });
  assert.deepEqual(result.map((r) => r.id), ["match"]);
});

test("search and status combine (AND, not OR)", () => {
  const rows = [
    row({ id: "both", intakeNumber: "D260813", status: "IN_REPAIR" }),
    row({ id: "search-only", intakeNumber: "D260813", status: "WAITING_SHIPMENT" }),
  ];
  const result = applyMyWorkFilters(rows, { query: "260813", status: "IN_REPAIR" });
  assert.deepEqual(result.map((r) => r.id), ["both"]);
});
