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
  weeklyReportDeliveries,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createWeeklyReportDelivery,
  deleteWeeklyReportDelivery,
  updateWeeklyReportDelivery,
} from "./weekly-report-deliveries";
import { addCalendarDays } from "@/lib/domain/date-only";
import type { WeeklyReportDeliveryFields } from "@/lib/validation/weekly-report-delivery-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 주간보고 납입 예정 건 — 줄이 실제로 들어가고, 동시 수정과 동시 삭제가 막히는가
 * ============================================================================
 * 확인하는 것은 넷이다.
 *
 *  1. **추가·수정이 같은 칸들을 쓴다** — 추가하면 들어가는데 수정하면 안
 *     들어가는 칸이 없어야 한다. 비고는 **비워 둘 수 있다**(금주 목표와 갈리는
 *     지점이라 양쪽을 다 본다).
 *  2. **version 이 낙관적 잠금으로 실제로 동작한다** — 낡은 version 으로 온
 *     저장은 CONFLICT 이고, 그때 줄은 **한 글자도 바뀌지 않는다.**
 *  3. **삭제는 바로 지우되 version 을 본다** — 휴지통이 없으므로 행 자체가
 *     사라져야 하고, version 이 어긋난 삭제는 거절되며 그때도 줄은 그대로다.
 *  4. **수정·삭제가 남의 줄을 건드리지 않는다** — id 로 좁히지 않으면 한 줄을
 *     지우는 일이 그 주 표를 통째로 비우는 일이 된다.
 *
 * 인가는 여기서 시험하지 않는다. 세션·역할 판정은 서버 액션의 몫이고
 * (mutations 파일 헤더의 계층 구분), 역할 정책은 permission-areas.test.ts 가
 * 따로 본다 — weekly-report-goals.integration.test.ts 와 같은 방식이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 이 스위트만 쓰는 접수 월 "9606",
 * 고객사 접두사 "AS-TEST-WEEKLY-DELIVERY-", 제품 모델 접두사
 * "WEEKLY-DELIVERY-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로
 * TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * **주는 테스트마다 다르다.** nextWeek() 이 2096-06-04(월요일)에서 7일씩 더해
 * 새 월요일을 내놓으므로, 한 테스트가 만든 줄이 다른 테스트의 "그 주 목록"에
 * 섞이지 않는다. 7의 배수라 결과는 언제나 월요일이다.
 *
 * after() 는 이 스위트가 만든 행만 FK 순서대로 지운다 — 납입 예정 줄을 먼저
 * 지운다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-WEEKLY-DELIVERY-";
const TEST_MODEL_PREFIX = "WEEKLY-DELIVERY-TEST-";
const TEST_YEAR_MONTH = "9606";
const TEST_RECEIVED_AT = "2096-06-05";
/** 2096-06-04 는 월요일이다. 아래 nextWeek() 이 여기서 7일씩 더한다. */
const FIRST_TEST_WEEK = "2096-06-04";

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

function fields(overrides: Partial<WeeklyReportDeliveryFields> = {}): WeeklyReportDeliveryFields {
  return {
    weekStartDate: FIRST_TEST_WEEK,
    repairCaseId: repairCaseIds[0],
    note: null,
    displayOrder: null,
    ...overrides,
  };
}

