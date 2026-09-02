import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WEEKLY_REPORT_STATUSES,
  buildWeeklyReport,
  classifyWeeklyReportStatus,
  foldWeeklyReportKind,
  hasWeeklyReportPoIssued,
  isExcludedFromWeeklyReport,
  pairWeeklyReportBlocksByCustomer,
  pickWeeklyReportOrderDates,
  summarizeWeeklyReportPoIssuance,
  sumWeeklyReportStatusCounts,
  weeklyReportStatusLabels,
  type WeeklyReportCase,
} from "./weekly-report";
import { isLongPendingPo } from "./long-pending-po";
import { WORKFLOW_TYPE_CODES, type RepairStatus, type WorkflowType } from "./types";

/**
 * 이 파일이 지키려는 것은 둘이다 — **승인된 매핑표가 코드와 같다**, 그리고
 * **총 대수는 언제나 6칸의 합이다.**
 *
 * 6칸 중 하나는 상태만으로 갈리지 않고(점검 대기/점검 중은 인수점검 기록으로
 * 갈린다), PO 발행 완료는 아예 칸이 아니라 **그 위에 겹쳐 세는 값**이다. 이
 * 두 가지가 조용히 뒤집히면 화면의 숫자는 여전히 그럴듯해 보이는데 뜻이
 * 달라지므로, 칸마다 한 건씩 못 박아 둔다.
 */

/**
 * 이 시험이 말하는 "오늘" — 2026-08-25 14:00 KST. 한국 날짜와 UTC 날짜가 둘 다
 * 08-25 라 경계가 아니다(long-pending-po.test.ts 와 같은 값·같은 이유).
 *
 * buildWeeklyReport 가 `now` 를 **받는** 까닭이 이것이다: 도메인 안에서
 * new Date() 를 부르면 아래 시험들의 결과가 **돌리는 날**에 따라 달라져,
 * 아무것도 고치지 않은 두 달 뒤에 갑자기 깨진다.
 */
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

/**
 * 아래 시험이 부르는 buildWeeklyReport — "오늘"을 못 박아 결정적으로 만든다.
 * 다른 날을 봐야 하는 시험만 두 번째 인자를 넘긴다.
 */
function buildAsOf(cases: readonly WeeklyReportCase[], now: Date = MIDDAY_KST) {
  return buildWeeklyReport(cases, now);
}

let sequence = 0;

