import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, DEFAULT_FILTERS, parseInitialFilters, type Filters } from "./repair-case-filters";
import type { EffectiveRepairCase } from "./local/workflow/effective-repair-case";

/**
 * 전체 A/S 현황 목록 필터. 2026-08-19에 워크플로 유형 하나로 걸던 것을 제품군과
 * 유·무상 둘로 나눴고(repair-case-filters.ts 상단 주석), 여기서 그 두 축이
 * 서로 독립적으로 동작하는지를 못 박는다.
 */

function row(overrides: Partial<EffectiveRepairCase> = {}): EffectiveRepairCase {
  return {
    id: "case-1",
    version: 1,
    source: "MOCK",
    productId: null,
    intakeNumber: "D260813",
    legacyReportNumber: null,
    workflowType: "PAID_GENERATOR",
    status: "IN_REPAIR",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "repair",
    receivedAt: "2026-08-03",
    customerRequestedDueDate: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    isOverdue: false,
    productCategory: "Generator",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TG-350",
    lotNumber: "LN-1",
    serialNumber: "SN-1",
    partNumber: null,
    customerId: "cust-1",
    customerName: "대성RF시스템",
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
    effectiveStatus: "IN_REPAIR",
    effectiveWorkflowStepKey: "repair",
    effectiveActualShipmentDate: null,
    effectiveIsOverdue: false,
    holdState: null,
    hasWorkflowOverride: false,
    ...overrides,
  };
}

function filters(overrides: Partial<Filters> = {}): Filters {
  return { ...DEFAULT_FILTERS, ...overrides };
}

function idsOf(rows: EffectiveRepairCase[]): string[] {
  return rows.map((r) => r.id);
}

// ─────────────────────────────────────────────── 제품군

test("제품군은 표에 적히는 문구 그대로 비교한다", () => {
  const rows = [
    row({ id: "gen", productCategory: "Generator" }),
    row({ id: "tc", productCategory: "Total Controller" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategory: "Generator" }))), ["gen"]);
});

test("제품군은 유·무상을 가리지 않는다 — 예전 워크플로 유형이 못 하던 것", () => {
  const rows = [
    row({ id: "paid", productCategory: "Generator", workflowType: "PAID_GENERATOR", billingType: "PAID" }),
    row({
      id: "warranty",
      productCategory: "Generator",
      workflowType: "WARRANTY_GENERATOR",
      billingType: "WARRANTY",
    }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategory: "Generator" }))), ["paid", "warranty"]);
});

// ─────────────────────────────────────────────── 유·무상

test("유·무상은 제품군을 가리지 않는다", () => {
  const rows = [
    row({ id: "gen", productCategory: "Generator", billingType: "PAID" }),
    row({ id: "tc", productCategory: "Total Controller", billingType: "PAID" }),
    row({ id: "free", productCategory: "Generator", billingType: "WARRANTY" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingType: "PAID" }))), ["gen", "tc"]);
});

test("'미지정'은 유·무상이 아직 정해지지 않은 건만 남긴다", () => {
  const rows = [
    row({ id: "unset", billingType: null, paidOrWarranty: "-" }),
    row({ id: "paid", billingType: "PAID" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingType: "NONE" }))), ["unset"]);
});

test("유·무상을 고르면 정해지지 않은 건은 어느 쪽으로도 딸려오지 않는다", () => {
  const rows = [row({ id: "unset", billingType: null }), row({ id: "paid", billingType: "PAID" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingType: "PAID" }))), ["paid"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingType: "WARRANTY" }))), []);
});

test("전체는 정해지지 않은 건까지 다 남긴다", () => {
  const rows = [row({ id: "unset", billingType: null }), row({ id: "paid", billingType: "PAID" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters())), ["unset", "paid"]);
});

test("제품군과 유·무상은 함께 걸린다", () => {
  const rows = [
    row({ id: "hit", productCategory: "Generator", billingType: "WARRANTY" }),
    row({ id: "wrong-category", productCategory: "Matcher", billingType: "WARRANTY" }),
    row({ id: "wrong-billing", productCategory: "Generator", billingType: "PAID" }),
  ];
  const result = applyFilters(rows, filters({ productCategory: "Generator", billingType: "WARRANTY" }));
  assert.deepEqual(idsOf(result), ["hit"]);
});

// ─────────────────────────────────────────────── 주소창에서 들어온 값

test("주소창의 제품군·유·무상 값은 아는 값일 때만 받는다", () => {
  const parsed = parseInitialFilters(
    new URLSearchParams("productCategory=Generator&billingType=WARRANTY")
  );
  assert.equal(parsed.productCategory, "Generator");
  assert.equal(parsed.billingType, "WARRANTY");

  const junk = parseInitialFilters(new URLSearchParams("productCategory=드론&billingType=FREE"));
  assert.equal(junk.productCategory, "ALL", "모르는 제품군은 조용히 무시한다");
  assert.equal(junk.billingType, "ALL", "모르는 유·무상 코드도 마찬가지다");
});

test("주소창으로도 '미지정'을 걸 수 있다", () => {
  assert.equal(parseInitialFilters(new URLSearchParams("billingType=NONE")).billingType, "NONE");
});

test("사라진 workflowType 파라미터는 아무 것도 걸지 않는다", () => {
  // 딥링크가 한 군데도 없어서 끊어질 링크는 없지만, 남아 있는 주소가 있어도
  // 조용히 무시될 뿐 엉뚱한 필터가 걸리지는 않아야 한다.
  const parsed = parseInitialFilters(new URLSearchParams("workflowType=PAID_GENERATOR"));
  assert.deepEqual(parsed, { ...DEFAULT_FILTERS });
});
