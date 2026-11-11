import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  collectCustomerFilterOptions,
  DEFAULT_FILTERS,
  IN_HOUSE_STATUSES,
  parseInitialFilters,
  sortRows,
  type Filters,
} from "./repair-case-filters";
import {
  BILLING_TYPE_CODES,
  PRIORITY_CODES,
  PRODUCT_CATEGORY_OPTIONS,
  REPAIR_STATUS_CODES,
} from "./types";
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
    domesticOrderDueDates: [],
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
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategories: ["Generator"] }))), ["gen"]);
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
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategories: ["Generator"] }))), [
    "paid",
    "warranty",
  ]);
});

// ─────────────────────────────────────────────── 유·무상

test("유·무상은 제품군을 가리지 않는다", () => {
  const rows = [
    row({ id: "gen", productCategory: "Generator", billingType: "PAID" }),
    row({ id: "tc", productCategory: "Total Controller", billingType: "PAID" }),
    row({ id: "free", productCategory: "Generator", billingType: "WARRANTY" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["PAID"] }))), ["gen", "tc"]);
});

test("'미지정'은 유·무상이 아직 정해지지 않은 건만 남긴다", () => {
  const rows = [
    row({ id: "unset", billingType: null, paidOrWarranty: "-" }),
    row({ id: "paid", billingType: "PAID" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["NONE"] }))), ["unset"]);
});

test("유·무상을 고르면 정해지지 않은 건은 어느 쪽으로도 딸려오지 않는다", () => {
  const rows = [row({ id: "unset", billingType: null }), row({ id: "paid", billingType: "PAID" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["PAID"] }))), ["paid"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["WARRANTY"] }))), []);
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
  const result = applyFilters(rows, filters({ productCategories: ["Generator"], billingTypes: ["WARRANTY"] }));
  assert.deepEqual(idsOf(result), ["hit"]);
});

// ─────────────────────────────────────────────── 주소창에서 들어온 값

test("주소창의 제품군·유·무상 값은 아는 값일 때만 받는다", () => {
  const parsed = parseInitialFilters(
    new URLSearchParams("productCategory=Generator&billingType=WARRANTY")
  );
  // 값이 하나면 길이 1 짜리 배열이다 — 옛 링크가 전과 똑같이 동작한다.
  assert.deepEqual(parsed.productCategories, ["Generator"]);
  assert.deepEqual(parsed.billingTypes, ["WARRANTY"]);

  const junk = parseInitialFilters(new URLSearchParams("productCategory=드론&billingType=FREE"));
  assert.deepEqual(junk.productCategories, [], "모르는 제품군은 조용히 무시한다");
  assert.deepEqual(junk.billingTypes, [], "모르는 유·무상 코드도 마찬가지다");
});

test("주소창으로도 '미지정'을 걸 수 있다", () => {
  assert.deepEqual(parseInitialFilters(new URLSearchParams("billingType=NONE")).billingTypes, ["NONE"]);
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

// ─────────────────────────────────────────────── 현재 상태 — 여럿 고르기
//
// 2026-11-11 사용자 개선요청: 한 종류의 필터 안에서 **복수로** 고를 수 있게.
// 그래서 status 하나가 statuses 배열이 되었고, **빈 배열이 「전체」**다.
//
// 「입고품 전체」는 그보다 앞선 같은 날의 결정이다 — 대시보드 [현재 입고 수]를
// 누르면 그 묶음이 걸린 채로 목록이 열린다(그 전에는 조건 없이 열려서 출하 완료
// 건까지 다 보였고, 카드에 적힌 수와 목록의 건수가 달랐다). 복수 선택이 되면서
// 그것은 **저장되는 값이 아니라 상태들로 펼쳐지는 단축**이 되었다.
//
// 🔴 **두 수가 같은지**(그 결정의 핵심)는 여기가 아니라
// in-house-filter-matches-dashboard.test.ts 가 같은 표본에 두 함수를 돌려 맞댄다.
// 여기서 보는 것은 거르는 규칙 자체와 주소줄이다.

test("🔴 IN_HOUSE 는 상태 목록에 없는 값이다 — 상태가 아니라 거르는 방식이다", () => {
  // 언젠가 이것을 상태로 끼워 넣으면 DB 의 상태 enum 에 없는 값이 저장·전이·표의
  // 상태 칸으로 새어 나간다. 이제는 필터 값으로도 남지 않는다 — 주소줄 별칭과
  // 화면의 단축 단추가 상태들로 펼쳐 넣을 뿐이라 샐 길이 아예 없다.
  assert.ok(
    !(REPAIR_STATUS_CODES as readonly string[]).includes("IN_HOUSE"),
    "IN_HOUSE 가 상태 목록에 들어갔다"
  );
  assert.ok(
    !(IN_HOUSE_STATUSES as readonly string[]).includes("IN_HOUSE"),
    "펼쳐 넣는 묶음에 IN_HOUSE 가 섞였다 — 그러면 아무 줄과도 안 맞아 목록이 빈다"
  );
});

test("🔴 아무것도 안 고르면 전부 지나간다 — 빈 배열이 「전체」다", () => {
  const rows = [
    row({ id: "repair", effectiveStatus: "IN_REPAIR" }),
    row({
      id: "shipped",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
    }),
  ];
  assert.deepEqual(DEFAULT_FILTERS.statuses, [], "기본값이 빈 배열이 아니면 첫 화면부터 걸러진다");
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: [] }))), ["repair", "shipped"]);
});

test("🔴 여럿 고르면 합집합이다 — 고른 상태의 줄이 전부 남는다", () => {
  // 이 조각이 있는 까닭 그 자체다. 예전에는 한 번에 하나뿐이라 「수리 중과 출하
  // 대기」를 한 화면에서 볼 수 없었다.
  const rows = [
    row({ id: "intake", effectiveStatus: "WAITING_INTAKE_INSPECTION" }),
    row({ id: "repair", effectiveStatus: "IN_REPAIR" }),
    row({ id: "ship-wait", effectiveStatus: "WAITING_SHIPMENT" }),
    row({
      id: "shipped",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
    }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: ["IN_REPAIR", "WAITING_SHIPMENT"] }))), [
    "repair",
    "ship-wait",
  ]);
  // 고른 차례가 달라도 남는 줄은 같다 — 배열이지 순서가 있는 조건이 아니다.
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: ["WAITING_SHIPMENT", "IN_REPAIR"] }))), [
    "repair",
    "ship-wait",
  ]);
  // 🔵 고른 상태의 줄이 하나도 없으면 빈 목록이다(전체로 되돌아가지 않는다).
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: ["WAITING_KYOSAN_REPLY"] }))), []);
});

