import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBillingBreakdown,
  buildEndUserBreakdown,
  buildFaultPartBreakdown,
  buildSymptomBreakdown,
  selectProductModelPeriodFaultParts,
  type FaultPartRow,
  type ProductModelBreakdownCase,
} from "./product-model-breakdown";
import {
  listFaultSymptomYears,
  selectFaultSymptomPeriodCases,
  FAULT_SYMPTOM_ALL_PERIOD,
  type FaultSymptomPeriod,
} from "./fault-symptom-breakdown";
import type { PieSlice } from "./pie-slices";

/**
 * ============================================================================
 * 🔴 [제품 모델 상세] · [A/S 이력] 의 **년/월 거르기** (2026-10-29 사용자 요청)
 * ============================================================================
 * 사용자 말: 「[제품 모델 상세]에 있는 [a/s 이력]에서 **[대시보드]의 [신고 증상별
 * 현황]처럼** 년/월을 선택해서 확인할 수 있도록 해줘.」 그래서 거르는 자는 대시보드의
 * 것을 **그대로** 쓴다(`selectFaultSymptomPeriodCases` · `listFaultSymptomYears`).
 *
 * ── 🔴 이 파일이 재는 것 ────────────────────────────────────────────────
 * 그 두 함수 자체의 성질(꼴이 어긋난 인수일 · 연도 없이 월만 · 내림차순)은 이웃한
 * `fault-symptom-breakdown.test.ts` 가 이미 못 박았다. **여기서 재는 것은 네 그래프가
 * 한 기간에 걸렸을 때 서로 어긋나지 않는가**이고, 특히 🔴 **[고장 부품]만 날짜 칸이
 * 없어 id 집합으로 걸리는데 그 결과가 앞의 셋과 같은 건 집합을 보고 있는가**다.
 *
 * 🔵 화면 쪽 배선(드롭다운 둘 · 월 잠금 · 펼친 조각 초기화)은 components 목록의
 *    `product-model-history-period.test.tsx` 가 본다 — 이 환경에는 눌러 볼 도구가 없어
 *    값으로 잴 수 있는 것과 글자로밖에 못 재는 것을 일부러 갈라 두었다.
 *
 * 🔴 고객사명·End-User·부품 이름은 **전부 가짜**다.
 * ============================================================================
 */

/**
 * 화면이 실제로 손에 쥐는 모양 — 접수 건 줄에는 **인수일이 아직 붙어 있다**
 * (ResolvedRepairCase). ProductModelBreakdownCase 로 매핑하면서 그 칸이 떨어지므로,
 * 화면도 이 모양일 때 먼저 거른다.
 */
type HistoryCase = ProductModelBreakdownCase & { receivedAt: string };

function historyCase(
  id: string,
  receivedAt: string,
  overrides: Partial<ProductModelBreakdownCase> = {}
): HistoryCase {
  return {
    id,
    receivedAt,
    reportedSymptom: null,
    intakeInspectionResult: null,
    endUserName: null,
    billingType: null,
    ...overrides,
  };
}

/**
 * 🔴 `matchKey`(2026-10-29 에 생긴 칸)는 **이 파일이 보지 않는 값**이라 기본값을 둔다 —
 * 여기서 재는 것은 「어느 줄이 그 기간에 남는가」뿐이고, 거르는 자는 `repairCaseId` 만 본다.
 * 🔴 **운영에서 열쇠는 이름표와 같은 글자가 아니다**(품번을 눌러 적은 값이다 —
 *    `used-part-display.ts` 의 `usedPartMatchKey`). 여기 같은 글자를 넣는 것은 줄마다 다른
 *    값을 만드는 가장 짧은 길일 뿐이고, 열쇠가 그래프와 맞는지는 `fault-part-inventory.test.ts`
 *    가 **진짜 자로** 잰다.
 */
function part(repairCaseId: string, displayName: string, matchKey = displayName): FaultPartRow {
  return { repairCaseId, displayName, matchKey };
}

function labels(slices: readonly PieSlice<unknown>[]): string[] {
  return [...slices.map((slice) => slice.label)].sort();
}

/**
 * 2024년 한 건 · 2025년 3월 두 건 · 2025년 7월 한 건. 세 기간(전체 · 해 · 달)의 답이
 * **서로 다르게** 나오는 가장 작은 표본이다 — 셋이 같은 수면 거르기가 꺼져 있어도
 * 시험이 통과한다.
 */
