import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAULT_SYMPTOM_OTHER_LABEL,
  FAULT_SYMPTOM_TOP_SLICE_LIMIT,
  FAULT_SYMPTOM_UNSPECIFIED_LABEL,
  buildFaultSymptomBreakdowns,
  formatFaultSymptomSliceLabel,
  type FaultSymptomCase,
  type FaultSymptomKindBreakdown,
  type FaultSymptomSlice,
} from "./fault-symptom-breakdown";
import type { WorkflowType } from "./types";

/**
 * 이 시험이 지키는 것은 두 가지다.
 *   1) **조각 건수의 합 = 그 종류의 총 대수.** 미입력을 버리거나 기타를 잘못
 *      접으면 이 등식이 먼저 깨진다.
 *   2) **각도의 합 = 360.** 비율(%)을 반올림해 각도로 쓰면 여기서 드러난다.
 *
 * 시험 데이터는 mock-data.ts 를 끌어오지 않고 여기서 손으로 만든다 — 그쪽이
 * 바뀌었을 때 이 시험이 엉뚱한 이유로 깨지면 안 된다.
 */

function row(
  workflowType: WorkflowType,
  reportedSymptom: string | null,
  intakeInspectionResult: string | null = null
): FaultSymptomCase {
  return { workflowType, reportedSymptom, intakeInspectionResult };
}

/** RFG 쪽 건 하나 — 종류를 신경 쓰지 않는 시험이 쓰는 지름길. */
function rfg(
  reportedSymptom: string | null,
  intakeInspectionResult: string | null = null
): FaultSymptomCase {
  return row("PAID_GENERATOR", reportedSymptom, intakeInspectionResult);
}

// assert.ok 로 좁히지 않고 직접 던진다 — 타입 좁히기를 단언 함수에 기대면
// 실패했을 때 어느 줄에서 무엇이 없었는지가 메시지에 남지 않는다.
function byKind(
  breakdowns: FaultSymptomKindBreakdown[],
  kind: "RFG" | "MB"
): FaultSymptomKindBreakdown {
  const found = breakdowns.find((b) => b.kind === kind);
  if (!found) throw new Error(`${kind} 종류가 결과에 없다`);
  return found;
}

function sumCounts(breakdown: FaultSymptomKindBreakdown): number {
  return breakdown.slices.reduce((acc, slice) => acc + slice.count, 0);
}

function findSlice(
  breakdown: FaultSymptomKindBreakdown,
  label: string
): FaultSymptomSlice | undefined {
  return breakdown.slices.find((slice) => slice.label === label);
}

function requireSlice(breakdown: FaultSymptomKindBreakdown, label: string): FaultSymptomSlice {
  const slice = findSlice(breakdown, label);
  if (!slice) throw new Error(`'${label}' 조각이 없다`);
  return slice;
}

// ─────────────────────────────────────────────── 합이 맞는가

test("조각 건수의 합은 그 종류의 총 대수와 같다 — 미입력도 포함해서", () => {
  const breakdowns = buildFaultSymptomBreakdowns([
    rfg("전원 인가 불가"),
    rfg("전원 인가 불가"),
    rfg("출력 저하"),
    rfg(null),
    rfg("   "),
    row("PAID_MATCHER", "튜닝 불량"),
    row("PAID_MATCHER", null),
  ]);

  const rfgBreakdown = byKind(breakdowns, "RFG");
  assert.equal(rfgBreakdown.total, 5);
  assert.equal(sumCounts(rfgBreakdown), 5);

  const mbBreakdown = byKind(breakdowns, "MB");
  assert.equal(mbBreakdown.total, 2);
  assert.equal(sumCounts(mbBreakdown), 2);
});

test("건이 아주 많고 종류도 많아도 조각 합은 총 대수를 벗어나지 않는다", () => {
  // 12종 × 서로 다른 건수 + 미입력 3건. 기타로 접힌 뒤에도 합이 맞아야 한다.
  const cases: FaultSymptomCase[] = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let n = 0; n < i; n += 1) cases.push(rfg(`증상 ${String(i).padStart(2, "0")}`));
  }
  cases.push(rfg(null), rfg(""), rfg("\n  \t "));

  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");
  assert.equal(breakdown.total, 78 + 3);
  assert.equal(sumCounts(breakdown), breakdown.total);
});

// ─────────────────────────────────────────────── 미입력

