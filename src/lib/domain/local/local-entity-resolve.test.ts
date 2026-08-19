import { test } from "node:test";
import assert from "node:assert/strict";
import { localCustomerId, localEndUserId, type LocalRepairCase } from "./local-types";
import { resolveOrCreateLocalCustomer, resolveOrCreateLocalEndUser } from "./local-entity-resolve";
import type { Customer, EndUser } from "../types";

const mockCustomers: Customer[] = [
  { id: "c-001", name: "대성RF", contactName: "김철수", contactEmail: "a@example.test", contactPhone: "010-0000-0000" },
];
const mockEndUsers: EndUser[] = [
  { id: "eu-001", customerId: "c-001", name: "대전연구소", contactName: "박영희", contactEmail: "b@example.test" },
];

function baseLocalCase(overrides: Partial<LocalRepairCase> = {}): LocalRepairCase {
  return {
    id: "local-aaaa",
    intakeNumber: "D260601",
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    status: "WAITING_INTAKE_INSPECTION",
    priority: "NORMAL",
    currentWorkflowStepKey: "product_intake",
    receivedAt: "2026-08-01",
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    exceptionStatus: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    customerId: "c-001",
    customerNameSnapshot: "대성RF",
    endUserId: null,
    endUserNameSnapshot: null,
    assignedEngineerId: null,
    assignedEngineerNameSnapshot: null,
    modelName: "TG-100",
    lotNumber: "LOT-1",
    serialNumber: "SN-1",
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

test("resolveOrCreateLocalCustomer reuses an existing mock customer on a normalized-name match", () => {
  const result = resolveOrCreateLocalCustomer("  대성rf  ", mockCustomers, []);
  assert.equal(result.id, "c-001");
  assert.equal(result.name, "대성RF");
});

test("resolveOrCreateLocalCustomer reuses a customer already created by an earlier local case", () => {
  const localCases = [baseLocalCase({ customerId: "local-customer-신규고객사", customerNameSnapshot: "신규고객사" })];
  const result = resolveOrCreateLocalCustomer("신규고객사", mockCustomers, localCases);
  assert.equal(result.id, "local-customer-신규고객사");
  assert.equal(result.name, "신규고객사");
});

test("resolveOrCreateLocalCustomer synthesizes a deterministic id for a genuinely new name", () => {
  const result = resolveOrCreateLocalCustomer("완전히 새로운 고객사", mockCustomers, []);
  assert.equal(result.id, localCustomerId("완전히 새로운 고객사"));
  assert.equal(result.name, "완전히 새로운 고객사");
});

test("resolveOrCreateLocalCustomer: two calls with the same normalized name converge on the same id", () => {
  const first = resolveOrCreateLocalCustomer("Acme  Co", mockCustomers, []);
  const second = resolveOrCreateLocalCustomer("acme co", mockCustomers, []);
  assert.equal(first.id, second.id);
});

test("resolveOrCreateLocalEndUser reuses an existing mock End-User scoped to the customer", () => {
  const result = resolveOrCreateLocalEndUser("대전연구소", "c-001", mockEndUsers, []);
  assert.equal(result.id, "eu-001");
});

test("resolveOrCreateLocalEndUser never matches a same-named End-User under a different customer", () => {
  const result = resolveOrCreateLocalEndUser("대전연구소", "c-999", mockEndUsers, []);
  assert.equal(result.id, localEndUserId("c-999", "대전연구소"));
});

test("resolveOrCreateLocalEndUser synthesizes a deterministic id scoped to the customer for a new name", () => {
  const result = resolveOrCreateLocalEndUser("새 지점", "c-001", mockEndUsers, []);
  assert.equal(result.id, localEndUserId("c-001", "새 지점"));
});

test("resolveOrCreateLocalEndUser reuses an End-User already created by an earlier local case under the same customer", () => {
  const localCases = [
    baseLocalCase({ customerId: "c-001", endUserId: "local-enduser-c-001:부산지점", endUserNameSnapshot: "부산지점" }),
  ];
  const result = resolveOrCreateLocalEndUser("부산지점", "c-001", mockEndUsers, localCases);
  assert.equal(result.id, "local-enduser-c-001:부산지점");
});