test("입고품 전체는 출하 완료가 아닌 줄만 남긴다", () => {
  const rows = [
    row({ id: "intake", effectiveStatus: "WAITING_INTAKE_INSPECTION" }),
    row({ id: "repair", effectiveStatus: "IN_REPAIR" }),
    row({ id: "ship-wait", effectiveStatus: "WAITING_SHIPMENT" }),
    row({
      id: "shipped",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
    }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: IN_HOUSE_STATUSES }))), [
    "intake",
    "repair",
    "ship-wait",
  ]);
});

test("🔴 입고품 전체는 상태를 낱낱이 적지 않는다 — 출하 완료 하나만 빠진다", () => {
  // 상태가 하나 늘어도 저절로 따라오는지 본다. 남길 상태를 적어 두는 방식이면
  // 상태가 늘 때 그 건들이 아무 소리 없이 목록에서 빠진다.
  // 🔴 묶음 자체를 REPAIR_STATUS_CODES 와 맞대어 센다 — 거르기로만 재면 "출하
  //    완료만 빠진다"는 것은 알아도 **빠진 것이 하나뿐인지**는 모른다.
  assert.equal(
    IN_HOUSE_STATUSES.length,
    REPAIR_STATUS_CODES.length - 1,
    "손으로 적은 목록이면 상태가 늘어난 날 여기가 터진다"
  );
  assert.deepEqual(
    [...IN_HOUSE_STATUSES],
    REPAIR_STATUS_CODES.filter((status) => status !== "SHIPMENT_COMPLETED"),
    "출하 완료 말고 전부여야 한다 — 차례까지 그대로다"
  );

  const rows = REPAIR_STATUS_CODES.map((status) => row({ id: status, effectiveStatus: status }));
  const kept = idsOf(applyFilters(rows, filters({ statuses: IN_HOUSE_STATUSES })));
  assert.equal(kept.length, REPAIR_STATUS_CODES.length - 1);
  assert.ok(!kept.includes("SHIPMENT_COMPLETED"), "출하 완료만 빠져야 한다");
});

test("🔴 원본 status 가 아니라 effectiveStatus 로 가른다", () => {
  // 워크플로 재정의가 있으면 두 칸이 갈린다. 대시보드도 effectiveStatus 만 보므로
  // (dashboard-metrics.ts), 여기서 원본 칸을 보면 두 수가 어긋난다.
  const rows = [
    row({
      id: "override-in",
      status: "SHIPMENT_COMPLETED",
      effectiveStatus: "IN_REPAIR",
      hasWorkflowOverride: true,
    }),
    row({
      id: "override-out",
      status: "IN_REPAIR",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
      hasWorkflowOverride: true,
    }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: IN_HOUSE_STATUSES }))), ["override-in"]);
  // 낱낱의 상태를 골랐을 때도 같은 칸을 본다 — 표에 「수리 중」이라 적힌 줄이
  // 「수리 중」으로 걸러도 안 나오면, 오류 없이 사람만 헤맨다.
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: ["IN_REPAIR"] }))), ["override-in"]);
});

test("전체·낱낱의 상태는 전과 똑같다 — 입고품 전체가 끼어들지 않는다", () => {
  const rows = [
    row({ id: "repair", effectiveStatus: "IN_REPAIR" }),
    row({ id: "ship-wait", effectiveStatus: "WAITING_SHIPMENT" }),
    row({
      id: "shipped",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
    }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters())), ["repair", "ship-wait", "shipped"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: ["IN_REPAIR"] }))), ["repair"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ statuses: ["SHIPMENT_COMPLETED"] }))), ["shipped"]);
});

test("입고품 전체도 다른 조건과 함께 걸린다", () => {
  const rows = [
    row({ id: "hit", effectiveStatus: "IN_REPAIR", productCategory: "Generator" }),
    row({ id: "other-category", effectiveStatus: "IN_REPAIR", productCategory: "Matcher" }),
    row({
      id: "shipped",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
      productCategory: "Generator",
    }),
  ];
  const result = applyFilters(rows, filters({ statuses: IN_HOUSE_STATUSES, productCategories: ["Generator"] }));
  assert.deepEqual(idsOf(result), ["hit"]);
});

test("🔴 주소창으로 상태 여럿을 걸 수 있다(?status=A,B)", () => {
  // 쉼표로 잇는다. 필터를 바꿀 때 주소줄을 되쓰지는 않지만(이번 범위가 아니다),
  // 읽는 쪽은 받아야 한다 — 사람이 주소를 손으로 적어 넘기는 자리다.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("status=WAITING_PO,IN_REPAIR")).statuses,
    ["WAITING_PO", "IN_REPAIR"]
  );
  // 공백이 섞여도(메일·메신저를 거치면 붙는다) 읽는다. 같은 값이 두 번 오면 한 번만.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("status=IN_REPAIR, IN_REPAIR ,WAITING_PO")).statuses,
    ["IN_REPAIR", "WAITING_PO"]
  );
  // 낱낱의 상태 딥링크(대시보드 카드 여덟)는 그대로다 — 길이 1 짜리 배열이 된다.
  assert.deepEqual(parseInitialFilters(new URLSearchParams("status=IN_REPAIR")).statuses, ["IN_REPAIR"]);
  assert.deepEqual(parseInitialFilters(new URLSearchParams("")).statuses, []);
});

