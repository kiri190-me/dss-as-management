import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import { applyWorkflowOverride } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { RELEASED_HOLD_STATE, type LocalWorkflowState } from "@/lib/domain/local/workflow/workflow-types";
import type { SortState } from "@/lib/domain/repair-case-filters";

/**
 * ============================================================================
 * 🔴 「납기 지연」 배지가 **빌려 온 날짜로도** 켜지는가 — 화면 쪽 길 (2026-11-07)
 * ============================================================================
 * 사용자 신고: 「고객 요청 납기일이 **내자정리에서 읽어온 경우 [납기지연]이 안뜨는**
 * 것 같아」.
 *
 * 판정은 domain/repair-case-overdue.test.ts 가, 서버 매퍼 쪽 길은
 * db/mappers/repair-case-overdue.test.ts 가 잰다. **이 파일이 보는 것은 화면까지
 * 닿는가**다. 화면 쪽에는 길이 둘이고, 2026-11-07 이전에는 둘 다 눈이 멀어 있었다:
 *
 *  ① 재정의가 **없는** 건 — 서버가 재 둔 `resolved.isOverdue` 를 그대로 쓴다.
 *  ② 🔴 재정의가 **있는** 건 — 어댑터가 그 자리에서 **다시 판정한다**
 *    (applyWorkflowOverride). 재료를 안 넘기면 **재정의가 걸린 건만** 빌려 오지
 *    못해, 같은 표에서 어떤 줄은 배지가 뜨고 어떤 줄은 안 뜬다. 눈으로는 「가끔
 *    안 뜬다」로 보여 가장 찾기 어려운 모양이다.
 *
 * 🔴 값은 전부 가짜다. 실제 접수번호·고객사 이름·S/N·L/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const OVERDUE_LABEL = "납기 지연";
const FAKE_CASE_ID = "case-fake-overdue-1";
const SORT: SortState = { column: "intakeNumber", direction: "desc" };

/** 2094-12-10 14:00 KST — 한국/UTC 달력 날짜가 둘 다 12-10인, 경계가 아닌 시각. */
const MIDDAY_KST = new Date("2094-12-10T05:00:00.000Z");
/** 그 시각 기준으로 **이미 지난** 하루. 내자 줄에서 빌려 올 날짜로 쓴다. */
const PAST_DUE_DATE = "2094-12-01";