function makeCase(overrides: Partial<WeeklyReportCase> = {}): WeeklyReportCase {
  sequence += 1;
  return {
    id: `case-${sequence}`,
    // 낙관적 잠금 값. 이 파일의 시험은 하나도 이 값을 보지 않지만(순수 함수의
    // 셈에는 들어오지 않는다), 타입에 **반드시 있는 값**이라 여기서도 채운다 —
    // 선택 값으로 두면 화면에 version 없는 줄이 생길 수 있고, 그 줄에서 누른
    // 저장은 남이 방금 고친 비고를 덮어쓴다(도메인 타입의 주석).
    version: 1,
    intakeNumber: `D2601${String(sequence).padStart(2, "0")}`,
    customerName: "INVENIA",
    customerRowColor: null,
    workflowType: "PAID_MATCHER",
    status: "IN_REPAIR",
    currentWorkflowStepKey: "repair_in_progress",
    hasIntakeInspectionRecord: false,
    modelName: "RFG-1000",
    serialNumber: "SN-1",
    lotNumber: "LN-1",
    quoteIssuedDate: null,
    orderIssuedDate: null,
    notes: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────── 6칸 매핑 (표 그대로)

test("매핑표의 6칸이 칸마다 한 건씩 그대로 나온다", () => {
  const cases: { expected: (typeof WEEKLY_REPORT_STATUSES)[number]; row: WeeklyReportCase }[] = [
    {
      expected: "INSPECTION_WAITING",
      row: makeCase({
        status: "WAITING_INTAKE_INSPECTION",
        currentWorkflowStepKey: "intake_inspection",
        hasIntakeInspectionRecord: false,
      }),
    },
    {
      expected: "INSPECTION_IN_PROGRESS",
      row: makeCase({
        status: "WAITING_INTAKE_INSPECTION",
        currentWorkflowStepKey: "intake_inspection",
        hasIntakeInspectionRecord: true,
      }),
    },
    {
      expected: "REPAIR_WAITING",
      row: makeCase({ status: "WAITING_PARTS_SUPPLY", currentWorkflowStepKey: "parts_supply" }),
    },
    {
      expected: "IN_REPAIR",
      row: makeCase({ status: "IN_REPAIR", currentWorkflowStepKey: "repair_in_progress" }),
    },
    {
      expected: "PO_WAITING",
      row: makeCase({ status: "WAITING_PO", currentWorkflowStepKey: "waiting_po" }),
    },
    {
      expected: "SHIPMENT_WAITING",
      row: makeCase({ status: "WAITING_SHIPMENT", currentWorkflowStepKey: "waiting_shipment" }),
    },
  ];

  for (const { expected, row } of cases) {
    assert.equal(
      classifyWeeklyReportStatus(row),
      expected,
      `${row.status}/${row.currentWorkflowStepKey} 는 ${weeklyReportStatusLabels[expected]} 이어야 한다`
    );
  }

  // 6칸을 하나도 빠뜨리지 않았는지 — 칸이 늘면 이 단언이 먼저 깨진다.
  assert.deepEqual(
    cases.map((entry) => entry.expected).sort(),
    [...WEEKLY_REPORT_STATUSES].sort()
  );
  assert.equal(WEEKLY_REPORT_STATUSES.length, 6, "상태는 여섯 칸뿐이다");
});

test("PO 발행 완료는 상태 칸이 아니다 — 6칸 목록에 없다", () => {
  // 다시 상태 목록으로 기어 들어오면 총 대수가 두 번 세어진다.
  assert.ok(
    !(WEEKLY_REPORT_STATUSES as readonly string[]).includes("PO_ISSUED"),
    "PO 발행 완료가 상태 목록에 있으면 안 된다"
  );
});

test("점검 대기와 점검 중은 인수점검 기록 하나로 갈린다", () => {
  const base = {
    status: "WAITING_INTAKE_INSPECTION" as RepairStatus,
    currentWorkflowStepKey: "intake_inspection",
  };
  assert.equal(
    classifyWeeklyReportStatus({ ...base, hasIntakeInspectionRecord: false }),
    "INSPECTION_WAITING"
  );
  assert.equal(
    classifyWeeklyReportStatus({ ...base, hasIntakeInspectionRecord: true }),
    "INSPECTION_IN_PROGRESS"
  );
});

test("waiting_po 와 po_received 는 둘 다 PO 대기 중이다 — 단계 키로 가르지 않는다", () => {
  const base = { status: "WAITING_PO" as RepairStatus, hasIntakeInspectionRecord: true };
  for (const stepKey of ["waiting_po", "po_received", "po_partially_received"]) {
    assert.equal(
      classifyWeeklyReportStatus({ ...base, currentWorkflowStepKey: stepKey }),
      "PO_WAITING",
      `${stepKey} 도 PO 대기 중이어야 한다`
    );
  }
});

test("부품 수급 대기와 수리 대기는 둘 다 수리 대기 칸으로 간다", () => {
  // 상태가 하나 늘었을 때 이 칸에 넣기로 정한 것이다(파일 헤더의 매핑표).
  // 여기가 없으면 수리 대기 건이 조용히 사라지지는 않아도 분류 안 됨으로 떨어진다.
  for (const status of ["WAITING_PARTS_SUPPLY", "WAITING_REPAIR"] as const) {
    assert.equal(
      classifyWeeklyReportStatus({
        status,
        currentWorkflowStepKey: "parts_supply",
        hasIntakeInspectionRecord: true,
      }),
      "REPAIR_WAITING",
      `${status} 는 수리 대기 칸이어야 한다`
    );
  }
});

test("인수점검 중·인수점검 완료는 둘 다 점검 중 칸으로 간다", () => {
  // 점검이 끝나 다음 지시를 기다리는 자리도 점검 중에 접기로 정했다(매핑표).
  for (const status of ["INTAKE_INSPECTION_IN_PROGRESS", "INTAKE_INSPECTION_COMPLETED"] as const) {
    assert.equal(
      classifyWeeklyReportStatus({
        status,
        currentWorkflowStepKey: "intake_inspection",
        hasIntakeInspectionRecord: false,
      }),
      "INSPECTION_IN_PROGRESS",
      `${status} 는 점검 중 칸이어야 한다 — 점검 기록이 아직 없어도 그렇다`
    );
  }
});

test("교산 회신 대기는 점검 중, 출하 승인 대기는 출하 대기로 함께 접힌다", () => {
  assert.equal(
    classifyWeeklyReportStatus({
      status: "WAITING_KYOSAN_REPLY",
      currentWorkflowStepKey: "waiting_kyosan_reply",
      hasIntakeInspectionRecord: false,
    }),
    "INSPECTION_IN_PROGRESS",
    "교산 회신을 기다리는 동안에도 그 장비는 점검대에 있다"
  );
  assert.equal(
    classifyWeeklyReportStatus({
      status: "WAITING_SHIPMENT_APPROVAL",
      currentWorkflowStepKey: "waiting_kyosan_shipment_approval",
      hasIntakeInspectionRecord: true,
    }),
    "SHIPMENT_WAITING"
  );
});

// ─────────────────────────────────────────────────── PO 발행 완료 (겹쳐 세는 값)

test("PO 발행 완료는 발주발행일 유무로만 갈린다 — 상태와 무관하다", () => {
  assert.equal(hasWeeklyReportPoIssued({ quoteIssuedDate: null, orderIssuedDate: null }), false);
  assert.equal(
    hasWeeklyReportPoIssued({ quoteIssuedDate: "2026-07-01", orderIssuedDate: null }),
    false,
    "견적만 나간 건은 PO 발행 완료가 아니다"
  );
  assert.equal(
    hasWeeklyReportPoIssued({ quoteIssuedDate: null, orderIssuedDate: "2026-07-28" }),
    true
  );

  // 어느 상태에 놓여 있든 발주발행일 하나로 갈린다.
  for (const status of [
    "WAITING_INTAKE_INSPECTION",
    "WAITING_KYOSAN_REPLY",
    "WAITING_PARTS_SUPPLY",
    "IN_REPAIR",
    "WAITING_PO",
    "WAITING_SHIPMENT",
    "WAITING_SHIPMENT_APPROVAL",
  ] as const) {
    const report = buildAsOf([
      makeCase({ status, orderIssuedDate: "2026-07-28" }),
      makeCase({ status, orderIssuedDate: null }),
    ]);
    assert.equal(report.total.poIssued, 1, `${status} 에서도 발주일이 있는 한 건만 세어진다`);
    assert.equal(report.total.total, 2, `${status} 의 총 대수는 그대로 2 다`);
  }
});

test("총 대수는 6칸의 합이고, PO 발행 완료는 거기 들어가지 않는다", () => {
  const report = buildAsOf([
    makeCase({ status: "WAITING_INTAKE_INSPECTION", currentWorkflowStepKey: "intake_inspection" }),
    makeCase({
      status: "WAITING_INTAKE_INSPECTION",
      currentWorkflowStepKey: "intake_inspection",
      hasIntakeInspectionRecord: true,
    }),
    makeCase({ status: "WAITING_KYOSAN_REPLY", currentWorkflowStepKey: "waiting_kyosan_reply" }),
    makeCase({ status: "WAITING_PARTS_SUPPLY", currentWorkflowStepKey: "parts_supply" }),
    makeCase({ status: "IN_REPAIR", currentWorkflowStepKey: "repair_in_progress" }),
    // PO 두 단계가 한 칸으로 모인다.
    makeCase({ status: "WAITING_PO", currentWorkflowStepKey: "waiting_po" }),
    makeCase({ status: "WAITING_PO", currentWorkflowStepKey: "po_received" }),
    makeCase({ status: "WAITING_SHIPMENT", currentWorkflowStepKey: "waiting_shipment" }),
    makeCase({
      status: "WAITING_SHIPMENT_APPROVAL",
      currentWorkflowStepKey: "waiting_kyosan_shipment_approval",
      // 출하 대기이면서 PO 발행 완료 — 원본의 D260602 가 이 경우다.
      orderIssuedDate: "2026-07-28",
    }),
  ]);

  assert.equal(report.total.total, 9);
  assert.equal(report.total.unclassified, 0);
  assert.equal(sumWeeklyReportStatusCounts(report.total), 9, "총 대수 = 6칸의 합");
  assert.deepEqual(report.total.byStatus, {
    INSPECTION_WAITING: 1,
    INSPECTION_IN_PROGRESS: 2,
    REPAIR_WAITING: 1,
    IN_REPAIR: 1,
    PO_WAITING: 2,
    SHIPMENT_WAITING: 2,
  });
  assert.equal(report.total.poIssued, 1, "겹쳐 세는 값은 따로 있다");
  assert.notEqual(
    sumWeeklyReportStatusCounts(report.total) + report.total.poIssued,
    report.total.total,
    "PO 발행 완료를 더하면 총 대수가 넘친다 — 그래서 더하지 않는다"
  );

  // 블록 하나뿐이므로 블록 집계도 같아야 한다.
  assert.equal(report.blocks.length, 1);
  assert.deepEqual(report.blocks[0].counts, report.total);
});

test("출하 대기인데 발주발행일이 있는 건은 출하 대기이면서 PO 발행 완료다", () => {
  // 원본의 D260602: 현 상태는 출하 대기, PO 발행 일시는 2026-07-28.
  const report = buildAsOf([
    makeCase({
      intakeNumber: "D260602",
      status: "WAITING_SHIPMENT",
      currentWorkflowStepKey: "waiting_shipment",
      orderIssuedDate: "2026-07-28",
    }),
  ]);

  assert.equal(report.total.byStatus.SHIPMENT_WAITING, 1, "출하 대기 칸에서 사라지지 않는다");
  assert.equal(report.total.poIssued, 1, "그러면서 PO 발행 완료로도 세어진다");
  assert.equal(report.total.total, 1, "한 대는 한 대다 — 두 번 세지 않는다");
  assert.equal(sumWeeklyReportStatusCounts(report.total), 1);
});

test("PO 발행 완료는 각 블록·종류별 총합·전체에서 같은 규칙으로 세어진다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER", orderIssuedDate: "2026-07-28" }),
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER", orderIssuedDate: null }),
    makeCase({
      customerName: "ICD",
      workflowType: "PAID_GENERATOR",
      orderIssuedDate: "2026-06-01",
    }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER", orderIssuedDate: null }),
  ]);

  const icdMb = report.blocks.find((block) => block.key === "ICD MB")!;
  const icdRfg = report.blocks.find((block) => block.key === "ICD RFG")!;
  assert.equal(icdMb.counts.poIssued, 1);
  assert.equal(icdRfg.counts.poIssued, 1);

  // 종류별 총합은 그 종류 블록들의 합이다.
  for (const { kind, counts } of report.totalsByKind) {
    assert.equal(
      counts.poIssued,
      report.blocks
        .filter((block) => block.kind === kind)
        .reduce((acc, block) => acc + block.counts.poIssued, 0),
      `${kind} 총합의 PO 발행 완료가 블록 합과 다르다`
    );
  }

  // 화면의 `RFG 총합` · `MB 총합` 블록에 생긴 PO 발행 완료 칸이 읽는 값이 바로
  // 이것이다 — 화면은 접수 건을 다시 세지 않고 totalsByKind 의 poIssued 를 그대로
  // 그린다. 위 반복이 "블록 합과 같다"를 지키고, 이 단언이 그 값을 못 박는다.
  assert.deepEqual(
    report.totalsByKind.map((entry) => [entry.kind, entry.counts.poIssued]),
    [
      ["RFG", 1],
      ["MB", 1],
    ],
    "총합 블록이 그릴 PO 발행 완료 숫자"
  );

  // 그 칸이 총합에 생겼다고 총 대수가 늘지는 않는다 — 겹쳐 세는 값이라 6칸의
  // 합이 곧 총 대수다.
  for (const { kind, counts } of report.totalsByKind) {
    assert.equal(
      sumWeeklyReportStatusCounts(counts),
      counts.total,
      `${kind} 총합의 총 대수가 6칸의 합과 다르다`
    );
  }

  assert.equal(report.total.poIssued, 2);
});