test("🔴 ?status=IN_HOUSE 는 계속 받는다 — 상태 열하나로 펼쳐진다", () => {
  // 대시보드 [현재 입고 수] 카드가 거는 딥링크다. 카드의 href 는 그대로 두고
  // (즐겨찾기·메일에 남은 링크가 조용히 「전체」로 열리면 안 된다) 여기서 푼다.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("status=IN_HOUSE")).statuses,
    [...IN_HOUSE_STATUSES]
  );
  // 별칭과 낱낱의 상태를 섞어 적어도 한 번씩만 들어간다.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("status=IN_HOUSE,IN_REPAIR")).statuses,
    [...IN_HOUSE_STATUSES]
  );
  // 별칭에 없는 상태를 덧붙이면 그만큼 는다.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("status=IN_HOUSE,SHIPMENT_COMPLETED")).statuses,
    [...IN_HOUSE_STATUSES, "SHIPMENT_COMPLETED"]
  );
});

test("🔴 주소창에 모르는 값이 오면 조용히 버린다 — 한 건도 사라지지 않는다", () => {
  // 주소줄은 사람이 손으로 고칠 수 있다. 엉뚱한 값에 화면이 깨지거나 목록이
  // 통째로 비면 안 된다 — 대소문자가 다른 것도 모르는 값이다.
  for (const junk of ["in_house", "IN HOUSE", "입고품 전체", "SHIPPED", "", ",,,"]) {
    assert.deepEqual(
      parseInitialFilters(new URLSearchParams(`status=${junk}`)).statuses,
      [],
      `"${junk}" 는 빈 배열(= 전체)로 떨어져야 한다`
    );
  }
  // 🔴 아는 값과 섞여 오면 **아는 것만** 남는다. 통째로 버리면 멀쩡한 조건까지
  //    날아가고, 그대로 넣으면 아무 줄과도 안 맞아 목록이 빈다.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("status=SHIPPED,IN_REPAIR")).statuses,
    ["IN_REPAIR"]
  );

  const rows = [
    row({ id: "repair", effectiveStatus: "IN_REPAIR" }),
    row({
      id: "shipped",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
    }),
  ];
  const parsed = parseInitialFilters(new URLSearchParams("status=in_house"));
  assert.deepEqual(idsOf(applyFilters(rows, parsed)), ["repair", "shipped"]);
});

// ──────────────────── 나머지 네 필터도 여럿 고르기 (2026-11-11 사용자 개선요청)
//
// [현재 상태]에 이어 제품군·유·무상·고객사·우선순위도 배열이 되었다. 넷 다 **빈
// 배열이 「전체」**이고 고른 것이 있으면 **합집합**이다 — "ALL" 이라는 값은 없앴다.
//
// 🔴 넷 중 유·무상만 특별하다. "NONE"(미지정)이 **배열의 원소**로 들어간다 —
// [현재 상태]의 "IN_HOUSE" 와는 다르다. 그쪽은 상태들로 펼쳐지는 단축이라 저장되지
// 않지만, 미지정은 표에 "-" 로 나오는 **실제로 고를 수 있는 한 줄**이고 유상·무상과
// 함께 고를 수 있어야 한다.

test("🔵 표본 점검 — 네 필터가 쓰는 값이 실제 선택지에서 나온 것이다", () => {
  // 선택지에 없는 값으로 재면 "거르기가 되는가"는 알아도 **화면에서 고를 수 있는
  // 값인가**는 모른다. 아래 시험들이 쓰는 값이 진짜 목록에 있는지 먼저 못 박는다.
  for (const category of ["Generator", "Matcher", "Total Controller"]) {
    assert.ok(PRODUCT_CATEGORY_OPTIONS.includes(category), `제품군 선택지에 ${category} 가 없다`);
  }
  for (const code of ["PAID", "WARRANTY", "PARTIAL_PAID"]) {
    assert.ok((BILLING_TYPE_CODES as readonly string[]).includes(code), `유·무상 코드에 ${code} 가 없다`);
  }
  assert.ok(
    !(BILLING_TYPE_CODES as readonly string[]).includes("NONE"),
    "미지정이 저장되는 코드 목록에 섞였다 — 필터 전용 값이어야 한다"
  );
  for (const code of ["LOW", "NORMAL", "HIGH", "URGENT"]) {
    assert.ok((PRIORITY_CODES as readonly string[]).includes(code), `우선순위 코드에 ${code} 가 없다`);
  }
  // 기본값이 빈 배열이 아니면 첫 화면부터 걸러진다.
  assert.deepEqual(DEFAULT_FILTERS.productCategories, []);
  assert.deepEqual(DEFAULT_FILTERS.billingTypes, []);
  assert.deepEqual(DEFAULT_FILTERS.customerIds, []);
  assert.deepEqual(DEFAULT_FILTERS.priorities, []);
});

test("🔴 제품군 — 빈 배열은 전체, 하나면 그것만, 여럿이면 합집합", () => {
  const rows = [
    row({ id: "gen", productCategory: "Generator" }),
    row({ id: "matcher", productCategory: "Matcher" }),
    row({ id: "tc", productCategory: "Total Controller" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategories: [] }))), [
    "gen",
    "matcher",
    "tc",
  ]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategories: ["Matcher"] }))), ["matcher"]);
  assert.deepEqual(
    idsOf(applyFilters(rows, filters({ productCategories: ["Generator", "Total Controller"] }))),
    ["gen", "tc"]
  );
  // 고른 차례가 달라도 남는 줄은 같다 — 배열이지 순서가 있는 조건이 아니다.
  assert.deepEqual(
    idsOf(applyFilters(rows, filters({ productCategories: ["Total Controller", "Generator"] }))),
    ["gen", "tc"]
  );
  // 🔵 고른 제품군의 줄이 하나도 없으면 빈 목록이다(전체로 되돌아가지 않는다).
  assert.deepEqual(idsOf(applyFilters(rows, filters({ productCategories: ["없는 제품군"] }))), []);
});

test("🔴 유·무상 — 빈 배열은 전체, 하나면 그것만, 여럿이면 합집합", () => {
  const rows = [
    row({ id: "paid", billingType: "PAID" }),
    row({ id: "warranty", billingType: "WARRANTY" }),
    row({ id: "partial", billingType: "PARTIAL_PAID" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: [] }))), [
    "paid",
    "warranty",
    "partial",
  ]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["WARRANTY"] }))), ["warranty"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["PAID", "PARTIAL_PAID"] }))), [
    "paid",
    "partial",
  ]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["PENDING_DECISION"] }))), []);
});