function resolvedRow(overrides: Partial<ResolvedRepairCase> = {}): ResolvedRepairCase {
  return {
    id: FAKE_CASE_ID,
    version: 1,
    source: "DATABASE",
    productId: "product-fake-1",
    intakeNumber: "D9412-07",
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    status: "IN_REPAIR",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "REPAIR",
    receivedAt: "2094-11-02",
    // 🔴 **제 칸은 비어 있다** — 사용자가 본 그 모양이다. 빌려 오지 않는 구현이면
    //    아래 단언이 전부 거짓이 된다.
    customerRequestedDueDate: null,
    domesticOrderDueDates: [PAST_DUE_DATE],
    internalTargetInspectionCompletionDate: null,
    // 🔴 표본의 못 — 사내 날짜는 늘 한참 지나 있다. 2026-11-03 이전의 옛 규칙
    //    (사내 날짜로 재기)이 되살아나면 「안 뜬다」 단언이 깨진다.
    internalTargetShipmentDate: "2094-01-05",
    actualShipmentDate: null,
    createdAt: "2094-11-02T00:00:00.000Z",
    // 서버가 재 둔 값. ① 길은 이 값을 그대로 쓴다.
    isOverdue: true,
    productCategory: "TEST-CATEGORY",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TEST-MODEL-A",
    lotNumber: "TEST-LN-0001",
    serialNumber: "TEST-SN-0001",
    partNumber: null,
    customerId: "customer-fake-1",
    customerName: "시험용 고객사",
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

function override(overrides: Partial<LocalWorkflowState> = {}): LocalWorkflowState {
  return {
    id: "workflow-state-fake-1",
    repairCaseId: FAKE_CASE_ID,
    workflowType: "PAID_MATCHER",
    currentStatus: "IN_REPAIR",
    currentWorkflowStepKey: "REPAIR",
    // 보류는 이 시험의 축이 아니다 — 「안 걸린 상태」를 뜻하는 그 상수를 그대로 쓴다.
    holdState: RELEASED_HOLD_STATE,
    shipmentCompletedAt: null,
    updatedByUserId: "user-fake-1",
    updatedByNameSnapshot: "시험 사용자",
    updatedAt: "2094-12-05T00:00:00.000Z",
    source: "LOCAL_DEMO",
    ...overrides,
  };
}

test("🔴 표본 점검 — 제 칸이 비었고 빌려 올 날짜는 지나 있고 사내 날짜도 지나 있다", () => {
  // 이 못이 없으면 아래 단언들이 제 칸으로 통과하거나, 「사내 날짜로는 안 잰다」가
  // 아무것도 안 재게 된다.
  const row = resolvedRow();
  assert.equal(row.customerRequestedDueDate, null, "표본의 제 칸이 비어 있지 않다");
  assert.deepEqual(row.domesticOrderDueDates, [PAST_DUE_DATE]);
  assert.ok(PAST_DUE_DATE < "2094-12-10", "표본의 빌려 온 날짜가 지나 있지 않다");
  assert.ok(
    row.internalTargetShipmentDate !== null && row.internalTargetShipmentDate < "2094-12-10",
    "표본의 사내 날짜가 지나 있지 않다"
  );
});

describe("② 재정의가 걸린 건 — 어댑터가 그 자리에서 다시 잰다", () => {
  test("🔴 빌려 온 날짜가 지났으면 effectiveIsOverdue 가 참이다", () => {
    const effective = applyWorkflowOverride(resolvedRow(), override(), MIDDAY_KST);
    assert.equal(effective.hasWorkflowOverride, true, "재정의가 안 걸렸다 — 다른 길을 재고 있다");
    assert.equal(effective.effectiveIsOverdue, true);
  });

  test("🔴 재료가 안 실려 오면 예전처럼 안 뜬다 — 이 한 줄이 이번에 고친 자리다", () => {
    const effective = applyWorkflowOverride(
      resolvedRow({ domesticOrderDueDates: [] }),
      override(),
      MIDDAY_KST
    );
    // 🔴 서버가 재 둔 resolved.isOverdue 는 여전히 true 다. 재정의가 걸린 건은 그
    //    값을 쓰지 않고 다시 재므로, 재료가 없으면 여기서 거짓으로 뒤집힌다.
    assert.equal(effective.effectiveIsOverdue, false);
  });

  test("재정의로 출하 완료된 건은 빌려 온 날짜가 지났어도 거짓이다", () => {
    const effective = applyWorkflowOverride(
      resolvedRow(),
      override({ currentStatus: "SHIPMENT_COMPLETED", shipmentCompletedAt: "2094-12-09T00:00:00.000Z" }),
      MIDDAY_KST
    );
    assert.equal(effective.effectiveIsOverdue, false);
  });

  test("제 칸에 적힌 미래 날짜가 이긴다 — 내자에 지난 날짜가 있어도 거짓이다", () => {
    const effective = applyWorkflowOverride(
      resolvedRow({ customerRequestedDueDate: "2094-12-31" }),
      override(),
      MIDDAY_KST
    );
    assert.equal(effective.effectiveIsOverdue, false);
  });
});

describe("① 재정의가 없는 건 — 서버가 재 둔 값을 그대로 쓴다", () => {
  test("isOverdue 가 참이면 effectiveIsOverdue 도 참이다", () => {
    const effective = applyWorkflowOverride(resolvedRow(), undefined, MIDDAY_KST);
    assert.equal(effective.hasWorkflowOverride, false);
    assert.equal(effective.effectiveIsOverdue, true);
  });

  test("🔴 서버가 거짓으로 재 두었으면 화면이 제멋대로 켜지 않는다", () => {
    const effective = applyWorkflowOverride(resolvedRow({ isOverdue: false }), undefined, MIDDAY_KST);
    assert.equal(effective.effectiveIsOverdue, false);
  });
});

describe("③ 그 값이 표와 카드에 **글자로** 선다", () => {
  const effective = applyWorkflowOverride(resolvedRow(), override(), MIDDAY_KST);
  const notOverdue = applyWorkflowOverride(
    resolvedRow({ domesticOrderDueDates: [] }),
    override(),
    MIDDAY_KST
  );

  test("표에 「납기 지연」이 선다", () => {
    const html = renderToStaticMarkup(
      <RepairCaseTable rows={[effective]} sort={SORT} onSortChange={() => {}} />
    );
    assert.ok(html.includes(OVERDUE_LABEL), "표에 배지가 없다");
  });

  test("🔴 카드에도 선다 — 표에만 넣으면 창 크기에 따라 보이는 사람이 갈린다", () => {
    const html = renderToStaticMarkup(<RepairCaseCardList rows={[effective]} />);
    assert.ok(html.includes(OVERDUE_LABEL), "카드에 배지가 없다");
  });

  test("지연이 아닌 줄에는 표에도 카드에도 한 글자도 안 선다", () => {
    const tableHtml = renderToStaticMarkup(
      <RepairCaseTable rows={[notOverdue]} sort={SORT} onSortChange={() => {}} />
    );
    const cardHtml = renderToStaticMarkup(<RepairCaseCardList rows={[notOverdue]} />);
    assert.equal(tableHtml.includes(OVERDUE_LABEL), false, "지연이 아닌데 표에 배지가 섰다");
    assert.equal(cardHtml.includes(OVERDUE_LABEL), false, "지연이 아닌데 카드에 배지가 섰다");
  });
});
