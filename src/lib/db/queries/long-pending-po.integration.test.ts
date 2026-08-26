import "../../../../scripts/load-env";

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
  workflowSteps,
} from "../schema";
import { createRepairCase, updateRepairCase } from "../mutations/repair-cases";
import { listLongPendingPoCaseIds } from "./long-pending-po";
import { listWeeklyReportCases } from "./weekly-report";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * listLongPendingPoCaseIds — "견적서를 낸 지 두 달이 지나도록 PO 가 안 났다"가
 * 실제 DB 에서 그대로 나오는가.
 *
 * 판정 규칙 자체는 domain/long-pending-po.test.ts 가 본다. 여기서 확인하는
 * 것은 **조회가 도메인에 무엇을 실어 넘기는가**다:
 *  1. 내자 줄의 두 날짜가 그대로 온다(견적일 · 발주일).
 *  2. 한 접수 건에 붙은 **여러 줄이 한 묶음으로** 온다 — 조인으로 복제되거나
 *     한 줄만 오면 판정이 뒤집힌다.
 *  3. `is_deleted = false` 인 줄만 온다 — 지워진 줄의 발주일이 판정을 막거나,
 *     지워진 줄의 견적일이 판정을 만들어 내면 안 된다.
 *  4. 출하 완료 판정에 쓰는 평탄화 상태가 **지금 서 있는 단계**에서 온다.
 *  5. 휴지통에 든 접수 건은 아예 나오지 않는다.
 *
 * "**다른 이유로** 빠진다"를 보이려는 시험에는 반드시 **대조**를 함께 둔다 —
 * 조건 하나만 되돌리면 묶음에 들어오는 건이라는 확인이 없으면, 검사를 통째로
 * 지워도 초록색인 시험이 된다.
 *
 * 파일 끝에 **주간보고 조회(listWeeklyReportCases)** 시험 둘이 붙어 있다. 다른
 * 함수지만 같은 상세표의 다른 칸을 보는 일이고, 접수 건을 만들어 두는 준비와
 * 뒷정리가 여기와 똑같아서 스위트를 나눠 쓴다 — 그 두 시험 앞의 주석을 볼 것.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 디렉터리의 다른 통합 테스트와 같다 — 이 스위트만 쓰는 접수 월 "9604",
 * 제품 모델 접두사 "LONGPO-TEST-". 인수번호의 연월은 receivedAt 에서 나오므로
 * TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은 달을 가리킨다. after() 는 이
 * 스위트가 만든 행만 FK 순서대로 지운다 — domestic_orders 를 먼저 지운다.
 *
 * 묶음에는 시드 데이터의 건도 들어 있을 수 있으므로, 단언은 언제나 **포함
 * 여부**로 한다(전체 목록과의 같음이 아니다).
 */

const TEST_YEAR_MONTH = "9604";
const TEST_RECEIVED_AT = "2096-04-06";
const TEST_MODEL_PREFIX = "LONGPO-TEST-";

/** 2026-08-25 14:00 KST — 한국/UTC 달력 날짜가 둘 다 08-25인, 경계가 아닌 시각. */
const NOW = new Date("2026-08-25T05:00:00.000Z");
/** NOW 기준으로 견적일 + 2개월이 **정확히 오늘**이 되는 날. */
const QUOTE_EXACTLY_TWO_MONTHS_AGO = "2026-06-25";
/** 그 하루 뒤 — 두 달이 되려면 하루가 모자란다. */
const QUOTE_ONE_DAY_SHORT = "2026-06-26";

let customerId: string;
let engineerId: string;
const createdCaseIds: string[] = [];

