import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAULT_SYMPTOM_ALL_PERIOD,
  FAULT_SYMPTOM_OTHER_LABEL,
  FAULT_SYMPTOM_PERIOD_MONTHS,
  FAULT_SYMPTOM_TOP_SLICE_LIMIT,
  FAULT_SYMPTOM_UNSPECIFIED_LABEL,
  buildFaultSymptomBreakdowns,
  formatFaultSymptomPeriodLabel,
  formatFaultSymptomSliceLabel,
  listFaultSymptomYears,
  selectFaultSymptomPeriodCases,
  type FaultSymptomCase,
  type FaultSymptomKindBreakdown,
  type FaultSymptomPeriod,
  type FaultSymptomPeriodCase,
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

// ══════════════════════════════════════════════ 기간 고르기(연도·월)
//
// 이 아래가 지키는 것은 세 가지다.
//   1) **전체면 한 건도 걸러지지 않는다.** 기간을 고르기 전 화면이 예전 그대로라는
//      보장이다.
//   2) **시간대가 하루를 밀지 못한다.** 1월 1일 건이 전 해로 잡히는 고장은
//      new Date(문자열) 로 파싱하는 순간 조용히 생긴다.
//   3) **거른 뒤에도 조각 건수의 합 = 총 대수.** 위쪽 시험이 지키는 불변식이
//      기간을 걸어도 성립해야 한다.

/**
 * 인수일과 세는 쪽 칸을 함께 갖는 건 하나 — 화면이 넘기는 행이 그렇다. 거른
 * 배열을 그대로 buildFaultSymptomBreakdowns 에 넘길 수 있는지도 이것으로 본다.
 */
function dated(
  receivedAt: string | null,
  reportedSymptom: string | null = "전원 인가 불가",
  workflowType: WorkflowType = "PAID_GENERATOR"
): FaultSymptomCase & FaultSymptomPeriodCase {
  return { receivedAt, workflowType, reportedSymptom, intakeInspectionResult: null };
}

function receivedDates(cases: readonly FaultSymptomPeriodCase[]): (string | null)[] {
  return cases.map((row) => row.receivedAt);
}

/**
 * 시간대를 잠깐 바꿔 그 안에서 돌린다. 되돌리는 일은 finally 가 맡는다 — 여기서
 * 새는 값이 남으면 뒤따르는 시험이 엉뚱한 이유로 깨진다.
 */
function withTimeZone<T>(timeZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

// ─────────────────────────────────────────────── 연도 목록

test("연도 목록은 최근 해가 먼저 오고, 같은 해가 두 번 나오지 않는다", () => {
  assert.deepEqual(
    listFaultSymptomYears([
      dated("2024-05-01"),
      dated("2026-01-31"),
      dated("2024-12-31"),
      dated("2025-07-07"),
      dated("2026-06-06"),
    ]),
    [2026, 2025, 2024]
  );
});

test("접수 건이 없는 해는 연도 목록에 나오지 않는다", () => {
  // 2025년 건이 하나도 없다 — 사이가 비어 있다고 그 해를 만들어 내지 않는다.
  assert.deepEqual(listFaultSymptomYears([dated("2024-05-01"), dated("2026-01-31")]), [2026, 2024]);
  assert.deepEqual(listFaultSymptomYears([]), []);
});

// ─────────────────────────────────────────────── 거르기

test("전체(연도 null)면 한 건도 걸러지지 않는다", () => {
  // 인수일을 읽을 수 없는 건까지 그대로 남는다 — 전체는 말 그대로 전체다.
  const cases = [
    dated("2026-03-01"),
    dated("2025-12-31"),
    dated(""),
    dated(null),
    dated("2026/03/02"),
  ];

  const picked = selectFaultSymptomPeriodCases(cases, FAULT_SYMPTOM_ALL_PERIOD);
  assert.equal(picked.length, cases.length);
  assert.deepEqual(picked, cases);
});

test("연도만 고르면 그 해 열두 달이 전부 남는다", () => {
  const cases: (FaultSymptomCase & FaultSymptomPeriodCase)[] = [];
  for (const month of FAULT_SYMPTOM_PERIOD_MONTHS) {
    cases.push(dated(`2026-${String(month).padStart(2, "0")}-15`));
  }
  cases.push(dated("2025-06-15"), dated("2027-06-15"));

  const picked = selectFaultSymptomPeriodCases(cases, { year: 2026, month: null });
  assert.equal(picked.length, 12);
  assert.deepEqual(
    receivedDates(picked),
    FAULT_SYMPTOM_PERIOD_MONTHS.map((month) => `2026-${String(month).padStart(2, "0")}-15`)
  );
});

test("연도와 월을 고르면 그 달만 남는다", () => {
  const cases = [
    dated("2026-02-28"),
    dated("2026-03-01"),
    dated("2026-03-31"),
    dated("2026-04-01"),
    dated("2025-03-15"),
  ];

  assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: 3 })), [
    "2026-03-01",
    "2026-03-31",
  ]);
});

