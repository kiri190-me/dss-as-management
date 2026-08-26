import "../../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrderDueDates,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { listDomesticOrderDueDatesForRepairCase, listDomesticOrders } from "./domestic-orders";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * listDomesticOrders — `납품일` 이 어디에서 오는가
 * ============================================================================
 * 화면의 `납품일` 은 **연결된 수리 건의 실제 출하일**
 * (repair_cases.actual_shipment_date)이고, 그 줄에 손으로 적혀 있던
 * `domestic_orders.delivered_date` 는 화면에 나오지 않는다. 고르는 규칙 자체는
 * domain/domestic-order-list.test.ts 가 본다 — 여기서 확인하는 것은 **조회가 그
 * 값을 실제로 실어 오는가**다. 도메인 함수가 아무리 맞아도 조회가 그 칸을
 * 안 골라 오면 화면은 늘 빈칸이고, 그것을 잡는 자리는 여기뿐이다.
 *
 * 확인하는 것 넷:
 *
 *  1. 연결된 건에 실제 출하일이 있으면 그 날짜가 displayDeliveredDate 로 온다.
 *  2. ⚠️ **그 줄에 delivered_date 가 적혀 있어도** 실제 출하일이 이긴다 —
 *     그리고 원본 칼럼은 **지워지지 않고 그대로 실려 온다**(저장이 되실어
 *     보내야 하는 값이다).
 *  3. 연결이 없으면 displayDeliveredDate 는 null 이다 — 그 줄에 적힌 값으로
 *     메우지 않는다.
 *  4. 연결은 있어도 아직 안 나갔으면 null 이다.
 *
 * ── 납기요청일이 두 화면을 오간다 ───────────────────────────────────────
 * 뒤쪽 시험 묶음은 **납기요청일 잇기**를 본다. 고르는 규칙 자체는
 * domain/requested-due-date-link.test.ts 가 보고, 여기서 확인하는 것은 위와
 * 같은 이유로 **조회가 재료를 실제로 실어 오는가**다:
 *
 *  5. 내자 목록이 연결된 건의 `고객 요청 납기일` 을 실어 온다 — 이 값이 없으면
 *     `납기요청일` 칸이 비어 있는 줄은 영영 빈칸이다.
 *  6. listDomesticOrderDueDatesForRepairCase 가 그 건에 붙은 **모든 내자 줄의
 *     날짜를 통틀어** 걷어 온다(분할 발주 · 분할 납품).
 *  7. **지운 발주 줄의 날짜는 세지 않는다** — 화면에 없는 줄이 다른 화면의
 *     값을 정하면 안 된다.
 *
 * ── 실제 출하일은 손으로 못 넣는다 ──────────────────────────────────────
 * 그 값은 워크플로가 출하 완료 시점에 찍고(mutations/workflow-transitions.ts)
 * updateRepairCase 로도 고칠 수 없다. 그래서 준비 단계에서 그 칼럼만 직접
 * UPDATE 한다 — 여기서 확인하려는 것은 출하 워크플로가 아니라 **조회가 그 칼럼을
 * 읽어 오는가**이므로, 전체 전이를 태우면 시험이 보려는 것과 무관한 이유로
 * 깨진다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 이 스위트만 쓰는 접수 월 "9607",
 * 제품 모델 접두사 "DOMESTIC-ORDER-QUERY-TEST-". 인수번호의 연월은 receivedAt
 * 에서 나오므로 TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은 달을 가리킨다.
 * after() 는 이 스위트가 만든 행만 FK 순서대로 지운다 — domestic_orders 를 먼저
 * 지운다(그 표가 repair_cases 를 가리킨다).
 *
 * 이 조회는 **지워지지 않은 내자 줄 전부**를 돌려주므로 시드 자료의 줄도 함께
 * 나온다. 단언은 언제나 **이 스위트가 만든 id 를 찾아서** 한다(목록 전체와의
 * 같음이 아니다).
 * ============================================================================
 */