test("🔴 유·무상의 '미지정'은 배열의 원소다 — 다른 값과 **함께** 고를 수 있다", () => {
  // 이 조각에서 가장 틀리기 쉬운 자리다. 미지정을 따로 떼어 판정하면("미지정이면
  // null 인 것만") 유상과 함께 고른 순간 둘 중 하나가 서로를 잡아먹어, 고른 것이
  // 둘인데 남는 줄은 한쪽뿐이거나 아예 없어진다 — 오류는 안 난다.
  const rows = [
    row({ id: "unset", billingType: null, paidOrWarranty: "-" }),
    row({ id: "paid", billingType: "PAID" }),
    row({ id: "warranty", billingType: "WARRANTY" }),
  ];

  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["NONE"] }))), ["unset"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["NONE", "PAID"] }))), [
    "unset",
    "paid",
  ]);
  // 적은 차례를 뒤집어도 같다 — 먼저 쓴 조건이 이기는 구현이면 여기서 갈린다.
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["PAID", "NONE"] }))), [
    "unset",
    "paid",
  ]);
  // 미지정을 빼고 고르면 정해지지 않은 건은 어느 쪽으로도 딸려오지 않는다.
  assert.deepEqual(idsOf(applyFilters(rows, filters({ billingTypes: ["PAID", "WARRANTY"] }))), [
    "paid",
    "warranty",
  ]);
});

test("🔴 고객사 — 빈 배열은 전체, 하나면 그것만, 여럿이면 합집합", () => {
  const rows = [
    row({ id: "a", customerId: "c-1", customerName: "가온전자" }),
    row({ id: "b", customerId: "c-2", customerName: "나래시스템" }),
    row({ id: "c", customerId: "c-3", customerName: "다온계측" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ customerIds: [] }))), ["a", "b", "c"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ customerIds: ["c-2"] }))), ["b"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ customerIds: ["c-1", "c-3"] }))), ["a", "c"]);
  // 🔴 견주는 것은 이름이 아니라 id 다 — 같은 이름의 고객사가 둘일 수 있다.
  assert.deepEqual(idsOf(applyFilters(rows, filters({ customerIds: ["가온전자"] }))), []);
});

test("🔴 우선순위 — 빈 배열은 전체, 하나면 그것만, 여럿이면 합집합", () => {
  const rows = [
    row({ id: "low", priority: "LOW" }),
    row({ id: "normal", priority: "NORMAL" }),
    row({ id: "high", priority: "HIGH" }),
    row({ id: "urgent", priority: "URGENT" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ priorities: [] }))), [
    "low",
    "normal",
    "high",
    "urgent",
  ]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ priorities: ["HIGH"] }))), ["high"]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ priorities: ["HIGH", "URGENT"] }))), [
    "high",
    "urgent",
  ]);
  assert.deepEqual(idsOf(applyFilters(rows, filters({ priorities: ["URGENT", "HIGH"] }))), [
    "high",
    "urgent",
  ]);
});

test("🔴 다섯 필터는 서로 AND 로 겹친다 — 한 종류 안에서만 합집합이다", () => {
  // "제품군 둘 중 하나 **이면서** 우선순위 둘 중 하나"가 되어야 한다. 종류끼리도
  // 합집합이 되면 아무것도 못 좁히는 필터가 된다.
  const rows = [
    row({
      id: "hit",
      effectiveStatus: "IN_REPAIR",
      productCategory: "Generator",
      billingType: "PAID",
      customerId: "c-1",
      priority: "HIGH",
    }),
    row({ id: "wrong-category", productCategory: "Matcher", billingType: "PAID", customerId: "c-1", priority: "HIGH" }),
    row({ id: "wrong-billing", productCategory: "Generator", billingType: "WARRANTY", customerId: "c-1", priority: "HIGH" }),
    row({ id: "wrong-customer", productCategory: "Generator", billingType: "PAID", customerId: "c-9", priority: "HIGH" }),
    row({ id: "wrong-priority", productCategory: "Generator", billingType: "PAID", customerId: "c-1", priority: "LOW" }),
    row({
      id: "wrong-status",
      effectiveStatus: "SHIPMENT_COMPLETED",
      effectiveActualShipmentDate: "2026-11-02",
      productCategory: "Generator",
      billingType: "PAID",
      customerId: "c-1",
      priority: "HIGH",
    }),
  ];

  const picked = filters({
    statuses: ["IN_REPAIR", "WAITING_PO"],
    productCategories: ["Generator", "Total Controller"],
    billingTypes: ["PAID", "NONE"],
    customerIds: ["c-1", "c-2"],
    priorities: ["HIGH", "URGENT"],
  });
  assert.deepEqual(idsOf(applyFilters(rows, picked)), ["hit"]);
});

test("🔴 주소창으로 넷 다 여럿 걸 수 있다 — 쉼표로 잇는다", () => {
  const parsed = parseInitialFilters(
    new URLSearchParams(
      "productCategory=Generator,Matcher&billingType=PAID,NONE&customerId=c-1,c-2&priority=HIGH,URGENT"
    )
  );
  assert.deepEqual(parsed.productCategories, ["Generator", "Matcher"]);
  assert.deepEqual(parsed.billingTypes, ["PAID", "NONE"]);
  assert.deepEqual(parsed.customerIds, ["c-1", "c-2"]);
  assert.deepEqual(parsed.priorities, ["HIGH", "URGENT"]);

  // 공백이 섞여도(메일·메신저를 거치면 붙는다) 읽고, 같은 값이 두 번 오면 한 번만.
  const messy = parseInitialFilters(new URLSearchParams("priority=HIGH, HIGH ,URGENT"));
  assert.deepEqual(messy.priorities, ["HIGH", "URGENT"]);
});

