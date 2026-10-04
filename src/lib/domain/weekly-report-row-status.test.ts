import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  WEEKLY_REPORT_ROW_STATUSES,
  classifyWeeklyReportRowStatus,
  isWeeklyReportRowStatus,
  weeklyReportRowStatusLabels,
} from "./weekly-report-row-status";
import {
  WEEKLY_REPORT_STATUSES,
  buildWeeklyReport,
  classifyWeeklyReportStatus,
  sumWeeklyReportStatusCounts,
  weeklyReportStatusLabels,
  type WeeklyReportCase,
} from "./weekly-report";
import type { RepairStatus } from "./types";

/**
 * ============================================================================
 * 상세표 한 칸이 보여 주는 상태 — 집계 6칸과 **일부러 다르다**
 * ============================================================================
 * 2026-10-04 사용자 요청으로 상세표의 `현 상태` 가 7칸이 되었다. 바뀐 것은 그
 * 한 칸뿐이고 **집계는 그대로 6칸**이다. 이 시험이 못 박는 것은 넷이다.
 *
 *   1. 🔴 수리 완료인 건은 상세표에 **'수리 완료'**로 보인다 — '수리 중'이 아니다.
 *   2. 🔴 **집계는 안 바뀌었다** — 그 건은 여전히 '수리 중' 숫자에 들어가고,
 *      6칸의 합과 총 대수가 그대로 맞는다. 이번 변경으로 **깨지면 안 되는** 자리다.
 *   3. 나머지 여섯 칸은 집계와 **한 글자도 다르지 않다**. 늘어난 것은 하나뿐이다.
 *   4. 고르개의 차례와 이름표 — '수리 완료'는 '수리 중' **바로 다음**이고,
 *      6칸짜리 이름표는 **늘어나지 않았다**(집계 블록이 그 표를 돈다).
 *
 * 어느 단계로 가는가는 이 파일이 아니라 weekly-report-status-step.test.ts 가 본다.
 * ============================================================================
 */

/** 이 시험이 말하는 "오늘". buildWeeklyReport 는 그 값을 **받는다**(그 파일 헤더). */
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

let sequence = 0;

function makeCase(overrides: Partial<WeeklyReportCase> = {}): WeeklyReportCase {
  sequence += 1;
  return {
    id: `case-${sequence}`,
    version: 1,
    intakeNumber: `D2601${String(sequence).padStart(2, "0")}`,
    customerName: "INVENIA",
    customerRowColor: null,
    workflowType: "PAID_MATCHER",
    status: "IN_REPAIR",
    currentWorkflowStepKey: "repair_in_progress",
    modelName: "RFG-1000",
    serialNumber: "SN-1",
    lotNumber: "LN-1",
    quoteIssuedDate: null,
    orderIssuedDate: null,
    notes: null,
    ...overrides,
  };
}

describe("classifyWeeklyReportRowStatus", () => {
  test("1. 🔴 수리 완료인 건은 상세표에 '수리 완료'로 보인다 — 집계는 같은 건을 '수리 중'으로 센다", () => {
    const row = {
      // 전용 단계 키는 없다 — 판정은 단계 키를 보지 않으므로 수리 단계 그대로 둔다.
      status: "REPAIR_COMPLETED" as RepairStatus,
      currentWorkflowStepKey: "repair_in_progress",
    };

    assert.equal(classifyWeeklyReportRowStatus(row), "REPAIR_COMPLETED", "줄에 적히는 값");
    assert.equal(classifyWeeklyReportStatus(row), "IN_REPAIR", "숫자를 세는 값");

    // 사람이 읽는 글자로도 본다 — 이 두 줄이 이번 변경의 전부다.
    assert.equal(weeklyReportRowStatusLabels.REPAIR_COMPLETED, "수리 완료");
    assert.equal(weeklyReportStatusLabels.IN_REPAIR, "수리 중");
  });

  test("2. 나머지 여섯 칸은 집계와 똑같다 — 늘어난 것은 수리 완료 하나뿐이다", () => {
    // 상태 하나하나를 집계와 견준다. 수리 완료만 빼고 전부 같아야 한다.
    const statuses: RepairStatus[] = [
      "WAITING_INTAKE_INSPECTION",
      "INTAKE_INSPECTION_IN_PROGRESS",
      "INTAKE_INSPECTION_COMPLETED",
      "WAITING_KYOSAN_REPLY",
      "WAITING_PARTS_SUPPLY",
      "WAITING_REPAIR",
      "IN_REPAIR",
      "WAITING_PO",
      "WAITING_SHIPMENT",
      "WAITING_SHIPMENT_APPROVAL",
    ];
    for (const status of statuses) {
      const row = { status, currentWorkflowStepKey: "any_step" };
      assert.equal(
        classifyWeeklyReportRowStatus(row),
        classifyWeeklyReportStatus(row),
        `${status} 는 집계와 같은 칸이어야 한다`
      );
    }
  });

  test("3. 분류 안 됨은 늘지도 줄지도 않는다 — null 이 되는 조합이 집계와 같다", () => {
    const unknown = { status: null, currentWorkflowStepKey: "intake_inspection" };
    assert.equal(classifyWeeklyReportStatus(unknown), null);
    assert.equal(classifyWeeklyReportRowStatus(unknown), null, "빨간 '분류 안 됨' 딱지가 그대로다");
  });
});

