import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
  weeklyReportGoals,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createWeeklyReportGoal } from "../mutations/weekly-report-goals";
import { listWeeklyReportGoalWeeks, listWeeklyReportGoals } from "./weekly-report-goals";
import { buildGoalPrefix, formatGoalLine } from "@/lib/domain/weekly-report-goal";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 읽을 때 앞부분의 재료가 실제로 따라오는가
 * ============================================================================
 * 이 조회의 값은 다섯 표를 가로지르는 조인에서 나온다(목표 → 수리 건 → 고객사 ·
 * 제품 · 워크플로 종류). 조인 하나가 어긋나도 타입은 통과하므로, 그것을 잡는
 * 자리는 여기뿐이다.
 *
 * 지키는 것은 넷이다.
 *
 *  1. **앞부분의 재료가 전부 따라온다** — 고객사명·인수번호·형식·L/N·S/N.
 *     저장돼 있지 않은 값이라 조인이 끊기면 화면의 줄이 통째로 빈다.
 *  2. **RFG/MB 는 수리 건의 종류가 정한다** — 저장하지 않는다.
 *  3. **차례는 display_order, 같으면 적은 차례** — NULL 은 뒤로.
 *  4. **주 목록은 최근 주가 먼저이고 줄 수를 함께 센다.**
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 접수 월 "9603", 고객사 접두사 "AS-TEST-WEEKLY-GOAL-Q-",
 * 제품 모델 접두사 "WEEKLY-GOAL-QUERY-TEST-".
 *
 * listWeeklyReportGoalWeeks() 는 표 전체를 훑으므로 **다른 주까지 함께 나온다.**
 * 그래서 목록 전체를 통째로 대조하지 않고, 이 스위트가 만든 주만 골라 본다 —
 * 통째로 대조하면 옆 스위트가 남긴 줄 하나에 이 시험이 깨진다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-WEEKLY-GOAL-Q-";
const TEST_MODEL_PREFIX = "WEEKLY-GOAL-QUERY-TEST-";
const TEST_YEAR_MONTH = "9603";
const TEST_RECEIVED_AT = "2096-03-05";
/** 전부 월요일이다 — 이 스위트만 쓰는 주. */
const WEEK_OLDER = "2096-03-05";
const WEEK_NEWER = "2096-03-12";
const WEEK_EMPTY = "2096-03-19";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let customerName: string;
const repairCaseIds: string[] = [];
/** 인수번호·형식·L/N·S/N — 앞부분의 재료가 그대로 따라오는지 대조할 값. */
const caseFacts: { intakeNumber: string; modelName: string; lotNumber: string; serialNumber: string }[] = [];

function baseCreateRepairCaseInput(suffix: string): ValidatedCreateRepairCaseInput {
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: null,
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  actorUserId = engineer.id;

  customerName = `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}`;
  const [customer] = await db
    .insert(customers)
    .values({ name: customerName })
    .returning({ id: customers.id });
  customerId = customer.id;

  for (let index = 0; index < 3; index += 1) {
    const suffix = randomUUID().slice(0, 8);
    const input = baseCreateRepairCaseInput(suffix);
    const created = await createRepairCase(input);
    assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;
    repairCaseIds.push(created.id);

    const [row] = await db
      .select({ intakeNumber: repairCases.intakeNumber })
      .from(repairCases)
      .where(eq(repairCases.id, created.id));
    caseFacts.push({
      intakeNumber: row.intakeNumber,
      modelName: input.modelName,
      lotNumber: input.lotNumber!,
      serialNumber: input.serialNumber!,
    });
  }

  // 오래된 주에 두 줄(차례가 정해진 줄 + 정하지 않은 줄), 최근 주에 한 줄.
  await createWeeklyReportGoal({
    fields: {
      weekStartDate: WEEK_OLDER,
      repairCaseId: repairCaseIds[0],
      goalText: "견적서 발행",
      displayOrder: 1,
    },
    actorUserId,
  });
  await createWeeklyReportGoal({
    fields: {
      weekStartDate: WEEK_OLDER,
      repairCaseId: repairCaseIds[1],
      goalText: "차례를 정하지 않은 줄",
      displayOrder: null,
    },
    actorUserId,
  });
  await createWeeklyReportGoal({
    fields: {
      weekStartDate: WEEK_NEWER,
      repairCaseId: repairCaseIds[2],
      goalText: "수리 완료",
      displayOrder: 1,
    },
    actorUserId,
  });
});