test("🔴 주소창에 모르는 값이 오면 조용히 버린다 — 넷 다", () => {
  // 주소줄은 사람이 손으로 고칠 수 있다. 엉뚱한 값에 목록이 통째로 비면 안 된다.
  const junk = parseInitialFilters(
    new URLSearchParams("productCategory=드론&billingType=FREE&priority=매우긴급")
  );
  assert.deepEqual(junk.productCategories, []);
  assert.deepEqual(junk.billingTypes, []);
  assert.deepEqual(junk.priorities, []);

  // 아는 값과 섞여 오면 **아는 것만** 남는다. 통째로 버리면 멀쩡한 조건까지
  // 날아가고, 그대로 넣으면 아무 줄과도 안 맞아 목록이 빈다.
  const mixed = parseInitialFilters(
    new URLSearchParams("productCategory=드론,Generator&billingType=FREE,WARRANTY&priority=매우긴급,LOW")
  );
  assert.deepEqual(mixed.productCategories, ["Generator"]);
  assert.deepEqual(mixed.billingTypes, ["WARRANTY"]);
  assert.deepEqual(mixed.priorities, ["LOW"]);

  // 🔴 고객사만 다르다 — 아는 값의 목록이 아예 없다(선택지가 지금 화면의 줄에서
  //    뽑힌다). 전에도 `customerId ?? "ALL"` 로 그대로 받았고, 그 결을 그대로 둔다.
  //    빈 조각만 버린다.
  assert.deepEqual(
    parseInitialFilters(new URLSearchParams("customerId=c-9, ,c-8")).customerIds,
    ["c-9", "c-8"]
  );
  assert.deepEqual(parseInitialFilters(new URLSearchParams("customerId=,,,")).customerIds, []);
});

test("🔴 주소창에서 아무것도 안 오면 넷 다 빈 배열이다 — 걸리지 않는다", () => {
  const parsed = parseInitialFilters(new URLSearchParams(""));
  assert.deepEqual(parsed.productCategories, []);
  assert.deepEqual(parsed.billingTypes, []);
  assert.deepEqual(parsed.customerIds, []);
  assert.deepEqual(parsed.priorities, []);

  const rows = [
    row({ id: "a", productCategory: "Generator", billingType: "PAID", priority: "HIGH" }),
    row({ id: "b", productCategory: "Matcher", billingType: null, priority: "LOW" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, parsed)), ["a", "b"]);
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
  const narrowed = filters({ customerIds: ["c-1"], query: "없는인수번호" });
  assert.deepEqual(idsOf(applyFilters(rows, narrowed)), [], "이 조건에서는 남는 행이 없다");

  // 그래도 선택지는 그대로다 — 고른 c-1이 남아 있어야 무엇을 걸어 뒀는지 보이고,
  // c-2가 남아 있어야 다른 고객사로 옮겨 갈 수 있다.
  assert.deepEqual(collectCustomerFilterOptions(rows), options);
  for (const picked of narrowed.customerIds) {
    assert.ok(options.some((c) => c.id === picked));
  }
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

// ─────────────────────────────────────────────── 검색어
//
// 검색은 서버가 아니라 화면에서 건다 — 여러 칸을 한 줄로 이어 붙인 뒤 검색어가
// 들어 있는지만 본다. 「내 담당 제품」 화면(my-active-work-filter.ts)은 진작
// L/N 으로 찾을 수 있었는데 이 화면만 그 칸이 빠져 있었다. 아래 시험들이
// 그 칸을 못 박고, 동시에 원래 되던 여섯 칸이 그대로인지도 지킨다.

test("L/N 으로 검색하면 그 건이 나온다", () => {
  const rows = [
    row({ id: "hit", lotNumber: "LN-2026-0731" }),
    row({ id: "miss", lotNumber: "LN-2026-0801" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ query: "LN-2026-0731" }))), ["hit"]);
});

test("L/N 검색은 대소문자를 가리지 않고 일부만 쳐도 찾는다", () => {
  const rows = [row({ id: "hit", lotNumber: "LN-2026-0731" }), row({ id: "miss", lotNumber: "XX-9" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ query: "ln-2026" }))), ["hit"]);
});

test("L/N 이 비어 있는 건은 검색어가 있을 때 조용히 섞여 나오지 않는다", () => {
  // lotNumber 는 타입상 string 이라(resolved-repair-case.ts) 빈 값은 null 이 아니라
  // 빈 문자열로 온다. 그래도 Boolean(value) 로 걸러내지 않으면 join(" ")이 군더더기
  // 빈칸을 만들어, 빈 L/N 이 검색 결과에 끼어들 여지가 생긴다.
  const rows = [row({ id: "hit", lotNumber: "LN-2026-0731" }), row({ id: "no-lot", lotNumber: "" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ query: "LN-2026-0731" }))), ["hit"]);
  assert.deepEqual(
    idsOf(applyFilters(rows, filters({ query: "아무데도 없는 말" }))),
    [],
    "L/N 이 없는 건이라고 해서 검색을 그냥 통과하지는 않는다"
  );
});

test("검색어가 없으면 L/N 이 비어 있는 건도 그대로 남는다", () => {
  const rows = [row({ id: "hit", lotNumber: "LN-1" }), row({ id: "no-lot", lotNumber: "" })];
  assert.deepEqual(idsOf(applyFilters(rows, filters())), ["hit", "no-lot"]);
});

test("원래 되던 여섯 칸 검색은 그대로다", () => {
  const target = row({
    id: "target",
    intakeNumber: "D260813",
    customerName: "가온전자",
    endUserName: "나래반도체",
    modelName: "TG-350",
    serialNumber: "SN-4417",
    engineerName: "김엔지니어",
    lotNumber: "LN-2026-0731",
  });
  const other = row({
    id: "other",
    intakeNumber: "D260999",
    customerName: "다온계측",
    endUserName: "라온디스플레이",
    modelName: "MC-100",
    serialNumber: "SN-0002",
    engineerName: "박엔지니어",
    lotNumber: "LN-2026-0801",
  });
  const rows = [target, other];

  for (const query of ["D260813", "가온전자", "나래반도체", "TG-350", "SN-4417", "김엔지니어"]) {
    assert.deepEqual(idsOf(applyFilters(rows, filters({ query }))), ["target"], `${query} 로 찾히지 않는다`);
  }
  // 새로 더한 칸도 같은 자리에서 함께 동작한다.
  assert.deepEqual(idsOf(applyFilters(rows, filters({ query: "LN-2026-0731" }))), ["target"]);
});

// ─────────────────────────────── 신고 증상 필터(2026-09-30)

