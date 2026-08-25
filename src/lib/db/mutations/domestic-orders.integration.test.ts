import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

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
 * 확인하는 것은 다섯 가지다.
 *
 *  0. **수리 건 없이도 한 줄이 완성된다** — 고객사·형식·L/N·S/N·고장내역을
 *     직접 적을 수 있어야 한다(아래 '손으로 적는 다섯 칸').
 *  1. **추가와 수정이 같은 칸들을 쓴다** — 추가하면 들어가는데 수정하면 안
 *     들어가는 칸이 없어야 한다.
 *  2. **version 이 낙관적 잠금으로 실제로 동작한다** — 낡은 version 으로 온
 *     저장은 CONFLICT 이고, 그때 행은 한 글자도 바뀌지 않는다.
 *  3. **지워진 행은 고칠 수 없다** — NOT_FOUND. 수정이 되살리기를 겸하면
 *     지운 기록이 조용히 돌아온다.
 *  4. **저장마다 version 이 1씩 오른다** — 오르지 않으면 두 번째 사람의 저장이
 *     첫 번째 사람의 것을 조용히 덮는다.
 *  5. **납기요청일 목록이 딸린 표에 그대로 옮겨진다** — 그리고 version 이
 *     어긋난 저장은 그 날짜를 한 건도 건드리지 않는다(맨 아래 묶음).
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
    customerId: null,
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    displayOrder: null,
    purchaseOrderNumber: null,
    projectName: null,
    orderIssuedDate: null,
    // 납기요청일은 딸린 표에 있다 — 빈 목록이 "없음"이다.
    dueDates: [],
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

/**
 * 그 줄의 납기 요청일을 **차례대로**. 조회(queries/domestic-orders.ts)가 쓰는
 * 것과 같은 순서라, 여기서 본 차례가 곧 화면에 보이는 차례다.
 */