// ─────────────────────────────────────────────────────────── 종류 접기

test("Total Controller 는 RFG 로 접힌다 — 엑셀에 그 칸이 없다", () => {
  assert.equal(foldWeeklyReportKind("PAID_TOTAL_CONTROLLER"), "RFG");
  assert.equal(foldWeeklyReportKind("WARRANTY_TOTAL_CONTROLLER"), "RFG");
  assert.equal(foldWeeklyReportKind("PENDING_TOTAL_CONTROLLER"), "RFG");
});

test("Generator 는 RFG, Matcher 는 MB 이고, 유·무상·추후결정은 종류를 바꾸지 않는다", () => {
  for (const workflowType of ["PAID_GENERATOR", "WARRANTY_GENERATOR", "PENDING_GENERATOR"] as const) {
    assert.equal(foldWeeklyReportKind(workflowType), "RFG", workflowType);
  }
  for (const workflowType of ["PAID_MATCHER", "WARRANTY_MATCHER", "PENDING_MATCHER"] as const) {
    assert.equal(foldWeeklyReportKind(workflowType), "MB", workflowType);
  }
});

test("모든 워크플로 종류가 어느 한 줄에 들어간다", () => {
  // 종류가 늘었는데 접는 표를 빠뜨리면 그 건이 undefined 블록으로 사라진다.
  for (const workflowType of WORKFLOW_TYPE_CODES) {
    const kind = foldWeeklyReportKind(workflowType as WorkflowType);
    assert.ok(kind === "RFG" || kind === "MB", `${workflowType} 이 어느 줄에도 없다`);
  }
});

