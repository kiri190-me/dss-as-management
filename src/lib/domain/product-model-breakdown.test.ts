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
/**
 * 🔴 `quantity`(2026-10-29 에 생긴 칸)의 기본값은 **1** 이다 — 「줄 하나가 한 개」였던
 *    예전과 같은 수라, 아래 옛 시험들의 기대값이 그대로 참이어야 한다. 수량을 **실제로
 *    세는지**는 이 파일 맨 아래 묶음이 따로 본다.
 */
function part(
  repairCaseId: string,
  displayName: string,
  quantity = 1,
  matchKey = displayName
): FaultPartRow {
  return { repairCaseId, quantity, displayName, matchKey };
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
  // 🔴 「줄 수다」가 아니다(2026-10-29) — **수량의 합**이고, 이 표본은 줄마다 1 개라
  //    옛 기대값 5 가 그대로 맞다. 수량을 실제로 세는지는 아래 전용 묶음이 본다.
  assert.equal(breakdown.total, 5, "부품 개수는 수량의 합이다(이 표본은 줄마다 1 개)");
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
 * 🔴 **고장 부품만 「줄 수」가 아니라 「수량」을 센다** (2026-10-29 사용자 요청)
 * ============================================================================
 * 사용자 말: 「각 부품이 들어있는 수리건의 수 말고 **실제로 사용된 부품의 수**를
 * 표시해줘.」 세 입력이 어느 칸을 수량으로 싣고 오는지는 `product-model-fault-parts
 * .test.ts` 가 보고, 여기서 보는 것은 **이미 수량이 실린 줄을 어떻게 세는가**다:
 *   · 조각의 수 · 총계 · %가 전부 수량으로 나오는가
 *   · 펼친 자리의 수가 조각의 수와 **같은 자**인가(기타로 접혀도)
 *   · 🔴 「부품 기록이 있는 N건」은 **건수 그대로**인가
 *   · 🔴 **다른 세 그래프는 안 바뀌는가** — 그 셋이 묻는 것은 「몇 건인가」다
 * ============================================================================
 */
test("🔴 고장 부품은 **수량의 합**을 센다 — 줄 넷이어도 5+5+3+5 면 18개다", () => {
  // 🔵 사용자가 보낸 운영 화면의 모양이다(이름은 가짜). 한 건에서 나온 네 부품.
  const partRows = [
    part("case-A", "가 기판 (AA000111)", 5),
    part("case-A", "나 기판 (AA000222)", 5),
    part("case-A", "다 트랜스 (AA000333)", 3),
    part("case-A", "라 기판 (AA000444)", 5),
  ];

  const breakdown = buildFaultPartBreakdown(partRows);
  assert.equal(breakdown.total, 18, "🔴 줄 수로 세면 4 가 된다 — 신고된 그 증상이다");
  assert.equal(sumCounts(breakdown.slices), 18, "조각의 합도 같은 자여야 한다");
  assert.deepEqual(
    breakdown.slices.map((slice) => [slice.label, slice.count]),
    [
      ["가 기판 (AA000111)", 5],
      ["나 기판 (AA000222)", 5],
      ["라 기판 (AA000444)", 5],
      ["다 트랜스 (AA000333)", 3],
    ]
  );
  // 🔵 %도 수량에서 나온다 — 5/18 = 27.8%, 3/18 = 16.7%.
  assert.deepEqual(
    breakdown.slices.map((slice) => slice.percentage),
    [27.8, 27.8, 27.8, 16.7]
  );
  // 🔴 각도의 합은 여전히 360 이다(무게를 실어도 원은 원이다).
  assert.equal(
    Math.round(breakdown.slices.reduce((sum, slice) => sum + slice.sweepAngle, 0)),
    360
  );
});

test("🔴 「부품 기록이 있는 N건」은 **건수 그대로**다 — 수량으로 안 바뀐다", () => {
  const breakdown = buildFaultPartBreakdown([
    part("case-A", "가 기판 (AA000111)", 5),
    part("case-A", "나 기판 (AA000222)", 5),
    part("case-A", "다 트랜스 (AA000333)", 3),
    part("case-A", "라 기판 (AA000444)", 5),
  ]);
  assert.equal(breakdown.total, 18, "이 시험의 표본이 비었다 — 수량이 실려야 한다");
  assert.equal(breakdown.caseWithPartRecordCount, 1, "🔴 18 이 되면 「건」이 거짓말이 된다");
});

test("🔴 펼친 자리의 수도 수량이다 — 조각의 수와 갈리면 화면에서 어긋난 수가 보인다", () => {
  const breakdown = buildFaultPartBreakdown([
    part("case-A", "가 기판 (AA000111)", 5),
    part("case-B", "가 기판 (AA000111)", 2),
  ]);
  const slice = breakdown.slices[0];
  assert.equal(slice.count, 7);
  assert.deepEqual(
    slice.detail.parts.map((entry) => [entry.displayName, entry.count]),
    [["가 기판 (AA000111)", 7]]
  );
});

test("🔴 **기타로 접혀도** 접힌 부품 수량의 합이 조각의 수와 같다", () => {
  const partRows: FaultPartRow[] = [];
  // 값 9종 — 앞 8 종은 넉넉히, 접힐 두 종은 수량을 일부러 크게 둔다(줄 수로 세면
  // 접히는 차례 자체가 달라진다).
  for (let i = 1; i <= 8; i += 1) {
    for (let n = 0; n < 10; n += 1) partRows.push(part(`case-${i}`, `상위 부품 ${i}`, 1));
  }
  partRows.push(part("case-9", "접힐 부품 가", 4));
  partRows.push(part("case-9", "접힐 부품 나", 3));

  const breakdown = buildFaultPartBreakdown(partRows);
  const other = breakdown.slices[breakdown.slices.length - 1];
  assert.equal(other.sliceKind, "OTHER", "이 시험의 전제가 깨졌다 — 기타 조각이 없다");
  assert.equal(other.count, 7, "4 + 3 — 줄 수로 세면 2 가 된다");
  assert.deepEqual(
    other.detail.parts.map((entry) => entry.count),
    [4, 3]
  );
  assert.equal(
    other.detail.parts.reduce((sum, entry) => sum + entry.count, 0),
    other.count,
    "접힌 부품 수량의 합이 조각의 수와 다르다"
  );
  assert.equal(sumCounts(breakdown.slices), breakdown.total);
});

test("🔴 **다른 세 그래프는 한 줄이 한 건 그대로**다 — 수량에 안 물든다", () => {
  // 같은 모델의 접수 건 셋 · 그 건들에서 나온 부품 수량 18개.
  const cases = [
    caseRow({ reportedSymptom: "출력 저하", endUserName: "가 연구소", billingType: "PAID" }),
    caseRow({ reportedSymptom: "출력 저하", endUserName: "가 연구소", billingType: "PAID" }),
    caseRow({ reportedSymptom: "전원 인가 불가", endUserName: "나 공장", billingType: "WARRANTY" }),
  ];
  const partRows = [
    part(cases[0].id, "가 기판 (AA000111)", 5),
    part(cases[0].id, "나 기판 (AA000222)", 5),
    part(cases[1].id, "다 트랜스 (AA000333)", 3),
    part(cases[2].id, "라 기판 (AA000444)", 5),
  ];

  assert.equal(buildFaultPartBreakdown(partRows).total, 18, "표본이 비었다 — 수량이 실려야 한다");
  // 🔴 셋 다 **건수**다. 부품 수량이 어떻든 3 이어야 한다.
  for (const breakdown of [
    buildSymptomBreakdown(cases),
    buildEndUserBreakdown(cases),
    buildBillingBreakdown(cases),
  ]) {
    assert.equal(breakdown.total, 3, "접수 건 수가 아닌 수로 세고 있다");
    assert.equal(sumCounts(breakdown.slices), 3);
  }
  // 조각 하나하나도 건수다 — 「출력 저하」는 2건이지 10개가 아니다.
  assert.deepEqual(
    buildSymptomBreakdown(cases).slices.map((slice) => [slice.label, slice.count]),
    [
      ["출력 저하", 2],
      ["전원 인가 불가", 1],
    ]
  );
});

/**
 * ============================================================================
 * 🔴 **못 센 건이 있으면 그 사실이 글자로 나와야 한다** (2026-10-29)
 * ============================================================================
 * 반출 확인된 부품만 「일부만 받아 오는」 일이 생긴다(수리 건마다 재고 관리에 한 번씩
 * 묻는다 — `server/product-model-issued-parts.ts`). 조용히 적은 수를 보여 주면
 * 「이 모델은 이 부품이 적게 고장난다」는 틀린 결론이 나온다.
 *
 * 🔵 **수가 글자에 실제로 박히는지**까지 본다 — 「문장이 있다」만 재면 예산을 3초로
 *    고쳐도 「5초」라고 적힌 옛 문장이 영영 통과한다.
 *
 * ── 🔴 **2026-10-29: 끊는 자가 건수에서 시간으로 바뀌었다** ──────────────
 * 전에는 「수리 건이 **상한(40건)**을 넘으면 한 건도 안 센다」였고 그 말이 아래 시험
 * 이름에도 적혀 있었다. 사용자가 「상한 없이 불러올 수 있도록 해줘」로 정하면서 그 설계가
 * 통째로 사라졌다 — 옛 이름은 아래 각 시험에 **인용**으로 남겨 둔다.
 * ============================================================================
 */
test("🔴 다 셌으면 아무 말도 안 한다 — 늘 떠 있는 안내는 아무도 안 읽는다", () => {
  assert.equal(
    faultPartIssuedWarning({ uncountedCaseCount: 0, timedOutCaseCount: 0, timeBudgetMs: 5000 }),
    null
  );
  // 반출을 안 묻는 화면(또는 아직 안 물은 상태)도 조용하다.
  assert.equal(faultPartIssuedWarning(null), null);
});

test("🔴 못 받아 온 건이 있으면 **그 수**와 「적다」는 말이 함께 나온다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 3,
    timedOutCaseCount: 0,
    timeBudgetMs: 5000,
  });
  assert.ok(message, "못 센 건이 있는데 화면이 아무 말도 안 한다");
  assert.ok(message.includes("3건"), `못 센 수가 글자에 없다: ${message}`);
  assert.ok(message.includes("받아오지 못했습니다"), message);
  // 🔴 「없다」로 읽히면 안 된다 — 수가 실제보다 적다는 말이 반드시 들어간다.
  assert.ok(message.includes("적습니다"), message);
});

