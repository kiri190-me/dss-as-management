import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  products,
  quotes,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { createQuote } from "../mutations/quotes";
import { softDeleteQuote } from "../mutations/quote-trash";
import { listQuotes, listQuotesForRepairCase, lookupIntakeForQuote } from "./quotes";
import type { QuoteFields } from "@/lib/validation/quote-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 견적서는 양방향이다 — 수리 건의 탭과 PO/내자 목록이 같은 표를 본다
 * ============================================================================
 * 접수 건 상세의 「견적서」 탭과 왼쪽 메뉴의 `PO / 내자 > 견적서` 는 **같은
 * 표(quotes)** 를 읽는다. 이어 붙인 것이 아니라 처음부터 한 표였다 —
 * `quotes.repair_case_id` 가 그것이다. 그래서 여기서 못 박는 것은 "동기화가
 * 되는가"가 아니라 **두 조회가 같은 줄을 같은 모양으로 돌려주는가**다.
 *
 *  1. **탭에서 붙여 만든 견적서가 PO/내자 목록에 나온다.**
 *  2. **인수번호로 붙인 견적서가 그 건의 탭에 나온다** — 폼이 실제로 타는 길
 *     (lookupIntakeForQuote)로 repair_case_id 를 얻어 붙인다.
 *  3. 🔴 **`repair_case_id` 가 없는 견적서는 어느 건의 탭에도 나오지 않는다.**
 *     폼이 그 값을 채우지 못한 채 저장되면 견적서는 PO/내자 목록에만 남고 그
 *     건에서는 영영 보이지 않는다 — 이 시험이 그 사고를 붙잡는 자리다.
 *  4. **지운 견적서는 양쪽 어디에도 없다.**
 *  5. **두 목록의 같은 줄은 글자 하나까지 같다.** 사람이 두 화면에서 같은
 *     견적서의 다른 금액을 보면 안 된다(두 조회가 한 몸통을 쓰는 이유).
 *
 * 인가는 여기서 시험하지 않는다 — 화면과 서버 액션의 몫이다
 * (mutations/quotes.ts 헤더의 계층 구분).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9604", 고객사 접두사 "AS-TEST-CASE-QUOTES-",
 * 제품 모델 접두사 "CASE-QUOTES-TEST-", 발행번호 접두사 "CASE-QUOTES-TEST-".
 * 인수번호의 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와
 * TEST_RECEIVED_AT 은 언제나 같은 달을 가리켜야 한다.
 *
 * after() 는 FK 순서대로 지운다 — quotes 가 먼저다(customers 를 RESTRICT 로
 * 가리킨다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CASE-QUOTES-";
const TEST_MODEL_PREFIX = "CASE-QUOTES-TEST-";
const TEST_QUOTE_NUMBER_PREFIX = "CASE-QUOTES-TEST-";
const TEST_YEAR_MONTH = "9604";
const TEST_RECEIVED_AT = "2096-04-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
/** 본 건과 옆 건. 옆 건은 "남의 견적서가 새어 들어오지 않는가"를 보는 데 쓴다. */
let caseId: string;
let intakeNumber: string;
let otherCaseId: string;
const createdQuoteIds: string[] = [];

function fields(overrides: Partial<QuoteFields> = {}): QuoteFields {
  return {
    quoteNumber: `${TEST_QUOTE_NUMBER_PREFIX}${randomUUID().slice(0, 8)}`,
    kind: "DOMESTIC",
    quoteDate: "2096-04-10",
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
    laborEquipmentKind: null,
    laborBaseCost: null,
    powerTestExcluded: false,
    laborPowerTestDeduction: null,
    repairTasks: [],
    workScopeLines: [],
    items: [],
    ...overrides,
  };
}

async function create(overrides: Partial<QuoteFields> = {}): Promise<{ id: string; version: number }> {
  const result = await createQuote({ fields: fields(overrides), actorUserId });
  assert.equal(result.ok, true, `quote create failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdQuoteIds.push(result.id);
  return { id: result.id, version: result.version };
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
    reportedSymptom: "Bias Fwd Drop 발생",
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

async function createTestRepairCase(): Promise<string> {
  const created = await createRepairCase(baseCreateRepairCaseInput());
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  return created.id;
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

  caseId = await createTestRepairCase();
  otherCaseId = await createTestRepairCase();

  const [row] = await db
    .select({ intakeNumber: repairCases.intakeNumber })
    .from(repairCases)
    .where(eq(repairCases.id, caseId));
  intakeNumber = row.intakeNumber;
});

after(async () => {
  // quotes 가 먼저다 — customers 를 RESTRICT 로 가리키고 있다.
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

describe("접수 건의 견적서 ↔ PO/내자 견적서 목록", () => {
  test("🔴 ① 수리 건에 붙여 만든 견적서가 PO/내자 목록(listQuotes)에 나온다", async () => {
    const created = await create({
      repairCaseId: caseId,
      intakeNumberText: intakeNumber,
      subject: "탭에서 만든 장",
    });

    const inTab = await listQuotesForRepairCase(caseId);
    assert.ok(
      inTab.some((row) => row.id === created.id),
      "만든 건의 탭에 없다"
    );

    // 여기가 「양방향」의 절반이다 — 새로 이어 붙인 것이 아니라 같은 표를 읽어서
    // 그냥 나온다.
    const inList = await listQuotes();
    assert.ok(
      inList.some((row) => row.id === created.id),
      "PO/내자 목록에 없다"
    );
  });

  test("🔴 ② 인수번호로 붙인 견적서가 그 건의 탭(listQuotesForRepairCase)에 나온다", async () => {
    // 폼이 실제로 타는 길 그대로다 — 인수번호 하나로 repair_case_id 를 얻는다.
    // 여기서 얻은 id 를 그대로 저장하는 것이 「새 견적서」 단추가 하는 일이다.
    const found = await lookupIntakeForQuote(intakeNumber);
    assert.ok(found, "인수번호로 접수 건을 찾지 못했다");
    assert.equal(found.repairCaseId, caseId);

    const created = await create({
      repairCaseId: found.repairCaseId,
      intakeNumberText: found.intakeNumber,
      subject: "인수번호로 붙인 장",
    });

    const inTab = await listQuotesForRepairCase(caseId);
    assert.ok(
      inTab.some((row) => row.id === created.id),
      "인수번호로 붙였는데 그 건의 탭에 없다"
    );
    assert.ok(
      (await listQuotes()).some((row) => row.id === created.id),
      "PO/내자 목록에도 있어야 한다"
    );
  });

  test("🔴 ③ repair_case_id 가 없는 견적서는 어느 건의 탭에도 나오지 않는다", async () => {
    // 폼이 그 값을 채우지 못한 채 저장하면 정확히 이 상태가 된다 — 목록에는
    // 있는데 만든 건에서는 영영 안 보인다.
    const orphan = await create({ repairCaseId: null, subject: "건에 안 붙은 장" });

    for (const [label, id] of [["본 건", caseId], ["옆 건", otherCaseId]] as const) {
      assert.equal(
        (await listQuotesForRepairCase(id)).some((row) => row.id === orphan.id),
        false,
        `${label}의 탭에 붙지 않은 장이 나왔다`
      );
    }
    // 그래도 PO/내자 목록에는 있다 — 접수 건과의 연결은 선택이다(접수 전에 먼저
    // 견적을 내는 일이 있다).
    assert.ok((await listQuotes()).some((row) => row.id === orphan.id));
  });

  test("옆 건의 견적서는 이 건의 탭에 새어 들어오지 않는다", async () => {
    const mine = await create({ repairCaseId: caseId, subject: "본 건" });
    const other = await create({ repairCaseId: otherCaseId, subject: "옆 건" });

    const inTab = await listQuotesForRepairCase(caseId);
    assert.ok(inTab.some((row) => row.id === mine.id));
    assert.equal(
      inTab.some((row) => row.id === other.id),
      false,
      "옆 건의 견적서가 이 건의 탭에 나왔다"
    );
  });

  test("🔴 ④ 지운 견적서는 양쪽 어디에도 나오지 않는다", async () => {
    const created = await create({ repairCaseId: caseId, subject: "지울 장" });

    const deleted = await softDeleteQuote({
      quoteId: created.id,
      expectedVersion: created.version,
      actorUserId,
      reason: "시험",
    });
    assert.equal(deleted.ok, true, `soft delete failed: ${JSON.stringify(deleted)}`);

    assert.equal(
      (await listQuotesForRepairCase(caseId)).some((row) => row.id === created.id),
      false,
      "지운 장이 접수 건의 탭에 남아 있다"
    );
    assert.equal(
      (await listQuotes()).some((row) => row.id === created.id),
      false,
      "지운 장이 PO/내자 목록에 남아 있다"
    );
  });

  test("🔴 ⑤ 두 목록이 돌려주는 같은 줄은 글자 하나까지 같다", async () => {
    // 화면 둘이 같은 견적서를 다른 금액·다른 요약 줄로 보이면 안 된다. 두 조회가
    // 한 몸통을 쓰는 이유가 이것이고, 갈라지는 날 여기서 걸린다.
    const created = await create({
      repairCaseId: caseId,
      intakeNumberText: intakeNumber,
      customerId,
      customerNameText: "ICD Co.,Ltd",
      modelNameText: "CFK300FH-IC2",
      lotNumberText: "WU8042",
      serialNumberText: "1612027",
      faultDescriptionText: "Bias Fwd Drop 발생",
      subject: "모양 비교",
      workCost: "1200000.00",
      items: [
        { partId: null, isOverhaulPart: false, partNameText: "Bias Board ASSY", quantity: 1, unitPrice: "1850000.00" },
        { partId: null, isOverhaulPart: false, partNameText: "냉각 팬", quantity: 3, unitPrice: "45000.00" },
      ],
    });

    const fromList = (await listQuotes()).find((row) => row.id === created.id);
    const fromTab = (await listQuotesForRepairCase(caseId)).find((row) => row.id === created.id);
    assert.ok(fromList && fromTab);
    assert.deepEqual(fromTab, fromList);

    // 금액과 인수번호가 실제로 실려 온다 — 빈 껍데기를 비교해 놓고 같다고 하면
    // 위 deepEqual 이 아무것도 지키지 못한다.
    assert.equal(fromTab.supplyAmount, 1850000 + 45000 * 3 + 1200000);
    assert.equal(fromTab.itemCount, 2);
    assert.equal(fromTab.intakeNumber, intakeNumber);
    assert.equal(fromTab.repairCaseId, caseId);
  });

  test("정렬은 PO/내자 목록과 같다 — 발행일자 내림차순", async () => {
    const older = await create({ repairCaseId: caseId, quoteDate: "2096-04-01", subject: "먼저 낸 장" });
    const newer = await create({ repairCaseId: caseId, quoteDate: "2096-04-30", subject: "나중에 낸 장" });

    const ids = (await listQuotesForRepairCase(caseId)).map((row) => row.id);
    assert.ok(ids.indexOf(newer.id) < ids.indexOf(older.id), "최근에 낸 장이 위에 와야 한다");
  });

  test("UUID 가 아닌 id 는 빈 목록이다 — 조회가 22P02 로 죽지 않는다", async () => {
    assert.deepEqual(await listQuotesForRepairCase("local-demo-case"), []);
    assert.deepEqual(await listQuotesForRepairCase(""), []);
  });

  test("견적서가 한 장도 없는 접수 건은 빈 목록이다 — 오류가 아니다", async () => {
    const emptyCaseId = await createTestRepairCase();
    assert.deepEqual(await listQuotesForRepairCase(emptyCaseId), []);
  });
});