// ─────────────────────────────────────────────────── 출하 완료 · 분류 안 됨

test("출하 완료 건은 보고서에 아예 나오지 않는다 — 분류 안 됨으로도 세지 않는다", () => {
  assert.equal(isExcludedFromWeeklyReport({ status: "SHIPMENT_COMPLETED" }), true);
  assert.equal(isExcludedFromWeeklyReport({ status: "IN_REPAIR" }), false);

  const report = buildAsOf([
    makeCase({ status: "IN_REPAIR" }),
    makeCase({ status: "SHIPMENT_COMPLETED", currentWorkflowStepKey: "shipment_completed" }),
  ]);
  assert.equal(report.total.total, 1);
  assert.equal(report.total.unclassified, 0);
  assert.equal(report.blocks.length, 1);
  assert.equal(report.blocks[0].rows.length, 1);
});

test("어느 칸에도 안 맞는 건은 조용히 사라지지 않는다", () => {
  const report = buildAsOf([
    makeCase({ status: "IN_REPAIR" }),
    // 워크플로에 단계가 새로 생겨 상태가 아직 비어 있는 건.
    makeCase({ status: null, currentWorkflowStepKey: "some_new_step" }),
    // 앞으로 늘어날 상태 — 규칙이 모르는 값에 기본값을 지어내지 않는다.
    // (아직 REPAIR_STATUS_CODES 에 없는 값이라 시험에서만 억지로 만들어 넣는다.)
    makeCase({
      status: "WAITING_CUSTOMER_DECISION" as unknown as RepairStatus,
      currentWorkflowStepKey: "waiting_customer_decision",
    }),
  ]);

  assert.equal(report.total.total, 3, "총 대수에는 그대로 남는다");
  assert.equal(report.total.unclassified, 2, "분류 안 됨으로 드러난다");
  assert.equal(sumWeeklyReportStatusCounts(report.total), 1, "6칸에 들어간 것은 하나뿐이다");
  // 상세표에도 남는다 — 목록에서 빠지면 어느 건인지 찾을 수 없다.
  assert.equal(report.blocks[0].rows.filter((row) => row.reportStatus === null).length, 2);
});

test("분류 안 된 건이 있어도 총 대수 = 6칸의 합 + 분류 안 됨 이다", () => {
  const report = buildAsOf([
    makeCase({ status: "IN_REPAIR" }),
    makeCase({ status: "IN_REPAIR", orderIssuedDate: "2026-05-05" }),
    makeCase({ status: null, currentWorkflowStepKey: "some_new_step", orderIssuedDate: "2026-05-06" }),
  ]);

  assert.equal(
    sumWeeklyReportStatusCounts(report.total) + report.total.unclassified,
    report.total.total
  );
  // 분류 안 된 건도 발주일이 있으면 PO 발행 완료로 세어진다 — 상태와 무관하다.
  assert.equal(report.total.poIssued, 2);
});

// ─────────────────────────────────────────────────────────── 묶기와 세기

test("블록은 건수 많은 순으로 늘어선다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
  ]);

  assert.deepEqual(
    report.blocks.map((block) => [block.customerName, block.counts.total]),
    [
      ["JUSUNG", 3],
      ["INVENIA", 2],
      ["ICD", 1],
    ]
  );
});

test("같은 고객사라도 종류가 다르면 블록이 갈린다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "INVENIA", workflowType: "PAID_GENERATOR" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_TOTAL_CONTROLLER" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
  ]);

  assert.deepEqual(
    report.blocks.map((block) => [block.customerName, block.kind, block.counts.total]),
    [
      // Total Controller 가 Generator 와 같은 RFG 블록으로 합쳐진다.
      ["INVENIA", "RFG", 2],
      ["INVENIA", "MB", 1],
    ]
  );
});

