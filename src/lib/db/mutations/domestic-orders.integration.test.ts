import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createDomesticOrder,
  setDomesticOrderCompletion,
  updateDomesticOrder,
} from "./domestic-orders";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 내자 정리 — 행이 실제로 들어가고, 동시 수정이 막히는가
 * ============================================================================
 * 확인하는 것은 네 가지다.
 *
 *  1. **추가와 수정이 같은 칸들을 쓴다** — 추가하면 들어가는데 수정하면 안
 *     들어가는 칸이 없어야 한다.
 *  2. **version 이 낙관적 잠금으로 실제로 동작한다** — 낡은 version 으로 온
 *     저장은 CONFLICT 이고, 그때 행은 한 글자도 바뀌지 않는다.
 *  3. **지워진 행은 고칠 수 없다** — NOT_FOUND. 수정이 되살리기를 겸하면
 *     지운 기록이 조용히 돌아온다.
 *  4. **저장마다 version 이 1씩 오른다** — 오르지 않으면 두 번째 사람의 저장이
 *     첫 번째 사람의 것을 조용히 덮는다.
 *
 * 인가는 여기서 시험하지 않는다. 세션·역할 판정은 서버 액션의 몫이고
 * (mutations 파일 헤더의 계층 구분), 역할 정책은
 * permission-areas.test.ts 가 따로 본다 — customers.integration.test.ts 가
 * updateCustomer 를 다루는 방식과 같다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 이 스위트만 쓰는 접수 월 "9601",
 * 고객사 접두사 "AS-TEST-DOMESTIC-ORDER-", 제품 모델 접두사 "DOMESTIC-ORDER-TEST-".
 * 인수번호의 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와
 * TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * after() 는 이 스위트가 만든 행만 FK 순서대로 지운다 — domestic_orders 를
 * 먼저 지운다. 그 표가 repair_cases 와 customers 를 가리키고 있어서, 순서를
 * 바꾸면 customers 의 RESTRICT 에 걸려 정리가 통째로 실패한다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-DOMESTIC-ORDER-";
const TEST_MODEL_PREFIX = "DOMESTIC-ORDER-TEST-";
const TEST_YEAR_MONTH = "9601";
const TEST_RECEIVED_AT = "2096-01-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let linkedRepairCaseId: string;
const createdOrderIds: string[] = [];

/** 전부 비어 있는 한 줄. 이 표에는 필수 칸이 하나도 없다. */
function emptyFields(): DomesticOrderFields {
  return {
    repairCaseId: null,
    intakeNumberText: null,
    displayOrder: null,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    requestedDueDate: null,
    quoteIssuedDate: null,
    quoteNumber: null,
    progressNote: null,
    deliveredDate: null,
    deliveredBy: null,
    taxInvoiceDate: null,
    amountExcludingVat: null,
    paymentCompleted: false,
    japanRemittanceNote: null,
    historyNote: null,
    etcNote: null,
  };
}

function fields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return { ...emptyFields(), ...overrides };
}

async function createOrder(overrides: Partial<DomesticOrderFields> = {}) {
  const result = await createDomesticOrder({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `setup create failed: ${JSON.stringify(result)}`);
  if (result.ok) createdOrderIds.push(result.id);
  return result;
}

async function readOrder(id: string) {
  const [row] = await db.select().from(domesticOrders).where(eq(domesticOrders.id, id));
  return row;
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
      and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false))
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야
  // 한다. 역할은 상관없으므로 엔지니어를 그대로 쓴다(인가는 서버 액션의 몫이다).
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (created.ok) linkedRepairCaseId = created.id;
});