const TEST_YEAR_MONTH = "9607";
const TEST_RECEIVED_AT = "2096-07-05";
const TEST_MODEL_PREFIX = "DOMESTIC-ORDER-QUERY-TEST-";

let customerId: string;
let engineerId: string;
const createdCaseIds: string[] = [];
const createdOrderIds: string[] = [];

function baseCreateInput(
  /**
   * 접수 때 적는 `고객 요청 납기일`. 인수일보다 이전이면 검증이 거절하므로
   * (validation/repair-case-input.ts) 넘길 때는 TEST_RECEIVED_AT 이후여야 한다.
   */
  customerRequestedDueDate: string | null = null
): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate,
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

/**
 * 접수 건 하나. `actualShipmentDate` 를 주면 그 칼럼만 직접 UPDATE 한다 —
 * 사람이 넣을 수 있는 값이 아니라서 생성 입력에 자리가 없다(파일 헤더).
 */
async function createTestCase(
  actualShipmentDate: string | null = null,
  customerRequestedDueDate: string | null = null
): Promise<string> {
  const created = await createRepairCase(baseCreateInput(customerRequestedDueDate));
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  if (actualShipmentDate !== null) {
    await db.update(repairCases).set({ actualShipmentDate }).where(eq(repairCases.id, created.id));
  }
  return created.id;
}

/** 내자 줄 한 개. 이 시험이 보는 세 칸만 정하면 나머지는 전부 기본값(NULL)이다. */
async function insertOrder(fields: {
  repairCaseId?: string | null;
  deliveredDate?: string | null;
  /** 소프트 삭제된 줄을 만들 때만 준다 — 화면에서 지운 줄이다. */
  isDeleted?: boolean;
}): Promise<string> {
  const [inserted] = await db
    .insert(domesticOrders)
    .values({
      repairCaseId: fields.repairCaseId ?? null,
      deliveredDate: fields.deliveredDate ?? null,
      isDeleted: fields.isDeleted ?? false,
    })
    .returning({ id: domesticOrders.id });
  createdOrderIds.push(inserted.id);
  return inserted.id;
}

/**
 * 그 내자 줄에 납기요청일을 붙인다. 딸린 표라 부모를 지우면 CASCADE 로 함께
 * 사라지므로(schema/domestic-order-due-dates.ts) 뒷정리 목록에 따로 담지 않는다.
 */
async function insertDueDates(orderId: string, dates: readonly string[]): Promise<void> {
  if (dates.length === 0) return;
  await db.insert(domesticOrderDueDates).values(
    dates.map((dueDate, index) => ({
      domesticOrderId: orderId,
      dueDate,
      displayOrder: index + 1,
    }))
  );
}

/** 목록에서 이 스위트가 만든 한 줄을 찾아 온다. 못 찾으면 그 자리에서 멈춘다. */
async function loadOrder(orderId: string) {
  const found = (await listDomesticOrders()).find((item) => item.id === orderId);
  assert.ok(found, "방금 만든 내자 줄이 목록에 없다");
  return found;
}

before(async () => {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "expected at least one non-deleted customer in the test DB");
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected an approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
});

