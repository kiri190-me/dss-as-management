import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  collectCustomerFilterOptions,
  DEFAULT_FILTERS,
  parseInitialFilters,
  type Filters,
} from "./repair-case-filters";
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

// ─────────────────────────────────────────────── 내게 온 결재 요청

test("내게 온 결재 요청은 서버가 내려준 id 집합으로만 거른다", () => {
  const rows = [row({ id: "mine" }), row({ id: "other" })];
  const pending = new Set(["mine"]);

  assert.deepEqual(idsOf(applyFilters(rows, filters({ myPendingApprovalOnly: true }), pending)), ["mine"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters(), pending)), ["mine", "other"], "끄면 아무것도 걸리지 않는다");
});

test("근거가 되는 집합이 없으면 내게 온 결재 요청은 아무것도 남기지 않는다", () => {
  // 근거 없이 전부 통과시키면 "내게 온 결재 요청"이라는 이름이 거짓이 된다.
  const rows = [row({ id: "mine" }), row({ id: "other" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ myPendingApprovalOnly: true }))), []);
});

test("사이드바 배지의 딥링크(?myApproval=1)가 조건을 켠다", () => {
  assert.equal(parseInitialFilters(new URLSearchParams("myApproval=1")).myPendingApprovalOnly, true);
  assert.equal(parseInitialFilters(new URLSearchParams("myApproval=0")).myPendingApprovalOnly, false);
  assert.equal(parseInitialFilters(new URLSearchParams("")).myPendingApprovalOnly, false);
});

// ─────────────────────────────────────────────── 장기 PO 미발행

test("장기 PO 미발행은 서버가 내려준 id 집합으로만 거른다", () => {
  const rows = [row({ id: "stale" }), row({ id: "fresh" })];
  const longPending = new Set(["stale"]);

  assert.deepEqual(
    idsOf(applyFilters(rows, filters({ longPendingPoOnly: true }), undefined, longPending)),
    ["stale"]
  );
  assert.deepEqual(
    idsOf(applyFilters(rows, filters(), undefined, longPending)),
    ["stale", "fresh"],
    "끄면 아무것도 걸리지 않는다"
  );
});

test("근거가 되는 집합이 없으면 장기 PO 미발행은 아무것도 남기지 않는다", () => {
  // 견적일·발주일은 행이 아니라 내자 줄에 있고 "오늘"도 서버가 정한다 —
  // 근거 없이 전부 통과시키면 필터 이름이 거짓이 된다.
  const rows = [row({ id: "stale" }), row({ id: "fresh" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ longPendingPoOnly: true }))), []);
});

test("두 체크박스는 서로 독립적으로 겹쳐 걸린다", () => {
  const rows = [row({ id: "both" }), row({ id: "approval-only" }), row({ id: "po-only" })];
  const pending = new Set(["both", "approval-only"]);
  const longPending = new Set(["both", "po-only"]);

  assert.deepEqual(
    idsOf(
      applyFilters(
        rows,
        filters({ myPendingApprovalOnly: true, longPendingPoOnly: true }),
        pending,
        longPending
      )
    ),
    ["both"]
  );
});

test("주소창으로도 장기 PO 미발행을 걸 수 있다(?longPendingPo=1)", () => {
  assert.equal(parseInitialFilters(new URLSearchParams("longPendingPo=1")).longPendingPoOnly, true);
  assert.equal(parseInitialFilters(new URLSearchParams("longPendingPo=0")).longPendingPoOnly, false);
  assert.equal(parseInitialFilters(new URLSearchParams("")).longPendingPoOnly, false);
});

test("사라진 workflowType 파라미터는 아무 것도 걸지 않는다", () => {
  // 딥링크가 한 군데도 없어서 끊어질 링크는 없지만, 남아 있는 주소가 있어도
  // 조용히 무시될 뿐 엉뚱한 필터가 걸리지는 않아야 한다.
  const parsed = parseInitialFilters(new URLSearchParams("workflowType=PAID_GENERATOR"));
  assert.deepEqual(parsed, { ...DEFAULT_FILTERS });
});

// ─────────────────────────────────────────────── 고객사 선택지
//
// 이 필터는 mock-data.ts의 데모 고객사 7곳을 그대로 보고 있었다. 실제 DB에는
// 고객사가 훨씬 많아서, 수리품 목록에는 멀쩡히 보이는 접수 건의 고객사를 필터에서는
// 고를 수 없었다. 아래 시험들이 "목록에 있으면 필터에도 있다"를 못 박는다.

function nameOf(customers: { name: string }[]): string[] {
  return customers.map((c) => c.name);
}

test("접수 건이 없으면 고객사 선택지도 없다", () => {
  assert.deepEqual(collectCustomerFilterOptions([]), []);
});