after(async () => {
  // domestic_orders 가 먼저다 — customers 를 RESTRICT 로 가리키고 있다.
  if (createdOrderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdOrderIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("createDomesticOrder", () => {
  test("새 줄은 version 1로 시작하고 만든 사람이 기록된다", async () => {
    const result = await createOrder({ purchaseOrderNumber: "PO-CREATE-1" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.version, 1);

    const row = await readOrder(result.id);
    assert.equal(row.version, 1);
    assert.equal(row.purchaseOrderNumber, "PO-CREATE-1");
    assert.equal(row.createdBy, actorUserId);
    // 만든 사람이 곧 마지막으로 고친 사람이다 — 첫 수정 전까지 빈칸으로 두지
    // 않는다.
    assert.equal(row.updatedBy, actorUserId);
    assert.equal(row.isDeleted, false);
  });

  test("18칸이 전부 그대로 들어간다", async () => {
    const result = await createOrder({
      repairCaseId: linkedRepairCaseId,
      intakeNumberText: "손으로 적은 인수번호",
      displayOrder: 7,
      purchaseOrderNumber: "PO-ALL",
      projectName: "PJT-ALL",
      orderIssuedDate: "2096-01-05",
      requestedDueDate: "2096-01-20",
      quoteIssuedDate: "2096-01-07",
      quoteNumber: "Q-ALL",
      progressNote: "견적 발행 완료",
      deliveredDate: "2096-02-01",
      deliveredBy: "김유진",
      taxInvoiceDate: "2096-02-05",
      amountExcludingVat: "1234567.89",
      paymentCompleted: true,
      japanRemittanceNote: "2096-02-10 송금",
      historyNote: "재수리 이력 있음",
      etcNote: "기타 메모",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const row = await readOrder(result.id);
    assert.equal(row.repairCaseId, linkedRepairCaseId);
    assert.equal(row.intakeNumberText, "손으로 적은 인수번호");
    assert.equal(row.displayOrder, 7);
    assert.equal(row.purchaseOrderNumber, "PO-ALL");
    assert.equal(row.projectName, "PJT-ALL");
    assert.equal(row.orderIssuedDate, "2096-01-05");
    assert.equal(row.requestedDueDate, "2096-01-20");
    assert.equal(row.quoteIssuedDate, "2096-01-07");
    assert.equal(row.quoteNumber, "Q-ALL");
    assert.equal(row.progressNote, "견적 발행 완료");
    assert.equal(row.deliveredDate, "2096-02-01");
    assert.equal(row.deliveredBy, "김유진");
    assert.equal(row.taxInvoiceDate, "2096-02-05");
    // numeric 은 문자열로 읽힌다(schema 의 '금액은 numeric 이다').
    assert.equal(row.amountExcludingVat, "1234567.89");
    assert.equal(row.paymentCompleted, true);
    assert.equal(row.japanRemittanceNote, "2096-02-10 송금");
    assert.equal(row.historyNote, "재수리 이력 있음");
    assert.equal(row.etcNote, "기타 메모");
  });

  test("수리 건 연결이 없는 줄도 만들 수 있다 — 시트에 실제로 있는 모양이다", async () => {
    const result = await createOrder({ intakeNumberText: "D2401-999(연결 못 찾음)" });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const row = await readOrder(result.id);
    assert.equal(row.repairCaseId, null);
    assert.equal(row.intakeNumberText, "D2401-999(연결 못 찾음)");
  });

  test("없는 수리 건을 가리키면 FK 오류가 아니라 VALIDATION_ERROR다", async () => {
    const result = await createDomesticOrder({
      fields: fields({ repairCaseId: randomUUID() }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);
  });
});

describe("updateDomesticOrder", () => {
  test("수정이 값과 version과 고친 사람을 함께 남긴다", async () => {
    const created = await createOrder({ purchaseOrderNumber: "PO-BEFORE", displayOrder: 1 });
    if (!created.ok) return;
    const before = await readOrder(created.id);

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({
        purchaseOrderNumber: "PO-AFTER",
        displayOrder: 2,
        amountExcludingVat: "500.00",
        paymentCompleted: true,
      }),
      actorUserId,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);

    const row = await readOrder(created.id);
    assert.equal(row.purchaseOrderNumber, "PO-AFTER");
    assert.equal(row.displayOrder, 2);
    assert.equal(row.amountExcludingVat, "500.00");
    assert.equal(row.paymentCompleted, true);
    assert.equal(row.version, 2);
    assert.equal(row.updatedBy, actorUserId);
    assert.ok(row.updatedAt.getTime() >= before.updatedAt.getTime());
    // 만든 사람은 수정으로 바뀌지 않는다.
    assert.equal(row.createdBy, before.createdBy);
  });

  test("저장할 때마다 version이 1씩 오른다", async () => {
    const created = await createOrder();
    if (!created.ok) return;

    let version = created.version;
    for (const expected of [2, 3, 4]) {
      const result = await updateDomesticOrder({
        id: created.id,
        expectedVersion: version,
        fields: fields({ progressNote: `단계 ${expected}` }),
        actorUserId,
      });
      assert.equal(result.ok, true, `update to ${expected} failed: ${JSON.stringify(result)}`);
      if (!result.ok) return;
      assert.equal(result.version, expected);
      version = result.version;
    }

    const row = await readOrder(created.id);
    assert.equal(row.version, 4);
    assert.equal(row.progressNote, "단계 4");
  });

  test("빈 값으로 되돌릴 수 있다 — 잘못 적은 날짜와 금액을 지울 길이 있어야 한다", async () => {
    const created = await createOrder({
      orderIssuedDate: "2096-01-05",
      amountExcludingVat: "100.00",
      progressNote: "지울 메모",
    });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields(),
      actorUserId,
    });
    assert.equal(result.ok, true);

    const row = await readOrder(created.id);
    assert.equal(row.orderIssuedDate, null);
    assert.equal(row.amountExcludingVat, null);
    assert.equal(row.progressNote, null);
    assert.equal(row.paymentCompleted, false);
  });

  test("낡은 version으로 온 저장은 CONFLICT이고 행은 그대로다", async () => {
    const created = await createOrder({ progressNote: "처음" });
    if (!created.ok) return;
    const staleVersion = created.version;

    const first = await updateDomesticOrder({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ progressNote: "먼저 저장된 값" }),
      actorUserId,
    });
    assert.equal(first.ok, true);

    const second = await updateDomesticOrder({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ progressNote: "덮어써서는 안 되는 값" }),
      actorUserId,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");

    const row = await readOrder(created.id);
    assert.equal(row.progressNote, "먼저 저장된 값", "충돌한 저장이 적용되어서는 안 된다");
    assert.equal(row.version, 2, "충돌한 저장은 version 도 올리지 않는다");
  });

  test("동시에 들어온 두 저장 중 정확히 하나만 성공한다", async () => {
    const created = await createOrder();
    if (!created.ok) return;

    const [a, b] = await Promise.all([
      updateDomesticOrder({
        id: created.id,
        expectedVersion: created.version,
        fields: fields({ progressNote: "A" }),
        actorUserId,
      }),
      updateDomesticOrder({
        id: created.id,
        expectedVersion: created.version,
        fields: fields({ progressNote: "B" }),
        actorUserId,
      }),
    ]);

    assert.deepEqual([a.ok, b.ok].sort(), [false, true], "동시 저장 중 하나만 성공해야 한다");
    const loser = a.ok ? b : a;
    if (!loser.ok) assert.equal(loser.code, "CONFLICT");

    const row = await readOrder(created.id);
    assert.equal(row.version, 2, "성공한 쪽 한 번만 version 이 올라야 한다");
  });

  test("지워진 행은 고칠 수 없다 — NOT_FOUND다", async () => {
    const created = await createOrder({ progressNote: "지우기 전" });
    if (!created.ok) return;
    await db
      .update(domesticOrders)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(domesticOrders.id, created.id));

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ progressNote: "되살아나서는 안 되는 값" }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const row = await readOrder(created.id);
    assert.equal(row.progressNote, "지우기 전", "지워진 행은 한 글자도 바뀌지 않는다");
    assert.equal(row.isDeleted, true, "수정이 되살리기를 겸해서는 안 된다");
  });

  test("없는 id는 NOT_FOUND다", async () => {
    const result = await updateDomesticOrder({
      id: randomUUID(),
      expectedVersion: 1,
      fields: fields(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("수리 건 연결을 붙이고 뗄 수 있다", async () => {
    const created = await createOrder();
    if (!created.ok) return;

    const linked = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ repairCaseId: linkedRepairCaseId }),
      actorUserId,
    });
    assert.equal(linked.ok, true);
    if (!linked.ok) return;
    assert.equal((await readOrder(created.id)).repairCaseId, linkedRepairCaseId);

    const unlinked = await updateDomesticOrder({
      id: created.id,
      expectedVersion: linked.version,
      fields: fields({ repairCaseId: null, intakeNumberText: "연결 끊고 글자만 남김" }),
      actorUserId,
    });
    assert.equal(unlinked.ok, true);

    const row = await readOrder(created.id);
    assert.equal(row.repairCaseId, null);
    assert.equal(row.intakeNumberText, "연결 끊고 글자만 남김");
  });

  test("없는 수리 건으로 고치려 하면 VALIDATION_ERROR이고 행은 그대로다", async () => {
    const created = await createOrder({ progressNote: "그대로 남아야 한다" });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ repairCaseId: randomUUID(), progressNote: "적용되면 안 된다" }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);

    const row = await readOrder(created.id);
    assert.equal(row.progressNote, "그대로 남아야 한다");
    assert.equal(row.version, 1);
  });
});