function baseCreateInput(): ValidatedCreateRepairCaseInput {
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

async function createTestCase(): Promise<string> {
  const created = await createRepairCase(baseCreateInput());
  assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  createdCaseIds.push(created.id);
  return created.id;
}

/** 내자 줄 한 개. 이 조회가 읽는 세 칸만 정하면 나머지는 전부 기본값(NULL)이다. */
async function insertOrder(
  repairCaseId: string,
  fields: { quoteIssuedDate?: string | null; orderIssuedDate?: string | null; isDeleted?: boolean }
): Promise<void> {
  await db.insert(domesticOrders).values({
    repairCaseId,
    quoteIssuedDate: fields.quoteIssuedDate ?? null,
    orderIssuedDate: fields.orderIssuedDate ?? null,
    isDeleted: fields.isDeleted ?? false,
  });
}

/**
 * 이 건을 **출하 완료 단계**에 세운다. 단계 key 를 코드에 박지 않고
 * repair_status 로 찾는 이유는, 판정 근거가 단계 이름이 아니라 그 단계의
 * 평탄화 상태이기 때문이다(조회가 읽는 것과 같은 값).
 */
async function moveToShipmentCompleted(repairCaseId: string): Promise<void> {
  const [current] = await db
    .select({ workflowVersionId: repairCases.workflowVersionId })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(
      and(
        eq(workflowSteps.workflowVersionId, current.workflowVersionId),
        eq(workflowSteps.repairStatus, "SHIPMENT_COMPLETED")
      )
    )
    .limit(1);
  assert.ok(step, "expected a SHIPMENT_COMPLETED step in this workflow version");
  await db
    .update(repairCases)
    .set({ currentWorkflowStepId: step.id })
    .where(eq(repairCases.id, repairCaseId));
}

async function flaggedIds(): Promise<string[]> {
  return listLongPendingPoCaseIds(NOW);
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
  for (const caseId of createdCaseIds) {
    await db.delete(domesticOrders).where(eq(domesticOrders.repairCaseId, caseId));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  await pgClient.end({ timeout: 5 });
});

test("견적일 + 2개월이 오늘이면 묶음에 들어가고, 하루가 모자라면 들어가지 않는다", async () => {
  const due = await createTestCase();
  await insertOrder(due, { quoteIssuedDate: QUOTE_EXACTLY_TWO_MONTHS_AGO });
  const notYet = await createTestCase();
  await insertOrder(notYet, { quoteIssuedDate: QUOTE_ONE_DAY_SHORT });

  const ids = await flaggedIds();
  assert.ok(ids.includes(due), "두 달이 된 건은 들어간다");
  assert.ok(!ids.includes(notYet), "하루가 모자란 건은 들어가지 않는다");
});

test("PO 발행일이 있으면 견적일이 아무리 오래돼도 빠진다", async () => {
  const withPo = await createTestCase();
  await insertOrder(withPo, { quoteIssuedDate: "2025-01-05", orderIssuedDate: "2025-02-01" });

  assert.ok(!(await flaggedIds()).includes(withPo));
});

test("견적일이 없는 줄만 있으면 빠진다", async () => {
  const noQuote = await createTestCase();
  await insertOrder(noQuote, {});

  assert.ok(!(await flaggedIds()).includes(noQuote));
});

test("내자 줄이 하나도 없는 접수 건은 후보가 아니다", async () => {
  const noOrders = await createTestCase();

  assert.ok(!(await flaggedIds()).includes(noOrders));
});

test("출하 완료 단계에 선 건은 빠진다", async () => {
  const shipped = await createTestCase();
  await insertOrder(shipped, { quoteIssuedDate: "2025-01-05" });

  // 대조 — 단계를 옮기기 전에는 들어가는 건이다.
  assert.ok((await flaggedIds()).includes(shipped), "대조: 출하 완료로 옮기기 전에는 들어간다");

  await moveToShipmentCompleted(shipped);
  assert.ok(!(await flaggedIds()).includes(shipped));
});

test("휴지통에 든 접수 건은 빠진다", async () => {
  const trashed = await createTestCase();
  await insertOrder(trashed, { quoteIssuedDate: "2025-01-05" });

  assert.ok((await flaggedIds()).includes(trashed), "대조: 지우기 전에는 들어간다");

  await db.update(repairCases).set({ isDeleted: true }).where(eq(repairCases.id, trashed));
  assert.ok(!(await flaggedIds()).includes(trashed));
});

test("지워진 내자 줄의 발주일은 판정을 막지 못한다", async () => {
  // 발주가 났다가 그 줄이 지워졌다면, 남아 있는 근거는 견적서뿐이다.
  const caseId = await createTestCase();
  await insertOrder(caseId, { quoteIssuedDate: "2025-01-05" });
  await insertOrder(caseId, { quoteIssuedDate: "2025-01-05", orderIssuedDate: "2025-02-01", isDeleted: true });

  assert.ok((await flaggedIds()).includes(caseId));
});

test("지워진 내자 줄의 견적일만으로는 걸리지 않는다", async () => {
  const caseId = await createTestCase();
  await insertOrder(caseId, { quoteIssuedDate: "2025-01-05", isDeleted: true });

  assert.ok(!(await flaggedIds()).includes(caseId));
});

test("줄이 여럿일 때: 발주일이 있는 줄이 하나라도 있으면 빠진다", async () => {
  const caseId = await createTestCase();
  await insertOrder(caseId, { quoteIssuedDate: "2025-01-05" });
  await insertOrder(caseId, { quoteIssuedDate: "2026-05-01", orderIssuedDate: "2026-05-10" });

  assert.ok(!(await flaggedIds()).includes(caseId));
});

test("줄이 여럿일 때: 발주일이 어느 줄에도 없으면 가장 이른 견적일로 판정한다", async () => {
  // 이른 줄은 딱 두 달이 됐고 늦은 줄은 아직이다 — 한 줄만 읽거나 늦은 줄을
  // 고르면 답이 뒤집힌다.
  const earliestIsDue = await createTestCase();
  await insertOrder(earliestIsDue, { quoteIssuedDate: "2026-08-20" });
  await insertOrder(earliestIsDue, { quoteIssuedDate: QUOTE_EXACTLY_TWO_MONTHS_AGO });

  const earliestNotYet = await createTestCase();
  await insertOrder(earliestNotYet, { quoteIssuedDate: "2026-08-20" });
  await insertOrder(earliestNotYet, { quoteIssuedDate: "2026-07-01" });

  const ids = await flaggedIds();
  assert.ok(ids.includes(earliestIsDue));
  assert.ok(!ids.includes(earliestNotYet));
});

test("같은 접수 건이 두 번 나오지 않는다 (내자 줄로 복제되지 않는다)", async () => {
  const caseId = await createTestCase();
  await insertOrder(caseId, { quoteIssuedDate: "2025-01-05" });
  await insertOrder(caseId, { quoteIssuedDate: "2025-02-05" });
  await insertOrder(caseId, { quoteIssuedDate: "2025-03-05" });

  const ids = await flaggedIds();
  assert.equal(ids.filter((id) => id === caseId).length, 1);
  assert.equal(new Set(ids).size, ids.length, "묶음 전체에 중복이 없다");
});

// ─────────────────────────────── 주간보고 상세표 — 비고를 고치는 데 필요한 값
/**
 * listWeeklyReportCases 가 **낙관적 잠금 값(version)** 을 줄마다 실어 오는가.
 *
 * 주간보고 상세표의 `비고` 는 화면에서 바로 고칠 수 있고, 그 저장은 이 값을
 * expectedVersion 으로 실어 보낸다(WeeklyReportNotesCell). 값이 없거나 낡으면
 * 낙관적 잠금이 통째로 무력해져 **남이 방금 고친 비고를 조용히 덮어쓴다** —
 * 타입은 통과하고 화면도 멀쩡해 보이므로, 그것을 잡는 자리는 여기뿐이다.
 *
 * 이 스위트에 붙인 이유: 같은 디렉터리에서 **접수 건을 실제로 만들어 두는**
 * 통합 시험이 여기고, 위 시험들이 보는 `견적서 발행일` 도 같은 상세표의 칸이다.
 * 격리 규약(접수 월 9604 · 모델 접두사)과 뒷정리를 그대로 나눠 쓴다.
 *
 * 시드 자료의 건도 함께 나오므로 단언은 언제나 **포함 여부**로 한다.
 */
test("주간보고 조회가 낙관적 잠금 값(version)을 실어 오고, 저장하면 그 값이 올라간다", async () => {
  const caseId = await createTestCase();

  const before = (await listWeeklyReportCases()).find((row) => row.id === caseId);
  assert.ok(before, "대조: 방금 만든 건은 주간보고 목록에 들어 있다");
  assert.equal(before.version, 1, "새로 만든 접수 건의 version 은 1이다");

  // 상수 1을 돌려주기만 해도 위 단언은 통과한다. 그래서 실제로 한 번 고쳐 보고
  // **따라 올라가는지**까지 본다 — 화면이 낡은 값을 들고 있으면 저장이 CONFLICT
  // 로 막혀야 하는데, 조회가 늘 같은 숫자를 주면 그 문이 열린 채로 남는다.
  //
  // 보내는 것은 `notes` 키 **하나**다 — 주간보고 화면이 보내는 모양 그대로이고,
  // 같은 구간의 신고 증상·담당 엔지니어는 손대지 않은 채 남는다.
  const updated = await updateRepairCase(
    caseId,
    before.version,
    "FAULT_SERVICE",
    { notes: "주간보고 비고 시험" },
    engineerId
  );
  assert.equal(updated.ok, true, `update failed: ${JSON.stringify(updated)}`);

  const after = (await listWeeklyReportCases()).find((row) => row.id === caseId);
  assert.ok(after, "고친 뒤에도 같은 건이 목록에 있다");
  assert.equal(after.version, before.version + 1);
  assert.equal(after.notes, "주간보고 비고 시험", "고친 비고가 그대로 따라온다");
});

test("주간보고 조회의 모든 줄에 version 이 있다", async () => {
  // 한 줄이라도 비면 그 줄의 `수정` 은 저장할 수 없거나(값 없음) 아무 버전으로나
  // 저장하게 된다. 대조를 함께 둔다 — 목록이 통째로 비어 있으면 이 시험은 아무
  // 것도 확인하지 못한 채 초록색이 된다.
  await createTestCase();

  const rows = await listWeeklyReportCases();
  assert.ok(rows.length > 0, "대조: 주간보고에 나올 건이 하나 이상 있다");
  for (const row of rows) {
    assert.equal(
      typeof row.version,
      "number",
      `${row.intakeNumber} 의 version 이 실려 오지 않았다`
    );
    assert.ok(row.version >= 1, `${row.intakeNumber} 의 version 이 1보다 작다`);
  }
});