/**
 * 🔴 옛 이름: 「상한을 넘겨 **아예 안 센** 것은 다른 말이다 — 건수와 **상한**이 둘 다
 * 적힌다」. 지금은 상한이 없고, 같은 자리에 「**시간이 모자라 못 물어봤다**」가 선다.
 */
test("🔴 시간이 모자라 못 물어본 것은 **다른 말**이다 — 건수와 예산이 둘 다 적힌다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 0,
    timedOutCaseCount: 29,
    timeBudgetMs: 5000,
  });
  assert.ok(message, "못 물어본 건이 있는데 화면이 아무 말도 안 한다");
  assert.ok(message.includes("29건"), `못 물어본 건수가 글자에 없다: ${message}`);
  assert.ok(message.includes("5초"), `예산이 글자에 없다 — 상수를 고쳐도 안 바뀐다: ${message}`);
  // 🔴 사람이 **무엇을 하면 되는지**가 적혀 있어야 한다. 이 갈래는 저쪽이 늦은 것이라
  //    조금 뒤에 다시 열면 채워진다 — 그 말이 없으면 「고장났다」로 읽는다.
  assert.ok(message.includes("새로고침"), message);
  assert.ok(message.includes("적습니다"), message);
  // 🔴 「못 받아 왔다」와 섞이면 고칠 자리를 못 찾는다(저쪽이 늦은 것 ↔ 답을 못 준 것).
  assert.equal(message.includes("받아오지 못했습니다"), false, message);
});