describe("WEEKLY_REPORT_ROW_STATUSES", () => {
  test("4. 집계 6칸이 하나도 빠지지 않았고, 늘어난 것은 수리 완료 하나뿐이다", () => {
    for (const status of WEEKLY_REPORT_STATUSES) {
      assert.ok(
        (WEEKLY_REPORT_ROW_STATUSES as readonly string[]).includes(status),
        `집계 칸 ${status} 가 고르개에서 빠졌다 — 그 칸인 건은 고를 수 없게 된다`
      );
    }
    assert.equal(WEEKLY_REPORT_ROW_STATUSES.length, WEEKLY_REPORT_STATUSES.length + 1);
    assert.equal(WEEKLY_REPORT_ROW_STATUSES.length, 7, "상세표 칸은 일곱이다");
    assert.equal(WEEKLY_REPORT_STATUSES.length, 6, "🔴 집계 칸은 여섯 그대로다");
  });

  test("5. 고르개의 차례 — '수리 완료'는 '수리 중' 바로 다음이다", () => {
    assert.deepEqual(
      WEEKLY_REPORT_ROW_STATUSES.map((status) => weeklyReportRowStatusLabels[status]),
      ["점검 대기", "점검 중", "수리 대기", "수리 중", "수리 완료", "PO 대기 중", "출하 대기"]
    );
  });

  test("6. 🔴 6칸짜리 이름표는 늘어나지 않았다 — 집계 블록이 그 표를 돈다", () => {
    assert.equal(Object.keys(weeklyReportStatusLabels).length, 6);
    assert.ok(
      !("REPAIR_COMPLETED" in weeklyReportStatusLabels),
      "6칸 표에 수리 완료가 들어가면 집계 블록에 없는 칸이 하나 더 그려진다"
    );
    assert.equal(Object.keys(weeklyReportRowStatusLabels).length, 7);
  });
});

describe("집계는 이번 변경으로 바뀌지 않았다", () => {
  test("7. 🔴 수리 완료인 건은 '수리 중' 숫자에 들어가고, 6칸의 합과 총 대수가 그대로 맞는다", () => {
    const cases = [
      makeCase({ status: "REPAIR_COMPLETED", currentWorkflowStepKey: "repair_in_progress" }),
      makeCase({ status: "IN_REPAIR", currentWorkflowStepKey: "repair_in_progress" }),
      makeCase({ status: "WAITING_SHIPMENT", currentWorkflowStepKey: "waiting_shipment" }),
      makeCase({
        status: "WAITING_INTAKE_INSPECTION",
        currentWorkflowStepKey: "intake_inspection",
      }),
    ];
    const report = buildWeeklyReport(cases, MIDDAY_KST);

    assert.equal(report.total.byStatus.IN_REPAIR, 2, "수리 완료와 수리 중이 한 칸에 모인다");
    assert.equal(report.total.byStatus.SHIPMENT_WAITING, 1, "출하 대기로 새어 나가지 않는다");
    assert.equal(report.total.unclassified, 0, "분류 안 됨이 하나도 없다");
    assert.equal(report.total.total, 4, "총 대수");
    assert.equal(sumWeeklyReportStatusCounts(report.total), 4, "🔴 총 대수 = 6칸의 합");

    // 줄에 실린 집계용 값(reportStatus)도 그대로 '수리 중'이다 — 집계는 이 값을
    // 세고, 화면의 글자는 classifyWeeklyReportRowStatus 가 따로 정한다.
    const repairCompletedRow = report.blocks[0].rows.find(
      (row) => row.status === "REPAIR_COMPLETED"
    );
    assert.ok(repairCompletedRow, "수리 완료 건이 상세표에 남아 있어야 한다");
    assert.equal(repairCompletedRow!.reportStatus, "IN_REPAIR", "집계가 읽는 값은 그대로다");
    assert.equal(
      classifyWeeklyReportRowStatus(repairCompletedRow!),
      "REPAIR_COMPLETED",
      "같은 줄이 화면에는 '수리 완료'로 적힌다"
    );
  });
});

describe("isWeeklyReportRowStatus", () => {
  test("8. 7칸만 통과한다 — 형식 검증은 넓어진 만큼만 넓어졌다", () => {
    for (const status of WEEKLY_REPORT_ROW_STATUSES) {
      assert.equal(isWeeklyReportRowStatus(status), true, `${status} 는 통과해야 한다`);
    }
    assert.equal(isWeeklyReportRowStatus("REPAIR_COMPLETED"), true, "이번에 늘어난 칸");

    // 접수 건의 상태(RepairStatus)는 칸 이름이 아니다 — 겹쳐 보이는 값이 있어 더
    // 위험하다. WAITING_SHIPMENT 는 상태이지 칸이 아니다.
    assert.equal(isWeeklyReportRowStatus("WAITING_SHIPMENT"), false);
    assert.equal(isWeeklyReportRowStatus("SHIPMENT_COMPLETED"), false);
    assert.equal(isWeeklyReportRowStatus("WAITING_KYOSAN_REPLY"), false);
    assert.equal(isWeeklyReportRowStatus(""), false);
    assert.equal(isWeeklyReportRowStatus(null), false);
    assert.equal(isWeeklyReportRowStatus(undefined), false);
    assert.equal(isWeeklyReportRowStatus(3), false);
  });
});