/**
 * 대시보드 「신고 증상별 현황」에서 인수점검 결과 줄을 누르면
 * `/repair-cases?reportedSymptom=...` 로 들어온다. 이 목록이 그 값을 읽어 거른다.
 *
 * 🔴 판정은 이 파일이 하지 않는다 — reported-symptom-param.ts 하나가 한다.
 * 여기서 못 박는 것은 **그 판정 결과가 실제로 목록에 걸리는가**와, 걸 수 없는
 * 값이 왔을 때 **아무것도 걸리지 않고 화면이 멀쩡한가**다.
 */

test("처음 상태에서는 신고 증상 필터가 걸려 있지 않다", () => {
  assert.equal(DEFAULT_FILTERS.reportedSymptom, null);
});

test("주소에서 신고 증상을 읽어 건다", () => {
  const parsed = parseInitialFilters(new URLSearchParams("?reportedSymptom=전원 인가 불가"));
  assert.equal(parsed.reportedSymptom, "전원 인가 불가");
});

test("🔴 읽을 수 없는 값이면 걸지 않는다 — 오류가 아니라 전체 목록이다", () => {
  for (const search of [
    "",
    "?reportedSymptom=",
    "?reportedSymptom=%20%20",
    // 같은 이름이 두 번 — 어느 쪽을 고르든 근거가 없다.
    "?reportedSymptom=소음&reportedSymptom=과열",
    // 아주 긴 값.
    `?reportedSymptom=${"증".repeat(201)}`,
  ]) {
    assert.equal(parseInitialFilters(new URLSearchParams(search)).reportedSymptom, null, search);
  }
});

test("🔴 이상한 값이 와도 목록이 그대로 나온다 — 한 건도 사라지지 않는다", () => {
  const rows = [
    row({ id: "a", reportedSymptom: "전원 인가 불가" }),
    row({ id: "b", reportedSymptom: null }),
  ];
  const parsed = parseInitialFilters(new URLSearchParams("?reportedSymptom=소음&reportedSymptom=과열"));
  assert.deepEqual(idsOf(applyFilters(rows, { ...filters(), ...parsed })), ["a", "b"]);
});

test("글자가 똑같은 건만 남는다 — 앞뒤 공백은 양쪽 다 걷어낸 뒤 견준다", () => {
  const rows = [
    row({ id: "exact", reportedSymptom: "전원 인가 불가" }),
    row({ id: "padded", reportedSymptom: "  전원 인가 불가  " }),
    row({ id: "other", reportedSymptom: "소음" }),
    row({ id: "partial", reportedSymptom: "전원 인가 불가 및 소음" }),
  ];
  // 대시보드가 증상을 묶는 규칙과 같아야 두 화면의 건수가 맞는다
  // (fault-symptom-breakdown.ts 의 '글자 그대로 묶는다').
  assert.deepEqual(
    idsOf(applyFilters(rows, filters({ reportedSymptom: "전원 인가 불가" }))),
    ["exact", "padded"]
  );
});

test("신고 증상이 비어 있는 건은 어떤 값으로도 걸리지 않는다", () => {
  // 대시보드의 '미입력' 조각은 증상 하나로 좁힐 수 없어 링크가 되지 않는다.
  // 그래도 주소를 손으로 쳐서 들어올 수 있으므로, 빈 증상이 엉뚱하게 남지
  // 않는다는 것을 여기서 못 박는다.
  const rows = [
    row({ id: "null", reportedSymptom: null }),
    row({ id: "blank", reportedSymptom: "   " }),
    row({ id: "filled", reportedSymptom: "소음" }),
  ];
  assert.deepEqual(idsOf(applyFilters(rows, filters({ reportedSymptom: "소음" }))), ["filled"]);
});

test("다른 조건과 함께 걸린다 — 신고 증상만 남기고 나머지를 지우지 않는다", () => {
  const rows = [
    row({ id: "match", reportedSymptom: "소음", customerId: "cust-1" }),
    row({ id: "other-customer", reportedSymptom: "소음", customerId: "cust-2" }),
    row({ id: "other-symptom", reportedSymptom: "과열", customerId: "cust-1" }),
  ];
  assert.deepEqual(
    idsOf(applyFilters(rows, filters({ reportedSymptom: "소음", customerIds: ["cust-1"] }))),
    ["match"]
  );
});

// ─────────────────────────────────────────────── 상태 차례

/**
 * 상태 정렬은 REPAIR_STATUS_CODES 의 **자리**를 그대로 쓴다(sortRows 의 "status").
 * 그래서 배열에 값을 끝에 붙이면 화면 차례가 업무 차례와 어긋난다 — 아래 두
 * 시험이 그것을 막는다. 2026-10-04 에 "수리 완료"를 "수리 중" 다음에 끼워 넣었다.
 */
test("수리 완료는 배열에서 수리 중 바로 다음, 출하 승인 대기 바로 앞이다", () => {
  const inRepair = REPAIR_STATUS_CODES.indexOf("IN_REPAIR");
  const repairCompleted = REPAIR_STATUS_CODES.indexOf("REPAIR_COMPLETED");
  const waitingShipmentApproval = REPAIR_STATUS_CODES.indexOf("WAITING_SHIPMENT_APPROVAL");

  assert.notEqual(repairCompleted, -1, "REPAIR_COMPLETED 가 목록에 없다");
  assert.equal(repairCompleted, inRepair + 1, "수리 완료가 수리 중 바로 다음이 아니다");
  assert.equal(
    waitingShipmentApproval,
    repairCompleted + 1,
    "출하 승인 대기가 수리 완료 바로 다음이 아니다"
  );
});

test("상태순 정렬에서 수리 완료는 수리 중과 출하 승인 대기 사이에 놓인다", () => {
  // 끝에 붙여 놓았다면 shipment-approval 뒤로 밀려 이 시험이 깨진다.
  const rows = [
    row({ id: "shipment-approval", effectiveStatus: "WAITING_SHIPMENT_APPROVAL" }),
    row({ id: "shipment-completed", effectiveStatus: "SHIPMENT_COMPLETED" }),
    row({ id: "repair-completed", effectiveStatus: "REPAIR_COMPLETED" }),
    row({ id: "in-repair", effectiveStatus: "IN_REPAIR" }),
  ];

  assert.deepEqual(idsOf(sortRows(rows, { column: "status", direction: "asc" })), [
    "in-repair",
    "repair-completed",
    "shipment-approval",
    "shipment-completed",
  ]);
});