test("종류별 총합은 RFG·MB 두 줄 모두 있고, 둘을 더하면 전체다", () => {
  const report = buildAsOf([
    makeCase({ workflowType: "PAID_GENERATOR" }),
    makeCase({ workflowType: "WARRANTY_TOTAL_CONTROLLER" }),
    makeCase({ workflowType: "PAID_MATCHER" }),
  ]);

  assert.deepEqual(
    report.totalsByKind.map((entry) => [entry.kind, entry.counts.total]),
    [
      ["RFG", 2],
      ["MB", 1],
    ]
  );
  assert.equal(
    report.totalsByKind.reduce((acc, entry) => acc + entry.counts.total, 0),
    report.total.total
  );
});

test("건이 하나도 없으면 블록도 없고 총합은 0이다 — 종류별 두 줄은 그대로 남는다", () => {
  const report = buildAsOf([]);
  assert.deepEqual(report.blocks, []);
  assert.equal(report.total.total, 0);
  assert.equal(report.total.poIssued, 0);
  assert.deepEqual(
    report.totalsByKind.map((entry) => entry.kind),
    ["RFG", "MB"]
  );
});

test("블록 안의 줄은 인수번호 오름차순이다", () => {
  const report = buildAsOf([
    makeCase({ intakeNumber: "D260703" }),
    makeCase({ intakeNumber: "D260701" }),
    makeCase({ intakeNumber: "D260702" }),
  ]);
  assert.deepEqual(
    report.blocks[0].rows.map((row) => row.intakeNumber),
    ["D260701", "D260702", "D260703"]
  );
});

// ───────────────────────────────────────────── 내자 줄이 여럿일 때의 날짜

test("내자 줄이 여럿이면 발주발행일이 가장 이른 줄을 쓴다 — 두 날짜를 같은 줄에서 가져온다", () => {
  assert.deepEqual(
    pickWeeklyReportOrderDates([
      { quoteIssuedDate: "2026-03-01", orderIssuedDate: "2026-03-10" },
      { quoteIssuedDate: "2026-01-05", orderIssuedDate: "2026-02-20" },
      { quoteIssuedDate: "2026-04-01", orderIssuedDate: null },
    ]),
    // 견적일이 더 이른 줄(2026-01-05)이 아니라 **발주일이 가장 이른 줄**의 두 값이다.
    { quoteIssuedDate: "2026-01-05", orderIssuedDate: "2026-02-20" }
  );
});

test("어느 줄에도 발주일이 없으면 견적발행일이 가장 이른 줄을 쓴다", () => {
  assert.deepEqual(
    pickWeeklyReportOrderDates([
      { quoteIssuedDate: "2026-05-02", orderIssuedDate: null },
      { quoteIssuedDate: "2026-04-11", orderIssuedDate: null },
    ]),
    { quoteIssuedDate: "2026-04-11", orderIssuedDate: null }
  );
});

test("내자 줄이 없거나 두 날짜가 다 비어 있으면 빈칸이다", () => {
  assert.deepEqual(pickWeeklyReportOrderDates([]), {
    quoteIssuedDate: null,
    orderIssuedDate: null,
  });
  assert.deepEqual(pickWeeklyReportOrderDates([{ quoteIssuedDate: null, orderIssuedDate: null }]), {
    quoteIssuedDate: null,
    orderIssuedDate: null,
  });
});

test("발주일이 있는 줄이 하나라도 있으면 고른 줄에도 발주일이 있다 — PO 발행 완료가 이 불변식 위에 선다", () => {
  type Row = { quoteIssuedDate: string | null; orderIssuedDate: string | null };

  const candidates: Row[][] = [
    [],
    [{ quoteIssuedDate: null, orderIssuedDate: null }],
    [{ quoteIssuedDate: "2026-01-01", orderIssuedDate: null }],
    [
      { quoteIssuedDate: "2026-01-01", orderIssuedDate: null },
      { quoteIssuedDate: null, orderIssuedDate: "2026-02-02" },
    ],
    [
      { quoteIssuedDate: "2026-03-01", orderIssuedDate: "2026-03-05" },
      { quoteIssuedDate: "2026-01-01", orderIssuedDate: null },
      { quoteIssuedDate: "2026-02-01", orderIssuedDate: null },
    ],
    [
      { quoteIssuedDate: null, orderIssuedDate: null },
      { quoteIssuedDate: null, orderIssuedDate: "2026-09-09" },
    ],
  ];

  for (const rowSet of candidates) {
    const anyOrderDate = rowSet.some((row) => row.orderIssuedDate !== null);
    assert.equal(
      hasWeeklyReportPoIssued(pickWeeklyReportOrderDates(rowSet)),
      anyOrderDate,
      `${JSON.stringify(rowSet)} 에서 두 값이 갈라졌다`
    );
  }
});

test("내자 날짜는 접수 건에 그대로 실려 상세표까지 간다", () => {
  const report = buildAsOf([
    makeCase({ quoteIssuedDate: "2026-02-01", orderIssuedDate: "2026-02-15" }),
  ]);
  const row = report.blocks[0].rows[0];
  assert.equal(row.quoteIssuedDate, "2026-02-01");
  assert.equal(row.orderIssuedDate, "2026-02-15");
});

// ──────────────────────────────────── 고객사 한 줄에 RFG·MB 를 나란히 (엑셀 배치)