const CASES: HistoryCase[] = [
  historyCase("case-1", "2024-11-05", {
    reportedSymptom: "출력 저하",
    endUserName: "가 연구소",
    billingType: "PAID",
  }),
  historyCase("case-2", "2025-03-02", {
    reportedSymptom: "전원 인가 불가",
    endUserName: "나 공장",
    billingType: "WARRANTY",
  }),
  historyCase("case-3", "2025-03-21", {
    reportedSymptom: "출력 저하",
    endUserName: "나 공장",
    billingType: "PAID",
  }),
  historyCase("case-4", "2025-07-09", {
    reportedSymptom: "통신 불량",
    endUserName: "다 사업장",
    billingType: "PARTIAL_PAID",
  }),
];

/**
 * 🔴 **부품 줄에는 날짜가 없다.** 어느 건의 것인지(`repairCaseId`)만 있고, 그것이 이
 * 그래프를 기간에 걸 수 있는 유일한 실마리다. `case-3` 에는 일부러 한 줄도 안 달았다 —
 * 「건은 그 달에 있는데 부품 줄은 없다」가 실무에서 가장 흔한 꼴이다.
 */
const PARTS: FaultPartRow[] = [
  part("case-1", "가 부품 (DWG-001)"),
  part("case-2", "나 부품 (DWG-002)"),
  part("case-2", "가 부품 (DWG-001)"),
  part("case-4", "다 부품 (DWG-003)"),
];

/** 화면이 하는 일 그대로 — 거르고 → 매핑하고 → 부품 줄을 id 집합으로 건다. */
function selectPeriod(period: FaultSymptomPeriod) {
  const periodCases = selectFaultSymptomPeriodCases(CASES, period);
  const periodParts = selectProductModelPeriodFaultParts(PARTS, period, periodCases);
  return {
    symptom: buildSymptomBreakdown(periodCases),
    endUser: buildEndUserBreakdown(periodCases),
    billing: buildBillingBreakdown(periodCases),
    faultPart: buildFaultPartBreakdown(periodParts),
  };
}

describe("A/S 이력 기간 거르기 — 네 그래프가 한 기간을 본다", () => {
  test("🔴 「전체」면 다 나온다 — 기간을 고르기 전 화면은 예전 그대로다", () => {
    const view = selectPeriod(FAULT_SYMPTOM_ALL_PERIOD);

    assert.equal(view.symptom.total, 4);
    assert.equal(view.endUser.total, 4);
    assert.equal(view.billing.total, 4);
    assert.equal(view.faultPart.total, 4);
    assert.equal(view.faultPart.caseWithPartRecordCount, 3);
    assert.deepEqual(labels(view.symptom.slices), ["출력 저하", "전원 인가 불가", "통신 불량"].sort());
    assert.deepEqual(labels(view.faultPart.slices), [
      "가 부품 (DWG-001)",
      "나 부품 (DWG-002)",
      "다 부품 (DWG-003)",
    ].sort());
  });

  test("🔴 연도만 고르면 **그 해 전체**가 나온다 — 그 해의 다른 달이 빠지면 안 된다", () => {
    const view = selectPeriod({ year: 2025, month: null });

    // 2025년은 3월 둘 + 7월 하나. 2024년 한 건만 빠진다.
    assert.equal(view.symptom.total, 3);
    assert.equal(view.endUser.total, 3);
    assert.equal(view.billing.total, 3);
    assert.deepEqual(labels(view.symptom.slices), ["출력 저하", "전원 인가 불가", "통신 불량"].sort());
    // 🔴 7월 건(case-4)의 부품이 살아 있어야 「연도 = 그 해 전체」다.
    assert.equal(view.faultPart.total, 3);
    assert.deepEqual(labels(view.faultPart.slices), [
      "가 부품 (DWG-001)",
      "나 부품 (DWG-002)",
      "다 부품 (DWG-003)",
    ].sort());
    // 2024년 건의 부품 줄만 빠졌다 — 같은 이름표(가 부품)가 2025년에도 있어서 조각
    // 이름만으로는 안 갈린다. 수로 본다.
    const 가부품 = view.faultPart.slices.find((slice) => slice.label === "가 부품 (DWG-001)");
    assert.ok(가부품, "표본이 비었다 — 두 해에 걸친 이름표가 있어야 이 시험이 뜻이 있다");
    assert.equal(가부품.count, 1, "2024년 건의 부품 줄이 아직 세어지고 있다");
  });

  test("🔴 연도+월을 고르면 **그 달만** 나온다 — 같은 해 다른 달이 섞이면 안 된다", () => {
    const view = selectPeriod({ year: 2025, month: 3 });

    assert.equal(view.symptom.total, 2);
    assert.equal(view.endUser.total, 2);
    assert.equal(view.billing.total, 2);
    assert.deepEqual(labels(view.symptom.slices), ["출력 저하", "전원 인가 불가"].sort());
    assert.deepEqual(labels(view.endUser.slices), ["나 공장"]);
    assert.deepEqual(labels(view.billing.slices), ["무상", "유상"].sort());

    // 🔴 넷째도 같은 달만. 7월 건(case-4)의 「다 부품」이 사라져야 한다.
    assert.equal(view.faultPart.total, 2);
    assert.deepEqual(labels(view.faultPart.slices), [
      "가 부품 (DWG-001)",
      "나 부품 (DWG-002)",
    ].sort());
    // case-3 은 3월 건이지만 부품 줄이 한 개도 없다 — 건 수(2)와 부품 기록이 있는
    // 건 수(1)가 다른 것이 정상이고, 화면이 그 둘을 나란히 적는다.
    assert.equal(view.faultPart.caseWithPartRecordCount, 1);
  });

  test("🔴 건이 한 건도 없는 달을 골라도 터지지 않고 **넷 다 0** 이 된다", () => {
    const view = selectPeriod({ year: 2025, month: 12 });

    assert.equal(view.symptom.total, 0);
    assert.equal(view.endUser.total, 0);
    assert.equal(view.billing.total, 0);
    assert.equal(view.faultPart.total, 0);
    assert.deepEqual(view.symptom.slices, []);
    assert.deepEqual(view.faultPart.slices, []);
  });

  test("🔴 연도 선택지는 **자료에 있는 해만**, 최근 해가 위로", () => {
    assert.deepEqual(listFaultSymptomYears(CASES), [2025, 2024]);
  });
});