// ─────────────────────────────────────────────── 인수번호 차례

/**
 * 전체 A/S 현황의 **기본 차례**가 인수번호 내림차순이 되었다(2026-10-07 요구).
 * 그 기본값 자체는 RepairCaseListPage 의 DEFAULT_SORT 가 들고 있고
 * (components/repair-cases/repair-case-list-default-sort.test.ts 가 못 박는다),
 * 여기서는 그 값이 가리키는 **정렬 동작**을 본다.
 *
 * 🔴 접수일 차례와 **어긋나는** 자료를 쓴다. 두 차례가 같은 자료로 재면 기준을
 * 접수일로 되돌려도 시험이 조용히 통과한다.
 *
 * 인수번호는 `D + YY + MM + 2자리`로 길이가 고정이라 글자 비교가 곧 시간 비교다
 * (lib/db/queries/repair-cases.ts 의 listRepairCases 머리말).
 */
test("인수번호 내림차순은 접수일 차례를 이긴다", () => {
  const rows = [
    // 접수일은 가장 늦지만 번호는 가장 작다(같은 달 안에서 늦게 접수된 건이
    // 먼저 번호를 받을 수 있다 — 월 순번은 만든 차례로 올라간다).
    row({ id: "low-number-late-date", intakeNumber: "D261001", receivedAt: "2026-10-25" }),
    row({ id: "high-number-early-date", intakeNumber: "D261003", receivedAt: "2026-10-05" }),
    row({ id: "mid-number-mid-date", intakeNumber: "D261002", receivedAt: "2026-10-15" }),
  ];

  assert.deepEqual(idsOf(sortRows(rows, { column: "intakeNumber", direction: "desc" })), [
    "high-number-early-date",
    "mid-number-mid-date",
    "low-number-late-date",
  ]);

  // 같은 자료를 접수일로 세우면 전혀 다른 차례가 된다 — 위가 우연이 아니라는 증거다.
  assert.deepEqual(idsOf(sortRows(rows, { column: "receivedAt", direction: "desc" })), [
    "low-number-late-date",
    "mid-number-mid-date",
    "high-number-early-date",
  ]);
});

test("인수번호 오름차순은 작은 번호가 먼저다 — 고르개는 그대로 양방향이다", () => {
  const rows = [
    row({ id: "b", intakeNumber: "D261002" }),
    row({ id: "a", intakeNumber: "D261001" }),
    row({ id: "c", intakeNumber: "D261003" }),
  ];
  assert.deepEqual(idsOf(sortRows(rows, { column: "intakeNumber", direction: "asc" })), ["a", "b", "c"]);
});

/**
 * 해가 넘어가도 글자 비교로 충분하다는 것 — D260101 > D251231 이다. 자리수가
 * 흔들리지 않기 때문인데, 형식이 바뀌면 여기서 먼저 깨진다.
 */
test("해가 바뀌어도 글자 내림차순이 곧 시간 내림차순이다", () => {
  const rows = [
    row({ id: "old", intakeNumber: "D251231", receivedAt: "2025-12-31" }),
    row({ id: "new", intakeNumber: "D260101", receivedAt: "2026-01-02" }),
  ];
  assert.deepEqual(idsOf(sortRows(rows, { column: "intakeNumber", direction: "desc" })), ["new", "old"]);
});

// ─────────────────────────────────────────────── 출하일 차례

/**
 * 출하일 정렬(2026-10-19 요구, SortColumn "actualShipmentDate").
 *
 * 세우는 값은 **실제 출하일**(effectiveActualShipmentDate)이다 — 워크플로
 * 재정의가 반영된 값이고, 표가 그 칸에 그대로 그리는 값이다.
 *
 * 🔴 아래 세 시험이 함께 지키는 것: 아직 출하 안 된 건(널)을 사내 목표 완료일
 * (internalTargetShipmentDate)로 **대신 채워 세우지 않는다.** 그렇게 하면
 * 화면에 "-"로 그려진 줄이 날짜가 있는 줄 사이에 끼어 선다.
 */
test("출하일 오름차순은 이른 출하일이 먼저다", () => {
  const rows = [
    row({ id: "nov", effectiveActualShipmentDate: "2026-11-01" }),
    row({ id: "sep", effectiveActualShipmentDate: "2026-09-01" }),
    row({ id: "oct", effectiveActualShipmentDate: "2026-10-01" }),
  ];
  assert.deepEqual(idsOf(sortRows(rows, { column: "actualShipmentDate", direction: "asc" })), [
    "sep",
    "oct",
    "nov",
  ]);
  assert.deepEqual(idsOf(sortRows(rows, { column: "actualShipmentDate", direction: "desc" })), [
    "nov",
    "oct",
    "sep",
  ]);
});

/**
 * 🔴 가장 틀리기 쉬운 자리. "not-shipped" 는 실제 출하일이 널이지만 사내 목표
 * 출하일은 2026-10-01 로 **두 날짜 사이에 떨어지게** 잡아 두었다. 널을 목표
 * 출하일로 바꿔 끼워 세우는 순간 이 줄이 sep 과 nov 사이로 올라가고, 그러면
 * 화면에서 "-" 인 줄이 날짜가 있는 줄인 척 줄 서게 된다.
 *
 * 올바른 차례는 고객 요청 납기일과 **같다**(compareNullableString) — 오름차순에
 * 널이 맨 앞, 내림차순에 맨 뒤다.
 */