test("고객사마다 RFG 와 MB 가 한 쌍으로 나온다", () => {
  const pairs = pairWeeklyReportBlocksByCustomer(
    buildAsOf([
      makeCase({ customerName: "INVENIA", workflowType: "PAID_GENERATOR" }),
      makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
      makeCase({ customerName: "ICD", workflowType: "PAID_TOTAL_CONTROLLER" }),
      makeCase({ customerName: "ICD", workflowType: "WARRANTY_MATCHER" }),
    ]).blocks
  );

  assert.equal(pairs.length, 2, "고객사 둘이면 줄도 둘이다");
  for (const pair of pairs) {
    assert.equal(pair.rfg.kind, "RFG", "왼쪽은 언제나 RFG 다");
    assert.equal(pair.mb.kind, "MB", "오른쪽은 언제나 MB 다");
    assert.equal(pair.rfg.customerName, pair.customerName);
    assert.equal(pair.mb.customerName, pair.customerName);
    assert.equal(pair.rfg.counts.total, 1);
    assert.equal(pair.mb.counts.total, 1);
  }
});

test("한쪽이 0건이어도 빈 블록이 자리를 지킨다 — 엑셀의 ETC(RFG)가 그렇다", () => {
  const pairs = pairWeeklyReportBlocksByCustomer(
    buildAsOf([
      // MB 만 있는 고객사.
      makeCase({ customerName: "ETC", workflowType: "PAID_MATCHER" }),
      makeCase({ customerName: "ETC", workflowType: "PAID_MATCHER" }),
      // RFG 만 있는 고객사.
      makeCase({ customerName: "JUSUNG", workflowType: "PAID_GENERATOR" }),
    ]).blocks
  );

  const etc = pairs.find((pair) => pair.customerName === "ETC")!;
  assert.equal(etc.mb.counts.total, 2);
  assert.equal(etc.rfg.kind, "RFG", "없는 쪽도 블록으로 채워진다");
  assert.equal(etc.rfg.customerName, "ETC");
  assert.equal(etc.rfg.counts.total, 0);
  assert.equal(etc.rfg.counts.unclassified, 0);
  assert.equal(etc.rfg.counts.poIssued, 0);
  assert.equal(sumWeeklyReportStatusCounts(etc.rfg.counts), 0, "빈 블록의 6칸은 전부 0이다");
  assert.deepEqual(etc.rfg.rows, []);
  // 채워 넣은 블록의 key 도 buildWeeklyReport 가 만드는 것과 같은 모양이어야 한다.
  assert.equal(etc.rfg.key, "ETC RFG");

  const jusung = pairs.find((pair) => pair.customerName === "JUSUNG")!;
  assert.equal(jusung.rfg.counts.total, 1);
  assert.equal(jusung.mb.counts.total, 0);
  assert.deepEqual(jusung.mb.rows, []);
  assert.equal(jusung.mb.key, "JUSUNG MB");
});

test("줄 차례는 건수 많은 고객사 순 그대로다 — 짝을 지으면서 바꾸지 않는다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
  ]);

  assert.deepEqual(
    pairWeeklyReportBlocksByCustomer(report.blocks).map((pair) => pair.customerName),
    ["JUSUNG", "INVENIA", "ICD"]
  );

  // 고객사가 처음 나온 자리가 그 고객사의 자리다 — blocks 의 차례를 그대로 따른다.
  const firstAppearance: string[] = [];
  for (const block of report.blocks) {
    if (!firstAppearance.includes(block.customerName)) firstAppearance.push(block.customerName);
  }
  assert.deepEqual(
    pairWeeklyReportBlocksByCustomer(report.blocks).map((pair) => pair.customerName),
    firstAppearance
  );
});

test("짝을 지어도 블록을 하나도 잃지 않는다 — 늘어나는 것은 채워 넣은 빈 블록뿐이다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "INVENIA", workflowType: "PAID_GENERATOR" }),
    makeCase({ customerName: "INVENIA", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_TOTAL_CONTROLLER" }),
  ]);
  const pairs = pairWeeklyReportBlocksByCustomer(report.blocks);
  const paired = pairs.flatMap((pair) => [pair.rfg, pair.mb]);

  // 건이 있는 블록은 원래 목록과 하나도 다르지 않다(같은 key, 같은 객체).
  assert.deepEqual(
    paired.filter((block) => block.counts.total > 0).map((block) => block.key).sort(),
    report.blocks.map((block) => block.key).sort()
  );
  for (const block of report.blocks) {
    assert.ok(paired.includes(block), `${block.key} 가 짝 목록에서 사라졌다`);
  }
  // 자리는 언제나 고객사 × 2 다 — 빈 자리를 지우지 않기 때문이다.
  assert.equal(paired.length, pairs.length * 2);
  assert.equal(
    paired.reduce((acc, block) => acc + block.counts.total, 0),
    report.total.total,
    "짝지은 뒤에도 총 대수는 그대로다"
  );
});

test("건이 하나도 없으면 줄도 없다", () => {
  assert.deepEqual(pairWeeklyReportBlocksByCustomer(buildAsOf([]).blocks), []);
});

// ────────────────────────────────────────────────────────── 고객사 색

test("고객사 색은 블록에 그대로 실리고, 채워 넣은 빈 블록에도 같은 색이 간다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "ICD", customerRowColor: "sky", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "ETC", customerRowColor: null, workflowType: "PAID_MATCHER" }),
  ]);

  const icd = report.blocks.find((block) => block.customerName === "ICD")!;
  assert.equal(icd.customerRowColor, "sky");

  const pairs = pairWeeklyReportBlocksByCustomer(report.blocks);
  const icdPair = pairs.find((pair) => pair.customerName === "ICD")!;
  assert.equal(icdPair.mb.customerRowColor, "sky");
  assert.equal(icdPair.rfg.customerRowColor, "sky", "빈 쪽도 같은 고객사의 색이다");

  const etcPair = pairs.find((pair) => pair.customerName === "ETC")!;
  assert.equal(etcPair.rfg.customerRowColor, null, "색을 정하지 않은 고객사는 null 그대로다");
});