describe("selectProductModelPeriodFaultParts — 날짜 없는 줄을 id 집합으로 건다", () => {
  test("🔴 고른 기간의 건에 달린 줄만 남는다", () => {
    const kept = selectProductModelPeriodFaultParts(PARTS, { year: 2025, month: 3 }, [
      { id: "case-2" },
      { id: "case-3" },
    ]);

    assert.deepEqual(kept, [part("case-2", "나 부품 (DWG-002)"), part("case-2", "가 부품 (DWG-001)")]);
  });

  test("🔴 **전체 기간이면 한 줄도 거르지 않는다** — 집합에 없는 줄까지 남는다", () => {
    // 접수 건 목록에 없는 건의 부품 줄. 2026-10-29 실측으로는 생기지 않지만(조회 셋이
    // 전부 접수 건 목록과 같거나 더 좁다), 거기 기대어 두면 조회가 바뀌는 날 **기간을
    // 고르기도 전에** 줄이 사라진다. 그 길을 막아 둔 것이 전체 기간의 단락이다.
    const strays = [...PARTS, part("case-없음", "라 부품 (DWG-004)")];
    const kept = selectProductModelPeriodFaultParts(strays, FAULT_SYMPTOM_ALL_PERIOD, []);

    assert.equal(kept.length, 5, "전체 기간인데 줄이 걸러졌다");
    assert.deepEqual(kept, strays);
  });

  test("🔵 돌려주는 것은 **새 배열**이다 — 넘긴 배열을 건드리지 않는다", () => {
    const given: FaultPartRow[] = [part("case-2", "나 부품 (DWG-002)")];
    const all = selectProductModelPeriodFaultParts(given, FAULT_SYMPTOM_ALL_PERIOD, []);
    const filtered = selectProductModelPeriodFaultParts(given, { year: 2025, month: null }, [
      { id: "case-2" },
    ]);

    assert.notEqual(all, given);
    assert.notEqual(filtered, given);
    assert.deepEqual(given, [part("case-2", "나 부품 (DWG-002)")]);
  });

  test("🔴 건은 그 달에 있는데 부품 줄이 하나도 없으면 **빈 배열**이다", () => {
    const kept = selectProductModelPeriodFaultParts(PARTS, { year: 2025, month: null }, [
      { id: "case-3" },
    ]);

    assert.deepEqual(kept, []);
  });
});