after(async () => {
  if (repairCaseIds.length > 0) {
    await db.delete(weeklyReportGoals).where(inArray(weeklyReportGoals.repairCaseId, repairCaseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("listWeeklyReportGoals", () => {
  test("그 주의 줄만 나온다", async () => {
    const rows = await listWeeklyReportGoals(WEEK_OLDER);
    assert.equal(rows.length, 2);
    for (const row of rows) assert.equal(row.weekStartDate, WEEK_OLDER);
  });

  test("줄이 없는 주는 빈 목록이다", async () => {
    assert.deepEqual(await listWeeklyReportGoals(WEEK_EMPTY), []);
  });

  test("앞부분의 재료가 전부 따라온다 — 저장돼 있지 않은 값이다", async () => {
    const rows = await listWeeklyReportGoals(WEEK_NEWER);
    assert.equal(rows.length, 1);
    const row = rows[0];
    const facts = caseFacts[2];

    assert.equal(row.customerName, customerName);
    assert.equal(row.intakeNumber, facts.intakeNumber);
    assert.equal(row.modelName, facts.modelName);
    assert.equal(row.lotNumber, facts.lotNumber);
    assert.equal(row.serialNumber, facts.serialNumber);

    // 조회가 넘긴 재료로 도메인이 실제 그 줄을 만들어 낼 수 있어야 한다 —
    // 재료가 하나라도 빠지면 여기서 드러난다.
    assert.equal(
      formatGoalLine(buildGoalPrefix(row), row.goalText),
      `[${customerName}] ${facts.intakeNumber}_${facts.modelName}_${facts.lotNumber}_${facts.serialNumber}: 수리 완료`
    );
  });

  test("RFG/MB 는 수리 건의 워크플로 종류가 정한다 — 저장하지 않는다", async () => {
    const rows = await listWeeklyReportGoals(WEEK_NEWER);
    assert.equal(rows[0].workflowType, "PAID_MATCHER");
    assert.equal(rows[0].kind, "MB", "Matcher 는 MB 상자다");
  });

  test("version 과 만든 시각이 함께 나온다 — 폼이 그대로 다시 실어 보낸다", async () => {
    const rows = await listWeeklyReportGoals(WEEK_NEWER);
    assert.equal(rows[0].version, 1);
    assert.ok(rows[0].createdAt instanceof Date);
  });

  test("차례를 정하지 않은 줄은 뒤로 간다", async () => {
    const rows = await listWeeklyReportGoals(WEEK_OLDER);
    assert.deepEqual(
      rows.map((row) => [row.displayOrder, row.goalText]),
      [
        [1, "견적서 발행"],
        [null, "차례를 정하지 않은 줄"],
      ]
    );
  });
});

describe("listWeeklyReportGoalWeeks", () => {
  test("줄이 있는 주만 나오고, 줄 수를 함께 센다", async () => {
    const weeks = await listWeeklyReportGoalWeeks();
    const mine = new Map(weeks.map((week) => [week.weekStartDate, week.goalCount]));

    assert.equal(mine.get(WEEK_OLDER), 2);
    assert.equal(mine.get(WEEK_NEWER), 1);
    assert.equal(mine.has(WEEK_EMPTY), false, "줄이 없는 주는 목록에 없다");
  });

  test("줄 수는 문자열이 아니라 숫자다 — count(*) 는 bigint 로 온다", async () => {
    // 문자열로 그대로 넘기면 화면에서 "12" > "9" 같은 비교가 만들어진다.
    const weeks = await listWeeklyReportGoalWeeks();
    const older = weeks.find((week) => week.weekStartDate === WEEK_OLDER);
    assert.equal(typeof older?.goalCount, "number");
  });

  test("최근 주가 먼저다", async () => {
    const weeks = await listWeeklyReportGoalWeeks();
    const olderIndex = weeks.findIndex((week) => week.weekStartDate === WEEK_OLDER);
    const newerIndex = weeks.findIndex((week) => week.weekStartDate === WEEK_NEWER);
    assert.ok(olderIndex >= 0 && newerIndex >= 0);
    assert.ok(newerIndex < olderIndex, "최근 주가 앞에 와야 한다");
  });
});