test("🔵 예산이 떨어진 값이면 초도 떨어져 적힌다 — 밀리초를 그대로 적지 않는다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 0,
    timedOutCaseCount: 1,
    timeBudgetMs: 4500,
  });
  assert.ok(message?.includes("4.5초"), message ?? "(없음)");
  assert.equal(message?.includes("4500"), false, message ?? "(없음)");
});

/**
 * 🔴 **설계가 뒤집힌 자리다**(2026-10-29). 옛 이름은 「둘 다 0 이 아니면 **아예 안 셌다**는
 * 쪽이 이긴다 — 더 큰 사실이 가려지면 안 된다」였고, 그때는 상한에 걸리면 한 건도 안
 * 물어봐서 다른 쪽이 **반드시 0** 이었다(그래서 하나만 골라 적어도 잃는 것이 없었다).
 * 시간으로 끊는 지금은 **몇 건이 실패한 뒤 예산이 끝나는 상태**가 실제로 생기므로, 하나를
 * 고르면 나머지 하나가 조용히 사라진다.
 */
test("🔴 둘 다 0 이 아니면 **둘 다 적는다** — 하나를 고르면 나머지가 사라진다", () => {
  const message = faultPartIssuedWarning({
    uncountedCaseCount: 2,
    timedOutCaseCount: 29,
    timeBudgetMs: 5000,
  });
  assert.ok(message, "둘 다 못 셌는데 화면이 아무 말도 안 한다");
  assert.ok(message.includes("29건"), message);
  assert.ok(message.includes("2건"), message);
  assert.ok(message.includes("받아오지 못했습니다"), message);
  // 🔵 더 큰 사실(아예 못 물어본 건)이 앞에 선다.
  assert.ok(
    message.indexOf("물어보지 못했습니다") < message.indexOf("받아오지 못했습니다"),
    message
  );
});