test("null · 빈 문자열 · 공백뿐인 값은 전부 미입력 한 조각으로 모인다", () => {
  const breakdown = byKind(
    buildFaultSymptomBreakdowns([rfg(null), rfg(""), rfg("   "), rfg("\t\n")]),
    "RFG"
  );

  assert.equal(breakdown.slices.length, 1);
  const slice = breakdown.slices[0];
  assert.equal(slice.label, FAULT_SYMPTOM_UNSPECIFIED_LABEL);
  assert.equal(slice.sliceKind, "UNSPECIFIED");
  assert.equal(slice.count, 4);
});

test("미입력은 건수가 가장 적어도 기타로 접히지 않는다", () => {
  // 증상 9종(각 5건) + 미입력 1건. 9종이므로 상위 8 + 기타가 되는데,
  // 미입력은 그 셈에 들어가지 않고 따로 남아야 한다.
  const cases: FaultSymptomCase[] = [];
  for (let i = 1; i <= 9; i += 1) {
    for (let n = 0; n < 5; n += 1) cases.push(rfg(`증상 ${i}`));
  }
  cases.push(rfg(null));

  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");

  const unspecified = requireSlice(breakdown, FAULT_SYMPTOM_UNSPECIFIED_LABEL);
  assert.equal(unspecified.count, 1);
  assert.equal(unspecified.sliceKind, "UNSPECIFIED");

  // 기타에는 9번째 증상만 들어간다 — 미입력이 섞이면 6건이 된다.
  const other = requireSlice(breakdown, FAULT_SYMPTOM_OTHER_LABEL);
  assert.equal(other.count, 5);
  assert.equal(other.foldedSymptomCount, 1);
});

// ─────────────────────────────────────────────── 글자 다듬기

test("앞뒤 공백만 다른 두 값은 같은 조각이 된다", () => {
  const breakdown = byKind(
    buildFaultSymptomBreakdowns([
      rfg("전원 인가 불가"),
      rfg(" 전원 인가 불가 "),
      rfg("\t전원 인가 불가\n"),
    ]),
    "RFG"
  );

  assert.equal(breakdown.slices.length, 1);
  // 이름표는 다듬은 원문 그대로다 — 가운데 공백을 건드리지 않는다.
  assert.equal(breakdown.slices[0].label, "전원 인가 불가");
  assert.equal(breakdown.slices[0].count, 3);
});

// ─────────────────────────────────────────────── 차례와 접기

test("차례는 건수 많은 순, 같으면 이름 오름차순이다", () => {
  const breakdown = byKind(
    buildFaultSymptomBreakdowns([
      rfg("나 증상"),
      rfg("나 증상"),
      rfg("가 증상"),
      rfg("다 증상"),
      rfg("가 증상"),
    ]),
    "RFG"
  );

  assert.deepEqual(
    breakdown.slices.map((s) => [s.label, s.count]),
    [
      ["가 증상", 2],
      ["나 증상", 2],
      ["다 증상", 1],
    ]
  );
});

test("9종 이상이면 상위 8 + 기타이고, 접힌 종류 수가 함께 나온다", () => {
  // 증상 i 를 (20 - i)건씩 — 1번이 가장 많고 12번이 가장 적다.
  const cases: FaultSymptomCase[] = [];
  for (let i = 1; i <= 12; i += 1) {
    for (let n = 0; n < 20 - i; n += 1) cases.push(rfg(`증상 ${String(i).padStart(2, "0")}`));
  }

  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");

  assert.equal(breakdown.slices.length, FAULT_SYMPTOM_TOP_SLICE_LIMIT + 1);
  const other = breakdown.slices[breakdown.slices.length - 1];
  assert.equal(other.label, FAULT_SYMPTOM_OTHER_LABEL);
  assert.equal(other.sliceKind, "OTHER");
  // 9 · 10 · 11 · 12번이 접혔다 = 4종, 11 + 10 + 9 + 8 = 38건.
  assert.equal(other.foldedSymptomCount, 4);
  assert.equal(breakdown.otherDistinctCount, 4);
  assert.equal(other.count, 38);
  assert.equal(sumCounts(breakdown), breakdown.total);
});