async function createDelivery(overrides: Partial<WeeklyReportDeliveryFields> = {}) {
  const result = await createWeeklyReportDelivery({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  return result;
}

async function readDelivery(id: string) {
  const [row] = await db
    .select()
    .from(weeklyReportDeliveries)
    .where(eq(weeklyReportDeliveries.id, id));
  return row;
}

/** 그 주의 줄을 **조회와 같은 차례로**. 여기서 본 차례가 곧 화면의 차례다. */
async function readWeek(weekStart: string) {
  return db
    .select({
      id: weeklyReportDeliveries.id,
      repairCaseId: weeklyReportDeliveries.repairCaseId,
      note: weeklyReportDeliveries.note,
      displayOrder: weeklyReportDeliveries.displayOrder,
      version: weeklyReportDeliveries.version,
      createdBy: weeklyReportDeliveries.createdBy,
    })
    .from(weeklyReportDeliveries)
    .where(eq(weeklyReportDeliveries.weekStartDate, weekStart))
    .orderBy(asc(weeklyReportDeliveries.displayOrder), asc(weeklyReportDeliveries.createdAt));
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

  // 고친 사람이 만든 사람과 **다르게** 기록되는지 보려면 계정이 둘 필요하다.
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

  // 두 건이면 '남의 줄을 건드리지 않는다'까지 시험할 수 있다.
  for (let index = 0; index < 2; index += 1) {
    const created = await createRepairCase(baseCreateRepairCaseInput());
    assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
    if (created.ok) repairCaseIds.push(created.id);
  }
});

after(async () => {
  // 납입 예정 줄이 먼저다 — repair_cases 를 가리키고 있다(CASCADE 라 순서를
  // 어겨도 함께 사라지지만, 이 순서가 이 파일의 규약이다).
  if (repairCaseIds.length > 0) {
    await db
      .delete(weeklyReportDeliveries)
      .where(inArray(weeklyReportDeliveries.repairCaseId, repairCaseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("createWeeklyReportDelivery", () => {
  test("새 줄은 version 1로 시작하고 만든 사람이 기록된다", async () => {
    const week = nextWeek();
    const result = await createDelivery({
      weekStartDate: week,
      note: "고객사 요청으로 연기",
      displayOrder: 2,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.version, 1);

    const row = await readDelivery(result.id);
    assert.equal(row.weekStartDate, week);
    assert.equal(row.repairCaseId, repairCaseIds[0]);
    assert.equal(row.note, "고객사 요청으로 연기");
    assert.equal(row.displayOrder, 2);
    assert.equal(row.version, 1);
    assert.equal(row.createdBy, actorUserId);
    // 만든 사람이 곧 마지막으로 고친 사람이다 — 첫 수정 전까지 빈칸으로 두지
    // 않는다.
    assert.equal(row.updatedBy, actorUserId);
  });

  test("비고 없이도 줄이 들어간다 — 이 표에서 note 만 NULL 을 허용한다", async () => {
    const week = nextWeek();
    const result = await createDelivery({ weekStartDate: week, note: null });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const row = await readDelivery(result.id);
    assert.equal(row.note, null);
  });

  test("없는 수리 건은 칸 단위 오류로 거절한다 — FK 위반을 그대로 내보내지 않는다", async () => {
    const result = await createWeeklyReportDelivery({
      fields: fields({ repairCaseId: randomUUID() }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);
  });

  test("한 주에 같은 건을 두 줄 올릴 수 있다 — 막지 않는다", async () => {
    // 분할 납품처럼 비고가 서로 다른 줄이 실제로 생긴다(mutation 헤더).
    const week = nextWeek();
    await createDelivery({ weekStartDate: week, note: "1차분", displayOrder: 1 });
    await createDelivery({ weekStartDate: week, note: "2차분", displayOrder: 2 });

    const rows = await readWeek(week);
    assert.deepEqual(
      rows.map((row) => row.note),
      ["1차분", "2차분"]
    );
  });
});

describe("updateWeeklyReportDelivery", () => {
  test("비고를 고치면 version 이 오르고 고친 사람이 기록된다", async () => {
    const week = nextWeek();
    const created = await createDelivery({ weekStartDate: week, note: null });
    if (!created.ok) return;

    const result = await updateWeeklyReportDelivery({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ weekStartDate: week, note: "출하 준비 완료", displayOrder: 3 }),
      actorUserId: otherActorUserId,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.version, 2);

    const row = await readDelivery(created.id);
    assert.equal(row.note, "출하 준비 완료");
    assert.equal(row.displayOrder, 3);
    assert.equal(row.version, 2);
    assert.equal(row.createdBy, actorUserId, "만든 사람은 그대로다");
    assert.equal(row.updatedBy, otherActorUserId);
  });

  test("적어 둔 비고를 다시 비울 수 있다", async () => {
    const week = nextWeek();
    const created = await createDelivery({ weekStartDate: week, note: "적었다가" });
    if (!created.ok) return;

    const result = await updateWeeklyReportDelivery({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ weekStartDate: week, note: null }),
      actorUserId,
    });
    assert.equal(result.ok, true);
    assert.equal((await readDelivery(created.id)).note, null);
  });

  test("주와 수리 건도 함께 고칠 수 있다 — 잘못 단 줄을 옮기는 길이다", async () => {
    const week = nextWeek();
    const movedTo = nextWeek();
    const created = await createDelivery({ weekStartDate: week });
    if (!created.ok) return;

    const result = await updateWeeklyReportDelivery({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ weekStartDate: movedTo, repairCaseId: repairCaseIds[1] }),
      actorUserId,
    });
    assert.equal(result.ok, true);

    const row = await readDelivery(created.id);
    assert.equal(row.weekStartDate, movedTo);
    assert.equal(row.repairCaseId, repairCaseIds[1]);
    assert.equal((await readWeek(week)).length, 0, "옮겨 간 주에는 줄이 남지 않는다");
  });

  test("낡은 version 으로 온 수정은 CONFLICT 이고 한 글자도 바뀌지 않는다", async () => {
    const week = nextWeek();
    const created = await createDelivery({ weekStartDate: week, note: "먼저 적은 문장" });
    if (!created.ok) return;

    // 남이 먼저 고쳐 version 이 2가 된다.
    const first = await updateWeeklyReportDelivery({
      id: created.id,
      expectedVersion: 1,
      fields: fields({ weekStartDate: week, note: "남이 고친 문장" }),
      actorUserId: otherActorUserId,
    });
    assert.equal(first.ok, true);

    const before = await readDelivery(created.id);

    // 낡은 화면이 version 1을 들고 다시 저장한다.
    const stale = await updateWeeklyReportDelivery({
      id: created.id,
      expectedVersion: 1,
      fields: fields({ weekStartDate: week, note: "덮어써서는 안 되는 문장" }),
      actorUserId,
    });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.code, "CONFLICT");
    assert.ok(stale.message.includes("다시 불러온"));

    const after = await readDelivery(created.id);
    assert.equal(after.note, "남이 고친 문장");
    assert.equal(after.version, before.version);
    assert.equal(after.updatedBy, otherActorUserId);
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "손대지 않았다");
  });

  test("없는 줄을 고치면 NOT_FOUND 다", async () => {
    const result = await updateWeeklyReportDelivery({
      id: randomUUID(),
      expectedVersion: 1,
      fields: fields(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("수정은 남의 줄을 건드리지 않는다", async () => {
    const week = nextWeek();
    const mine = await createDelivery({ weekStartDate: week, note: "내 줄", displayOrder: 1 });
    const other = await createDelivery({
      weekStartDate: week,
      repairCaseId: repairCaseIds[1],
      note: "남의 줄",
      displayOrder: 2,
    });
    if (!mine.ok || !other.ok) return;

    await updateWeeklyReportDelivery({
      id: mine.id,
      expectedVersion: mine.version,
      fields: fields({ weekStartDate: week, note: "고친 내 줄", displayOrder: 1 }),
      actorUserId,
    });

    const rows = await readWeek(week);
    assert.deepEqual(
      rows.map((row) => [row.note, row.version]),
      [
        ["고친 내 줄", 2],
        ["남의 줄", 1],
      ]
    );
  });
});

describe("deleteWeeklyReportDelivery", () => {
  test("삭제하면 행 자체가 사라진다 — 휴지통이 없다", async () => {
    const week = nextWeek();
    const created = await createDelivery({ weekStartDate: week });
    if (!created.ok) return;

    const result = await deleteWeeklyReportDelivery({
      id: created.id,
      expectedVersion: created.version,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    // 지워진 줄의 version 을 그대로 돌려준다 — 화면이 방금 들고 있던 값과
    // 맞춰 볼 수 있게.
    assert.equal(result.version, created.version);

    assert.equal(await readDelivery(created.id), undefined);
    assert.equal((await readWeek(week)).length, 0);
  });

  test("낡은 version 으로 온 삭제는 거절되고 줄은 그대로 남는다", async () => {
    const week = nextWeek();
    const created = await createDelivery({ weekStartDate: week, note: "먼저 적은 문장" });
    if (!created.ok) return;

    // 남이 비고를 고쳐 version 이 2가 된다.
    await updateWeeklyReportDelivery({
      id: created.id,
      expectedVersion: 1,
      fields: fields({ weekStartDate: week, note: "남이 고친 문장" }),
      actorUserId: otherActorUserId,
    });

    // 낡은 화면에서 누른 삭제 — 그 사이 남이 적은 문장을 지우면 안 된다.
    const stale = await deleteWeeklyReportDelivery({ id: created.id, expectedVersion: 1 });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.code, "CONFLICT");

    const row = await readDelivery(created.id);
    assert.ok(row, "거절된 삭제는 행을 지우지 않는다");
    assert.equal(row.note, "남이 고친 문장");
    assert.equal(row.version, 2);
  });

  test("없는 줄을 지우면 NOT_FOUND 다", async () => {
    const result = await deleteWeeklyReportDelivery({ id: randomUUID(), expectedVersion: 1 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("삭제는 남의 줄을 건드리지 않는다 — 그 주 표를 통째로 비우지 않는다", async () => {
    const week = nextWeek();
    const mine = await createDelivery({ weekStartDate: week, note: "지울 줄", displayOrder: 1 });
    const other = await createDelivery({
      weekStartDate: week,
      repairCaseId: repairCaseIds[1],
      note: "남길 줄",
      displayOrder: 2,
    });
    if (!mine.ok || !other.ok) return;

    const result = await deleteWeeklyReportDelivery({
      id: mine.id,
      expectedVersion: mine.version,
    });
    assert.equal(result.ok, true);

    const rows = await readWeek(week);
    assert.deepEqual(
      rows.map((row) => row.note),
      ["남길 줄"]
    );
  });
});
