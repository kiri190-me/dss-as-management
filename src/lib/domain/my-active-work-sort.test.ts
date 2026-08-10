import { test } from "node:test";
import assert from "node:assert/strict";
import { sortMyActiveWorkRows } from "./my-active-work-sort";
import type { MyActiveWorkRow } from "@/lib/db/queries/repair-cases-mine";

function row(overrides: Partial<MyActiveWorkRow>): MyActiveWorkRow {
  return {
    id: overrides.id ?? "id",
    intakeNumber: "D260101",
    receivedAt: "2026-01-01",
    customerName: "고객사",
    endUserName: null,
    productCategory: "Matcher",
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