test("정확히 8종이면 접지 않는다 — 기타 조각이 생기지 않는다", () => {
  const cases: FaultSymptomCase[] = [];
  for (let i = 1; i <= 8; i += 1) cases.push(rfg(`증상 ${i}`));

  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");

  assert.equal(breakdown.slices.length, 8);
  assert.equal(breakdown.otherDistinctCount, 0);
  assert.equal(findSlice(breakdown, FAULT_SYMPTOM_OTHER_LABEL), undefined);
});

// ─────────────────────────────────────────────── RFG / MB 가르기

test("RFG · MB 가르기는 주간보고 규칙을 그대로 따른다", () => {
  const breakdowns = buildFaultSymptomBreakdowns([
    row("PAID_MATCHER", "매처"),
    row("PAID_GENERATOR", "제너레이터"),
    row("PAID_TOTAL_CONTROLLER", "토탈 컨트롤러"),
  ]);

  const rfgBreakdown = byKind(breakdowns, "RFG");
  const mbBreakdown = byKind(breakdowns, "MB");

  // Total Controller 는 RFG 로 접힌다(weekly-report.ts 의 판단).
  assert.equal(rfgBreakdown.total, 2);
  assert.deepEqual(
    rfgBreakdown.slices.map((s) => s.label).sort((a, b) => a.localeCompare(b, "ko")),
    ["제너레이터", "토탈 컨트롤러"]
  );
  assert.equal(mbBreakdown.total, 1);
  assert.equal(mbBreakdown.slices[0].label, "매처");
});

test("건이 하나도 없는 종류도 총 0 으로 자리를 지킨다", () => {
  const breakdowns = buildFaultSymptomBreakdowns([row("WARRANTY_MATCHER", "튜닝 불량")]);

  assert.equal(breakdowns.length, 2);
  const rfgBreakdown = byKind(breakdowns, "RFG");
  assert.equal(rfgBreakdown.total, 0);
  assert.deepEqual(rfgBreakdown.slices, []);
  assert.equal(rfgBreakdown.otherDistinctCount, 0);
});

test("목록이 통째로 비어도 두 종류가 총 0 으로 돌아온다", () => {
  const breakdowns = buildFaultSymptomBreakdowns([]);
  assert.deepEqual(
    breakdowns.map((b) => [b.kind, b.total, b.slices.length]),
    [
      ["RFG", 0, 0],
      ["MB", 0, 0],
    ]
  );
});

// ─────────────────────────────────────────────── 인수점검 결과

test("조각마다 인수점검 결과가 같은 글끼리 묶이고, 비어 있는 건은 따로 세어진다", () => {
  const breakdown = byKind(
    buildFaultSymptomBreakdowns([
      rfg("전원 인가 불가", "메인 PCB 소손"),
      rfg("전원 인가 불가", " 메인 PCB 소손 "),
      rfg("전원 인가 불가", "퓨즈 단선"),
      rfg("전원 인가 불가", null),
      rfg("전원 인가 불가", "   "),
      rfg("출력 저하", "RF 모듈 열화"),
    ]),
    "RFG"
  );

  const slice = requireSlice(breakdown, "전원 인가 불가");
  assert.equal(slice.count, 5);
  // 건수 많은 순 → 이름 오름차순.
  assert.deepEqual(slice.intakeInspectionResults, [
    { result: "메인 PCB 소손", count: 2 },
    { result: "퓨즈 단선", count: 1 },
  ]);
  // null 과 공백뿐인 값은 묶음에 섞이지 않고 '점검 전'으로만 세어진다.
  assert.equal(slice.intakeInspectionPendingCount, 2);

  // 묶음 건수 + 점검 전 건수 = 조각 건수.
  const grouped = slice.intakeInspectionResults.reduce((acc, g) => acc + g.count, 0);
  assert.equal(grouped + slice.intakeInspectionPendingCount, slice.count);
});

