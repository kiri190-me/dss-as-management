import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapRepairCaseRow, type RepairCaseJoinRow } from "./repair-case";

/**
 * ============================================================================
 * 🔴 「납기 지연」 배지가 **빌려 온 날짜로도** 켜지는가 — 매퍼 쪽 길
 * ============================================================================
 * 2026-11-07 사용자 신고: 「고객 요청 납기일이 **내자정리에서 읽어온 경우
 * [납기지연]이 안뜨는** 것 같아」.
 *
 * 판정 자체는 domain/repair-case-overdue.test.ts 가 값으로 전부 잰다. **이 파일이
 * 보는 것은 그 판정에 재료가 정말로 닿는가**다 — 2026-11-07 이전의 결함이 바로
 * 그 자리였다: 판정은 매퍼 **안에서** 돌고, 내자 날짜는 조회가 매퍼 **뒤에서**
 * 덧씌우고 있어서, 배지는 언제나 빈 배열을 보고 있었다. 판정 함수만 고치고 이 길을
 * 안 보면 **고친 티가 한 군데도 안 난다.**
 *
 * 🔵 매퍼는 순수 함수라 DB 가 필요 없다. 조회(listRepairCases · getRepairCaseById)가
 * 정말 그 재료를 실어 오는지는 DB 가 있어야 보이므로 거기서 따로 본다
 * (queries/repair-case-overdue-notifications.integration.test.ts).
 * ============================================================================
 */

// 2026-08-25 14:00 KST — 한국/UTC 달력 날짜가 둘 다 08-25인, 경계가 아닌 시각.
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

/**
 * 조인 한 줄의 최소 표본. 🔴 **사내 목표 완료일은 늘 한참 지나 있다** — 옛 규칙
 * (사내 날짜로 재기, 2026-11-03 이전)이 되살아나면 「지연 아님」 단언이 깨진다.
 * 🔴 **가짜 값만 쓴다** — 실제 접수번호·고객사 이름을 넣지 않는다(공개 저장소).
 */
function joinRow(overrides: Partial<RepairCaseJoinRow> = {}): RepairCaseJoinRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    intakeNumber: "D9705-012",
    legacyReportNumber: null,
    customerId: "00000000-0000-4000-8000-0000000000c1",
    customerName: "시험 고객사",
    endUserId: null,
    endUserName: null,
    productId: "00000000-0000-4000-8000-0000000000f1",
    modelName: "TEST-MODEL",
    lotNumber: null,
    serialNumber: null,
    partNumber: null,
    assignedEngineerId: null,
    engineerName: null,
    workflowTypeCode: "PAID_MATCHER",
    billingType: "PAID",
    priority: "NORMAL",
    currentWorkflowStepKey: "IN_REPAIR",
    currentWorkflowStepRepairStatus: "IN_REPAIR",
    exceptionStatusCode: null,
    receivedAt: "2026-08-01",
    customerRequestedDueDate: null,
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: "2026-01-05",
    actualShipmentDate: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    notes: null,
    contactNameSnapshot: null,
    contactPhoneSnapshot: null,
    contactEmailSnapshot: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("🔴 표본 점검 — 기본 표본은 제 칸이 비어 있고 사내 날짜는 지나 있다", () => {
  // 이 못이 없으면 아래 「빌려 와서 뜬다」가 제 칸으로 통과할 수 있고, 「사내 날짜로는
  // 안 뜬다」가 아무것도 안 재게 된다.
  const row = joinRow();
  assert.equal(row.customerRequestedDueDate, null, "표본의 제 칸이 비어 있지 않다");
  assert.ok(row.internalTargetShipmentDate !== null);
  assert.ok(row.internalTargetShipmentDate < "2026-08-25", "표본의 사내 날짜가 지나 있지 않다");
});

test("🔴 빌려 온 날짜가 지났으면 매퍼의 isOverdue 가 참이다 — 사용자가 본 그 모양", () => {
  const mapped = mapRepairCaseRow(joinRow(), ["2026-08-24"], MIDDAY_KST);
  assert.equal(mapped.isOverdue, true);
  // 재료도 그 줄에 그대로 실려 나간다 — 화면(정렬·「고객 요청 납기일」 칸)이 같은
  // 날짜를 그려야 배지와 글자가 어긋나지 않는다.
  assert.deepEqual(mapped.domesticOrderDueDates, ["2026-08-24"]);
});

test("🔴 재료를 안 넘기면(빌릴 것이 없으면) 예전처럼 안 뜬다 — 사내 날짜가 지나 있어도", () => {
  const mapped = mapRepairCaseRow(joinRow(), [], MIDDAY_KST);
  assert.equal(mapped.isOverdue, false);
  assert.deepEqual(mapped.domesticOrderDueDates, []);
});

test("빌려 온 날짜가 아직 안 지났으면 매퍼의 isOverdue 가 거짓이다", () => {
  assert.equal(mapRepairCaseRow(joinRow(), ["2026-12-31"], MIDDAY_KST).isOverdue, false);
});

test("빌려 온 날짜가 지났어도 실제 출하일이 찍혀 있으면 거짓이다", () => {
  const mapped = mapRepairCaseRow(
    joinRow({ actualShipmentDate: "2026-08-09" }),
    ["2026-08-24"],
    MIDDAY_KST
  );
  assert.equal(mapped.isOverdue, false);
});

test("🔴 제 칸에 적힌 값이 이긴다 — 내자에 지난 날짜가 있어도 제 칸이 미래면 거짓이다", () => {
  const mapped = mapRepairCaseRow(
    joinRow({ customerRequestedDueDate: "2026-12-31" }),
    ["2026-08-10"],
    MIDDAY_KST
  );
  assert.equal(mapped.isOverdue, false);
});

test("🔴 매퍼가 날짜를 **인자로** 받는다 — 뒤에서 덧씌우는 모양이 되살아나면 배지가 다시 눈먼다", () => {
  // 조회가 `...mapRepairCaseRow(row)` 뒤에 `domesticOrderDueDates:` 를 덧붙이는
  // 모양이면, 매퍼 안에서 도는 isOverdue 는 그 값을 못 본다 — 그것이 2026-11-07
  // 이전의 결함이었다. 글자로 못 박는다(값으로는 「덧씌운 쪽」도 칸은 맞게 나온다).
  const source = readFileSync(new URL("../queries/repair-cases.ts", import.meta.url), "utf8");
  assert.equal(
    source.includes("...mapRepairCaseRow(row),"),
    false,
    "조회가 매퍼 결과에 내자 날짜를 덧씌우고 있다 — isOverdue 가 그 값을 못 본다"
  );
  assert.ok(
    source.includes("mapRepairCaseRow(row, dueDatesByCaseId.get(row.id) ?? [])"),
    "목록 조회가 빌려 올 날짜를 매퍼에 넘기지 않는다"
  );
  // 🔴 상세 화면의 머리 카드가 이 조회의 isOverdue 로 그려진다.
  assert.ok(
    source.includes("loadDomesticOrderDueDatesByCaseId(dueDateBorrowerIds([row]))"),
    "건 하나 조회(getRepairCaseById)가 빌려 올 날짜를 읽지 않는다"
  );
});