async function readDueDates(orderId: string) {
  return db
    .select({
      dueDate: domesticOrderDueDates.dueDate,
      note: domesticOrderDueDates.note,
      displayOrder: domesticOrderDueDates.displayOrder,
    })
    .from(domesticOrderDueDates)
    .where(eq(domesticOrderDueDates.domesticOrderId, orderId))
    .orderBy(asc(domesticOrderDueDates.displayOrder), asc(domesticOrderDueDates.dueDate));
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

  test("칸 하나짜리 값 22개가 전부 그대로 들어간다 — 납기요청일만 딸린 표다", async () => {
    const result = await createOrder({
      repairCaseId: linkedRepairCaseId,
      intakeNumberText: "손으로 적은 인수번호",
      customerId,
      modelNameText: "발주서에 적힌 형식",
      lotNumberText: "발주서에 적힌 L/N",
      serialNumberText: "발주서에 적힌 S/N",
      faultDescriptionText: "발주서에 적힌 고장내역",
      displayOrder: 7,
      purchaseOrderNumber: "PO-ALL",
      projectName: "PJT-ALL",
      orderIssuedDate: "2096-01-05",
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
    assert.equal(row.customerId, customerId);
    assert.equal(row.modelNameText, "발주서에 적힌 형식");
    assert.equal(row.lotNumberText, "발주서에 적힌 L/N");
    assert.equal(row.serialNumberText, "발주서에 적힌 S/N");
    assert.equal(row.faultDescriptionText, "발주서에 적힌 고장내역");
    assert.equal(row.displayOrder, 7);
    assert.equal(row.purchaseOrderNumber, "PO-ALL");
    assert.equal(row.projectName, "PJT-ALL");
    assert.equal(row.orderIssuedDate, "2096-01-05");
    // 납기요청일은 이 칸이 아니라 딸린 표에 들어간다(아래 '납기요청일 목록').
    // 저장 경로가 이 칸을 **건드리지 않는다**는 것이 여기서 지키는 것이다 —
    // 건드리면 아직 옮기지 않은 줄의 원본이 지워진다.
    assert.equal(row.requestedDueDate, null);
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

  test("없는 고객사를 가리켜도 FK 오류가 아니라 VALIDATION_ERROR다", async () => {
    const result = await createDomesticOrder({
      fields: fields({ customerId: randomUUID() }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.customerId);
  });
});

/**
 * ── 손으로 적는 다섯 칸 ──────────────────────────────────────────────────
 * 고객사 · 형식 · L/N · S/N · 고장내역. 이 다섯이 이 표에 생긴 이유는 하나다 —
 * **수리 건 연결이 없는 줄**에는 그 값을 적을 자리가 달리 없다. 여기서 지키는
 * 것은 셋이다.
 *
 *  1. 다섯 칸이 저장되고 그대로 다시 읽힌다(추가에서도, 수정에서도).
 *  2. **수리 건 없이 그 다섯만으로 줄을 만들 수 있다** — 그러지 못하면 이
 *     기능은 있으나 마나다.
 *  3. 빈 값으로 되돌릴 수 있다. 비운다는 것은 "연결된 수리 건의 값을 따른다"는
 *     뜻이라, 되돌릴 길이 없으면 한 번 적은 값에서 빠져나올 수 없다.
 *
 * 어느 쪽 값을 화면에 쓸지 고르는 일은 여기서 시험하지 않는다 — 순수 함수라
 * domain/domestic-order-list.test.ts 가 본다.
 */
describe("직접 입력하는 다섯 칸 (고객사·형식·L/N·S/N·고장내역)", () => {
  test("수리 건 연결 없이 다섯 칸만으로 줄을 만들 수 있다", async () => {
    const created = await createOrder({
      repairCaseId: null,
      intakeNumberText: "D9601-없는건",
      customerId,
      modelNameText: "ARC-200",
      lotNumberText: "LN-2096-01",
      serialNumberText: "SN-000123",
      faultDescriptionText: "전원 인가 시 보호 회로 동작",
    });
    if (!created.ok) return;

    const row = await readOrder(created.id);
    assert.equal(row.repairCaseId, null, "연결이 없어도 줄이 만들어져야 한다");
    assert.equal(row.customerId, customerId);
    assert.equal(row.modelNameText, "ARC-200");
    assert.equal(row.lotNumberText, "LN-2096-01");
    assert.equal(row.serialNumberText, "SN-000123");
    assert.equal(row.faultDescriptionText, "전원 인가 시 보호 회로 동작");
  });

  test("수정으로도 다섯 칸이 들어간다 — 추가에서만 되는 칸이 없어야 한다", async () => {
    const created = await createOrder({ repairCaseId: linkedRepairCaseId });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({
        repairCaseId: linkedRepairCaseId,
        customerId,
        modelNameText: "발주서 형식",
        lotNumberText: "발주서 L/N",
        serialNumberText: "발주서 S/N",
        faultDescriptionText: "발주서 고장내역",
      }),
      actorUserId,
    });
    assert.equal(result.ok, true, `수정 실패: ${JSON.stringify(result)}`);

    const row = await readOrder(created.id);
    // 수리 건이 연결돼 있어도 이 행에 적은 값은 그대로 남는다 — 연결이
    // 이 칸들을 덮어쓰지 않는다.
    assert.equal(row.repairCaseId, linkedRepairCaseId);
    assert.equal(row.customerId, customerId);
    assert.equal(row.modelNameText, "발주서 형식");
    assert.equal(row.lotNumberText, "발주서 L/N");
    assert.equal(row.serialNumberText, "발주서 S/N");
    assert.equal(row.faultDescriptionText, "발주서 고장내역");
  });

  test("다섯 칸을 빈 값으로 되돌릴 수 있다 — 다시 수리 건을 따르게 하는 유일한 길이다", async () => {
    const created = await createOrder({
      customerId,
      modelNameText: "잘못 적은 형식",
      lotNumberText: "잘못 적은 L/N",
      serialNumberText: "잘못 적은 S/N",
      faultDescriptionText: "잘못 적은 고장내역",
    });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields(),
      actorUserId,
    });
    assert.equal(result.ok, true, `되돌리기 실패: ${JSON.stringify(result)}`);

    const row = await readOrder(created.id);
    assert.equal(row.customerId, null);
    assert.equal(row.modelNameText, null);
    assert.equal(row.lotNumberText, null);
    assert.equal(row.serialNumberText, null);
    assert.equal(row.faultDescriptionText, null);
  });

  test("없는 고객사로 고치려 하면 VALIDATION_ERROR이고 행은 그대로다", async () => {
    const created = await createOrder({ customerId, modelNameText: "그대로 남아야 한다" });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ customerId: randomUUID(), modelNameText: "적용되면 안 된다" }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.customerId);

    const row = await readOrder(created.id);
    assert.equal(row.customerId, customerId);
    assert.equal(row.modelNameText, "그대로 남아야 한다");
    assert.equal(row.version, 1);
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

/**
 * ── 납기요청일 목록 ──────────────────────────────────────────────────────
 * 한 발주에 납기일이 여럿일 수 있게 된 뒤(분할 납품), 저장이 지켜야 하는 것은
 * 다섯이다.
 *
 *  1. 여러 개가 들어가고 **적은 차례 그대로** 다시 읽힌다.
 *  2. 줄이면 없어지고 늘리면 생긴다 — 저장은 "지금부터 이것이 전부"라는 말이다.
 *  3. **version 이 어긋나면 날짜가 한 건도 바뀌지 않는다.** 이 항목이 이 묶음의
 *     핵심이다: 날짜를 먼저 지워 놓고 version 을 보면, 충돌해 실패한 저장이
 *     남의 날짜를 지운 채로 끝난다.
 *  4. **다른 줄의 날짜는 건드리지 않는다.** 지우는 문장이 domestic_order_id 로
 *     좁혀져 있지 않으면 한 줄을 고치는 일이 이 표를 통째로 비우는 일이 된다.
 *  5. 빈 목록으로 되돌릴 수 있다 — 잘못 넣은 날짜에서 빠져나올 길이 있어야 한다.
 *
 * 뒷정리는 따로 하지 않는다. domestic_order_due_dates 는 부모를 ON DELETE
 * CASCADE 로 가리키므로, after() 가 domestic_orders 를 지울 때 함께 사라진다.
 */
describe("납기요청일 목록 (domestic_order_due_dates)", () => {
  test("여러 개를 적은 차례 그대로 만들 수 있다", async () => {
    const created = await createOrder({
      dueDates: [
        { dueDate: "2096-03-10", note: "1차분" },
        { dueDate: "2096-01-20", note: null },
        { dueDate: "2096-02-15", note: "3차분" },
      ],
    });
    if (!created.ok) return;

    const dueDates = await readDueDates(created.id);
    // 날짜순으로 다시 세우지 않는다 — 차례가 곧 뜻이다.
    assert.deepEqual(
      dueDates.map((row) => [row.dueDate, row.note, row.displayOrder]),
      [
        ["2096-03-10", "1차분", 1],
        ["2096-01-20", null, 2],
        ["2096-02-15", "3차분", 3],
      ]
    );
  });

  test("날짜 없는 줄이 기본이다 — 빈 목록으로 만들면 딸린 행이 하나도 없다", async () => {
    const created = await createOrder();
    if (!created.ok) return;
    assert.deepEqual(await readDueDates(created.id), []);
  });

  test("수정으로 날짜를 늘리면 생기고 줄이면 없어진다", async () => {
    const created = await createOrder({
      dueDates: [{ dueDate: "2096-01-20", note: "1차분" }],
    });
    if (!created.ok) return;

    const grown = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({
        dueDates: [
          { dueDate: "2096-01-20", note: "1차분" },
          { dueDate: "2096-02-15", note: "2차분" },
          { dueDate: "2096-03-10", note: "3차분" },
        ],
      }),
      actorUserId,
    });
    assert.equal(grown.ok, true, `늘리기 실패: ${JSON.stringify(grown)}`);
    if (!grown.ok) return;
    assert.equal((await readDueDates(created.id)).length, 3);

    const shrunk = await updateDomesticOrder({
      id: created.id,
      expectedVersion: grown.version,
      fields: fields({ dueDates: [{ dueDate: "2096-02-15", note: "이것만 남는다" }] }),
      actorUserId,
    });
    assert.equal(shrunk.ok, true, `줄이기 실패: ${JSON.stringify(shrunk)}`);

    const remaining = await readDueDates(created.id);
    assert.deepEqual(
      remaining.map((row) => [row.dueDate, row.note, row.displayOrder]),
      [["2096-02-15", "이것만 남는다", 1]],
      "폼에서 지운 날짜가 남아 있으면 안 된다"
    );
  });

  test("빈 목록으로 되돌릴 수 있다", async () => {
    const created = await createOrder({
      dueDates: [
        { dueDate: "2096-01-20", note: "잘못 넣은 날짜" },
        { dueDate: "2096-02-15", note: null },
      ],
    });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ dueDates: [] }),
      actorUserId,
    });
    assert.equal(result.ok, true, `되돌리기 실패: ${JSON.stringify(result)}`);
    assert.deepEqual(await readDueDates(created.id), []);
  });

  test("낡은 version으로 온 저장은 CONFLICT이고 날짜가 한 건도 바뀌지 않는다", async () => {
    const created = await createOrder({
      dueDates: [
        { dueDate: "2096-01-20", note: "1차분" },
        { dueDate: "2096-02-15", note: "2차분" },
      ],
    });
    if (!created.ok) return;
    const staleVersion = created.version;

    const first = await updateDomesticOrder({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ dueDates: [{ dueDate: "2096-03-10", note: "먼저 저장된 날짜" }] }),
      actorUserId,
    });
    assert.equal(first.ok, true);

    // 낡은 화면에서 온 저장. **날짜를 통째로 비우려는 저장**이라, 지우기가
    // version 대조보다 먼저 일어나면 여기서 자료가 사라진다.
    const second = await updateDomesticOrder({
      id: created.id,
      expectedVersion: staleVersion,
      fields: fields({ dueDates: [] }),
      actorUserId,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");

    const dueDates = await readDueDates(created.id);
    assert.deepEqual(
      dueDates.map((row) => [row.dueDate, row.note]),
      [["2096-03-10", "먼저 저장된 날짜"]],
      "충돌한 저장이 날짜를 한 건이라도 건드려서는 안 된다"
    );
    assert.equal((await readOrder(created.id)).version, 2, "충돌한 저장은 version 도 올리지 않는다");
  });

  test("지워진 행에 저장하려 해도 NOT_FOUND이고 날짜는 그대로다", async () => {
    const created = await createOrder({
      dueDates: [{ dueDate: "2096-01-20", note: "지우기 전" }],
    });
    if (!created.ok) return;
    await db
      .update(domesticOrders)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(domesticOrders.id, created.id));

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ dueDates: [] }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const dueDates = await readDueDates(created.id);
    assert.equal(dueDates.length, 1, "지워진 행의 날짜도 한 건도 바뀌지 않는다");
    assert.equal(dueDates[0].note, "지우기 전");
  });

  test("없는 고객사로 고치려 하면 날짜도 그대로다 — VALIDATION_ERROR가 먼저다", async () => {
    const created = await createOrder({
      customerId,
      dueDates: [{ dueDate: "2096-01-20", note: "그대로 남아야 한다" }],
    });
    if (!created.ok) return;

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ customerId: randomUUID(), dueDates: [] }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");

    const dueDates = await readDueDates(created.id);
    assert.equal(dueDates.length, 1, "검증에 걸린 저장이 날짜를 지워서는 안 된다");
  });

  test("한 줄의 날짜를 고쳐도 다른 줄의 날짜는 그대로다", async () => {
    const other = await createOrder({
      purchaseOrderNumber: "PO-OTHER-ROW",
      dueDates: [
        { dueDate: "2096-05-01", note: "남의 줄 1차분" },
        { dueDate: "2096-06-01", note: "남의 줄 2차분" },
      ],
    });
    if (!other.ok) return;

    const target = await createOrder({
      dueDates: [{ dueDate: "2096-01-20", note: "내 줄" }],
    });
    if (!target.ok) return;

    // 대상 줄의 날짜를 통째로 비운다 — 지우기가 domestic_order_id 로 좁혀져
    // 있지 않으면 이 한 번으로 표 전체가 빈다.
    const cleared = await updateDomesticOrder({
      id: target.id,
      expectedVersion: target.version,
      fields: fields({ dueDates: [] }),
      actorUserId,
    });
    assert.equal(cleared.ok, true, `비우기 실패: ${JSON.stringify(cleared)}`);

    assert.deepEqual(await readDueDates(target.id), []);
    const otherDueDates = await readDueDates(other.id);
    assert.deepEqual(
      otherDueDates.map((row) => [row.dueDate, row.note]),
      [
        ["2096-05-01", "남의 줄 1차분"],
        ["2096-06-01", "남의 줄 2차분"],
      ],
      "다른 줄의 날짜를 건드려서는 안 된다"
    );
  });

  test("저장은 requested_due_date 칸을 건드리지 않는다 — 아직 남겨 둔 원본이다", async () => {
    const created = await createOrder({ progressNote: "원본 보존 확인" });
    if (!created.ok) return;

    // 옮기기 전의 줄을 흉내 낸다 — 그 칸에 값이 남아 있는 상태.
    await db
      .update(domesticOrders)
      .set({ requestedDueDate: "2096-01-20" })
      .where(eq(domesticOrders.id, created.id));

    const result = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ dueDates: [{ dueDate: "2096-02-15", note: "새 표에 적은 날짜" }] }),
      actorUserId,
    });
    assert.equal(result.ok, true, `저장 실패: ${JSON.stringify(result)}`);

    const row = await readOrder(created.id);
    assert.equal(
      row.requestedDueDate,
      "2096-01-20",
      "새 폼이 보내지 않는 칸이 NULL 로 덮이면 옮기지 않은 원본이 사라진다"
    );
    assert.equal((await readDueDates(created.id)).length, 1);
  });

  test("완료 처리는 날짜를 건드리지 않는다 — 표시일 뿐 값을 고치는 조작이 아니다", async () => {
    const created = await createOrder({
      dueDates: [{ dueDate: "2096-01-20", note: "완료 전에 적은 날짜" }],
    });
    if (!created.ok) return;

    const completed = await setDomesticOrderCompletion({
      id: created.id,
      expectedVersion: created.version,
      completed: true,
      actorUserId,
    });
    assert.equal(completed.ok, true);

    const dueDates = await readDueDates(created.id);
    assert.deepEqual(
      dueDates.map((row) => [row.dueDate, row.note]),
      [["2096-01-20", "완료 전에 적은 날짜"]]
    );
  });
});