after(async () => {
  for (const orderId of createdOrderIds) {
    await db.delete(domesticOrders).where(eq(domesticOrders.id, orderId));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

test("납품일은 연결된 수리 건의 실제 출하일로 실려 온다", async () => {
  const caseId = await createTestCase("2096-07-20");
  const orderId = await insertOrder({ repairCaseId: caseId });

  const found = await loadOrder(orderId);
  assert.equal(found.repairCaseActualShipmentDate, "2096-07-20", "조인이 그 칼럼을 안 골라 왔다");
  assert.equal(found.displayDeliveredDate, "2096-07-20");
});

test("⚠️ 그 줄에 납품일이 적혀 있어도 실제 출하일이 보인다 — 그리고 원본은 지워지지 않는다", async () => {
  // 실 자료에서 날짜가 바뀌는 줄이 이 모양이다. 손으로 적은 값은 DB 에 그대로
  // 남아 있어야 한다 — 저장이 그 값을 되실어 보내야 하고(payload 에서 빠지면
  // 지워진다), 나중에 "역시 손으로 적는 게 맞았다"가 되어도 되돌릴 수 있어야 한다.
  const caseId = await createTestCase("2095-11-14");
  const orderId = await insertOrder({ repairCaseId: caseId, deliveredDate: "2096-03-31" });

  const found = await loadOrder(orderId);
  assert.equal(found.displayDeliveredDate, "2095-11-14", "손으로 적은 값이 화면 값을 가렸다");
  assert.equal(found.deliveredDate, "2096-03-31", "원본 칼럼이 조회에서 사라졌다");
});

test("수리 건 연결이 없으면 납품일은 비어 있다 — 그 줄에 적힌 값으로 메우지 않는다", async () => {
  // 실 자료에서 빈칸이 되는 줄이 이 모양이다. 그래도 원본은 남는다.
  const orderId = await insertOrder({ repairCaseId: null, deliveredDate: "2096-03-31" });

  const found = await loadOrder(orderId);
  assert.equal(found.displayDeliveredDate, null);
  assert.equal(found.repairCaseActualShipmentDate, null);
  assert.equal(found.deliveredDate, "2096-03-31");
});

test("연결은 있어도 아직 안 나갔으면 납품일은 비어 있다", async () => {
  const caseId = await createTestCase();
  const orderId = await insertOrder({ repairCaseId: caseId, deliveredDate: "2096-03-31" });

  const found = await loadOrder(orderId);
  assert.equal(found.displayDeliveredDate, null);
  assert.equal(found.deliveredDate, "2096-03-31");

  // 대조 — 그 건이 나가면 같은 줄에 날짜가 생긴다. 이것이 없으면 위 단언은
  // 조회가 그 칼럼을 통째로 안 읽어 와도 초록색이다.
  await db
    .update(repairCases)
    .set({ actualShipmentDate: "2096-08-01" })
    .where(eq(repairCases.id, caseId));
  assert.equal((await loadOrder(orderId)).displayDeliveredDate, "2096-08-01");
});

test("같은 수리 건에 붙은 두 줄이 같은 날짜를 본다 — 줄마다 다르게 보이면 안 된다", async () => {
  // 한 접수 건에 내자 줄이 여럿인 것은 흔하다(분할 발주). 그 줄들의 납품일은
  // 전부 같은 출처에서 오므로 언제나 같은 날짜여야 한다.
  const caseId = await createTestCase("2096-07-25");
  const first = await insertOrder({ repairCaseId: caseId, deliveredDate: "2096-01-01" });
  const second = await insertOrder({ repairCaseId: caseId });

  assert.equal((await loadOrder(first)).displayDeliveredDate, "2096-07-25");
  assert.equal((await loadOrder(second)).displayDeliveredDate, "2096-07-25");
});

// ── 납기요청일 잇기 — 조회가 재료를 실어 오는가(파일 헤더) ────────────────

test("내자 목록이 연결된 건의 고객 요청 납기일을 실어 온다 — 빈 줄이 빌려 쓸 값이다", async () => {
  const caseId = await createTestCase(null, "2096-09-30");
  const orderId = await insertOrder({ repairCaseId: caseId });

  const found = await loadOrder(orderId);
  assert.equal(
    found.repairCaseCustomerRequestedDueDate,
    "2096-09-30",
    "조인이 그 칼럼을 안 골라 왔다 — 이 줄의 납기요청일 칸은 영영 빈칸이다"
  );
  // 이 줄에는 아직 납기요청일이 없다. 화면이 빌려 오는 조건이 바로 이것이다.
  assert.deepEqual(found.dueDates, []);
});

test("이 줄에 납기요청일이 있으면 두 벌이 다 실려 온다 — 고르는 일은 화면 쪽이다", async () => {
  // ⚠️ 조회가 한쪽을 미리 접어 버리면 화면은 그 날짜가 어디서 왔는지 알 수 없고
  // '빌려 온 값' 표시를 붙일 수 없게 된다.
  const caseId = await createTestCase(null, "2096-09-30");
  const orderId = await insertOrder({ repairCaseId: caseId });
  await insertDueDates(orderId, ["2096-08-20"]);

  const found = await loadOrder(orderId);
  assert.equal(found.repairCaseCustomerRequestedDueDate, "2096-09-30");
  assert.deepEqual(
    found.dueDates.map((entry) => entry.dueDate),
    ["2096-08-20"]
  );
});

test("수리 건 연결이 없으면 빌려 올 값도 없다", async () => {
  const orderId = await insertOrder({ repairCaseId: null });

  const found = await loadOrder(orderId);
  assert.equal(found.repairCaseCustomerRequestedDueDate, null);
  assert.deepEqual(found.dueDates, []);
});

test("한 건에 붙은 내자 날짜를 통틀어 걷어 온다 — 줄이 여럿이고 줄마다 날짜가 여럿이다", async () => {
  // 분할 발주(줄 여럿) × 분할 납품(줄 하나에 날짜 여럿). 수리 건 상세정보는
  // 이 묶음에서 가장 이른 하루를 고른다(도메인 함수).
  const caseId = await createTestCase();
  const first = await insertOrder({ repairCaseId: caseId });
  const second = await insertOrder({ repairCaseId: caseId });
  await insertDueDates(first, ["2096-09-30", "2096-11-01"]);
  await insertDueDates(second, ["2096-08-20"]);

  const dueDates = await listDomesticOrderDueDatesForRepairCase(caseId);
  assert.deepEqual([...dueDates].sort(), ["2096-08-20", "2096-09-30", "2096-11-01"]);
});

test("⚠️ 지운 발주 줄의 날짜는 세지 않는다 — 화면에 없는 줄이 값을 정하면 안 된다", async () => {
  const caseId = await createTestCase();
  const alive = await insertOrder({ repairCaseId: caseId });
  const removed = await insertOrder({ repairCaseId: caseId, isDeleted: true });
  await insertDueDates(alive, ["2096-09-30"]);
  // 지운 줄에 더 이른 날짜가 붙어 있다 — 세면 결과가 이 날짜로 뒤집힌다.
  await insertDueDates(removed, ["2096-01-05"]);

  const dueDates = await listDomesticOrderDueDatesForRepairCase(caseId);
  assert.deepEqual(dueDates, ["2096-09-30"]);
});

test("붙은 내자 줄이 없으면 빈 배열이다 — 오류가 아니라 '아직 없다'이다", async () => {
  const caseId = await createTestCase();

  assert.deepEqual(await listDomesticOrderDueDatesForRepairCase(caseId), []);
});

test("내자 줄은 있어도 날짜를 아직 안 적었으면 빈 배열이다", async () => {
  const caseId = await createTestCase();
  await insertOrder({ repairCaseId: caseId });

  assert.deepEqual(await listDomesticOrderDueDatesForRepairCase(caseId), []);
});

test("다른 건에 붙은 날짜는 섞이지 않는다", async () => {
  const mine = await createTestCase();
  const other = await createTestCase();
  const myOrder = await insertOrder({ repairCaseId: mine });
  const otherOrder = await insertOrder({ repairCaseId: other });
  await insertDueDates(myOrder, ["2096-09-30"]);
  await insertDueDates(otherOrder, ["2096-01-05"]);

  assert.deepEqual(await listDomesticOrderDueDatesForRepairCase(mine), ["2096-09-30"]);
  assert.deepEqual(await listDomesticOrderDueDatesForRepairCase(other), ["2096-01-05"]);
});

test("연결이 없는 내자 줄의 날짜는 어느 건에도 붙지 않는다", async () => {
  const caseId = await createTestCase();
  const orphan = await insertOrder({ repairCaseId: null });
  await insertDueDates(orphan, ["2096-01-05"]);

  assert.deepEqual(await listDomesticOrderDueDatesForRepairCase(caseId), []);
});
