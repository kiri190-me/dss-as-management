import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
import { listRepairCases } from "./repair-cases";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 전체 A/S 현황(/repair-cases)이 받는 줄이 **신고증상·L/N 을 싣고 오는가**
 * ============================================================================
 * 표(RepairCaseTable)와 카드(RepairCaseCardList)가 2026-10-17 부터 신고증상을
 * 그리고, 카드도 L/N 을 그린다. 화면은 listRepairCases() 가 보낸 줄 말고는
 * 아무 데서도 그 값을 얻지 못한다 — 그러니 **조회가 그 칸을 실제로 싣고
 * 오는지**를 DB 를 거쳐 한 번 재 둔다.
 *
 * 🔴 왜 화면 시험만으로는 모자란가 — 화면 시험은 손으로 만든 줄을 넘겨 그린다.
 * 조회가 그 칸을 빠뜨려도 화면 시험은 전부 통과하고, 사람 눈에는 **늘 빈 칸**만
 * 보인다(그리고 그건 "값이 없는 건"과 구별되지 않아 아무도 신고하지 않는다).
 *
 * 🔵 차례(인수번호 내림차순)는 이웃 파일 repair-cases-list-order.integration.test.ts
 * 가 본다. 이 파일은 **무엇이 실려 오는가** 하나만 본다.
 *
 * ── 2026-10-19: 내자 납기요청일도 같은 물음에 걸린다 ────────────────────
 * 고객 요청 납기일이 빈 건은 연결된 내자 정리의 납기요청일을 빌려 그린다. 그
 * 규칙은 2026-08-26 에 있었는데 목록 조회가 domestic_orders 를 한 글자도 읽지
 * 않아, [내자정리]에 적은 날짜가 표에는 "-"로 보였다(사용자 신고). **머리말의
 * 그 실패가 실제로 일어난 것**이라, 이 파일이 보는 두 번째 칸으로 더한다.
 *
 * 🔴 조회가 싣고 오는 것은 **고르기 전의 날짜 목록**이다. 여럿 중 하나를 고르는
 * 일은 화면이 쓰는 도메인 함수가 하므로(domain/requested-due-date-link.ts), 여기서
 * 재는 것도 "가장 이른 하루"가 아니라 **날짜가 전부 실려 왔는가**다.
 *
 * 자기 뒤처리 규약은 이웃과 같다: 이 묶음만 쓰는 인수 월 "9411"(다른 어느 시험
 * 파일도 쓰지 않는다)과 모델 이름 앞가지로 가둬 두고, after() 가 만든 줄만
 * 지운다. legacyImportState 없이 부르므로 createRepairCase 가 남기는 것은
 * products · repair_cases · 월 순번 한 줄뿐이다.
 *
 * 🔴 값은 전부 가짜다 — 실제 고객사 이름·L/N·S/N·신고증상 문장은 한 글자도
 * 쓰지 않는다(공개 저장소다. 신고증상에는 고객사 사정이 섞인다).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-COLUMNS-";
const TEST_MODEL_PREFIX = "COLUMNS-TEST-MODEL-";
const TEST_YEAR_MONTH = "9411";
const RECEIVED_AT = "2094-11-05";
/** 가짜 신고증상 한 문장. 실제 접수 건의 문장이 아니다. */
const FAKE_SYMPTOM = "시험용 가짜 증상입니다. 전원이 들어오지 않는다고 적혀 있습니다.";

let customerId: string;
let engineerId: string;
const createdCaseIds = new Set<string>();
const createdProductIds = new Set<string>();
/** 이 묶음이 만든 내자 줄. 딸린 납기요청일은 CASCADE 로 함께 지워진다. */
const createdOrderIds = new Set<string>();

before(async () => {
  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
});

after(async () => {
  // 내자 줄을 먼저 지운다 — repair_case_id 가 ON DELETE SET NULL 이라 접수 건을
  // 먼저 지우면 이 줄이 주인 없이 남는다(딸린 날짜는 CASCADE 로 함께 사라진다).
  const orderIds = [...createdOrderIds];
  if (orderIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.id, orderIds));
  }
  const caseIds = [...createdCaseIds];
  if (caseIds.length > 0) {
    await db.delete(repairCases).where(inArray(repairCases.id, caseIds));
  }
  const productIds = [...createdProductIds];
  if (productIds.length > 0) {
    await db.delete(products).where(inArray(products.id, productIds));
  }
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  if (customerId) {
    await db.delete(customers).where(eq(customers.id, customerId));
  }
  await pgClient.end({ timeout: 5 });
});

function baseCreateInput(
  reportedSymptom: string | null,
  customerRequestedDueDate: string | null = null
): {
  input: ValidatedCreateRepairCaseInput;
  lotNumber: string;
  serialNumber: string;
} {
  const suffix = randomUUID().slice(0, 8);
  const lotNumber = `COLUMNS-LOT-${suffix}`;
  const serialNumber = `COLUMNS-SN-${suffix}`;
  return {
    lotNumber,
    serialNumber,
    input: {
      workflowType: "PAID_MATCHER",
      billingType: "PAID",
      customerId,
      endUserId: null,
      assignedEngineerId: engineerId,
      receivedAt: RECEIVED_AT,
      customerRequestedDueDate,
      internalTargetShipmentDate: null,
      modelName: `${TEST_MODEL_PREFIX}${suffix}`,
      lotNumber,
      serialNumber,
      partNumber: null,
      accessoryList: null,
      externalConditionSummary: null,
      reasonForRemoval: null,
      reportedSymptom,
      intakeInspectionResult: null,
      currentDiagnosisSummary: null,
      nextPlannedAction: null,
      notes: null,
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    },
  };
}

