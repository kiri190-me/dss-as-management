import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_SLICE_ORDER,
  PRODUCT_MODEL_UNASSIGNED_LABEL,
  buildBillingBreakdown,
  buildEndUserBreakdown,
  buildFaultPartBreakdown,
  buildSymptomBreakdown,
  type ProductModelBreakdownCase,
  type RequestedPartRow,
} from "./product-model-breakdown";
import { FAULT_SYMPTOM_OTHER_LABEL, FAULT_SYMPTOM_UNSPECIFIED_LABEL } from "./fault-symptom-breakdown";
import type { PieSlice } from "./pie-slices";
import type { BillingType } from "./types";

/**
 * 조각을 나누는 일반 규칙(미입력·접기·각도)은 pie-slices.test.ts 가 지킨다.
 * 여기서 지키는 것은 **이 화면만의 판단**이다:
 *   · 네 그래프가 각각 어느 칸을 읽는가
 *   · 유/무상은 접지 않고 차례가 고정인가
 *   · 고장 부품만 접수 건이 아니라 요청 부품 줄을 세는가 (그래서 합이 다르다)
 */

let seq = 0;
function caseRow(overrides: Partial<ProductModelBreakdownCase> = {}): ProductModelBreakdownCase {
  seq += 1;
  return {
    id: `case-${seq}`,
    reportedSymptom: null,
    intakeInspectionResult: null,
    endUserName: null,
    billingType: null,
    ...overrides,
  };
}

function part(repairCaseId: string, partName: string): RequestedPartRow {
  return { repairCaseId, partName };
}

function labels(slices: readonly PieSlice<unknown>[]): string[] {
  return slices.map((slice) => slice.label);
}

function sumCounts(slices: readonly PieSlice<unknown>[]): number {
  return slices.reduce((acc, slice) => acc + slice.count, 0);
}

// ─────────────────────────────────────────────── ① 고장 증상

test("고장 증상은 신고 증상을 글자 그대로 묶고, 비어 있으면 미입력이다", () => {
  const breakdown = buildSymptomBreakdown([
    caseRow({ reportedSymptom: "전원 인가 불가" }),
    caseRow({ reportedSymptom: " 전원 인가 불가 " }),
    caseRow({ reportedSymptom: "출력 저하" }),
    caseRow({ reportedSymptom: null }),
    caseRow({ reportedSymptom: "   " }),
  ]);

  assert.equal(breakdown.total, 5);
  assert.equal(sumCounts(breakdown.slices), 5);
  assert.deepEqual(labels(breakdown.slices), [
    "전원 인가 불가",
    "출력 저하",
    FAULT_SYMPTOM_UNSPECIFIED_LABEL,
  ]);
});

test("고장 증상 조각은 그 건들의 인수점검 결과를 달고 다니고, 점검 전은 따로 센다", () => {
  const breakdown = buildSymptomBreakdown([
    caseRow({ reportedSymptom: "전원 인가 불가", intakeInspectionResult: "메인 PCB 소손" }),
    caseRow({ reportedSymptom: "전원 인가 불가", intakeInspectionResult: " 메인 PCB 소손 " }),
    caseRow({ reportedSymptom: "전원 인가 불가", intakeInspectionResult: "퓨즈 단선" }),
    caseRow({ reportedSymptom: "전원 인가 불가", intakeInspectionResult: null }),
    caseRow({ reportedSymptom: "전원 인가 불가", intakeInspectionResult: "  " }),
  ]);

  const slice = breakdown.slices[0];
  assert.equal(slice.count, 5);
  assert.deepEqual(slice.detail.intakeInspectionResults, [
    { result: "메인 PCB 소손", count: 2 },
    { result: "퓨즈 단선", count: 1 },
  ]);
  assert.equal(slice.detail.intakeInspectionPendingCount, 2);

  // 묶음 건수 + 점검 전 건수 = 조각 건수.
  const grouped = slice.detail.intakeInspectionResults.reduce((acc, g) => acc + g.count, 0);
  assert.equal(grouped + slice.detail.intakeInspectionPendingCount, slice.count);
});

test("고장 증상은 상위 8 + 기타로 접히고, 기타 조각의 인수점검 결과도 합쳐진다", () => {
  const cases: ProductModelBreakdownCase[] = [];
  for (let i = 1; i <= 8; i += 1) {
    for (let n = 0; n < 10; n += 1) {
      cases.push(caseRow({ reportedSymptom: `증상 ${i}`, intakeInspectionResult: "상위 결과" }));
    }
  }
  cases.push(caseRow({ reportedSymptom: "증상 9", intakeInspectionResult: "커넥터 접촉 불량" }));
  cases.push(caseRow({ reportedSymptom: "증상 10", intakeInspectionResult: "커넥터 접촉 불량" }));
  cases.push(caseRow({ reportedSymptom: "증상 10", intakeInspectionResult: null }));

  const breakdown = buildSymptomBreakdown(cases);
  const other = breakdown.slices.find((s) => s.label === FAULT_SYMPTOM_OTHER_LABEL);
  assert.ok(other, "기타 조각이 있어야 한다");
  assert.equal(other!.foldedGroupCount, 2);
  assert.equal(other!.count, 3);
  assert.deepEqual(other!.detail.intakeInspectionResults, [
    { result: "커넥터 접촉 불량", count: 2 },
  ]);
  assert.equal(other!.detail.intakeInspectionPendingCount, 1);
  assert.equal(sumCounts(breakdown.slices), breakdown.total);
});

// ─────────────────────────────────────────────── ② End-User