test("같은 고객사가 여러 건이어도 선택지에는 한 번만 나온다", () => {
  const rows = [
    row({ id: "a", customerId: "c-1", customerName: "가온전자" }),
    row({ id: "b", customerId: "c-1", customerName: "가온전자" }),
    row({ id: "c", customerId: "c-2", customerName: "나래시스템" }),
  ];
  assert.deepEqual(
    collectCustomerFilterOptions(rows).map((c) => c.id),
    ["c-1", "c-2"]
  );
});

test("고객사 선택지는 이름 가나다순이다", () => {
  const rows = [
    row({ id: "a", customerId: "c-4", customerName: "라온테크" }),
    row({ id: "b", customerId: "c-1", customerName: "가온전자" }),
    row({ id: "c", customerId: "c-3", customerName: "다온계측" }),
    row({ id: "d", customerId: "c-2", customerName: "나래시스템" }),
  ];
  assert.deepEqual(nameOf(collectCustomerFilterOptions(rows)), [
    "가온전자",
    "나래시스템",
    "다온계측",
    "라온테크",
  ]);
});

test("목록에 있는 고객사는 반드시 필터 선택지에도 있다", () => {
  // 이 고장의 재발 방지선이다. 데모 명단(7곳)을 따로 들고 있던 탓에 목록에는
  // 보이는데 필터에서는 고를 수 없는 고객사가 30곳 생겼었다 — 선택지를 목록
  // 자체에서 뽑는 한, 이 단언은 어떤 데이터에서도 참이다.
  const rows = [
    row({ id: "a", customerId: "c-1", customerName: "가온전자" }),
    row({ id: "b", customerId: "c-2", customerName: "나래시스템" }),
    row({ id: "c", customerId: "c-3", customerName: "다온계측" }),
    row({ id: "d", customerId: "c-9", customerName: "데모 명단에 없던 고객사" }),
  ];
  const optionIds = new Set(collectCustomerFilterOptions(rows).map((c) => c.id));

  for (const listed of rows) {
    assert.ok(
      optionIds.has(listed.customerId),
      `목록의 ${listed.customerName}(${listed.customerId})가 필터 선택지에 없다`
    );
  }
});

test("선택지는 필터 상태와 무관하다 — 고른 고객사가 목록에서 사라지지 않는다", () => {
  // 선택지를 applyFilters 뒤의 배열에서 뽑으면, 고객사를 고르는 순간 나머지가
  // 사라져 되돌아갈 수 없고 검색어를 겹쳐 걸면 고른 고객사까지 사라져 <select>가
  // 빈칸이 된다. 화면은 **필터를 걸기 전의 전체 목록**에서 뽑으므로 그렇지 않다.
  const rows = [
    row({ id: "a", customerId: "c-1", customerName: "가온전자", intakeNumber: "D260001" }),
    row({ id: "b", customerId: "c-2", customerName: "나래시스템", intakeNumber: "D260002" }),
  ];
  const options = collectCustomerFilterOptions(rows);

  // 고객사 c-1을 고르고, 그 고객사의 건이 하나도 안 남도록 검색어까지 겹쳐 건다.
  const narrowed = filters({ customerId: "c-1", query: "없는인수번호" });
  assert.deepEqual(idsOf(applyFilters(rows, narrowed)), [], "이 조건에서는 남는 행이 없다");

  // 그래도 선택지는 그대로다 — 고른 c-1이 남아 있어야 무엇을 걸어 뒀는지 보이고,
  // c-2가 남아 있어야 다른 고객사로 옮겨 갈 수 있다.
  assert.deepEqual(collectCustomerFilterOptions(rows), options);
  assert.ok(options.some((c) => c.id === narrowed.customerId));
});

test("고객사 id가 없는 행은 선택지가 되지 않는다", () => {
  // <option value="">는 "고르지 않음"과 구분되지 않아 골라도 되돌릴 수 없다.
  const rows = [
    row({ id: "a", customerId: "", customerName: "고객사 미상" }),
    row({ id: "b", customerId: "  ", customerName: "고객사 미상" }),
    row({ id: "c", customerId: "c-1", customerName: "가온전자" }),
  ];
  assert.deepEqual(
    collectCustomerFilterOptions(rows).map((c) => c.id),
    ["c-1"]
  );
});

test("이름이 비어 있으면 id로라도 고를 수 있게 남긴다", () => {
  // 버리면 그 고객사의 접수 건은 목록에 보이는데 필터에서만 사라진다 —
  // 방금 고친 고장 그대로다.
  const rows = [row({ id: "a", customerId: "c-7", customerName: "   " })];
  assert.deepEqual(collectCustomerFilterOptions(rows), [
    { id: "c-7", name: "c-7", contactName: "", contactEmail: "", contactPhone: "" },
  ]);
});

test("같은 고객사에 이름이 적힌 행이 하나라도 있으면 그 이름을 쓴다", () => {
  const rows = [
    row({ id: "a", customerId: "c-1", customerName: "" }),
    row({ id: "b", customerId: "c-1", customerName: "가온전자" }),
  ];
  assert.deepEqual(nameOf(collectCustomerFilterOptions(rows)), ["가온전자"]);
});
