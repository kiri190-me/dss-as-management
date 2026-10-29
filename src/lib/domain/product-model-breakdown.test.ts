import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_SLICE_ORDER,
  PRODUCT_MODEL_UNASSIGNED_LABEL,
  buildBillingBreakdown,
  buildEndUserBreakdown,
  buildFaultPartBreakdown,
  buildSymptomBreakdown,
  faultPartIssuedWarning,
  type FaultPartRow,
  type ProductModelBreakdownCase,
} from "./product-model-breakdown";
import { FAULT_SYMPTOM_OTHER_LABEL, FAULT_SYMPTOM_UNSPECIFIED_LABEL } from "./fault-symptom-breakdown";
import type { PieSlice } from "./pie-slices";
import type { BillingType } from "./types";

/**
 * 조각을 나누는 일반 규칙(미입력·접기·각도)은 pie-slices.test.ts 가 지킨다.
 * 여기서 지키는 것은 **이 화면만의 판단**이다:
 *   · 네 그래프가 각각 어느 칸을 읽는가
 *   · 유/무상은 접지 않고 차례가 고정인가
 *   · 고장 부품만 접수 건이 아니라 **부품 줄**을 세는가 (그래서 합이 다르다)
 *
 * 🔴 **고장 부품의 줄이 어디서 오는지는 여기서 재지 않는다**(2026-10-29). 부품 요청과
 *    사용 부품을 합치고 이름표를 만드는 일은 `product-model-fault-parts.test.ts` 가
 *    본다 — 이 파일이 보는 것은 **이미 글자가 된 줄을 어떻게 세는가**뿐이다.
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

/**
 * 그래프가 세는 줄 하나. 🔴 **이름표는 이미 만들어져 있다** — 부품 요청에서 왔는지
 * 사용 부품에서 왔는지 이 함수는 더 이상 세지 않는다(2026-10-29).
 */
/**
 * 🔴 `matchKey`(2026-10-29 에 생긴 칸)에 기본값을 둔다 — 이 파일이 재는 것은 **조각을
 * 어떻게 나누는가**이고, 그 일은 `displayName` 하나로만 돈다.
 * 🔴 **운영에서 열쇠는 이름표와 같은 글자가 아니다** — 품번을 눌러 적은 값이고
 *    (`used-part-display.ts` 의 `usedPartMatchKey`), 이름표는 「고객사 품명 (품번)」이다.
 *    여기 같은 글자를 넣는 것은 부품마다 다른 값을 만드는 가장 짧은 길일 뿐이다. 열쇠가
 *    그래프와 어긋나지 않는지는 `fault-part-inventory.test.ts` 가 진짜 자로 잰다.
 */
