import { test } from "node:test";
import assert from "node:assert/strict";
import { findProductHistoryMatches } from "./product-history-match";
import { resolveAllRepairCases, type ResolvedRepairCase } from "./resolved-repair-case";

/**
 * 「이 제품의 과거 A/S 이력」 칸이 실제 DB 건에서 아무것도 못 보여 주던
 * 버그를 못 박는다. 상세 화면은 DATABASE 소스 건에 대해 같은 product_id 로
 * 접수된 건들을 후보로 넘기고(queries/repair-cases.ts의
 * listRepairCasesByProductId), 그 중 무엇을 보여 줄지는 여기 있는
 * findProductHistoryMatches가 mock/local과 **같은 규칙**으로 고른다.
 *
 * 함께 고정하는 것:
 *  - DATABASE↔DATABASE 는 product_id 로 맞춘다(Model/L·N/S·N 문자열이
 *    어긋나도 같은 개체면 나온다, 세 값이 같아도 다른 개체면 안 나온다).
 *  - mock↔mock 경로 결과는 예전 그대로다(회귀 보호).
 */
function caseOf(overrides: Partial<ResolvedRepairCase> & { id: string }): ResolvedRepairCase {
  return {
    version: 1,
    source: "DATABASE",
    productId: "prod-A",
    intakeNumber: overrides.id,
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    status: "WAITING_INTAKE_INSPECTION",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "intake_inspection",
    receivedAt: "2026-01-01",
    customerRequestedDueDate: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    isOverdue: false,
    productCategory: "유상 매처",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TG-100",
    lotNumber: "LOT-1",
    serialNumber: "SN-1",
    partNumber: null,
    customerId: "cust-1",
    customerName: "한빛전자(주)",
    endUserId: null,
    endUserName: null,
    assignedEngineerId: null,
    engineerName: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    ...overrides,
  };
}

test("DATABASE 건 — 같은 product_id 의 더 이른 접수 건이 이력으로 나온다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01" });
  const earlier = caseOf({ id: "old", receivedAt: "2026-03-10" });

  const matches = findProductHistoryMatches([current, earlier], current);

  assert.deepEqual(
    matches.map((m) => m.id),
    ["old"]
  );
});

test("DATABASE 건 — 자기 자신은 이력에서 빠진다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01" });

  assert.deepEqual(findProductHistoryMatches([current], current), []);
});

test("DATABASE 건 — 현재 건보다 나중에 접수된 건은 나오지 않는다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01" });
  const later = caseOf({ id: "later", receivedAt: "2026-08-20" });
  const sameDay = caseOf({ id: "same-day", receivedAt: "2026-06-01" });

  assert.deepEqual(findProductHistoryMatches([current, later, sameDay], current), []);
});

test("DATABASE 건 — 접수일 내림차순(최근 것 먼저)으로 정렬된다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01" });
  const oldest = caseOf({ id: "oldest", receivedAt: "2025-11-02" });
  const middle = caseOf({ id: "middle", receivedAt: "2026-02-14" });
  const newest = caseOf({ id: "newest", receivedAt: "2026-05-30" });

  const matches = findProductHistoryMatches([oldest, current, newest, middle], current);

  assert.deepEqual(
    matches.map((m) => m.id),
    ["newest", "middle", "oldest"]
  );
});

test("DATABASE 건 — 다른 product_id 는 Model/L·N/S·N 이 모두 같아도 나오지 않는다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01", productId: "prod-A" });
  const otherUnit = caseOf({ id: "other-unit", receivedAt: "2026-01-05", productId: "prod-B" });

  assert.deepEqual(findProductHistoryMatches([current, otherUnit], current), []);
});

test("DATABASE 건 — product_id 가 같으면 Model/L·N/S·N 표기가 달라도 나온다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01" });
  const renamed = caseOf({
    id: "renamed",
    receivedAt: "2026-01-05",
    modelName: "TG-100 (개정)",
    lotNumber: "lot 1",
    serialNumber: "",
  });

  assert.deepEqual(
    findProductHistoryMatches([current, renamed], current).map((m) => m.id),
    ["renamed"]
  );
});

test("이력 항목은 화면이 그리는 여섯 칸을 그대로 담는다", () => {
  const current = caseOf({ id: "now", receivedAt: "2026-06-01" });
  const earlier = caseOf({
    id: "old",
    intakeNumber: "D260310",
    receivedAt: "2026-03-10",
    status: "SHIPMENT_COMPLETED",
    actualShipmentDate: "2026-03-25",
  });

  assert.deepEqual(findProductHistoryMatches([current, earlier], current), [
    {
      id: "old",
      source: "DATABASE",
      intakeNumber: "D260310",
      receivedAt: "2026-03-10",
      status: "SHIPMENT_COMPLETED",
      actualShipmentDate: "2026-03-25",
    },
  ]);
});

/**
 * 회귀 보호 — mock 병합 목록(상세 화면이 MOCK/LOCAL_DEMO 건에 여전히 넘기는
 * 바로 그 목록)에서 나오는 이력 짝이 예전과 한 줄도 달라지지 않아야 한다.
 * DATABASE 갈래를 더하면서 mock 경로를 건드리지 않았음을 이 표가 못 박는다.
 */
test("mock↔mock 경로 결과가 그대로다", () => {
  const all = resolveAllRepairCases([]);

  const pairs = all
    .map((current) => [current.intakeNumber, findProductHistoryMatches(all, current).map((m) => m.intakeNumber)] as const)
    .filter(([, matches]) => matches.length > 0);

  assert.deepEqual(pairs, [
    ["D260801", ["D260601"]],
    ["D260802", ["D260602"]],
    ["D260803", ["D260603"]],
    ["D260804", ["D260701"]],
    ["D260805", ["D260702"]],
    ["D260806", ["D260703"]],
    ["D260807", ["D260704"]],
    ["D260808", ["D260705"]],
    ["D260809", ["D260706"]],
  ]);
});

/**
 * 폴백(정규화 Model+L/N+S/N)은 그대로 남아 있어야 한다 — LOCAL_DEMO 가 낀
 * 비교에는 productId 자체가 없어서 이것뿐이다.
 */
test("LOCAL_DEMO 가 끼면 정규화 3필드 폴백으로 매칭된다", () => {
  const current = caseOf({
    id: "now",
    source: "LOCAL_DEMO",
    productId: null,
    receivedAt: "2026-06-01",
  });
  const earlier = caseOf({
    id: "old",
    source: "MOCK",
    productId: "p-001",
    receivedAt: "2026-03-10",
    modelName: " tg-100 ",
    lotNumber: "lot-1",
    serialNumber: "sn-1",
  });
  const differentUnit = caseOf({
    id: "other",
    source: "MOCK",
    productId: "p-002",
    receivedAt: "2026-02-10",
    serialNumber: "SN-9",
  });

  assert.deepEqual(
    findProductHistoryMatches([current, earlier, differentUnit], current).map((m) => m.id),
    ["old"]
  );
});