async function createTestCase(
  reportedSymptom: string | null,
  customerRequestedDueDate: string | null = null
): Promise<{ id: string; lotNumber: string; serialNumber: string }> {
  const { input, lotNumber, serialNumber } = baseCreateInput(reportedSymptom, customerRequestedDueDate);
  const created = await createRepairCase(input);
  assert.equal(created.ok, true, `setup failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("setup failed");
  createdCaseIds.add(created.id);
  const [row] = await db
    .select({ productId: repairCases.productId })
    .from(repairCases)
    .where(eq(repairCases.id, created.id));
  assert.ok(row);
  createdProductIds.add(row.productId);
  return { id: created.id, lotNumber, serialNumber };
}

describe("listRepairCases — 화면이 그리는 칸을 실제로 싣고 온다", () => {
  test("🔴 신고증상이 적힌 대로 실려 온다 (그리고 L/N·S/N 도 함께)", async () => {
    const created = await createTestCase(FAKE_SYMPTOM);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");

    assert.equal(
      row.reportedSymptom,
      FAKE_SYMPTOM,
      "신고증상이 실려 오지 않았다 — 조회의 select 에서 빠지면 화면은 늘 빈 칸만 그린다"
    );
    assert.equal(row.lotNumber, created.lotNumber, "L/N 이 실려 오지 않았다");
    assert.equal(row.serialNumber, created.serialNumber, "S/N 이 실려 오지 않았다");
  });

  test("신고증상이 비어 있는 건은 null 그대로 온다 — 빈 글자로 둔갑하지 않는다", async () => {
    const created = await createTestCase(null);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");
    assert.equal(row.reportedSymptom, null, "적지 않은 신고증상이 null 이 아니다");
  });
});

// ──────────────────────────── 2026-10-19 내자 납기요청일이 실려 오는가

/** 가짜 납기요청일 둘. 분할 납품이라 한 줄에 날짜가 여럿일 수 있다. */
const FAKE_DUE_DATES = ["2094-12-20", "2094-11-10"];

/**
 * 그 접수 건에 내자 줄 하나를 달고 날짜들을 붙인다.
 *
 * 🔵 읽는 칸만 채운다 — 고객사·형식·L/N 같은 글자 칸은 이 시험이 보지 않는다.
 * `isDeleted` 를 받는 것은 **지운 줄의 날짜는 세지 않는다**를 재기 위해서다.
 */
async function attachDomesticOrder(
  repairCaseId: string,
  dueDates: readonly string[],
  options: { isDeleted?: boolean } = {}
): Promise<string> {
  const [order] = await db
    .insert(domesticOrders)
    .values({ repairCaseId, customerId, isDeleted: options.isDeleted ?? false })
    .returning({ id: domesticOrders.id });
  createdOrderIds.add(order.id);

  if (dueDates.length > 0) {
    await db
      .insert(domesticOrderDueDates)
      .values(dueDates.map((dueDate) => ({ domesticOrderId: order.id, dueDate })));
  }
  return order.id;
}

describe("listRepairCases — 빌려 올 내자 납기요청일을 재료로 싣고 온다", () => {
  test("🔴 자기 칸이 빈 건은 연결된 내자 줄의 날짜를 **전부** 싣고 온다", async () => {
    const created = await createTestCase(null);
    await attachDomesticOrder(created.id, FAKE_DUE_DATES);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");

    assert.deepEqual(
      [...row.domesticOrderDueDates].sort(),
      [...FAKE_DUE_DATES].sort(),
      "내자 납기요청일이 실려 오지 않았다 — 표는 영영 '-' 만 그린다"
    );
    // 🔴 조인이 아니라 따로 읽어 묶는다는 것 — 조인했다면 이 건이 날짜 수만큼
    // 복제되어 목록에 같은 줄이 둘 선다.
    assert.equal(
      rows.filter((r) => r.id === created.id).length,
      1,
      "날짜가 둘이라고 접수 건이 두 줄로 늘어났다 — 조인으로 끌어온 것이다"
    );
    // 원본 칸은 건드리지 않는다. 빌려 온 날짜가 이 칸에 박제되면 "일부러 다르게
    // 적었다"와 "그냥 안 건드렸다"를 구분할 수 없다.
    assert.equal(row.customerRequestedDueDate, null, "빌려 온 날짜가 원본 칸에 써졌다");
  });

  test("🔵 자기 칸이 차 있는 건은 내자를 아예 묻지 않는다 — 빈 배열이다", async () => {
    const OWN = "2094-10-01";
    const created = await createTestCase(null, OWN);
    await attachDomesticOrder(created.id, FAKE_DUE_DATES);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");

    assert.equal(row.customerRequestedDueDate, OWN, "적어 둔 고객 요청 납기일이 실려 오지 않았다");
    assert.deepEqual(
      row.domesticOrderDueDates,
      [],
      "자기 칸이 찬 건의 내자 날짜까지 읽는다 — 쓰이지 않을 것을 묻고 있다"
    );
  });

  test("🔴 지운 내자 줄에 붙어 있던 날짜는 실려 오지 않는다", async () => {
    const created = await createTestCase(null);
    await attachDomesticOrder(created.id, FAKE_DUE_DATES, { isDeleted: true });

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");
    assert.deepEqual(
      row.domesticOrderDueDates,
      [],
      "화면에서 지운 줄의 날짜가 다른 화면의 값을 정하고 있다"
    );
  });

  test("연결된 내자 줄이 하나도 없으면 빈 배열이다 — undefined 가 새지 않는다", async () => {
    const created = await createTestCase(null);

    const rows = await listRepairCases();
    const row = rows.find((r) => r.id === created.id);
    assert.ok(row, "만든 건이 목록에 없다");
    assert.deepEqual(row.domesticOrderDueDates, []);
  });
});