// ────────────────────────────────────────────────────────── PO 발행 현황

test("PO 발행 현황의 고객사별 합은 그 종류의 블록별 PO 발행 완료 합과 같다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER", orderIssuedDate: "2026-07-28" }),
    makeCase({ customerName: "ICD", workflowType: "PAID_MATCHER", orderIssuedDate: null }),
    makeCase({
      customerName: "INVENIA",
      workflowType: "PAID_GENERATOR",
      orderIssuedDate: "2026-06-01",
    }),
    makeCase({
      customerName: "INVENIA",
      workflowType: "PAID_GENERATOR",
      orderIssuedDate: "2026-06-02",
    }),
    makeCase({ customerName: "JUSUNG", workflowType: "PAID_MATCHER", orderIssuedDate: null }),
  ]);

  const issuance = summarizeWeeklyReportPoIssuance(report.blocks);
  assert.deepEqual(
    issuance.map((entry) => entry.kind),
    ["RFG", "MB"]
  );

  for (const entry of issuance) {
    const fromBlocks = report.blocks
      .filter((block) => block.kind === entry.kind)
      .reduce((acc, block) => acc + block.counts.poIssued, 0);
    assert.equal(entry.total, fromBlocks, `${entry.kind} 의 합이 블록과 다르다`);
    assert.equal(
      entry.total,
      report.totalsByKind.find((total) => total.kind === entry.kind)!.counts.poIssued,
      `${entry.kind} 의 합이 종류별 총합과 다르다`
    );

    // 고객사 한 칸 한 칸도 그 블록의 값 그대로다 — 여기서 다시 세지 않는다.
    for (const customer of entry.customers) {
      const block = report.blocks.find((candidate) => candidate.key === customer.key);
      assert.equal(customer.count, block?.counts.poIssued ?? 0, `${customer.key} 가 다르다`);
    }
  }

  assert.equal(
    issuance.reduce((acc, entry) => acc + entry.total, 0),
    report.total.poIssued,
    "두 종류를 더하면 전체 PO 발행 완료다"
  );
});

test("PO 발행 현황은 두 종류에 같은 고객사 차례로 나오고, 0 인 고객사도 자리를 지킨다", () => {
  const report = buildAsOf([
    makeCase({ customerName: "ICD", customerRowColor: "sky", workflowType: "PAID_MATCHER" }),
    makeCase({ customerName: "ICD", customerRowColor: "sky", workflowType: "PAID_MATCHER" }),
    makeCase({
      customerName: "INVENIA",
      customerRowColor: "amber",
      workflowType: "PAID_GENERATOR",
      orderIssuedDate: "2026-06-01",
    }),
  ]);

  const issuance = summarizeWeeklyReportPoIssuance(report.blocks);
  const [rfg, mb] = issuance;

  assert.deepEqual(
    rfg.customers.map((entry) => entry.customerName),
    mb.customers.map((entry) => entry.customerName),
    "좌우 두 줄의 이름 차례가 같아야 견줄 수 있다"
  );
  // 건이 없는 자리도 0 으로 남는다(원본이 0을 적어 둔다).
  assert.equal(rfg.customers.find((entry) => entry.customerName === "ICD")!.count, 0);
  assert.equal(mb.customers.find((entry) => entry.customerName === "ICD")!.count, 0);
  assert.equal(rfg.customers.find((entry) => entry.customerName === "INVENIA")!.count, 1);

  // 이름표를 칠할 색도 함께 온다.
  assert.equal(rfg.customers.find((entry) => entry.customerName === "ICD")!.customerRowColor, "sky");
  assert.equal(
    mb.customers.find((entry) => entry.customerName === "INVENIA")!.customerRowColor,
    "amber"
  );
});

test("건이 하나도 없으면 PO 발행 현황도 두 줄만 남고 전부 비어 있다", () => {
  const issuance = summarizeWeeklyReportPoIssuance(buildAsOf([]).blocks);
  assert.deepEqual(
    issuance.map((entry) => [entry.kind, entry.customers.length, entry.total]),
    [
      ["RFG", 0, 0],
      ["MB", 0, 0],
    ]
  );
});

// ───────────────────────────────────── 장기 PO 미발행 (상세표의 빨간 볼드)

/**
 * 상세표의 `견적서 발행일` 을 빨갛게 만드는 표시다. 규칙 자체를 다시 시험하는
 * 것이 아니라(그 일은 long-pending-po.test.ts 가 한다) **이 파일이 그 판정을
 * 줄마다 제대로 실어 보내는가**를 못 박는다. 네 경계는 화면에서 눈으로 확인할
 * 방법이 사실상 없어서(두 달 전 견적을 만들어야 한다) 여기서 잡아야 한다.
 *
 * "오늘"은 MIDDAY_KST(2026-08-25)다.
 */

/** 그 줄 하나를 골라 표시를 읽는다 — 블록이 하나뿐인 시험들이 쓴다. */
function onlyRow(cases: readonly WeeklyReportCase[], now: Date = MIDDAY_KST) {
  const report = buildAsOf(cases, now);
  assert.equal(report.blocks.length, 1, "이 시험은 블록 하나를 전제한다");
  assert.equal(report.blocks[0].rows.length, 1, "이 시험은 줄 하나를 전제한다");
  return report.blocks[0].rows[0];
}

