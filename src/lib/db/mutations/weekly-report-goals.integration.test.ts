import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
  weeklyReportGoals,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  copyWeeklyReportGoals,
  createWeeklyReportGoal,
  deleteWeeklyReportGoal,
  updateWeeklyReportGoal,
} from "./weekly-report-goals";
import { addCalendarDays } from "@/lib/domain/date-only";
import type { WeeklyReportGoalFields } from "@/lib/validation/weekly-report-goal-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 줄이 실제로 들어가고, 동시 수정이 막히고, 복사가 늘어나지
 * 않는가
 * ============================================================================
 * 확인하는 것은 다섯이다.
 *
 *  1. **추가·수정이 같은 칸들을 쓴다** — 추가하면 들어가는데 수정하면 안
 *     들어가는 칸이 없어야 한다.
 *  2. **version 이 낙관적 잠금으로 실제로 동작한다** — 낡은 version 으로 온
 *     저장은 CONFLICT 이고, 그때 줄은 한 글자도 바뀌지 않는다.
 *  3. **삭제는 바로 지운다** — 휴지통이 없으므로 행 자체가 사라져야 한다.
 *     그리고 그 삭제도 version 을 본다.
 *  4. **수정·삭제가 남의 줄을 건드리지 않는다** — id 로 좁히지 않으면 한 줄을
 *     고치는 일이 그 주 상자를 통째로 비우는 일이 된다.
 *  5. **복사는 여러 번 눌러도 늘어나지 않는다** — 대상 주에 이미 있는 수리
 *     건은 건너뛴다(멱등). 그리고 몇 건을 옮기고 몇 건을 건너뛰었는지 센다.
 *
 * 인가는 여기서 시험하지 않는다. 세션·역할 판정은 서버 액션의 몫이고
 * (mutations 파일 헤더의 계층 구분), 역할 정책은 permission-areas.test.ts 가
 * 따로 본다 — domestic-orders.integration.test.ts 와 같은 방식이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 이 스위트만 쓰는 접수 월 "9602",
 * 고객사 접두사 "AS-TEST-WEEKLY-GOAL-", 제품 모델 접두사 "WEEKLY-GOAL-TEST-".
 * 인수번호의 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와
 * TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * **주는 테스트마다 다르다.** nextWeek() 이 2096-02-06(월요일)에서 7일씩 더해
 * 새 월요일을 내놓으므로, 한 테스트가 만든 줄이 다른 테스트의 "그 주 목록"에
 * 섞이지 않는다. 7의 배수라 결과는 언제나 월요일이다.
 *
 * after() 는 이 스위트가 만든 행만 FK 순서대로 지운다 — 목표 줄을 먼저 지운다.
 * 그 표가 repair_cases 를 CASCADE 로 가리키므로 순서를 지키지 않아도 함께
 * 사라지지만, 순서를 적어 두는 편이 나중에 이 파일을 고치는 사람에게 안전하다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-WEEKLY-GOAL-";
const TEST_MODEL_PREFIX = "WEEKLY-GOAL-TEST-";
const TEST_YEAR_MONTH = "9602";
const TEST_RECEIVED_AT = "2096-02-05";
/** 2096-02-06 은 월요일이다. 아래 nextWeek() 이 여기서 7일씩 더한다. */
const FIRST_TEST_WEEK = "2096-02-06";

let actorUserId: string;
let otherActorUserId: string;
let engineerId: string;
let customerId: string;
const repairCaseIds: string[] = [];

let weekCounter = 0;
/** 이 스위트 안에서 겹치지 않는 월요일. 7의 배수를 더하므로 언제나 월요일이다. */
function nextWeek(): string {
  weekCounter += 1;
  return addCalendarDays(FIRST_TEST_WEEK, weekCounter * 7);
}

function fields(overrides: Partial<WeeklyReportGoalFields> = {}): WeeklyReportGoalFields {
  return {
    weekStartDate: FIRST_TEST_WEEK,
    repairCaseId: repairCaseIds[0],
    goalText: "견적서 발행",
    displayOrder: null,
    ...overrides,
  };
}