function part(repairCaseId: string, displayName: string, matchKey = displayName): FaultPartRow {
  return { repairCaseId, displayName, matchKey };
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

/**
 * 🔴 **제목을 뒤집었다**(2026-10-29). 2026-10-29 전의 제목은 이랬다 —
 *
 *   > "고장 부품은 **요청 부품 줄**을 세므로 조각 합이 접수 건수와 다를 수 있다"
 *   > "**요청 기록이** 없는 건은 조각을 만들지 않는다 — 부품 줄이 없으면 빈 그래프다"
 *   > "**품명이** 공백뿐인 줄만 미입력으로 세고, 버리지 않는다"
 *
 * 단언은 전부 맞았지만 제목이 **옛 설계**를 적고 있었다. 이 그래프는 이제 부품 요청
 * 줄과 사용 부품 줄을 **함께** 세고(사용자 요청 2026-10-29), 묶는 열쇠도 품명이
 * 아니라 **이름표 글자**다. 초록 ✔ 옆의 글은 아무도 의심하지 않아서, 틀린 설명이
 * 그대로 다음 사람의 전제가 된다.
 */
test("고장 부품은 부품 줄을 세므로 조각 합이 접수 건수와 다를 수 있다", () => {
  // 접수 건 10건 중 3건에만 부품 기록이 있고, 그 3건에서 부품 5개가 나왔다.
  const partRows = [
    part("case-A", "RF 케이블"),
    part("case-A", "메인 PCB"),
    part("case-A", "퓨즈"),
    part("case-B", "메인 PCB"),
    part("case-C", "퓨즈"),
  ];

  const breakdown = buildFaultPartBreakdown(partRows);
  assert.equal(breakdown.total, 5, "부품 개수는 부품 줄 수다");
  assert.equal(breakdown.caseWithPartRecordCount, 3, "부품 기록이 있는 건은 3건이다");
  assert.equal(sumCounts(breakdown.slices), 5);
  assert.deepEqual(labels(breakdown.slices), ["메인 PCB", "퓨즈", "RF 케이블"]);
});

test("부품 기록이 없는 건은 조각을 만들지 않는다 — 부품 줄이 없으면 빈 그래프다", () => {
  const breakdown = buildFaultPartBreakdown([]);
  assert.equal(breakdown.total, 0);
  assert.equal(breakdown.caseWithPartRecordCount, 0);
  assert.deepEqual(breakdown.slices, []);
});

test("이름표가 공백뿐인 줄만 미입력으로 세고, 버리지 않는다", () => {
  const breakdown = buildFaultPartBreakdown([part("case-A", "퓨즈"), part("case-A", "   ")]);
  assert.equal(breakdown.total, 2);
  assert.equal(sumCounts(breakdown.slices), 2);
  assert.deepEqual(labels(breakdown.slices), ["퓨즈", FAULT_SYMPTOM_UNSPECIFIED_LABEL]);
});

/**
 * 🔴 **묶는 열쇠는 이름표 글자 그대로**다 — 「고객사 품명 (품번)」이 통째로 한 조각의
 * 이름이 된다. 괄호를 떼거나 품번만 남기는 손질을 여기서 하지 않는다(하면 서로 다른
 * 부품이 한 조각으로 뭉친다).
 */
test("이름표 글자가 그대로 조각 이름이 된다 — 「고객사 품명 (품번)」도 한 글자로 묶인다", () => {
  const breakdown = buildFaultPartBreakdown([
    part("case-A", "전원 퓨즈 (AA000111)"),
    part("case-B", "전원 퓨즈 (AA000111)"),
    // 같은 이름이지만 품번이 다르다 — **다른 조각**이다.
    part("case-C", "전원 퓨즈 (AA000222)"),
  ]);
  assert.deepEqual(labels(breakdown.slices), ["전원 퓨즈 (AA000111)", "전원 퓨즈 (AA000222)"]);
  assert.deepEqual(
    breakdown.slices.map((slice) => slice.count),
    [2, 1]
  );
});

test("고장 부품도 9종 이상이면 상위 8 + 기타로 접힌다", () => {
  const partRows: FaultPartRow[] = [];
  for (let i = 1; i <= 10; i += 1) {
    for (let n = 0; n < 20 - i; n += 1) partRows.push(part(`case-${i}`, `부품 ${i}`));
  }
  const breakdown = buildFaultPartBreakdown(partRows);
  assert.equal(breakdown.slices.length, 9);
  assert.equal(breakdown.slices[8].label, FAULT_SYMPTOM_OTHER_LABEL);
  assert.equal(breakdown.slices[8].foldedGroupCount, 2);
  assert.equal(breakdown.caseWithPartRecordCount, 10);
  assert.equal(sumCounts(breakdown.slices), breakdown.total);
});

/**
 * ============================================================================
 * 🔴 **못 센 건이 있으면 그 사실이 글자로 나와야 한다** (2026-10-29)
 * ============================================================================
 * 반출 확인된 부품만 「일부만 받아 오는」 일이 생긴다(수리 건마다 재고 관리에 한 번씩
 * 묻는다 — `server/product-model-issued-parts.ts`). 조용히 적은 수를 보여 주면
 * 「이 모델은 이 부품이 적게 고장난다」는 틀린 결론이 나온다.
 *
 * 🔵 **수가 글자에 실제로 박히는지**까지 본다 — 「문장이 있다」만 재면 상한을 30 으로
 *    고쳐도 「40건」이라고 적힌 옛 문장이 영영 통과한다.
 * ============================================================================
 */
test("🔴 다 셌으면 아무 말도 안 한다 — 늘 떠 있는 안내는 아무도 안 읽는다", () => {
  assert.equal(
    faultPartIssuedWarning({ uncountedCaseCount: 0, skippedCaseCount: 0, caseLimit: 40 }),
    null
  );
  // 반출을 안 묻는 화면(또는 아직 안 물은 상태)도 조용하다.
  assert.equal(faultPartIssuedWarning(null), null);
});

test("🔴 못 받아 온 건이 있으면 **그 수**와 「적다」는 말이 함께 나온다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 3,
    skippedCaseCount: 0,
    caseLimit: 40,
  });
  assert.ok(message, "못 센 건이 있는데 화면이 아무 말도 안 한다");
  assert.ok(message.includes("3건"), `못 센 수가 글자에 없다: ${message}`);
  assert.ok(message.includes("받아오지 못했습니다"), message);
  // 🔴 「없다」로 읽히면 안 된다 — 수가 실제보다 적다는 말이 반드시 들어간다.
  assert.ok(message.includes("적습니다"), message);
});

test("🔴 상한을 넘겨 아예 안 센 것은 **다른 말**이다 — 건수와 상한이 둘 다 적힌다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 0,
    skippedCaseCount: 57,
    caseLimit: 40,
  });
  assert.ok(message, "아예 안 셌는데 화면이 아무 말도 안 한다");
  assert.ok(message.includes("57건"), `이 모델의 건수가 글자에 없다: ${message}`);
  assert.ok(message.includes("40건"), `상한이 글자에 없다 — 상수를 고쳐도 안 바뀐다: ${message}`);
  assert.ok(message.includes("세지 않았습니다"), message);
});

test("🔴 둘 다 0 이 아니면 **아예 안 셌다**는 쪽이 이긴다 — 더 큰 사실이 가려지면 안 된다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 2,
    skippedCaseCount: 57,
    caseLimit: 40,
  });
  assert.ok(message?.includes("세지 않았습니다"), message ?? "(없음)");
  assert.equal(message?.includes("받아오지 못했습니다"), false, message ?? "(없음)");
});