test("기타 · 미입력 조각도 인수점검 결과를 갖는다 — 접힌 증상들의 결과가 합쳐진다", () => {
  const cases: FaultSymptomCase[] = [];
  for (let i = 1; i <= 8; i += 1) {
    for (let n = 0; n < 10; n += 1) cases.push(rfg(`증상 ${i}`, "상위 결과"));
  }
  // 9번째·10번째 증상이 기타로 접힌다. 둘 다 같은 결과 글을 쓴다.
  cases.push(rfg("증상 9", "커넥터 접촉 불량"));
  cases.push(rfg("증상 10", "커넥터 접촉 불량"));
  cases.push(rfg("증상 10", null));
  // 미입력 조각에도 결과가 붙는다.
  cases.push(rfg(null, "외관 파손"));
  cases.push(rfg("  ", null));

  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");

  const other = requireSlice(breakdown, FAULT_SYMPTOM_OTHER_LABEL);
  assert.equal(other.foldedSymptomCount, 2);
  assert.deepEqual(other.intakeInspectionResults, [{ result: "커넥터 접촉 불량", count: 2 }]);
  assert.equal(other.intakeInspectionPendingCount, 1);

  const unspecified = requireSlice(breakdown, FAULT_SYMPTOM_UNSPECIFIED_LABEL);
  assert.deepEqual(unspecified.intakeInspectionResults, [{ result: "외관 파손", count: 1 }]);
  assert.equal(unspecified.intakeInspectionPendingCount, 1);
});

// ─────────────────────────────────────────────── 이름표

test("기타 이름표에는 접힌 종류 수가 붙고, 나머지는 원문 그대로다", () => {
  const cases: FaultSymptomCase[] = [];
  for (let i = 1; i <= 11; i += 1) {
    for (let n = 0; n < 20 - i; n += 1) cases.push(rfg(`증상 ${String(i).padStart(2, "0")}`));
  }
  cases.push(rfg(null));

  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");

  assert.equal(
    formatFaultSymptomSliceLabel(requireSlice(breakdown, FAULT_SYMPTOM_OTHER_LABEL)),
    "기타(3종)"
  );
  assert.equal(
    formatFaultSymptomSliceLabel(requireSlice(breakdown, FAULT_SYMPTOM_UNSPECIFIED_LABEL)),
    "미입력"
  );
  assert.equal(formatFaultSymptomSliceLabel(requireSlice(breakdown, "증상 01")), "증상 01");
});

// ─────────────────────────────────────────────── 각도

test("각도의 합은 360 이고, 조각은 앞 조각이 끝난 자리에서 시작한다", () => {
  // 3 · 3 · 1 — 어떻게 나눠도 딱 떨어지지 않는 건수라서 반올림 오차가 드러난다.
  const cases = [
    rfg("가"),
    rfg("가"),
    rfg("가"),
    rfg("나"),
    rfg("나"),
    rfg("나"),
    rfg("다"),
  ];
  const breakdown = byKind(buildFaultSymptomBreakdowns(cases), "RFG");

  const sweepSum = breakdown.slices.reduce((acc, s) => acc + s.sweepAngle, 0);
  assert.ok(Math.abs(sweepSum - 360) < 1e-9, `각도 합이 360 이 아니다: ${sweepSum}`);

  assert.equal(breakdown.slices[0].startAngle, 0);
  for (let i = 1; i < breakdown.slices.length; i += 1) {
    const prev = breakdown.slices[i - 1];
    const gap = breakdown.slices[i].startAngle - (prev.startAngle + prev.sweepAngle);
    assert.ok(Math.abs(gap) < 1e-9, `${i}번째 조각 앞에 틈이 있다: ${gap}`);
  }
});

test("조각이 하나뿐이면 그 조각이 360 도를 차지한다", () => {
  const breakdown = byKind(buildFaultSymptomBreakdowns([rfg("전원 인가 불가")]), "RFG");
  assert.equal(breakdown.slices.length, 1);
  assert.equal(breakdown.slices[0].startAngle, 0);
  assert.equal(breakdown.slices[0].sweepAngle, 360);
  assert.equal(breakdown.slices[0].percentage, 100);
});

test("반올림한 비율의 합이 100 이 아닐 수 있다 — 각도는 그 값을 쓰지 않는다", () => {
  // 1건씩 3종 = 33.3% × 3 = 99.9%. 억지로 100 을 맞추지 않는 것이 이 시험의 뜻이다.
  const breakdown = byKind(
    buildFaultSymptomBreakdowns([rfg("가"), rfg("나"), rfg("다")]),
    "RFG"
  );
  const percentSum = breakdown.slices.reduce((acc, s) => acc + s.percentage, 0);
  assert.equal(Math.round(percentSum * 10) / 10, 99.9);

  const sweepSum = breakdown.slices.reduce((acc, s) => acc + s.sweepAngle, 0);
  assert.ok(Math.abs(sweepSum - 360) < 1e-9, `각도 합이 360 이 아니다: ${sweepSum}`);
});