async function createGoal(overrides: Partial<WeeklyReportGoalFields> = {}) {
  const result = await createWeeklyReportGoal({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  return result;
}

async function readGoal(id: string) {
  const [row] = await db.select().from(weeklyReportGoals).where(eq(weeklyReportGoals.id, id));
  return row;
}

/** 그 주의 줄을 **조회와 같은 차례로**. 여기서 본 차례가 곧 화면의 차례다. */
async function readWeek(weekStart: string) {
  return db
    .select({
      id: weeklyReportGoals.id,
      repairCaseId: weeklyReportGoals.repairCaseId,
      goalText: weeklyReportGoals.goalText,
      displayOrder: weeklyReportGoals.displayOrder,
      version: weeklyReportGoals.version,
      createdBy: weeklyReportGoals.createdBy,
    })
    .from(weeklyReportGoals)
    .where(eq(weeklyReportGoals.weekStartDate, weekStart))
    .orderBy(asc(weeklyReportGoals.displayOrder), asc(weeklyReportGoals.createdAt));
}

function baseCreateRepairCaseInput(): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
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
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야
  // 한다. 역할은 상관없으므로 엔지니어를 그대로 쓴다(인가는 서버 액션의 몫이다).
  actorUserId = engineer.id;

  // 복사한 사람이 원본을 적은 사람과 **다르게** 기록되는지 보려면 계정이 둘
  // 필요하다.
  const [otherUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPER_ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(otherUser, "expected an approved SUPER_ADMIN in the test DB");
  assert.notEqual(otherUser.id, actorUserId, "두 계정은 서로 달라야 한다");
  otherActorUserId = otherUser.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  // 세 건이면 복사·건너뜀·남의 줄을 전부 시험할 수 있다.
  for (let index = 0; index < 3; index += 1) {
    const created = await createRepairCase(baseCreateRepairCaseInput());
    assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
    if (created.ok) repairCaseIds.push(created.id);
  }
});

after(async () => {
  // 목표 줄이 먼저다 — repair_cases 를 가리키고 있다(CASCADE 라 순서를 어겨도
  // 함께 사라지지만, 이 순서가 이 파일의 규약이다).
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

describe("createWeeklyReportGoal", () => {
  test("새 줄은 version 1로 시작하고 만든 사람이 기록된다", async () => {
    const week = nextWeek();
    const result = await createGoal({ weekStartDate: week, goalText: "수리 완료", displayOrder: 2 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.version, 1);

    const row = await readGoal(result.id);
    assert.equal(row.weekStartDate, week);
    assert.equal(row.repairCaseId, repairCaseIds[0]);
    assert.equal(row.goalText, "수리 완료");
    assert.equal(row.displayOrder, 2);
    assert.equal(row.version, 1);
    assert.equal(row.createdBy, actorUserId);
    // 만든 사람이 곧 마지막으로 고친 사람이다 — 첫 수정 전까지 빈칸으로 두지
    // 않는다.
    assert.equal(row.updatedBy, actorUserId);
  });

  test("차례를 정하지 않은 줄도 만들 수 있다", async () => {
    const result = await createGoal({ weekStartDate: nextWeek(), displayOrder: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((await readGoal(result.id)).displayOrder, null);
  });

  test("없는 수리 건을 가리키면 FK 오류가 아니라 VALIDATION_ERROR다", async () => {
    const result = await createWeeklyReportGoal({
      fields: fields({ weekStartDate: nextWeek(), repairCaseId: randomUUID() }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);
  });

  test("같은 주에 같은 수리 건으로 두 줄을 적을 수 있다 — 사람이 일부러 나눠 적는다", async () => {
    // 표에 유일 제약을 두지 않은 결과다. 한 건에 이번 주 할 일이 둘일 수 있고
    // ("견적서 발행", "부품 입고 확인"), 막으면 사람은 한 칸에 몰아 적는다.
    // 복사는 반대로 접는다(아래 '복사' 묶음) — 그쪽은 사람이 적는 것이 아니라
    // 기계가 늘리는 자리라서 늘어나면 안 된다.
    const week = nextWeek();
    const first = await createGoal({ weekStartDate: week, goalText: "견적서 발행" });
    const second = await createGoal({ weekStartDate: week, goalText: "부품 입고 확인" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal((await readWeek(week)).length, 2);
  });
});

describe("updateWeeklyReportGoal", () => {
  test("수정이 값과 version과 고친 사람을 함께 남긴다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week, goalText: "고치기 전" });
    if (!created.ok) return;
    const before = await readGoal(created.id);

    const result = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ weekStartDate: week, goalText: "고친 뒤", displayOrder: 5 }),
      actorUserId: otherActorUserId,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);

    const row = await readGoal(created.id);
    assert.equal(row.goalText, "고친 뒤");
    assert.equal(row.displayOrder, 5);
    assert.equal(row.version, 2);
    assert.equal(row.updatedBy, otherActorUserId);
    assert.ok(row.updatedAt.getTime() >= before.updatedAt.getTime());
    // 만든 사람은 수정으로 바뀌지 않는다.
    assert.equal(row.createdBy, before.createdBy);
  });

  test("저장할 때마다 version이 1씩 오른다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week });
    if (!created.ok) return;

    let version = created.version;
    for (const expected of [2, 3, 4]) {
      const result = await updateWeeklyReportGoal({
        id: created.id,
        expectedVersion: version,
        fields: fields({ weekStartDate: week, goalText: `단계 ${expected}` }),
        actorUserId,
      });
      assert.equal(result.ok, true, `update to ${expected} failed: ${JSON.stringify(result)}`);
      if (!result.ok) return;
      assert.equal(result.version, expected);
      version = result.version;
    }

    const row = await readGoal(created.id);
    assert.equal(row.version, 4);
    assert.equal(row.goalText, "단계 4");
  });

  test("줄을 다른 주로 옮길 수 있다 — 잘못 적은 주에서 빠져나올 길이 있어야 한다", async () => {
    const from = nextWeek();
    const to = nextWeek();
    const created = await createGoal({ weekStartDate: from });
    if (!created.ok) return;

    const result = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ weekStartDate: to }),
      actorUserId,
    });
    assert.equal(result.ok, true, `옮기기 실패: ${JSON.stringify(result)}`);

    assert.equal((await readWeek(from)).length, 0);
    assert.equal((await readWeek(to)).length, 1);
  });

  test("연결된 수리 건을 바꿀 수 있다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week, repairCaseId: repairCaseIds[0] });
    if (!created.ok) return;

    const result = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ weekStartDate: week, repairCaseId: repairCaseIds[1] }),
      actorUserId,
    });
    assert.equal(result.ok, true, `수정 실패: ${JSON.stringify(result)}`);
    assert.equal((await readGoal(created.id)).repairCaseId, repairCaseIds[1]);
  });

  test("낡은 version으로 온 저장은 CONFLICT이고 줄은 그대로다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week, goalText: "처음" });
    if (!created.ok) return;
    const staleVersion = created.version;

    const first = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ weekStartDate: week, goalText: "먼저 저장된 값" }),
      actorUserId,
    });
    assert.equal(first.ok, true);

    const second = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ weekStartDate: week, goalText: "덮어써서는 안 되는 값" }),
      actorUserId,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");

    const row = await readGoal(created.id);
    assert.equal(row.goalText, "먼저 저장된 값", "충돌한 저장이 적용되어서는 안 된다");
    assert.equal(row.version, 2, "충돌한 저장은 version 도 올리지 않는다");
  });

  test("동시에 들어온 두 저장 중 정확히 하나만 성공한다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week });
    if (!created.ok) return;

    const [a, b] = await Promise.all([
      updateWeeklyReportGoal({
        id: created.id,
        expectedVersion: created.version,
        fields: fields({ weekStartDate: week, goalText: "A" }),
        actorUserId,
      }),
      updateWeeklyReportGoal({
        id: created.id,
        expectedVersion: created.version,
        fields: fields({ weekStartDate: week, goalText: "B" }),
        actorUserId,
      }),
    ]);

    assert.deepEqual([a.ok, b.ok].sort(), [false, true], "동시 저장 중 하나만 성공해야 한다");
    const loser = a.ok ? b : a;
    if (!loser.ok) assert.equal(loser.code, "CONFLICT");

    assert.equal((await readGoal(created.id)).version, 2, "성공한 쪽 한 번만 version 이 올라야 한다");
  });

  test("없는 수리 건으로 고치려 하면 VALIDATION_ERROR이고 줄은 그대로다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week, goalText: "그대로 남아야 한다" });
    if (!created.ok) return;

    const result = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({
        weekStartDate: week,
        repairCaseId: randomUUID(),
        goalText: "적용되면 안 된다",
      }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);

    const row = await readGoal(created.id);
    assert.equal(row.goalText, "그대로 남아야 한다");
    assert.equal(row.version, 1);
  });

  test("없는 id는 NOT_FOUND다", async () => {
    const result = await updateWeeklyReportGoal({
      id: randomUUID(),
      expectedVersion: 1,
      fields: fields({ weekStartDate: nextWeek() }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("한 줄을 고쳐도 같은 주의 다른 줄은 그대로다 — 수정은 id 로 좁힌다", async () => {
    const week = nextWeek();
    const target = await createGoal({
      weekStartDate: week,
      repairCaseId: repairCaseIds[0],
      goalText: "고칠 줄",
      displayOrder: 1,
    });
    const neighbour = await createGoal({
      weekStartDate: week,
      repairCaseId: repairCaseIds[1],
      goalText: "건드리면 안 되는 줄",
      displayOrder: 2,
    });
    if (!target.ok || !neighbour.ok) return;

    const result = await updateWeeklyReportGoal({
      id: target.id,
      expectedVersion: target.version,
      fields: fields({ weekStartDate: week, repairCaseId: repairCaseIds[0], goalText: "고쳤다" }),
      actorUserId,
    });
    assert.equal(result.ok, true, `수정 실패: ${JSON.stringify(result)}`);

    const neighbourRow = await readGoal(neighbour.id);
    assert.equal(neighbourRow.goalText, "건드리면 안 되는 줄");
    assert.equal(neighbourRow.version, 1, "남의 줄은 version 도 오르지 않는다");
  });
});

describe("deleteWeeklyReportGoal", () => {
  test("삭제는 행 자체를 지운다 — 휴지통이 없다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week });
    if (!created.ok) return;

    const result = await deleteWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
    });
    assert.equal(result.ok, true, `삭제 실패: ${JSON.stringify(result)}`);

    assert.equal(await readGoal(created.id), undefined, "지운 줄이 남아 있으면 안 된다");
    assert.equal((await readWeek(week)).length, 0);
  });

  test("낡은 version으로 온 삭제는 CONFLICT이고 줄은 그대로 남는다", async () => {
    const week = nextWeek();
    const created = await createGoal({ weekStartDate: week, goalText: "처음" });
    if (!created.ok) return;
    const staleVersion = created.version;

    const updated = await updateWeeklyReportGoal({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ weekStartDate: week, goalText: "그 사이 누가 고쳐 둔 값" }),
      actorUserId,
    });
    assert.equal(updated.ok, true);

    // 낡은 화면에서 누른 '삭제'. 되돌릴 수 없는 조작이라 여기서 막지 않으면
    // 지우는 사람이 보고 있던 줄과 실제로 지워지는 줄이 달라진다.
    const result = await deleteWeeklyReportGoal({ id: created.id, expectedVersion: staleVersion });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");

    const row = await readGoal(created.id);
    assert.ok(row, "충돌한 삭제가 줄을 지워서는 안 된다");
    assert.equal(row.goalText, "그 사이 누가 고쳐 둔 값");
    assert.equal(row.version, 2);
  });

  test("같은 줄을 두 번 지우면 두 번째는 NOT_FOUND다", async () => {
    const created = await createGoal({ weekStartDate: nextWeek() });
    if (!created.ok) return;

    const first = await deleteWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
    });
    assert.equal(first.ok, true);

    const second = await deleteWeeklyReportGoal({
      id: created.id,
      expectedVersion: created.version,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "NOT_FOUND");
  });

  test("없는 id는 NOT_FOUND다", async () => {
    const result = await deleteWeeklyReportGoal({ id: randomUUID(), expectedVersion: 1 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("한 줄을 지워도 같은 주의 다른 줄은 남는다 — 삭제는 id 로 좁힌다", async () => {
    const week = nextWeek();
    const target = await createGoal({
      weekStartDate: week,
      repairCaseId: repairCaseIds[0],
      goalText: "지울 줄",
    });
    const survivor = await createGoal({
      weekStartDate: week,
      repairCaseId: repairCaseIds[1],
      goalText: "남아야 하는 줄",
    });
    if (!target.ok || !survivor.ok) return;

    const result = await deleteWeeklyReportGoal({
      id: target.id,
      expectedVersion: target.version,
    });
    assert.equal(result.ok, true, `삭제 실패: ${JSON.stringify(result)}`);

    const remaining = await readWeek(week);
    assert.deepEqual(
      remaining.map((row) => row.goalText),
      ["남아야 하는 줄"],
      "한 줄을 지우는 일이 그 주 상자를 비워서는 안 된다"
    );
  });
});

/**
 * ── 지난주 줄 복사 ───────────────────────────────────────────────────────
 * 여기서 지키는 것은 넷이다.
 *
 *  1. 줄과 **차례가 그대로** 옮겨지고, 새 줄이므로 version 은 1이다.
 *  2. **이미 있는 수리 건은 건너뛴다** — 그 수를 세어 돌려준다.
 *  3. **여러 번 눌러도 늘어나지 않는다**(멱등). 이 항목이 이 묶음의 핵심이다.
 *  4. **원본 주는 그대로 남는다** — 복사이지 이동이 아니다.
 */
describe("copyWeeklyReportGoals", () => {
  test("줄과 차례가 그대로 옮겨지고, 만든 사람은 복사한 사람이다", async () => {
    const from = nextWeek();
    const to = nextWeek();
    await createGoal({
      weekStartDate: from,
      repairCaseId: repairCaseIds[0],
      goalText: "견적서 발행",
      displayOrder: 1,
    });
    await createGoal({
      weekStartDate: from,
      repairCaseId: repairCaseIds[1],
      goalText: "수리 완료",
      displayOrder: 2,
    });

    const result = await copyWeeklyReportGoals({
      fromWeekStart: from,
      toWeekStart: to,
      actorUserId: otherActorUserId,
    });
    assert.equal(result.ok, true, `복사 실패: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.copied, 2);
    assert.equal(result.skipped, 0);

    const copied = await readWeek(to);
    assert.deepEqual(
      copied.map((row) => [row.repairCaseId, row.goalText, row.displayOrder, row.version]),
      [
        [repairCaseIds[0], "견적서 발행", 1, 1],
        [repairCaseIds[1], "수리 완료", 2, 1],
      ]
    );
    for (const row of copied) {
      assert.equal(row.createdBy, otherActorUserId, "이번 주 상자를 만든 사람이 남아야 한다");
    }
  });

  test("원본 주는 그대로 남는다 — 복사이지 이동이 아니다", async () => {
    const from = nextWeek();
    const to = nextWeek();
    await createGoal({ weekStartDate: from, repairCaseId: repairCaseIds[0], goalText: "원본" });

    const result = await copyWeeklyReportGoals({ fromWeekStart: from, toWeekStart: to, actorUserId });
    assert.equal(result.ok, true);

    const source = await readWeek(from);
    assert.deepEqual(source.map((row) => row.goalText), ["원본"]);
  });

  test("두 번 눌러도 늘어나지 않는다 — 두 번째는 전부 건너뛴다", async () => {
    const from = nextWeek();
    const to = nextWeek();
    await createGoal({ weekStartDate: from, repairCaseId: repairCaseIds[0], goalText: "한 줄" });
    await createGoal({ weekStartDate: from, repairCaseId: repairCaseIds[1], goalText: "두 줄" });

    const first = await copyWeeklyReportGoals({ fromWeekStart: from, toWeekStart: to, actorUserId });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.copied, 2);
    assert.equal(first.skipped, 0);

    const second = await copyWeeklyReportGoals({ fromWeekStart: from, toWeekStart: to, actorUserId });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.copied, 0, "두 번째 복사가 줄을 늘려서는 안 된다");
    assert.equal(second.skipped, 2);

    assert.equal((await readWeek(to)).length, 2, "버튼을 두 번 눌렀다고 두 벌이 되면 안 된다");
  });

  test("먼저 적어 둔 문장은 덮이지 않는다 — 건너뛴 수로 드러난다", async () => {
    const from = nextWeek();
    const to = nextWeek();
    await createGoal({
      weekStartDate: from,
      repairCaseId: repairCaseIds[0],
      goalText: "지난주 문장",
    });
    await createGoal({ weekStartDate: from, repairCaseId: repairCaseIds[1], goalText: "옮겨질 줄" });
    await createGoal({
      weekStartDate: to,
      repairCaseId: repairCaseIds[0],
      goalText: "이번 주에 먼저 적은 문장",
    });

    const result = await copyWeeklyReportGoals({ fromWeekStart: from, toWeekStart: to, actorUserId });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.copied, 1);
    assert.equal(result.skipped, 1);

    const rows = await readWeek(to);
    const kept = rows.find((row) => row.repairCaseId === repairCaseIds[0]);
    assert.equal(
      kept?.goalText,
      "이번 주에 먼저 적은 문장",
      "방금 적은 문장이 말없이 사라져서는 안 된다"
    );
    assert.equal(rows.length, 2);
  });

  test("원본 주에 같은 수리 건이 두 줄이면 하나만 옮긴다", async () => {
    // 접지 않으면 대상 주에 같은 건이 두 줄 생기고, 다음 복사가 그 둘을 다시
    // 건너뛰는 상태가 굳어진다.
    const from = nextWeek();
    const to = nextWeek();
    await createGoal({
      weekStartDate: from,
      repairCaseId: repairCaseIds[0],
      goalText: "첫 줄",
      displayOrder: 1,
    });
    await createGoal({
      weekStartDate: from,
      repairCaseId: repairCaseIds[0],
      goalText: "둘째 줄",
      displayOrder: 2,
    });

    const result = await copyWeeklyReportGoals({ fromWeekStart: from, toWeekStart: to, actorUserId });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.copied, 1);
    assert.equal(result.skipped, 1);

    const rows = await readWeek(to);
    assert.deepEqual(rows.map((row) => row.goalText), ["첫 줄"]);
  });

  test("가져올 주에 줄이 하나도 없으면 VALIDATION_ERROR다", async () => {
    // "0건 복사"를 성공으로 돌려주면, 사람은 아무것도 늘지 않은 화면을 보고
    // 고장을 의심한다.
    const to = nextWeek();
    const result = await copyWeeklyReportGoals({
      fromWeekStart: nextWeek(),
      toWeekStart: to,
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.equal((await readWeek(to)).length, 0);
  });

  test("복사는 다른 주의 줄을 건드리지 않는다", async () => {
    const from = nextWeek();
    const to = nextWeek();
    const bystander = nextWeek();
    await createGoal({ weekStartDate: from, repairCaseId: repairCaseIds[0], goalText: "옮길 줄" });
    await createGoal({
      weekStartDate: bystander,
      repairCaseId: repairCaseIds[0],
      goalText: "남의 주",
    });

    const result = await copyWeeklyReportGoals({ fromWeekStart: from, toWeekStart: to, actorUserId });
    assert.equal(result.ok, true);

    const others = await readWeek(bystander);
    assert.deepEqual(others.map((row) => row.goalText), ["남의 주"]);
  });
});