/**
 * ── 완료 처리 ────────────────────────────────────────────────────────────
 * 완료는 감추는 조작이 아니라 회색으로 표시하는 조작이지만, 지키는 규칙은
 * 수정과 똑같다 — 잠금 · version 대조 · 지워진 행 거절. 여기서 따로 확인하는
 * 것은 **두 칸(completed_at · completed_by)이 언제나 함께 움직이는가**다.
 * 한쪽만 남으면 그 행이 완료인지 아닌지 답할 방법이 없어진다.
 */
describe("setDomesticOrderCompletion", () => {
  test("완료 처리하면 시각과 사람이 함께 남고 version이 오른다", async () => {
    const created = await createOrder({ progressNote: "완료 전" });
    if (!created.ok) return;

    const result = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: created.version,
      completed: true,
      actorUserId,
    });
    assert.equal(result.ok, true, `완료 처리 실패: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.version, 2);

    const row = await readOrder(created.id);
    assert.ok(row.completedAt instanceof Date, "완료 시각이 남아야 한다");
    assert.equal(row.completedBy, actorUserId, "완료 처리한 사람이 남아야 한다");
    assert.equal(row.version, 2);
    assert.equal(row.updatedBy, actorUserId);
    // 다른 칸은 건드리지 않는다 — 완료는 표시일 뿐 값을 고치는 조작이 아니다.
    assert.equal(row.progressNote, "완료 전");
  });

  test("완료 해제하면 두 칸이 함께 NULL이 된다", async () => {
    const created = await createOrder();
    if (!created.ok) return;

    const completed = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: created.version,
      completed: true,
      actorUserId,
    });
    assert.equal(completed.ok, true);
    if (!completed.ok) return;

    const released = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: completed.version,
      completed: false,
      actorUserId,
    });
    assert.equal(released.ok, true, `완료 해제 실패: ${JSON.stringify(released)}`);
    if (!released.ok) return;
    assert.equal(released.version, 3);

    const row = await readOrder(created.id);
    assert.equal(row.completedAt, null, "완료 시각이 남아 있으면 안 된다");
    assert.equal(row.completedBy, null, "완료한 사람만 남으면 상태가 어긋난다");
  });

  test("완료 해제는 두 칸 중 하나만 지우지 않는다 — 다시 완료해도 짝이 맞는다", async () => {
    const created = await createOrder();
    if (!created.ok) return;

    let version = created.version;
    for (const completed of [true, false, true]) {
      const result = await setDomesticOrderCompletion({
        id: created.id,
        expectedVersion: version,
        completed,
        actorUserId,
      });
      assert.equal(result.ok, true, `전환 실패(${completed}): ${JSON.stringify(result)}`);
      if (!result.ok) return;
      version = result.version;

      const row = await readOrder(created.id);
      // 두 칸이 언제나 같은 상태여야 한다 — 하나는 있고 하나는 없는 중간
      // 상태가 존재하면 완료 여부를 말할 수 없다.
      assert.equal(
        row.completedAt !== null,
        row.completedBy !== null,
        "completed_at 과 completed_by 는 언제나 함께 있거나 함께 없어야 한다"
      );
      assert.equal(row.completedAt !== null, completed);
    }
  });

  test("낡은 version으로 온 완료 처리는 CONFLICT이고 행은 그대로다", async () => {
    const created = await createOrder({ progressNote: "처음" });
    if (!created.ok) return;
    const staleVersion = created.version;

    const first = await updateDomesticOrder({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ progressNote: "먼저 저장된 값" }),
      actorUserId,
    });
    assert.equal(first.ok, true);

    const second = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: staleVersion,
      completed: true,
      actorUserId,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");

    const row = await readOrder(created.id);
    assert.equal(row.completedAt, null, "충돌한 완료 처리가 적용되어서는 안 된다");
    assert.equal(row.completedBy, null);
    assert.equal(row.progressNote, "먼저 저장된 값", "행은 한 글자도 바뀌지 않는다");
    assert.equal(row.version, 2, "충돌한 저장은 version 도 올리지 않는다");
  });

  test("지워진 행은 완료 처리할 수 없다 — NOT_FOUND다", async () => {
    const created = await createOrder();
    if (!created.ok) return;
    await db
      .update(domesticOrders)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(domesticOrders.id, created.id));

    const result = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: created.version,
      completed: true,
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const row = await readOrder(created.id);
    assert.equal(row.completedAt, null, "지워진 행은 한 글자도 바뀌지 않는다");
    assert.equal(row.version, 1);
    assert.equal(row.isDeleted, true, "완료 처리가 되살리기를 겸해서는 안 된다");
  });

  test("없는 id는 NOT_FOUND다", async () => {
    const result = await setDomesticOrderCompletion({
      id: randomUUID(),
      expectedVersion: 1,
      completed: true,
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("완료된 줄도 여전히 고칠 수 있다 — 회색은 잠금이 아니다", async () => {
    const created = await createOrder({ progressNote: "완료 전" });
    if (!created.ok) return;

    const completed = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: created.version,
      completed: true,
      actorUserId,
    });
    assert.equal(completed.ok, true);
    if (!completed.ok) return;

    const updated = await updateDomesticOrder({
      id: created.id,
      expectedVersion: completed.version,
      fields: fields({ progressNote: "완료 후에 적은 입금 사실" }),
      actorUserId,
    });
    assert.equal(updated.ok, true, `완료된 줄 수정 실패: ${JSON.stringify(updated)}`);

    const row = await readOrder(created.id);
    assert.equal(row.progressNote, "완료 후에 적은 입금 사실");
    // 수정은 완료 표시를 건드리지 않는다 — 둘은 서로 다른 조작이다.
    assert.ok(row.completedAt instanceof Date, "수정이 완료 표시를 지워서는 안 된다");
    assert.equal(row.completedBy, actorUserId);
  });
});
