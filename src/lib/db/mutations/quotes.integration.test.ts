import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  products,
  quoteItems,
  quotes,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { createQuote, updateQuote } from "./quotes";
import type { QuoteFields } from "@/lib/validation/quote-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 견적서 — 실제로 저장되고, 겹치는 번호와 동시 수정이 막히는가
 * ============================================================================
 * 확인하는 것은 여섯 가지다.
 *
 *  1. **만들기와 고치기가 같은 칸들을 쓴다** — 새로 만들면 들어가는데 고치면
 *     안 들어가는 칸이 없어야 한다.
 *  2. **발행번호가 겹치면 거절한다** — 같은 번호의 견적서 두 장은 어느 쪽이
 *     고객사에 간 것인지 말할 수 없게 만든다.
 *  3. **지운 장의 번호는 다시 쓸 수 있다** — 인덱스가 `is_deleted = false` 로
 *     좁혀져 있으므로, 검사도 같은 조건이어야 "DB 는 허락하는데 화면이 거절하는"
 *     번호가 생기지 않는다.
 *  4. **version 이 낙관적 잠금으로 실제로 동작한다** — 낡은 version 으로 온
 *     저장은 CONFLICT 이고, 그때 **부품 줄까지 한 줄도 바뀌지 않는다.**
 *  5. **부품 줄은 통째로 갈아 끼워진다** — 폼에서 지운 줄이 남아 있으면 안 된다.
 *  6. **지워진 장은 고칠 수 없다** — NOT_FOUND.
 *
 * 인가는 여기서 시험하지 않는다. 세션·역할 판정은 서버 액션의 몫이고
 * (mutations/quotes.ts 헤더의 계층 구분), 역할 정책은 navigation.test.ts 와
 * permission-areas.test.ts 가 따로 본다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9602", 고객사 접두사 "AS-TEST-QUOTE-",
 * 제품 모델 접두사 "QUOTE-TEST-", 발행번호 접두사 "QUOTE-TEST-".
 * 인수번호의 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와
 * TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * after() 는 FK 순서대로 지운다 — quotes 를 먼저 지운다(quote_items 는
 * CASCADE 로 함께 사라진다). 그 표가 repair_cases 와 customers 를 가리키고
 * 있어서, 순서를 바꾸면 customers 의 RESTRICT 에 걸려 정리가 통째로 실패한다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-QUOTE-";
const TEST_MODEL_PREFIX = "QUOTE-TEST-";
const TEST_QUOTE_NUMBER_PREFIX = "QUOTE-TEST-";
const TEST_YEAR_MONTH = "9602";
const TEST_RECEIVED_AT = "2096-02-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
let linkedRepairCaseId: string;
const createdQuoteIds: string[] = [];

