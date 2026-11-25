import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

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
import { listPortalItemsForCustomer } from "./customer-portal";
import { findPortalFormById } from "@/lib/domain/customer-portal-forms";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 「고객 안내 현황」의 **납품 요청일** — 어느 날짜가 그 칸에 들어가는가 (2026-11-26)
 * ============================================================================
 * JUSUNG 양식의 「납품 요청일」은 수리 건의 「고객 요청 납기일」이다. 🔴 그런데 이
 * 저장소에서 그 말은 **DB 칸 하나가 아니다** — 2026-08-26 부터 「그 건에 적힌 값이
 * 먼저, 비면 연결된 내자 정리의 납기요청일 중 가장 이른 하루」라는 **두 칸의 판정**
 * 이고(domain/requested-due-date-link.ts 의 resolveRepairCaseRequestedDueDate),
 * 수리 건 상세 · 전체 A/S 현황 · 내 작업 · 종 알림이 전부 그 함수를 쓴다.
 *
 * 🔴 **이 조회만 그 판정을 안 거치고 날것을 읽고 있었다.** 그래서 수리 건 상세에는
 * 날짜가 보이는데 고객사 표에는 `-` 인 건이 있었고, 그 빈칸이 그대로 고객사 엑셀로
 * 나갔다(사용자 신고 2026-11-26). 이 파일이 재는 것이 정확히 그 구멍이다.
 *
 * ── 🔴 왜 단위 시험으로는 못 재는가 ─────────────────────────────────────
 * 「빌려 온다」를 재려면 **내자 줄이 실제로 있어야** 한다. 날짜는 조인으로 따라오지
 * 않고 별도 질의가 건별로 묶어 오므로(queries/repair-case-domestic-order-due-dates.ts),
 * 가짜 객체로는 그 배선이 끊겼는지 알 수 없다 — 끊겨도 「빈 배열 → 안 빌림」이라
 * **아무 오류 없이** 예전 모양으로 돌아간다.
 *
 * ── 여기서 못 박는 넷 ───────────────────────────────────────────────────
 *  ① 건에 **적혀 있으면 그 값**이다 — 🔴 내자 날짜가 **달라도 안 밀린다.**
 *  ② 건이 **비어 있으면** 연결된 내자 납기요청일 중 **가장 이른 하루**를 빌린다.
 *  ③ 🔴 **양쪽 다 없으면 null 이다.** 오늘 날짜도 다른 날짜도 메우지 않는다 —
 *     아무도 약속한 적 없는 날짜가 고객사 표에 적히면 안 된다.
 *  ④ 🔴 **셋이 서로 다른 답이어야 한다.** ①②③ 이 우연히 같은 값이면 「언제나
 *     같은 것을 내는」 구현도 통과한다 — 그 함정이 이 조각의 시작이었다(2번 줄과
 *     3번 줄이 둘 다 `-` 라 사람 눈에는 맞아 보였다).
 *
 * 🔴 **「빌려 왔는가」를 따로 묻지 않는다** — 그 표시는 어디에도 안 실린다(사용자
 * 결정 2026-11-26 — 「(내자) 표시는 없어도 돼」). 대신 **날짜 값 자체가 출처를
 * 말하게** 표본을 짰다: ① 의 답은 내자에 없는 날짜이고, ② 의 답은 그 건에 없는
 * 날짜다. 그래서 값만으로 어느 쪽에서 왔는지 갈린다.
 *
 * ── 🔵 왜 listPortalItemsForForm 이 아니라 고객사 하나인가 ───────────────
 * 날짜를 고르는 일은 전부 listPortalItemsForCustomer 안에서 일어나고, 양식 쪽
 * 함수는 그것을 고객사별로 불러 **합치고 정렬할** 뿐이다(그 둘이 이어져 있다는
 * 것은 글자로 지킨다 — components/customer-portal/customer-portal-form-view.test.ts).
 * 🔴 더 중요한 까닭: 양식으로 부르면 **시험 DB 에 있는 남의 JUSUNG 고객사까지**
 * 훑게 되고, 그 건들 중 견적발행일이 적힌 것이 있으면 조회가 **진짜 공유폴더를
 * 뒤진다**(queries/repair-case-quote-numbers.ts 의 listArchiveQuoteNumbers).
 * 시험이 바깥을 건드리는 길은 만들지 않는다. 🔵 이 파일이 만드는 건들은 내자 줄에
 * 견적발행일을 적지 않으므로 그 관문을 지나지 않는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9207"(이웃 고객 안내 현황 시험이 9208 · 9607 을 쓴다),
 * 고객사 접두사 "AS-TEST-PORTAL-DUE-", 제품 모델 접두사 "PORTAL-DUE-TEST-".
 * 인수번호의 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와 TEST_RECEIVED_AT
 * 은 같은 달을 가리켜야 한다.
 *
 * 🔴 내자 줄은 **이 실행이 만든 id 로만** 지우고, **접수보다 먼저** 지운다 —
 * `domestic_orders.repair_case_id` 는 접수를 지우면 CASCADE 가 아니라 SET NULL 이라
 * (그 스키마 주석) 접수를 먼저 지우면 줄이 주인 없이 남는다. 날짜 행은 줄에
 * CASCADE 로 매달려 있어 함께 간다.
 *
 * 🔴 디스크에는 아무것도 쓰지 않는다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-PORTAL-DUE-";
