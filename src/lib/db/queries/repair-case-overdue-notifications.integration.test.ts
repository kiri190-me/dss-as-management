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
import { createRepairCase } from "../mutations/repair-cases";
import { createDomesticOrder } from "../mutations/domestic-orders";
import { getRepairCaseById, listRepairCases } from "./repair-cases";
import {
  countRepairCaseOverdueStages,
  listRepairCasesOverdue,
} from "./repair-case-overdue-notifications";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 🔴 「납기 지연」이 **빌려 온 날짜로도** 뜨는가 — 진짜 DB 위에서 (2026-11-07)
 * ============================================================================
 * 2026-11-07 사용자 신고: 「고객 요청 납기일이 **내자정리에서 읽어온 경우
 * [납기지연]이 안뜨는** 것 같아」. 판정 자체는 순수 함수 시험이 전부 쥐고 있고
 * (domain/repair-case-overdue.test.ts), **이 파일이 보는 것은 DB 에서 재료가 정말로
 * 그 판정까지 실려 오는가**다 — 2026-11-07 이전의 결함이 정확히 그 자리였다(판정은
 * 매퍼 안에서 돌고 내자 날짜는 조회가 매퍼 뒤에서 덧씌우고 있었다).
 *
 * 🔴 **길을 셋 다 본다.** 하나만 고쳐지는 것이 이 조각의 가장 비싼 실패다:
 *   ① 종 알림  — listRepairCasesOverdue
 *   ② 수리 건 상세의 배지 — getRepairCaseById().isOverdue
 *   ③ 전체 A/S 현황의 배지 — listRepairCases() 안의 그 줄
 * 셋이 **같은 건에 같은 답**을 내야 한다.
 *
 * ── 🔴 왜 **1991년** 인가 ──────────────────────────────────────────────────
 * ② ③ 의 isOverdue 는 매퍼가 **실제 지금 시각**으로 잰다(「오늘」을 넣을 자리가
 * 없다 — 서버가 그리는 값이라 그래야 한다). 그래서 「지난 날짜」가 **진짜로 지나
 * 있어야** 하고, 고객 요청 납기일은 인수일보다 이를 수 없다(저장 쪽 잣대). 다른
 * 통합 시험들이 쓰는 먼 미래(209x)로는 이 시험을 쓸 수 없다 — 그 날짜는 영원히
 * 「아직 안 지났다」이다. 그래서 **먼 과거**를 쓴다: 인수일 1991-09-05, 지난 납기일
 * 1991-09-10, 안 지난 납기일 2991-09-10.
 * 🔵 인수번호의 연월은 인수일에서 나오므로 이 스위트의 달은 "9109" 다(그 달을 쓰는
 *    다른 시험이 없다 — 2026-11-07 실측).
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9109", 고객사 접두사 "AS-TEST-OVERDUE-",
 * 제품 모델 접두사 "OVERDUE-TEST-".
 *
 * after() 는 FK 차례대로 지운다 — domestic_orders 가 먼저다(repair_cases 와
 * customers 를 가리킨다). 납기요청일 행은 그 줄을 지우면 CASCADE 로 함께 사라진다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-OVERDUE-";
const TEST_MODEL_PREFIX = "OVERDUE-TEST-";
const TEST_YEAR_MONTH = "9109";
const TEST_RECEIVED_AT = "1991-09-05";
/** 진짜로 지난 하루. */
const PAST_DUE_DATE = "1991-09-10";
/** 아무리 늦게 돌려도 안 지날 하루. */
const FUTURE_DUE_DATE = "2991-09-10";

let actorUserId: string;
let engineerId: string;
let customerId: string;
const createdOrderIds: string[] = [];

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