test("End-User 는 이름을 글자 그대로 묶고, 비어 있으면 미지정이다", () => {
  const breakdown = buildEndUserBreakdown([
    caseRow({ endUserName: "삼성전자 화성" }),
    caseRow({ endUserName: " 삼성전자 화성 " }),
    caseRow({ endUserName: "SK하이닉스 이천" }),
    caseRow({ endUserName: null }),
    caseRow({ endUserName: "" }),
  ]);

  assert.equal(breakdown.total, 5);
  assert.equal(sumCounts(breakdown.slices), 5);
  assert.deepEqual(labels(breakdown.slices), [
    "삼성전자 화성",
    "SK하이닉스 이천",
    PRODUCT_MODEL_UNASSIGNED_LABEL,
  ]);
  // 조각을 눌러도 펼칠 것이 없다.
  assert.equal(breakdown.slices[0].detail, null);
});

test("End-User 도 9종 이상이면 상위 8 + 기타로 접힌다", () => {
  const cases: ProductModelBreakdownCase[] = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let n = 0; n < 20 - i; n += 1) cases.push(caseRow({ endUserName: `고객 ${i}` }));
  }
  const breakdown = buildEndUserBreakdown(cases);
  assert.equal(breakdown.slices.length, 9);
  assert.equal(breakdown.slices[8].label, FAULT_SYMPTOM_OTHER_LABEL);
  assert.equal(breakdown.slices[8].foldedGroupCount, 4);
  assert.equal(sumCounts(breakdown.slices), breakdown.total);
});

// ─────────────────────────────────────────────── ③ 유/무상

test("유/무상 차례는 유상 → 일부유상 → 무상 → 추후결정 → 미지정으로 고정이다", () => {
  assert.deepEqual(BILLING_SLICE_ORDER, ["유상", "일부유상", "무상", "추후결정"]);

  const cases: ProductModelBreakdownCase[] = [];
  // 건수는 일부러 거꾸로 — 건수 순이었다면 차례가 뒤집혔을 것이다.
  const plan: [BillingType | null, number][] = [
    ["PAID", 1],
    ["PARTIAL_PAID", 2],
    ["WARRANTY", 3],
    ["PENDING_DECISION", 4],
    [null, 5],
  ];
  for (const [billingType, n] of plan) {
    for (let i = 0; i < n; i += 1) cases.push(caseRow({ billingType }));
  }

  const breakdown = buildBillingBreakdown(cases);
  assert.deepEqual(labels(breakdown.slices), [
    "유상",
    "일부유상",
    "무상",
    "추후결정",
    PRODUCT_MODEL_UNASSIGNED_LABEL,
  ]);
  assert.equal(sumCounts(breakdown.slices), 15);
  assert.equal(breakdown.total, 15);
});

test("유/무상은 접지 않는다 — 건수 0 인 값은 조각을 만들지 않고, 기타도 생기지 않는다", () => {
  const breakdown = buildBillingBreakdown([
    caseRow({ billingType: "WARRANTY" }),
    caseRow({ billingType: "WARRANTY" }),
  ]);
  assert.deepEqual(labels(breakdown.slices), ["무상"]);
  assert.equal(
    breakdown.slices.find((s) => s.sliceKind === "OTHER"),
    undefined
  );
  assert.equal(breakdown.slices[0].sweepAngle, 360);
});

// ─────────────────────────────────────────────── ④ 고장 부품

test("고장 부품은 요청 부품 줄을 세므로 조각 합이 접수 건수와 다를 수 있다", () => {
  // 접수 건 10건 중 3건에만 요청 기록이 있고, 그 3건에서 부품 5개가 나갔다.
  const partRows = [
    part("case-A", "RF 케이블"),
    part("case-A", "메인 PCB"),
    part("case-A", "퓨즈"),
    part("case-B", "메인 PCB"),
    part("case-C", "퓨즈"),
  ];

  const breakdown = buildFaultPartBreakdown(partRows);
  assert.equal(breakdown.total, 5, "부품 개수는 요청 줄 수다");
  assert.equal(breakdown.caseWithRequestCount, 3, "요청 기록이 있는 건은 3건이다");
  assert.equal(sumCounts(breakdown.slices), 5);
  assert.deepEqual(labels(breakdown.slices), ["메인 PCB", "퓨즈", "RF 케이블"]);
});

test("요청 기록이 없는 건은 조각을 만들지 않는다 — 부품 줄이 없으면 빈 그래프다", () => {
  const breakdown = buildFaultPartBreakdown([]);
  assert.equal(breakdown.total, 0);
  assert.equal(breakdown.caseWithRequestCount, 0);
  assert.deepEqual(breakdown.slices, []);
});

test("품명이 공백뿐인 줄만 미입력으로 세고, 버리지 않는다", () => {
  const breakdown = buildFaultPartBreakdown([part("case-A", "퓨즈"), part("case-A", "   ")]);
  assert.equal(breakdown.total, 2);
  assert.equal(sumCounts(breakdown.slices), 2);
  assert.deepEqual(labels(breakdown.slices), ["퓨즈", FAULT_SYMPTOM_UNSPECIFIED_LABEL]);
});

test("고장 부품도 9종 이상이면 상위 8 + 기타로 접힌다", () => {
  const partRows: RequestedPartRow[] = [];
  for (let i = 1; i <= 10; i += 1) {
    for (let n = 0; n < 20 - i; n += 1) partRows.push(part(`case-${i}`, `부품 ${i}`));
  }
  const breakdown = buildFaultPartBreakdown(partRows);
  assert.equal(breakdown.slices.length, 9);
  assert.equal(breakdown.slices[8].label, FAULT_SYMPTOM_OTHER_LABEL);
  assert.equal(breakdown.slices[8].foldedGroupCount, 2);
  assert.equal(breakdown.caseWithRequestCount, 10);
  assert.equal(sumCounts(breakdown.slices), breakdown.total);
});