test("실제 출하일이 널인 줄은 사내 목표 완료일로 끼워지지 않는다", () => {
  const rows = [
    row({ id: "nov", effectiveActualShipmentDate: "2026-11-01", internalTargetShipmentDate: "2026-11-01" }),
    // 실제 출하일 없음 + 목표 완료일만 있음 — 끼워 넣으면 한가운데로 간다.
    row({ id: "not-shipped", effectiveActualShipmentDate: null, internalTargetShipmentDate: "2026-10-01" }),
    row({ id: "sep", effectiveActualShipmentDate: "2026-09-01", internalTargetShipmentDate: "2026-09-01" }),
  ];

  assert.deepEqual(
    idsOf(sortRows(rows, { column: "actualShipmentDate", direction: "asc" })),
    ["not-shipped", "sep", "nov"],
    "오름차순에서 출하 안 된 줄이 목표 완료일 자리(sep 과 nov 사이)로 끼어들었다"
  );
  assert.deepEqual(
    idsOf(sortRows(rows, { column: "actualShipmentDate", direction: "desc" })),
    ["nov", "sep", "not-shipped"],
    "내림차순에서 출하 안 된 줄이 목표 완료일 자리로 끼어들었다"
  );
});

/**
 * 한 머리글 칸에 포개 놓은 두 차례(출하일 · 고객 요청 납기일)가 **서로 다른 값**을
 * 본다는 것. 두 칸을 어긋나는 자료로 재야, 출하일을 더하면서 아래 보조 단추의
 * 차례를 건드리지 않았음이 드러난다.
 */
test("고객 요청 납기일 차례는 출하일을 더한 뒤에도 그대로다", () => {
  const rows = [
    row({ id: "a", effectiveActualShipmentDate: "2026-11-01", customerRequestedDueDate: "2026-09-10" }),
    row({ id: "b", effectiveActualShipmentDate: "2026-09-01", customerRequestedDueDate: "2026-11-10" }),
    row({ id: "c", effectiveActualShipmentDate: null, customerRequestedDueDate: null }),
  ];

  // 널(c)이 오름차순 맨 앞 — 예전 그대로다.
  assert.deepEqual(idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "asc" })), [
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "desc" })), [
    "b",
    "a",
    "c",
  ]);

  // 같은 자료를 출하일로 세우면 a 와 b 가 뒤집힌다 — 위가 우연이 아니라는 증거다.
  // 널 자리(c 가 맨 앞)는 두 칸이 똑같다 — 같은 compareNullableString 을 쓴다.
  assert.deepEqual(idsOf(sortRows(rows, { column: "actualShipmentDate", direction: "asc" })), [
    "c",
    "b",
    "a",
  ]);
});

// ──────────────────────────────── 고객 요청 납기일 차례 — 빌려 온 날짜까지

/**
 * ============================================================================
 * 고객 요청 납기일 정렬은 **보이는 날짜**로 선다 (2026-10-19)
 * ============================================================================
 * 자기 칸(customerRequestedDueDate)이 비면 표는 연결된 내자 정리의 납기요청일
 * 중 가장 이른 하루를 빌려 그린다(components/repair-cases/RequestedDueDateValue.tsx).
 *
 * 🔴 그런데 정렬이 원본 칸을 보면 **보이는 날짜와 줄 서는 차례가 달라진다** —
 * 화면에 2026-10-20 이라고 적힌 줄이 "날짜 없음" 자리에 가서 선다. 값이 안
 * 나오는 것보다 더 나쁜 결함이다. 바로 위 출하일 정렬이 널을 사내 목표
 * 출하일로 끼워 넣지 않기로 한 것과 같은 결의 판단이다.
 *
 * 🔴 아래 세 시험이 함께 지키는 것:
 *  · 빌려 온 건은 **빌려 온 날짜 자리**에 선다(널 자리가 아니다).
 *  · 자기 칸이 적혀 있으면 **그 값이 이긴다** — 내자 날짜가 더 일러도 끌려가지 않는다.
 *  · 양쪽 다 없으면 **널 자리**다 — 예전과 같다.
 * ============================================================================
 */
test("🔴 자기 칸이 빈 건은 내자에서 빌려 온 날짜 자리에 줄 선다 — 널 자리가 아니다", () => {
  const rows = [
    row({ id: "own-late", customerRequestedDueDate: "2026-12-01" }),
    // 자기 칸은 비었고 내자에만 날짜가 있다. 가장 이른 하루는 2026-10-20 이고,
    // 그 날짜는 아래 두 건 **사이**에 떨어지게 잡아 두었다 — 원본 칸으로 세우면
    // 이 줄은 널로 보여 오름차순 맨 앞, 내림차순 맨 뒤로 튄다.
    row({
      id: "borrowed",
      customerRequestedDueDate: null,
      domesticOrderDueDates: ["2026-11-20", "2026-10-20"],
    }),
    row({ id: "own-early", customerRequestedDueDate: "2026-09-05" }),
  ];

  assert.deepEqual(
    idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "asc" })),
    ["own-early", "borrowed", "own-late"],
    "오름차순에서 빌려 온 줄이 제 날짜 자리에 서지 않았다"
  );
  assert.deepEqual(
    idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "desc" })),
    ["own-late", "borrowed", "own-early"],
    "내림차순에서 빌려 온 줄이 제 날짜 자리에 서지 않았다"
  );
});

test("🔴 자기 칸이 적혀 있으면 그 값이 이긴다 — 내자 날짜가 더 일러도 끌려가지 않는다", () => {
  const rows = [
    // 내자 날짜(2026-01-02)가 훨씬 이르다. 빌려 온 것이 이기면 이 줄이 맨 앞으로 온다.
    row({
      id: "own-wins",
      customerRequestedDueDate: "2026-12-01",
      domesticOrderDueDates: ["2026-01-02"],
    }),
    row({ id: "mid", customerRequestedDueDate: "2026-06-01" }),
  ];

  assert.deepEqual(
    idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "asc" })),
    ["mid", "own-wins"],
    "자기 칸이 있는데도 내자 날짜로 줄을 세웠다"
  );
});

test("양쪽 어디에도 날짜가 없으면 널 자리다 — 예전과 같다", () => {
  const rows = [
    row({ id: "none", customerRequestedDueDate: null, domesticOrderDueDates: [] }),
    row({ id: "dated", customerRequestedDueDate: "2026-09-01" }),
  ];

  // 오름차순에 널이 맨 앞, 내림차순에 맨 뒤 — compareNullableString 그대로다.
  assert.deepEqual(idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "asc" })), [
    "none",
    "dated",
  ]);
  assert.deepEqual(idsOf(sortRows(rows, { column: "customerRequestedDueDate", direction: "desc" })), [
    "dated",
    "none",
  ]);
});