const TEST_MODEL_PREFIX = "PORTAL-DUE-TEST-";
const TEST_YEAR_MONTH = "9207";
const TEST_RECEIVED_AT = "2092-07-05";

/** ① 건에 적어 두는 날짜. 아래 어느 내자 날짜와도 달라야 한다(④). */
const OWN_DUE_DATE = "2092-09-30";
/** ① 의 건에 함께 매다는 내자 날짜 — **더 이른데도 져야 한다.** */
const OWN_CASE_ORDER_DUE_DATE = "2092-08-01";
/** ② 가 빌려 올 날짜(둘 중 이른 쪽)와 그 곁의 늦은 날짜. */
const BORROWED_EARLIEST = "2092-09-20";
const BORROWED_LATER = "2092-10-15";

let engineerId: string;
let customerId: string;

/** 🔴 뒷정리는 이 목록으로만 한다(이름으로 지우지 않는다). */
const createdCustomerIds: string[] = [];
const createdDomesticOrderIds: string[] = [];

/** ① 적힌 값이 있는 건(내자 날짜도 함께 달려 있다). */
let ownCaseId: string;
/** ② 비어 있고 내자 줄에 날짜가 둘 달린 건. */
let borrowedCaseId: string;
/** ③ 양쪽 어디에도 없는 건. */
let emptyCaseId: string;