/** 전부 비어 있는 한 줄. 이 표에는 필수 칸이 하나도 없다. */
function emptyFields(): DomesticOrderFields {
  return {
    repairCaseId: null,
    quoteId: null,
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

async function createCase(customerRequestedDueDate: string | null): Promise<string> {
  const result = await createRepairCase(baseCreateRepairCaseInput(customerRequestedDueDate));
  assert.equal(result.ok, true, `setup repair case failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.id;
}

async function attachDueDate(repairCaseId: string, dueDate: string): Promise<void> {
  const result = await createDomesticOrder({
    fields: {
      ...emptyFields(),
      repairCaseId,
      dueDates: [{ dueDate, note: null, deliveredDate: null, deliveredBy: null }],
    },
    actorUserId,
  });
  assert.equal(result.ok, true, `setup domestic order failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  createdOrderIds.push(result.id);
}

/** 제 칸이 비었고 연결된 내자 줄에 **지난** 날짜가 있는 건 — 사용자가 본 그 모양. */
let borrowedOverdueId: string;
/** 제 칸이 비었고 내자 줄의 날짜가 **아직 안 지난** 건. */
let borrowedFutureId: string;
/** 제 칸에 **지난** 날짜가 적힌 건(내자 없음) — 고치기 전에도 뜨던 모양. */
let ownOverdueId: string;
/** 제 칸에 **안 지난** 날짜가 적혔고 내자에는 지난 날짜가 있는 건 — 제 칸이 이긴다. */
let ownWinsId: string;
/** 빌려 온 날짜가 지났지만 **실제 출하일이 찍힌** 건. */
let shippedId: string;

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
  // created_by/updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야 한다.
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  borrowedOverdueId = await createCase(null);
  await attachDueDate(borrowedOverdueId, PAST_DUE_DATE);

  borrowedFutureId = await createCase(null);
  await attachDueDate(borrowedFutureId, FUTURE_DUE_DATE);

  ownOverdueId = await createCase(PAST_DUE_DATE);

  // 🔴 이 건만 순서가 다르다. 내자 줄을 **먼저** 붙이고 제 칸을 **직접** 적는다 —
  // 2026-10-30 의 「묶기」 때문이다: 제 칸이 차 있는 건에 내자 납기요청일을 저장하면
  // 그 날짜가 **수리 건의 고객 요청 납기일에도 써진다**(domain/requested-due-date-link.ts
  // 의 resolveRepairCaseDueDateWriteThrough). 그대로 두면 제 칸이 지난 날짜로 덮여
  // 「제 칸이 이긴다」를 잴 수 없다. 저장 경로가 아니라 칸을 직접 고치는 까닭이 그것이다.
  ownWinsId = await createCase(null);
  await attachDueDate(ownWinsId, PAST_DUE_DATE);
  await db
    .update(repairCases)
    .set({ customerRequestedDueDate: FUTURE_DUE_DATE })
    .where(eq(repairCases.id, ownWinsId));

  shippedId = await createCase(null);
  await attachDueDate(shippedId, PAST_DUE_DATE);
  // 출하일은 인수 정보 저장 경로가 아니라 **이 자리에서 직접** 찍는다 — 이웃
  // 통합 시험(mutations/repair-cases-update.integration.test.ts)이 쓰는 그 방법이다.
  await db
    .update(repairCases)
    .set({ actualShipmentDate: "1991-09-20" })
    .where(eq(repairCases.id, shippedId));
});

after(async () => {
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

test("🔴 밑자락 점검 — 다섯 건이 저마다 다른 모양으로 섰다", () => {
  // 이 못이 없으면 setup 이 조용히 틀어졌을 때(예: 내자 줄이 안 붙었을 때) 아래
  // 「안 뜬다」 단언들이 전부 공짜로 통과한다.
  const ids = [borrowedOverdueId, borrowedFutureId, ownOverdueId, ownWinsId, shippedId];
  assert.equal(new Set(ids).size, 5, "같은 건을 두 번 쓰고 있다");
  for (const id of ids) assert.ok(id, "setup 이 건을 만들지 못했다");
  assert.ok(PAST_DUE_DATE < new Date().toISOString().slice(0, 10), "표본의 '지난 날짜'가 안 지났다");
  assert.ok(FUTURE_DUE_DATE > new Date().toISOString().slice(0, 10), "표본의 '안 지난 날짜'가 지났다");
});

describe("① 종 알림 — listRepairCasesOverdue", () => {
  test("🔴 제 칸이 비었고 내자 줄에 지난 날짜가 있으면 뜬다 — 빌려 온 값이라는 표시와 함께", async () => {
    const rows = await listRepairCasesOverdue();
    const row = rows.find((item) => item.repairCaseId === borrowedOverdueId);
    assert.ok(row, "사용자가 신고한 그 모양이 종에 안 뜬다");
    assert.equal(row.dueDate, PAST_DUE_DATE);
    assert.equal(row.borrowed, true, "빌려 온 값인데 표시가 안 붙는다");
    assert.ok(row.intakeNumber.startsWith(`D${TEST_YEAR_MONTH}`), row.intakeNumber);
  });

  test("제 칸에 지난 날짜가 적힌 건도 뜬다 — 표시는 안 붙는다", async () => {
    const rows = await listRepairCasesOverdue();
    const row = rows.find((item) => item.repairCaseId === ownOverdueId);
    assert.ok(row, "제 칸으로 지연인 건이 안 뜬다");
    assert.equal(row.dueDate, PAST_DUE_DATE);
    assert.equal(row.borrowed, false, "제 칸 값인데 빌려 온 것으로 표시된다");
  });

  test("🔴 안 지난 날짜 · 제 칸이 이기는 건 · 이미 나간 건은 안 뜬다", async () => {
    const ids = new Set((await listRepairCasesOverdue()).map((item) => item.repairCaseId));
    assert.equal(ids.has(borrowedFutureId), false, "안 지난 빌려 온 날짜에 지연이 떴다");
    assert.equal(ids.has(ownWinsId), false, "제 칸의 안 지난 날짜를 두고 내자 날짜로 쟀다");
    assert.equal(ids.has(shippedId), false, "이미 나간 건에 지연이 떴다");
  });

  test("한 건에 한 줄이다 — 내자 줄이 붙어도 복제되지 않는다", async () => {
    const rows = await listRepairCasesOverdue();
    const mine = rows.filter((item) => item.repairCaseId === borrowedOverdueId);
    assert.equal(mine.length, 1, "같은 건이 여러 줄로 섰다");
  });
});

describe("② 수리 건 상세의 배지 — getRepairCaseById", () => {
  test("🔴 빌려 온 날짜가 지났으면 isOverdue 가 참이고, 그 날짜가 줄에 실려 온다", async () => {
    const resolved = await getRepairCaseById(borrowedOverdueId);
    assert.ok(resolved, "건을 못 읽었다");
    // 재료가 실려 오는가 — 2026-11-07 이전에는 이 칸이 여기서 늘 빈 배열이었다.
    assert.deepEqual([...resolved.domesticOrderDueDates], [PAST_DUE_DATE]);
    assert.equal(resolved.isOverdue, true, "상세 머리 카드의 배지가 안 뜬다");
  });

  test("안 지난 빌려 온 날짜면 거짓이다", async () => {
    const resolved = await getRepairCaseById(borrowedFutureId);
    assert.ok(resolved);
    assert.deepEqual([...resolved.domesticOrderDueDates], [FUTURE_DUE_DATE]);
    assert.equal(resolved.isOverdue, false);
  });

  test("🔴 제 칸이 찬 건은 내자를 **읽지도 않는다** — 그래도 제 칸으로 바르게 판정한다", async () => {
    // 자기 자리에 적힌 것이 먼저이므로, 빌릴 건이 아닌 줄은 질의 자체를 줄인다
    // (dueDateBorrowerIds). 빈 배열이 「날짜가 없다」는 뜻이 아니다.
    const winner = await getRepairCaseById(ownWinsId);
    assert.ok(winner);
    assert.deepEqual([...winner.domesticOrderDueDates], [], "안 빌릴 건의 날짜까지 읽고 있다");
    assert.equal(winner.isOverdue, false, "제 칸의 안 지난 날짜를 두고 내자 날짜로 쟀다");

    const own = await getRepairCaseById(ownOverdueId);
    assert.ok(own);
    assert.equal(own.isOverdue, true);
  });

  test("이미 나간 건은 거짓이다", async () => {
    const resolved = await getRepairCaseById(shippedId);
    assert.ok(resolved);
    assert.equal(resolved.actualShipmentDate, "1991-09-20", "setup: 출하일이 안 찍혔다");
    assert.equal(resolved.isOverdue, false);
  });
});

describe("③ 전체 A/S 현황의 배지 — listRepairCases", () => {
  test("🔴 목록의 그 줄도 상세와 **같은 답**이다", async () => {
    const rows = await listRepairCases();
    const byId = new Map(rows.map((row) => [row.id, row]));

    const borrowed = byId.get(borrowedOverdueId);
    assert.ok(borrowed, "만든 건이 목록에 없다 — 아래가 아무것도 안 잰다");
    assert.deepEqual([...borrowed.domesticOrderDueDates], [PAST_DUE_DATE]);
    assert.equal(borrowed.isOverdue, true, "표의 배지가 안 뜬다");

    assert.equal(byId.get(borrowedFutureId)?.isOverdue, false);
    assert.equal(byId.get(ownOverdueId)?.isOverdue, true);
    assert.equal(byId.get(ownWinsId)?.isOverdue, false);
    assert.equal(byId.get(shippedId)?.isOverdue, false);
  });

  test("🔴 종과 목록이 **같은 건들**을 가리킨다 — 한쪽만 고쳐지면 여기서 갈린다", async () => {
    const mine = new Set([borrowedOverdueId, borrowedFutureId, ownOverdueId, ownWinsId, shippedId]);
    const bell = new Set(
      (await listRepairCasesOverdue())
        .map((row) => row.repairCaseId)
        .filter((id) => mine.has(id))
    );
    const badge = new Set(
      (await listRepairCases()).filter((row) => mine.has(row.id) && row.isOverdue).map((row) => row.id)
    );
    assert.ok(bell.size > 0, "표본이 비었다 — 이 시험이 아무것도 안 잰다");
    assert.deepEqual([...bell].sort(), [...badge].sort());
  });
});

describe("④ 세는 도구가 보는 수", () => {
  test("🔴 ⑥(합계)이 실제 알림 줄 수와 같다 — 갈라지면 운영에서 틀린 수를 보고 판단한다", async () => {
    const stages = await countRepairCaseOverdueStages();
    const rows = await listRepairCasesOverdue();
    assert.equal(stages.overdueTotal, rows.length);
    assert.equal(stages.overdueTotal, stages.overdueByOwnDueDate + stages.overdueByBorrowedDueDate);
  });

  test("🔴 「새로 뜨는 수」가 빌려 온 건을 센다 — 이 시험의 건이 거기 들어 있다", async () => {
    const stages = await countRepairCaseOverdueStages();
    assert.ok(stages.live >= 5, `살아 있는 건이 ${stages.live}건 — 표본이 안 들어갔다`);
    assert.ok(stages.withBorrowedDueDate >= 2, "빌려 오는 건을 하나도 못 셌다");
    assert.ok(stages.overdueByBorrowedDueDate >= 1, "빌려 온 날짜로 지연인 건을 못 셌다");
    assert.ok(stages.overdueByOwnDueDate >= 1, "제 칸으로 지연인 건을 못 셌다");
  });
});