/** 필수 넷만 채운 한 장. 나머지는 전부 비어 있어도 된다. */
function fields(overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`,
    // 종류(2026-08-28). 기본은 내자다.
    kind: "DOMESTIC",
    quoteDate: "2096-02-10",
    repairCaseId: null,
    intakeNumberText: null,
    customerId: null,
    customerNameText: "테스트 공급처",
    modelNameText: null,
    lotNumberText: null,
    serialNumberText: null,
    faultDescriptionText: null,
    subject: "테스트 견적",
    validity: null,
    delivery: null,
    payment: null,
    workCost: "0",
    items: [],
    ...overrides,
  };
}

async function create(overrides: Partial<QuoteFields> = {}) {
  const result = await createQuote({ fields: fields(overrides), actorUserId });
  if (result.ok) createdQuoteIds.push(result.id);
  return result;
}

async function readQuote(id: string) {
  const [row] = await db.select().from(quotes).where(eq(quotes.id, id));
  return row;
}

/** 그 장의 부품 줄을 **차례대로**. 조회가 쓰는 것과 같은 순서다. */
async function readItems(quoteId: string) {
  return db
    .select({
      lineNo: quoteItems.lineNo,
      partNameText: quoteItems.partNameText,
      quantity: quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      partId: quoteItems.partId,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId))
    .orderBy(asc(quoteItems.lineNo));
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
  // 한다. 역할은 상관없다(인가는 서버 액션의 몫이다).
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
  // quotes 가 먼저다 — customers 를 RESTRICT 로 가리키고 있다.
  // quote_items 는 CASCADE 라 함께 사라진다.
  if (createdQuoteIds.length > 0) {
    await db.delete(quotes).where(inArray(quotes.id, createdQuoteIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("createQuote", () => {
  test("새 장은 version 1로 시작하고 만든 사람이 기록된다", async () => {
    const result = await create({ subject: "첫 장" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.version, 1);

    const row = await readQuote(result.id);
    assert.equal(row.version, 1);
    assert.equal(row.subject, "첫 장");
    assert.equal(row.createdBy, actorUserId);
    // 만든 사람이 곧 마지막으로 고친 사람이다.
    assert.equal(row.updatedBy, actorUserId);
    assert.equal(row.isDeleted, false);
  });

  test("모든 칸이 그대로 들어가고 부품 줄에 차례가 매겨진다", async () => {
    const result = await create({
      repairCaseId: linkedRepairCaseId,
      intakeNumberText: "손으로 적은 인수번호",
      customerId,
      customerNameText: "ICD Co.,Ltd",
      modelNameText: "CFK300FH-IC2",
      lotNumberText: "WU8042",
      serialNumberText: "1612027",
      faultDescriptionText: "Bias Fwd Drop 발생",
      subject: "전 칸 확인",
      validity: "발행일로부터 8주",
      delivery: "발주일로부터 4주",
      payment: "현금 결제",
      workCost: "1200000.00",
      items: [
        { partId: null, isOverhaulPart: false, partNameText: "Bias Board ASSY", quantity: 1, unitPrice: "1850000.00" },
        { partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 3, unitPrice: "45000.00" },
      ],
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const row = await readQuote(result.id);
    assert.equal(row.repairCaseId, linkedRepairCaseId);
    assert.equal(row.intakeNumberText, "손으로 적은 인수번호");
    assert.equal(row.customerId, customerId);
    assert.equal(row.customerNameText, "ICD Co.,Ltd");
    assert.equal(row.modelNameText, "CFK300FH-IC2");
    // L/N 과 S/N 이 서로 바뀌어 들어가지 않는다 — 실제로 한 번 헷갈렸던 자리다.
    assert.equal(row.lotNumberText, "WU8042");
    assert.equal(row.serialNumberText, "1612027");
    assert.equal(row.faultDescriptionText, "Bias Fwd Drop 발생");
    assert.equal(row.validity, "발행일로부터 8주");
    assert.equal(row.delivery, "발주일로부터 4주");
    assert.equal(row.payment, "현금 결제");
    assert.equal(row.workCost, "1200000.00");

    // 차례는 폼에 늘어놓은 순서 그대로 1부터다.
    assert.deepEqual(
      (await readItems(result.id)).map((item) => [item.lineNo, item.partNameText, item.quantity]),
      [
        [1, "Bias Board ASSY", 1],
        [2, "냉각 팬", 3],
      ]
    );
  });

  test("부품 다섯 줄을 넘겨도 전부 저장된다 — 합산은 xlsx 를 만들 때만 일어난다", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      partId: null,
      isOverhaulPart: false,
      partNameText: `부품 ${i + 1}`,
      quantity: 1,
      unitPrice: "10000.00",
    }));
    const result = await create({ items });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((await readItems(result.id)).length, 7);
  });

  test("발행번호가 겹치면 거절한다", async () => {
    const shared = `${TEST_QUOTE_NUMBER_PREFIX}DUP-${randomUUID().slice(0, 6)}`;
    const first = await create({ quoteNumber: shared });
    assert.equal(first.ok, true);

    const second = await create({ quoteNumber: shared });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "VALIDATION_ERROR");
    assert.ok(second.fieldErrors?.quoteNumber, "발행번호 칸에 오류가 붙어야 한다");
  });

  test("지운 장의 번호는 다시 쓸 수 있다 — 부분 unique 인덱스와 같은 규칙", async () => {
    const shared = `${TEST_QUOTE_NUMBER_PREFIX}REUSE-${randomUUID().slice(0, 6)}`;
    const first = await create({ quoteNumber: shared });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    await db.update(quotes).set({ isDeleted: true }).where(eq(quotes.id, first.id));

    const second = await create({ quoteNumber: shared });
    assert.equal(second.ok, true, "지운 번호를 다시 쓸 수 있어야 한다");
  });

  test("없는 수리 건을 가리키면 칸 오류로 답한다 — FK 오류는 아무것도 설명하지 못한다", async () => {
    const result = await create({ repairCaseId: randomUUID() });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.repairCaseId);
  });
});

describe("updateQuote", () => {
  test("저장할 때마다 version 이 1씩 오른다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;

    const first = await updateQuote({
      id: created.id,
      expectedVersion: 1,
      fields: fields({ quoteNumber: (await readQuote(created.id)).quoteNumber, subject: "한 번 고침" }),
      actorUserId,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.version, 2);
    assert.equal((await readQuote(created.id)).subject, "한 번 고침");
  });

  test("낡은 version 으로 온 저장은 CONFLICT — 부품 줄까지 한 줄도 바뀌지 않는다", async () => {
    const created = await create({
      subject: "원래 품명",
      items: [{ partId: null, isOverhaulPart: false, partNameText: "원래 부품", quantity: 2, unitPrice: "1000.00" }],
    });
    assert.ok(created.ok);
    if (!created.ok) return;
    const quoteNumber = (await readQuote(created.id)).quoteNumber;

    const stale = await updateQuote({
      id: created.id,
      expectedVersion: 99,
      fields: fields({
        quoteNumber,
        subject: "덮어쓰려던 품명",
        items: [{ partId: null, isOverhaulPart: false, partNameText: "덮어쓰려던 부품", quantity: 9, unitPrice: "2.00" }],
      }),
      actorUserId,
    });
    assert.equal(stale.ok, false);
    if (stale.ok) return;
    assert.equal(stale.code, "CONFLICT");

    const row = await readQuote(created.id);
    assert.equal(row.subject, "원래 품명", "본문이 바뀌면 안 된다");
    assert.equal(row.version, 1, "version 도 오르면 안 된다");
    // 여기가 요점이다 — CONFLICT 로 끝난 저장이 부품을 먼저 지워 버리면, 실패한
    // 저장이 자료를 지우고 간 셈이 된다.
    assert.deepEqual(
      (await readItems(created.id)).map((item) => [item.partNameText, item.quantity]),
      [["원래 부품", 2]]
    );
  });

  test("부품 줄은 통째로 갈아 끼워진다 — 폼에서 지운 줄이 남지 않는다", async () => {
    const created = await create({
      items: [
        { partId: null, isOverhaulPart: false, partNameText: "A", quantity: 1, unitPrice: "100.00" },
        { partId: null, isOverhaulPart: false, partNameText: "B", quantity: 1, unitPrice: "200.00" },
        { partId: null, isOverhaulPart: false, partNameText: "C", quantity: 1, unitPrice: "300.00" },
      ],
    });
    assert.ok(created.ok);
    if (!created.ok) return;
    const quoteNumber = (await readQuote(created.id)).quoteNumber;

    const updated = await updateQuote({
      id: created.id,
      expectedVersion: 1,
      fields: fields({
        quoteNumber,
        items: [{ partId: null, isOverhaulPart: false, partNameText: "C 만 남김", quantity: 5, unitPrice: "300.00" }],
      }),
      actorUserId,
    });
    assert.equal(updated.ok, true);

    assert.deepEqual(
      (await readItems(created.id)).map((item) => [item.lineNo, item.partNameText, item.quantity]),
      [[1, "C 만 남김", 5]]
    );
  });

  test("부품을 전부 지우면 한 줄도 남지 않는다", async () => {
    const created = await create({
      items: [{ partId: null, isOverhaulPart: false, partNameText: "지울 것", quantity: 1, unitPrice: "1.00" }],
    });
    assert.ok(created.ok);
    if (!created.ok) return;
    const quoteNumber = (await readQuote(created.id)).quoteNumber;

    const updated = await updateQuote({
      id: created.id,
      expectedVersion: 1,
      fields: fields({ quoteNumber, items: [] }),
      actorUserId,
    });
    assert.equal(updated.ok, true);
    assert.equal((await readItems(created.id)).length, 0);
  });

  test("다른 장의 번호로 바꾸려 하면 거절한다", async () => {
    const other = await create();
    const target = await create();
    assert.ok(other.ok && target.ok);
    if (!other.ok || !target.ok) return;
    const takenNumber = (await readQuote(other.id)).quoteNumber;

    const result = await updateQuote({
      id: target.id,
      expectedVersion: 1,
      fields: fields({ quoteNumber: takenNumber }),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.fieldErrors?.quoteNumber);
  });

  test("자기 번호를 그대로 두는 저장은 중복이 아니다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;
    const ownNumber = (await readQuote(created.id)).quoteNumber;

    const result = await updateQuote({
      id: created.id,
      expectedVersion: 1,
      fields: fields({ quoteNumber: ownNumber, subject: "번호는 그대로" }),
      actorUserId,
    });
    assert.equal(result.ok, true, "자기 번호를 자기가 중복이라고 말하면 안 된다");
  });

  test("지워진 장은 고칠 수 없다 — 수정이 되살리기를 겸하면 안 된다", async () => {
    const created = await create();
    assert.ok(created.ok);
    if (!created.ok) return;
    await db.update(quotes).set({ isDeleted: true }).where(eq(quotes.id, created.id));

    const result = await updateQuote({
      id: created.id,
      expectedVersion: 1,
      fields: fields(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("없는 장은 NOT_FOUND", async () => {
    const result = await updateQuote({
      id: randomUUID(),
      expectedVersion: 1,
      fields: fields(),
      actorUserId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});