function baseCreateRepairCaseInput(
  customerRequestedDueDate: string | null
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

async function createTestRepairCase(customerRequestedDueDate: string | null): Promise<string> {
  const created = await createRepairCase(baseCreateRepairCaseInput(customerRequestedDueDate));
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  return created.id;
}

/**
 * 그 접수에 내자 줄 하나를 달고 납기요청일 행들을 넣는다.
 *
 * 🔴 **견적발행일을 적지 않는다** — 적으면 조회가 공유폴더를 뒤진다(파일 머리말).
 */
async function attachDomesticOrderDueDates(
  repairCaseId: string,
  dueDates: readonly string[]
): Promise<void> {
  const [order] = await db
    .insert(domesticOrders)
    .values({ repairCaseId, customerId })
    .returning({ id: domesticOrders.id });
  createdDomesticOrderIds.push(order.id);
  if (dueDates.length === 0) return;
  await db
    .insert(domesticOrderDueDates)
    .values(dueDates.map((dueDate) => ({ domesticOrderId: order.id, dueDate })));
}

/** 그 접수의 줄 하나. 못 찾으면 던진다 — 「없어서 통과」를 막는다. */
async function portalRowOf(repairCaseId: string) {
  const items = await listPortalItemsForCustomer(customerId);
  const found = items.find((item) => item.sourceId === repairCaseId);
  assert.ok(found, "고객 안내 현황 목록에서 그 접수를 못 찾았다");
  return found;
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

  // 🔴 양식은 **칸으로** 고른다 — 이름은 가짜라 등록부에 없다(2026-10-17 의 그 규칙).
  const [customer] = await db
    .insert(customers)
    .values({
      name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}`,
      portalFormId: "JUSUNG",
    })
    .returning({ id: customers.id });
  customerId = customer.id;
  createdCustomerIds.push(customer.id);

  ownCaseId = await createTestRepairCase(OWN_DUE_DATE);
  await attachDomesticOrderDueDates(ownCaseId, [OWN_CASE_ORDER_DUE_DATE]);

  borrowedCaseId = await createTestRepairCase(null);
  await attachDomesticOrderDueDates(borrowedCaseId, [BORROWED_LATER, BORROWED_EARLIEST]);

  emptyCaseId = await createTestRepairCase(null);
});

after(async () => {
  // 🔴 내자 줄을 **먼저** 지운다(접수를 지우면 SET NULL 이라 주인 없이 남는다).
  //    날짜 행은 줄에 CASCADE 로 매달려 함께 간다.
  if (createdDomesticOrderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, createdDomesticOrderIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  if (createdCustomerIds.length > 0) {
    await db.delete(customers).where(inArray(customers.id, createdCustomerIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("🔴 납품 요청일 — 건에 적힌 값이 먼저, 비면 내자에서 빌린다 (2026-11-26)", () => {
  test("🔵 먼저 — JUSUNG 양식에 그 열이 있고 이 칸을 가리킨다(아래가 잴 것이 있다)", () => {
    const column = findPortalFormById("JUSUNG")?.columns.find((c) => c.label === "납품 요청일");
    assert.ok(column, "JUSUNG 양식에 「납품 요청일」 열이 없다");
    assert.equal(column.kind, "SYSTEM");
    assert.equal(column.kind === "SYSTEM" ? column.field : null, "customerRequestedDueDate");
  });

  test("🔴 ① 건에 적혀 있으면 **그 값**이다 — 내자 날짜가 더 일러도 안 밀린다", async () => {
    const row = await portalRowOf(ownCaseId);
    assert.equal(row.customerRequestedDueDate, OWN_DUE_DATE);
    // 🔴 울타리 — 그 건에 내자 날짜가 **정말로 달려 있어야** 이 시험이 뜻이 있다.
    //    안 달려 있으면 「빌릴 것이 없어서」 통과한 것이고, 옛 코드로 되돌려도 통과한다.
    assert.notEqual(OWN_CASE_ORDER_DUE_DATE, OWN_DUE_DATE);
    const [attached] = await db
      .select({ dueDate: domesticOrderDueDates.dueDate })
      .from(domesticOrderDueDates)
      .innerJoin(domesticOrders, eq(domesticOrderDueDates.domesticOrderId, domesticOrders.id))
      .where(eq(domesticOrders.repairCaseId, ownCaseId));
    assert.equal(attached?.dueDate, OWN_CASE_ORDER_DUE_DATE, "표본에 내자 날짜가 안 달렸다");
  });

  test("🔴 ② 비어 있으면 내자에서 **가장 이른 하루**를 빌린다", async () => {
    const row = await portalRowOf(borrowedCaseId);
    assert.equal(
      row.customerRequestedDueDate,
      BORROWED_EARLIEST,
      "빌려 오지 못했거나 늦은 날짜를 골랐다"
    );
    // 🔵 짝 — 「아무거나 하나」가 아니라 이른 쪽을 골랐다는 것을 못 박는다.
    assert.notEqual(BORROWED_EARLIEST, BORROWED_LATER);
    assert.ok(BORROWED_EARLIEST < BORROWED_LATER);
    // 🔴 그 건 자체에는 없는 날짜다 — 값만으로 「빌려 왔다」가 갈린다(파일 머리말).
    const [stored] = await db
      .select({ dueDate: repairCases.customerRequestedDueDate })
      .from(repairCases)
      .where(eq(repairCases.id, borrowedCaseId));
    assert.equal(stored?.dueDate, null, "표본의 제 칸이 비어 있지 않다");
  });

  test("🔴 ③ 양쪽 어디에도 없으면 **빈 채로 둔다** — 다른 날짜로 메우지 않는다", async () => {
    const row = await portalRowOf(emptyCaseId);
    assert.equal(
      row.customerRequestedDueDate,
      null,
      "아무도 약속한 적 없는 날짜가 고객사 표에 들어간다"
    );
  });

  test("🔴 ④ 셋이 **서로 다른 답**이다 — 「언제나 같은 것을 내는」 구현은 통과 못 한다", async () => {
    const answers = [
      (await portalRowOf(ownCaseId)).customerRequestedDueDate,
      (await portalRowOf(borrowedCaseId)).customerRequestedDueDate,
      (await portalRowOf(emptyCaseId)).customerRequestedDueDate,
    ];
    assert.deepEqual(answers, [OWN_DUE_DATE, BORROWED_EARLIEST, null]);
    assert.equal(new Set(answers).size, 3, "셋 중 둘이 같다 — 이 시험이 가르지 못한다");
  });

  test("🔴 접수 건에 적힌 날것은 **그대로 남는다** — 화면에 그린 값을 DB 에 쓰지 않는다", async () => {
    const [stored] = await db
      .select({ dueDate: repairCases.customerRequestedDueDate })
      .from(repairCases)
      .where(eq(repairCases.id, borrowedCaseId));
    assert.equal(
      stored?.dueDate,
      null,
      "빌려 그린 날짜가 접수 건에 박제됐다 — 「내가 적은 값」과 구별할 수 없게 된다"
    );
  });
});