test("견적일 + 2개월이 오늘이면 그 줄에 장기 PO 미발행 표시가 켜진다", () => {
  // 2026-06-25 + 2개월 = 2026-08-25 = 오늘. 딱 되는 날 **당일부터** 걸린다.
  const row = onlyRow([
    makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-25", orderIssuedDate: null }),
  ]);
  assert.equal(row.isLongPendingPo, true);
});

test("두 달이 하루 모자란 줄은 켜지지 않는다", () => {
  // 2026-06-26 + 2개월 = 2026-08-26 > 오늘(08-25).
  const row = onlyRow([
    makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-26", orderIssuedDate: null }),
  ]);
  assert.equal(row.isLongPendingPo, false);
});

test("PO 발행일이 있으면 견적일이 아무리 오래돼도 켜지지 않는다", () => {
  const report = buildAsOf([
    makeCase({
      status: "WAITING_SHIPMENT",
      // 2년도 더 지난 견적이지만 발주가 났다 — 기다릴 PO 가 없다.
      quoteIssuedDate: "2024-01-02",
      orderIssuedDate: "2024-03-15",
    }),
  ]);
  assert.equal(report.blocks[0].rows[0].isLongPendingPo, false);
  // 그러면서 PO 발행 완료로는 세어진다 — 둘은 서로 다른 값이다.
  assert.equal(report.total.poIssued, 1);
});

test("견적일이 없는 줄은 켜지지 않는다 — 기다릴 것이 시작되지 않았다", () => {
  const row = onlyRow([
    makeCase({ status: "IN_REPAIR", quoteIssuedDate: null, orderIssuedDate: null }),
  ]);
  assert.equal(row.isLongPendingPo, false);
});

test("표시는 전체 A/S 현황과 **같은 함수**가 정한다 — 두 화면이 같은 건을 가리킨다", () => {
  // 규칙을 여기 옮겨 적으면 언젠가 어긋나고, 그때 어느 쪽이 맞는지 말할 수 없다.
  const cases = [
    makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-25" }),
    makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-26" }),
    makeCase({ status: "IN_REPAIR", quoteIssuedDate: "2026-01-01", orderIssuedDate: "2026-02-01" }),
    makeCase({ status: "WAITING_PARTS_SUPPLY", quoteIssuedDate: null }),
    makeCase({ status: null, currentWorkflowStepKey: "some_new_step", quoteIssuedDate: "2026-05-01" }),
  ];

  for (const row of buildAsOf(cases).blocks.flatMap((block) => block.rows)) {
    assert.equal(
      row.isLongPendingPo,
      isLongPendingPo({ status: row.status, orderRows: [row] }, MIDDAY_KST),
      `${row.intakeNumber} 의 표시가 판정 함수와 다르다`
    );
  }
});

test("'오늘'은 부르는 쪽이 정한다 — 같은 자료도 날짜가 다르면 표시가 갈린다", () => {
  // 도메인이 new Date() 를 부르면 이 시험을 쓸 수 없다(파일 위 MIDDAY_KST 주석).
  const cases = [makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-25" })];
  assert.equal(
    onlyRow(cases, new Date("2026-08-24T05:00:00.000Z")).isLongPendingPo,
    false,
    "하루 전에는 아직 아니다"
  );
  assert.equal(onlyRow(cases, MIDDAY_KST).isLongPendingPo, true, "당일부터 걸린다");
});

test("빨간 글씨는 세는 값이 아니다 — 집계 6칸·PO 발행 완료·총 대수가 그대로다", () => {
  const cases = [
    makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-25" }),
    makeCase({ status: "WAITING_PO", quoteIssuedDate: "2026-06-26" }),
  ];
  const report = buildAsOf(cases);

  assert.deepEqual(
    report.blocks[0].rows.map((row) => row.isLongPendingPo),
    [true, false],
    "한 줄만 켜진다"
  );
  assert.equal(report.total.total, 2);
  assert.equal(report.total.byStatus.PO_WAITING, 2, "표시가 켜져도 PO 대기 중 칸에 그대로 남는다");
  assert.equal(report.total.poIssued, 0);
  assert.equal(sumWeeklyReportStatusCounts(report.total), report.total.total);
});

test("출하 완료 건은 켜질 자리조차 없다 — 보고서에서 통째로 빠진다", () => {
  const report = buildAsOf([
    makeCase({
      status: "SHIPMENT_COMPLETED",
      currentWorkflowStepKey: "shipment_completed",
      quoteIssuedDate: "2026-01-02",
    }),
  ]);
  assert.deepEqual(report.blocks, []);
  assert.equal(report.total.total, 0);
});

test("고른 줄을 다시 고르면 그대로다 — 표시가 상세표의 두 날짜와 같은 것을 본다", () => {
  // buildWeeklyReport 는 조회가 이미 고른 줄 하나를 isLongPendingPo 에 넘긴다.
  // 그 한 줄을 다시 골라도 값이 바뀌지 않아야 판정과 상세표가 갈라지지 않는다.
  const pickedShapes = [
    { quoteIssuedDate: null, orderIssuedDate: null },
    { quoteIssuedDate: "2026-06-25", orderIssuedDate: null },
    { quoteIssuedDate: null, orderIssuedDate: "2026-02-20" },
    { quoteIssuedDate: "2026-01-05", orderIssuedDate: "2026-02-20" },
  ];
  for (const picked of pickedShapes) {
    assert.deepEqual(
      pickWeeklyReportOrderDates([picked]),
      picked,
      `${JSON.stringify(picked)} 를 다시 고르니 값이 바뀌었다`
    );
  }
});