test("월 목록은 자료와 무관하게 1~12월 전부다", () => {
  // 있는 달만 보여 주면 '그 달에 0건'과 '고를 수조차 없음'이 구별되지 않는다.
  assert.deepEqual([...FAULT_SYMPTOM_PERIOD_MONTHS], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

// ─────────────────────────────────────────────── 시간대가 하루를 밀지 못한다

test("1월 1일과 12월 31일은 UTC 뒤쪽 시간대에서도 제 해·제 달로 잡힌다", () => {
  // 함정을 재현해 놓고 시험한다: new Date("2026-01-01") 은 UTC 자정이라 뉴욕에서는
  // 2025-12-31 19:00 이고, 거기서 getFullYear() 를 부르면 2025 가 나온다. 인수일을
  // Date 로 파싱하는 구현으로 되돌아가면 이 시험이 먼저 깨진다.
  withTimeZone("America/New_York", () => {
    assert.equal(
      new Date("2026-01-01").getFullYear(),
      2025,
      "시간대를 바꾸지 못했다면 이 시험은 아무것도 지키지 못한다"
    );

    const cases = [
      dated("2026-01-01"),
      dated("2026-12-31"),
      dated("2025-12-31"),
      dated("2027-01-01"),
    ];

    assert.deepEqual(listFaultSymptomYears(cases), [2027, 2026, 2025]);
    assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: null })), [
      "2026-01-01",
      "2026-12-31",
    ]);
    assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: 1 })), [
      "2026-01-01",
    ]);
    assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: 12 })), [
      "2026-12-31",
    ]);
  });
});

// ─────────────────────────────────────────────── 읽을 수 없는 인수일

test("인수일이 비었거나 꼴이 어긋난 건은 전체에만 남고 특정 연도·월에는 들어가지 않는다", () => {
  // 어느 달의 건인지 말할 수 없는 것을 어느 달에 끼워 넣으면 그 달의 숫자가
  // 거짓이 된다. 대신 연도별 건수를 다 더한 값이 전체보다 작아진다.
  const cases = [
    dated("2026-03-01"),
    dated(""),
    dated("   "),
    dated(null),
    dated("2026/03/02"),
    dated("2026-13-05"),
    dated("26-03-03"),
  ];

  assert.deepEqual(listFaultSymptomYears(cases), [2026]);
  assert.equal(selectFaultSymptomPeriodCases(cases, FAULT_SYMPTOM_ALL_PERIOD).length, 7);
  assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: null })), [
    "2026-03-01",
  ]);
  assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: 3 })), [
    "2026-03-01",
  ]);
});

test("인수일 뒤에 시각이 붙어 있어도 앞머리의 날짜를 읽는다", () => {
  const cases = [dated("2026-03-01T23:30:00Z"), dated("2026-04-01T00:00:00+09:00")];
  assert.deepEqual(listFaultSymptomYears(cases), [2026]);
  assert.deepEqual(receivedDates(selectFaultSymptomPeriodCases(cases, { year: 2026, month: 3 })), [
    "2026-03-01T23:30:00Z",
  ]);
});

// ─────────────────────────────────────────────── 연도 없이 월만은 없다

test("연도가 전체면 월은 아예 보지 않는다 — 타입이 막고, 억지로 넣어도 무시된다", () => {
  const cases = [dated("2026-03-01"), dated("2026-04-01")];

  // @ts-expect-error 연도 없이 월만 정한 기간은 유니온이 거부한다. 이 줄이 오류를 내지 않게 되면 그 방어가 무너진 것이다.
  const impossible: FaultSymptomPeriod = { year: null, month: 3 };

  assert.equal(selectFaultSymptomPeriodCases(cases, impossible).length, 2);
});

// ─────────────────────────────────────────────── 거른 뒤에도 합이 맞는가

test("기간으로 거른 배열을 넘겨도 조각 건수의 합은 그 종류의 총 대수와 같다", () => {
  const cases = [
    dated("2026-03-01", "전원 인가 불가"),
    dated("2026-03-15", "전원 인가 불가"),
    dated("2026-03-20", null),
    dated("2026-03-31", "출력 저하"),
    dated("2026-04-01", "출력 저하"),
    dated("2025-03-05", "출력 저하"),
    dated("", "출력 저하"),
    dated("2026-03-02", "튜닝 불량", "PAID_MATCHER"),
  ];

  const march = selectFaultSymptomPeriodCases(cases, { year: 2026, month: 3 });
  assert.equal(march.length, 5);

  const breakdowns = buildFaultSymptomBreakdowns(march);

  const rfgBreakdown = byKind(breakdowns, "RFG");
  assert.equal(rfgBreakdown.total, 4);
  assert.equal(sumCounts(rfgBreakdown), 4);
  // 미입력 건은 기간을 걸었다고 사라지지 않는다 — 버리면 합이 총 대수와 어긋난다.
  assert.equal(requireSlice(rfgBreakdown, FAULT_SYMPTOM_UNSPECIFIED_LABEL).count, 1);

  const mbBreakdown = byKind(breakdowns, "MB");
  assert.equal(mbBreakdown.total, 1);
  assert.equal(sumCounts(mbBreakdown), 1);
});

test("건이 하나도 남지 않는 기간을 골라도 두 종류가 총 0 으로 자리를 지킨다", () => {
  const march2020 = selectFaultSymptomPeriodCases([dated("2026-03-01")], { year: 2020, month: 3 });
  assert.deepEqual(march2020, []);
  assert.deepEqual(
    buildFaultSymptomBreakdowns(march2020).map((b) => [b.kind, b.total, b.slices.length]),
    [
      ["RFG", 0, 0],
      ["MB", 0, 0],
    ]
  );
});

// ─────────────────────────────────────────────── 기간 이름표

test("걸린 기간은 사람이 읽는 한 마디로 나간다", () => {
  assert.equal(formatFaultSymptomPeriodLabel(FAULT_SYMPTOM_ALL_PERIOD), "전체 기간");
  assert.equal(formatFaultSymptomPeriodLabel({ year: 2026, month: null }), "2026년");
  assert.equal(formatFaultSymptomPeriodLabel({ year: 2026, month: 3 }), "2026년 3월");
  assert.equal(formatFaultSymptomPeriodLabel({ year: 2026, month: 12 }), "2026년 12월");
});
