import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MY_WORK_SORT,
  sortMyActiveWorkRows,
  sortMyActiveWorkRowsBy,
} from "./my-active-work-sort";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

function row(overrides: Partial<MyActiveWorkRow>): MyActiveWorkRow {
  return {
    id: overrides.id ?? "id",
    intakeNumber: "D260101",
    receivedAt: "2026-01-01",
    customerId: "cust-1",
    customerName: "고객사",
    endUserName: null,
    productCategory: "Matcher",
    billingType: "PAID",
    modelName: "M",
    serialNumber: "S",
    lotNumber: "L",
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

test("sorts by internalTargetShipmentDate ascending, soonest first", () => {
  const rows = [
    row({ id: "late", internalTargetShipmentDate: "2026-09-01" }),
    row({ id: "soon", internalTargetShipmentDate: "2026-08-15" }),
    row({ id: "mid", internalTargetShipmentDate: "2026-08-20" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["soon", "mid", "late"]);
});

test("rows with no internalTargetShipmentDate sort after every dated row (nulls last)", () => {
  const rows = [
    row({ id: "no-target", internalTargetShipmentDate: null }),
    row({ id: "dated", internalTargetShipmentDate: "2026-12-31" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["dated", "no-target"]);
});

test("tie-break 1: same target date -> older receivedAt first", () => {
  const rows = [
    row({ id: "newer-intake", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-05" }),
    row({ id: "older-intake", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-01" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["older-intake", "newer-intake"]);
});

test("tie-break 2: same target date and same receivedAt -> intakeNumber decides, always deterministic", () => {
  const rows = [
    row({ id: "b", intakeNumber: "D260102", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-01" }),
    row({ id: "a", intakeNumber: "D260101", internalTargetShipmentDate: "2026-08-20", receivedAt: "2026-08-01" }),
  ];
  const sorted = sortMyActiveWorkRows(rows).map((r) => r.id);
  assert.deepEqual(sorted, ["a", "b"]);
});

test("never mutates the input array", () => {
  const rows = [row({ id: "1", internalTargetShipmentDate: "2026-09-01" }), row({ id: "2", internalTargetShipmentDate: "2026-08-01" })];
  const original = [...rows];
  sortMyActiveWorkRows(rows);
  assert.deepEqual(rows, original);
});

// ─────────────────────────────────────────── 2026-08-19 열 머리글 정렬

test("아무 머리글도 누르지 않은 상태(default)는 기존 급한 순 정렬 그대로다", () => {
  const rows = [
    row({ id: "late", intakeNumber: "D1", internalTargetShipmentDate: "2026-09-01" }),
    row({ id: "soon", intakeNumber: "D2", internalTargetShipmentDate: "2026-08-20" }),
    row({ id: "none", intakeNumber: "D3", internalTargetShipmentDate: null }),
  ];
  assert.deepEqual(
    sortMyActiveWorkRowsBy(rows, DEFAULT_MY_WORK_SORT).map((r) => r.id),
    sortMyActiveWorkRows(rows).map((r) => r.id)
  );
});

test("열을 고르면 그 열로 오름차순 정렬한다", () => {
  const rows = [row({ id: "b", customerName: "동해정밀" }), row({ id: "a", customerName: "가온전자" })];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "customerName", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["a", "b"]);
});

test("값이 같으면 인수번호로 순서를 매듭짓는다", () => {
  const rows = [
    row({ id: "second", intakeNumber: "D260902", customerName: "가온전자" }),
    row({ id: "first", intakeNumber: "D260901", customerName: "가온전자" }),
  ];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "customerName", direction: "asc" });
  assert.deepEqual(sorted.map((r) => r.id), ["first", "second"]);
});

test("내림차순에서도 값 없는 행은 맨 뒤에 남는다", () => {
  // 값 없음이 맨 위로 올라오면 목록 첫 화면이 정보 없는 행으로 채워진다.
  const rows = [
    row({ id: "early", intakeNumber: "D1", customerRequestedDueDate: "2026-08-20" }),
    row({ id: "none", intakeNumber: "D2", customerRequestedDueDate: null }),
    row({ id: "late", intakeNumber: "D3", customerRequestedDueDate: "2026-09-10" }),
  ];
  const sorted = sortMyActiveWorkRowsBy(rows, { column: "customerRequestedDueDate", direction: "desc" });
  assert.deepEqual(sorted.map((r) => r.id), ["late", "early", "none"]);
});

test("정렬은 원본 배열을 건드리지 않는다", () => {
  const rows = [row({ id: "b", customerName: "동해정밀" }), row({ id: "a", customerName: "가온전자" })];
  sortMyActiveWorkRowsBy(rows, { column: "customerName", direction: "asc" });
  assert.deepEqual(rows.map((r) => r.id), ["b", "a"]);
});
