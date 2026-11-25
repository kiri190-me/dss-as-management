import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  customers,
  domesticOrders,
  products,
  repairCaseIntakeSequences,
  repairCases,
  statusChangeHistories,
  users,
  workflowSteps,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { addCaseWorkflowStep } from "./case-workflow-steps";
import { createDomesticOrder, updateDomesticOrder } from "./domestic-orders";
import { saveRepairCaseDomesticOrderIssueDates } from "./domestic-order-issue-dates";
import {
  PO_ISSUED_REPAIR_WAITING_METADATA,
  PO_ISSUED_REPAIR_WAITING_REASON,
  PO_ISSUED_TARGET_REPAIR_STATUS,
} from "@/lib/domain/po-issued-repair-waiting";
import type { DomesticOrderFields } from "@/lib/validation/domestic-order-input";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * PO발행일이 적히면 단계가 [수리 대기]로 — 실제 DB (시험 DB), 2026-11-26
 * ============================================================================
 * 순수 판정(domain/po-issued-repair-waiting.ts)은 unit 목록의 같은 이름 시험이
 * 까닭 아홉을 값으로 못 박았다. 여기서 재는 것은 그쪽이 못 재는 둘이다:
 *  · **표에 실제로 무슨 일이 일어나는가** — 단계 · version · 이력 줄
 *  · 🔴 **통로 셋에 전부 걸렸는가.** 하나만 걸면 「수리 건 상세에서는 되는데 내자
 *    정리에서는 안 되는」 모양이 되고, 그 어긋남은 오류를 한 줄도 안 낸다.
 *
 * ── 🔴 시험 DB 에는 [수리 대기] 단계가 **없다** — 그래서 만들어 쓴다 ────────
 * 시험 DB 의 워크플로 단계는 씨앗이 domain/local/workflow/step-status-map.ts 에서
 * 만들어 넣는데(scripts/seed-dev-db.ts), 그 표에는 `WAITING_REPAIR` 가 한 줄도
 * 없다. 운영에는 **워크플로 편집기로 추가된** 그 단계가 있다(2026-11-26 운영 조회 —
 * 유상 계열의 `po_received`, 상태 WAITING_REPAIR).
 *
 * 그래서 이 파일은 **운영과 같은 방법으로** 그 단계를 만든다 — 건 전용 단계
 * 끼워넣기(addCaseWorkflowStep)다. 그 함수는 그 건만의 워크플로 버전을 복제해
 * (is_current=false) 단계를 하나 꽂으므로, **다른 시험이 그 단계를 보지 못한다.**
 * 🔴 씨앗 단계의 repair_status 를 바꿔치기하는 길은 **쓰면 안 된다** — 공용 버전을
 * 건드리는 것이라 주간보고·대시보드·단계 직접 변경 시험이 통째로 흔들린다.
 *
 * 🔵 **그래서 3번(단계가 없는 갈래)은 단계를 안 끼운 건을 그대로 쓴다.** 시험 DB 의
 * 기본 워크플로가 곧 「그 상태의 단계가 없는 워크플로」라서, 무상 갈래를 흉내 낼
 * 필요 없이 그 자체가 표본이다.
 *
 * ── 접수 건을 몇 개 만드는가: **셋** ───────────────────────────────────
 * 🔴 인수번호는 한 달에 99개가 한도다(채번). 헤프게 만들면 한참 뒤 전혀 다른
 * 시험이 까닭 없이 깨진다. 그래서 한 건에 여러 상황을 세운다 — 1번은 한 건에서
 * 날짜만 바꿔 가며 다섯 갈래를 보고, 2번은 한 건에서 보류·잠금까지 본다.
 *
 * 격리 이름: 접수 월 "9110" · 제품 모델 "POWAIT-TEST-".
 * 🔴 **걷을 때 건 전용 워크플로 버전까지 걷는다** — 안 걷으면 시험 DB 에 쓰레기
 * 버전이 쌓이고, 워크플로 관리 쪽 시험이 그 수를 센다.
 * ============================================================================
 */

const TEST_RECEIVED_AT = "2091-10-05";
const TEST_MODEL_PREFIX = "POWAIT-TEST-";
const TEST_YEAR_MONTH = "9110";
const TEST_INTAKE_PREFIX = "D9110%";

/**
 * 끼워넣은 단계의 키. 🔴 **운영의 `po_received` 를 쓰지 않는다** — 그 키는 씨앗
 * 워크플로에 이미 있어 끼워넣기가 DUPLICATE_KEY 로 막힌다. 그리고 판정이 키를 한
 * 글자도 보지 않는다는 사실이 이 이름으로 **값에서 드러난다**: 운영과 다른 키인데도
 * 아래 시험들이 전부 그 단계를 찾아낸다.
 */
const TARGET_STEP_KEY = "po_waiting_repair_probe";
const TARGET_STEP_LABEL = "PO 접수 완료";

/**
 * 자동 이동이 남긴 줄을 가르는 열쇠 — metadata 한 칸이다. 🔴 `action_type` 은
 * 사람이 [단계 직접 변경]으로 옮긴 것과 **똑같이** STEP_SET_MANUALLY 라, 이것 말고는
 * 구분할 길이 없다. 글자가 상수와 어긋나면 아래 0번이 먼저 빨개진다 — 안 그러면 이
 * 파일의 질의가 **오류 없이 0건**을 세기 시작하고, 「안 움직였다」 쪽 단언이 전부
 * 공짜로 통과한다.
 */
const AUTO_METADATA_KEY = "autoAdvancedOnPoIssuedDate";

let customerId: string;
let engineerId: string;
let actorUserId: string;
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

function fields(overrides: Partial<DomesticOrderFields> = {}): DomesticOrderFields {
  return { ...emptyFields(), ...overrides };
}

/** 지금 이 건이 어디에 서 있고 version 이 얼마인가. */
async function caseState(repairCaseId: string): Promise<{
  stepKey: string;
  stepOrder: number;
  status: string | null;
  version: number;
}> {
  const [row] = await db
    .select({
      stepKey: workflowSteps.key,
      stepOrder: workflowSteps.stepOrder,
      status: workflowSteps.repairStatus,
      version: repairCases.version,
    })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
    .where(eq(repairCases.id, repairCaseId));
  assert.ok(row, "접수 건을 못 읽었다");
  return row;
}

/** 그 건의 이력 줄 수 전부 — 「안 늘었는가」를 0 이 아니라 **증분**으로 재기 위한 것. */
async function historyCount(repairCaseId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(statusChangeHistories)
    .where(eq(statusChangeHistories.repairCaseId, repairCaseId));
  return row.count;
}

/** 🔴 **자동 이동이 남긴 줄만** 고른다(metadata 로 가린다 — 파일 머리말). */
async function autoMoveRows(repairCaseId: string) {
  return db
    .select({
      actionType: statusChangeHistories.actionType,
      fromStepId: statusChangeHistories.fromStepId,
      toStepId: statusChangeHistories.toStepId,
      actorUserId: statusChangeHistories.actorUserId,
      reason: statusChangeHistories.reason,
    })
    .from(statusChangeHistories)
    .where(
      and(
        eq(statusChangeHistories.repairCaseId, repairCaseId),
        // 🔴 글자를 그대로 적는다(상수를 끼워 넣지 않는다) — drizzle 의 sql 템플릿은
        //    끼워 넣은 상수를 **바인딩 자리로 구워** 질의 뜻이 달라진다. 그 대신 이
        //    글자가 실제 상수와 같은지는 0번이 맞대어 본다.
        sql`${statusChangeHistories.metadata}->>'autoAdvancedOnPoIssuedDate' = 'true'`
      )
    );
}

/**
 * 그 건의 워크플로에 [수리 대기] 단계를 하나 끼워넣는다 — **운영과 같은 방법**
 * (건 전용 버전 복제). 돌려주는 것은 그 단계의 step_order 다.
 */
async function insertWaitingRepairStep(repairCaseId: string): Promise<number> {
  const { version } = await caseState(repairCaseId);
  const added = await addCaseWorkflowStep({
    repairCaseId,
    expectedVersion: version,
    key: TARGET_STEP_KEY,
    label: TARGET_STEP_LABEL,
    status: PO_ISSUED_TARGET_REPAIR_STATUS,
    category: "BUSINESS",
    actorUserId: actorUserId,
  });
  assert.equal(added.ok, true, `단계 끼워넣기가 막혔다: ${JSON.stringify(added)}`);
  if (!added.ok) throw new Error("unreachable");
  const [step] = await db
    .select({ order: workflowSteps.stepOrder, status: workflowSteps.repairStatus })
    .from(workflowSteps)
    .where(eq(workflowSteps.id, added.stepId));
  assert.equal(step.status, PO_ISSUED_TARGET_REPAIR_STATUS, "끼워넣은 단계의 상태가 어긋났다");
  return step.order;
}

/**
 * Arrange-only 직접 SQL — 그 건을 특정 단계에 세운다. 정식 경로로 거기까지 가려면
 * 전이가 여러 번 필요하고 그것은 이 파일이 보려는 동작이 아니다(이웃
 * shipment-waiting-auto-advance.integration.test.ts 가 같은 자리에서 쓰는 방식).
 */
async function placeCaseAtOrder(repairCaseId: string, stepOrder: number): Promise<void> {
  const [row] = await db
    .select({ versionId: repairCases.workflowVersionId })
    .from(repairCases)
    .where(eq(repairCases.id, repairCaseId));
  const [step] = await db
    .select({ id: workflowSteps.id })
    .from(workflowSteps)
    .where(
      and(
        eq(workflowSteps.workflowVersionId, row.versionId),
        eq(workflowSteps.stepOrder, stepOrder)
      )
    );
  assert.ok(step, `그 버전에 step_order=${stepOrder} 인 단계가 없다 — 표본이 어긋났다`);
  await db
    .update(repairCases)
    .set({ currentWorkflowStepId: step.id })
    .where(eq(repairCases.id, repairCaseId));
}

async function removeFixtures(): Promise<void> {
  const leftovers = await db
    .select({ id: repairCases.id })
    .from(repairCases)
    .where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  const caseIds = leftovers.map((row) => row.id);
  if (caseIds.length > 0) {
    await db.delete(domesticOrders).where(inArray(domesticOrders.repairCaseId, caseIds));
    await db.delete(statusChangeHistories).where(inArray(statusChangeHistories.repairCaseId, caseIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, TEST_INTAKE_PREFIX));
  // 🔴 접수 건을 지운 **뒤** 건 전용 버전을 걷는다 — 그 버전의 단계를 접수 건이
  //    가리키고 있어(RESTRICT) 차례를 뒤집으면 지워지지 않는다.
  if (caseIds.length > 0) {
    const versions = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(
        and(eq(workflowVersions.isCaseScoped, true), inArray(workflowVersions.repairCaseId, caseIds))
      );
    const versionIds = versions.map((row) => row.id);
    if (versionIds.length > 0) {
      await db.delete(workflowTransitions).where(inArray(workflowTransitions.workflowVersionId, versionIds));
      await db.delete(workflowSteps).where(inArray(workflowSteps.workflowVersionId, versionIds));
      await db.delete(workflowVersions).where(inArray(workflowVersions.id, versionIds));
    }
  }
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
}

before(async () => {
  await removeFixtures();

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.isDeleted, false))
    .limit(1);
  assert.ok(customer, "삭제되지 않은 고객이 최소 1건 필요합니다");
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
  assert.ok(engineer, "승인된 AS_ENGINEER 가 필요합니다");
  engineerId = engineer.id;

  // 🔴 수리 건 상세의 발행일 저장은 `domesticOrders.edit` WRITE 를 묻는다. 그리고
  //    단계 끼워넣기는 관리자 또는 담당 엔지니어를 묻는다. 둘 다 통과하는 계정이
  //    필요해 ADMIN 을 고른다(씨앗 계정 — 이 파일은 계정을 하나도 만들지 않는다).
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false),
        eq(users.isActive, true)
      )
    )
    .limit(1);
  assert.ok(admin, "승인된 ADMIN 이 필요합니다");
  actorUserId = admin.id;
});

after(async () => {
  await removeFixtures();
  await pgClient.end({ timeout: 5 });
});

// ───────────────────────────────────────────────────────── 0. 표본 점검
describe("0. 표본 점검 — 이 파일이 무엇을 세고 있는지", () => {
  test("🔴 이력을 가르는 글자가 **실제 상수와 같다**", () => {
    // 🔴 이 한 줄이 이 파일 전체의 안전장치다. 상수 이름이 바뀌면 autoMoveRows 의
    //    질의가 **오류 없이 0건**을 세기 시작하고, 그러면 「안 움직였다」 쪽 단언이
    //    전부 공짜로 통과한다(이웃 shipment-waiting-auto-advance 가 같은 못을 박았다).
    assert.deepEqual(Object.keys(PO_ISSUED_REPAIR_WAITING_METADATA), [AUTO_METADATA_KEY]);
    assert.equal(PO_ISSUED_REPAIR_WAITING_METADATA[AUTO_METADATA_KEY], true);
  });

  test("🔴 시험 DB 의 **기본** 워크플로에는 그 상태의 단계가 하나도 없다", async () => {
    // 🔵 이 사실이 3번(갈 단계가 없는 갈래)의 표본 그 자체다. 언젠가 씨앗이 바뀌어
    //    기본 워크플로에 그 단계가 생기면 **여기서 먼저** 빨개진다 — 그러면 3번이
    //    조용히 뜻을 잃는 것이 아니라 고쳐야 할 자리가 드러난다.
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workflowSteps)
      .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSteps.workflowVersionId))
      .where(
        and(
          eq(workflowSteps.repairStatus, PO_ISSUED_TARGET_REPAIR_STATUS),
          eq(workflowVersions.isCaseScoped, false)
        )
      );
    assert.equal(row.count, 0, "씨앗 워크플로에 [수리 대기] 단계가 생겼다 — 3번 표본을 다시 보라");
  });

  test("🔴 끼워넣기로 만든 단계는 **상태가 WAITING_REPAIR** 이고 키는 운영과 다르다", async () => {
    const caseId = await createTestCase();
    const order = await insertWaitingRepairStep(caseId);
    const [step] = await db
      .select({ key: workflowSteps.key, status: workflowSteps.repairStatus })
      .from(workflowSteps)
      .innerJoin(repairCases, eq(repairCases.workflowVersionId, workflowSteps.workflowVersionId))
      .where(and(eq(repairCases.id, caseId), eq(workflowSteps.stepOrder, order)));
    assert.equal(step.status, "WAITING_REPAIR");
    // 🔴 운영 키(`po_received`)가 아니다. 그런데도 아래 시험들이 그 단계를 찾아낸다 —
    //    그것이 「키를 안 본다」의 값 증거다.
    assert.equal(step.key, TARGET_STEP_KEY);
    assert.notEqual(step.key, "po_received");
  });
});

// ─────────────────────────────── 1. 수리 건 상세 통로 (domestic-order-issue-dates)
describe("1. 통로 ① 수리 건 상세 「내자 정리 발행일」", () => {
  test("🔴 PO발행일을 적으면 단계가 [수리 대기]가 된다 — 그리고 되돌림·무동작 갈래까지", async () => {
    const caseId = await createTestCase();
    const targetOrder = await insertWaitingRepairStep(caseId);

    const before = await caseState(caseId);
    // 표본 점검: 지금은 그 단계가 **아니고**, 목표가 바로 앞이다.
    assert.notEqual(before.status, "WAITING_REPAIR", "시작부터 수리 대기면 아무것도 못 잰다");
    assert.ok(before.stepOrder < targetOrder, "목표 단계가 앞에 있어야 한다");
    const historyBefore = await historyCount(caseId);

    // ── ⓵ 줄이 없는 상태에서 **처음 적는다**(CREATE 갈래) ──────────────
    const created = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: caseId,
      quoteIssuedDate: null,
      orderIssuedDate: "2091-10-20",
      expectedVersion: null,
      actorUserId,
    });
    assert.equal(created.ok, true, `발행일 저장이 막혔다: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");

    const moved = await caseState(caseId);
    assert.equal(moved.status, "WAITING_REPAIR", "🔴 단계가 [수리 대기]로 안 갔다");
    assert.equal(moved.stepKey, TARGET_STEP_KEY);
    assert.equal(moved.stepOrder, targetOrder);
    // 🔴 version 을 올리기로 했다 — 안 올리면 열려 있던 상세가 낡은 값으로 되돌린다.
    assert.ok(moved.version > before.version, "version 이 안 올랐다");

    // 이력 한 줄이 늘었고, 그 줄이 **시스템이 옮겼다**고 말한다.
    assert.equal(await historyCount(caseId), historyBefore + 1, "이력이 한 줄 늘어야 한다");
    const rows = await autoMoveRows(caseId);
    assert.equal(rows.length, 1, "자동 이동 이력이 정확히 한 줄이어야 한다");
    assert.equal(rows[0].actionType, "STEP_SET_MANUALLY");
    assert.equal(rows[0].actorUserId, actorUserId, "날짜를 적은 사람이 들어가야 한다");
    assert.equal(
      rows[0].reason,
      PO_ISSUED_REPAIR_WAITING_REASON,
      "🔴 사유가 없으면 날짜를 적은 사람이 손으로 옮긴 것으로 읽힌다"
    );

    // ── ⓶ 🔴 **이미 [수리 대기]면 아무 일도 안 난다** ────────────────────
    const settled = await caseState(caseId);
    const historySettled = await historyCount(caseId);
    const again = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: caseId,
      quoteIssuedDate: null,
      orderIssuedDate: "2091-11-02", // 날짜는 **바뀐다** — 그래도 단계는 그대로여야 한다
      expectedVersion: created.version,
      actorUserId,
    });
    assert.equal(again.ok, true, `두 번째 저장이 막혔다: ${JSON.stringify(again)}`);
    if (!again.ok) throw new Error("unreachable");
    const afterAgain = await caseState(caseId);
    assert.equal(afterAgain.stepOrder, settled.stepOrder, "단계가 움직였다");
    assert.equal(afterAgain.version, settled.version, "🔴 version 이 쓸데없이 올랐다");
    assert.equal(await historyCount(caseId), historySettled, "🔴 이력이 쓸데없이 늘었다");

    // ── ⓷ 🔴 **날짜를 지워도 단계는 그대로다** ───────────────────────────
    const cleared = await saveRepairCaseDomesticOrderIssueDates({
      repairCaseId: caseId,
      quoteIssuedDate: "2091-09-01", // 🔵 둘 다 비면 EMPTY 로 막히므로 한쪽을 채운다
      orderIssuedDate: null,
      expectedVersion: again.version,
      actorUserId,
    });
    assert.equal(cleared.ok, true, `지우는 저장이 막혔다: ${JSON.stringify(cleared)}`);
    const afterCleared = await caseState(caseId);
    assert.equal(afterCleared.stepOrder, settled.stepOrder, "🔴 날짜를 지웠다고 단계가 돌아갔다");
    assert.equal(afterCleared.version, settled.version, "지우는 저장이 version 을 올렸다");
    assert.equal(await historyCount(caseId), historySettled, "지우는 저장이 이력을 남겼다");
  });
});

// ─────────────────────────── 2. 내자 정리 줄 수정 통로 (updateDomesticOrder)
describe("2. 통로 ② 내자 정리 줄 수정 — 되돌리지 않는다 · 보류 · 잠금", () => {
  test("🔴 이미 그 뒤 단계로 간 건은 PO발행일을 적어도 안 되돌아간다", async () => {
    const caseId = await createTestCase();
    const targetOrder = await insertWaitingRepairStep(caseId);
    // 🔴 그 단계를 **지나친** 자리에 세운다. 이것이 1번과 **짝**이다 — 없으면
    //    「언제나 덮는」 구현도 1번을 통과한다.
    await placeCaseAtOrder(caseId, targetOrder + 1);

    const before = await caseState(caseId);
    assert.ok(before.stepOrder > targetOrder, "표본이 목표보다 뒤에 있어야 한다");
    assert.notEqual(before.status, "WAITING_REPAIR");
    const historyBefore = await historyCount(caseId);

    const created = await createDomesticOrder({
      fields: fields({ repairCaseId: caseId }),
      actorUserId,
    });
    assert.equal(created.ok, true, `줄 만들기가 막혔다: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");

    const updated = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-10-20" }),
      actorUserId,
    });
    assert.equal(updated.ok, true, `줄 수정이 막혔다: ${JSON.stringify(updated)}`);

    const after = await caseState(caseId);
    assert.equal(after.stepKey, before.stepKey, "🔴 뒤 단계에 있던 건이 끌려 내려왔다");
    assert.equal(after.stepOrder, before.stepOrder);
    assert.equal(after.version, before.version, "안 움직였는데 version 이 올랐다");
    assert.equal(await historyCount(caseId), historyBefore, "안 움직였는데 이력이 남았다");
    assert.equal((await autoMoveRows(caseId)).length, 0);
  });

  test("🔴 보류 중인 건과 출하 완료로 잠긴 건은 안 옮긴다", async () => {
    const caseId = await createTestCase();
    const targetOrder = await insertWaitingRepairStep(caseId);
    const start = await caseState(caseId);
    assert.ok(start.stepOrder < targetOrder, "목표가 앞에 있어야 잴 수 있다");

    const created = await createDomesticOrder({
      fields: fields({ repairCaseId: caseId }),
      actorUserId,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("unreachable");

    // ── 보류 중 ────────────────────────────────────────────────────────
    const [versionRow] = await db
      .select({ versionId: repairCases.workflowVersionId })
      .from(repairCases)
      .where(eq(repairCases.id, caseId));
    // 🔴 created_at 을 **손으로 박는다.** 보류 판정은 HOLD_STARTED/RELEASED 가운데
    //    가장 최신 줄 하나를 보는데, 기본값(now())에 맡기면 두 줄이 같은 순간에
    //    떨어질 수 있고 그러면 어느 쪽이 이기는지 정해지지 않는다 — 그날 이 시험은
    //    까닭 없이 깜빡인다.
    await db.insert(statusChangeHistories).values({
      repairCaseId: caseId,
      workflowVersionId: versionRow.versionId,
      actionType: "HOLD_STARTED",
      actorUserId,
      reason: "시험용 보류",
      createdAt: new Date("2091-10-10T00:00:00.000Z"),
    });
    const heldBefore = await caseState(caseId);
    const held = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-10-20" }),
      actorUserId,
    });
    assert.equal(held.ok, true, `보류 중 저장이 막혔다: ${JSON.stringify(held)}`);
    if (!held.ok) throw new Error("unreachable");
    assert.equal(
      (await caseState(caseId)).stepOrder,
      heldBefore.stepOrder,
      "🔴 보류 중인데 시스템이 단계를 옮겼다"
    );
    assert.equal((await autoMoveRows(caseId)).length, 0);

    // ── 보류를 풀고 **잠근다** ──────────────────────────────────────────
    await db.insert(statusChangeHistories).values({
      repairCaseId: caseId,
      workflowVersionId: versionRow.versionId,
      actionType: "HOLD_RELEASED",
      actorUserId,
      reason: "시험용 보류 해제",
      createdAt: new Date("2091-10-11T00:00:00.000Z"),
    });
    await db.update(repairCases).set({ isLocked: true }).where(eq(repairCases.id, caseId));
    const lockedBefore = await caseState(caseId);
    const locked = await updateDomesticOrder({
      id: created.id,
      expectedVersion: held.version,
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-11-09" }),
      actorUserId,
    });
    assert.equal(locked.ok, true, `잠긴 건 저장이 막혔다: ${JSON.stringify(locked)}`);
    if (!locked.ok) throw new Error("unreachable");
    assert.equal(
      (await caseState(caseId)).stepOrder,
      lockedBefore.stepOrder,
      "🔴 출하 완료로 잠긴 건을 시스템이 옮겼다"
    );
    assert.equal((await autoMoveRows(caseId)).length, 0);

    // ── 🔵 **대조** — 잠금을 풀면 같은 길로 실제로 옮겨진다 ───────────────
    // 🔴 이것이 없으면 위 둘은 「애초에 이 통로가 안 걸려 있다」와 구별되지 않는다.
    await db.update(repairCases).set({ isLocked: false }).where(eq(repairCases.id, caseId));
    const freed = await updateDomesticOrder({
      id: created.id,
      expectedVersion: locked.version,
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-12-01" }),
      actorUserId,
    });
    assert.equal(freed.ok, true, `잠금 해제 뒤 저장이 막혔다: ${JSON.stringify(freed)}`);
    const afterFreed = await caseState(caseId);
    assert.equal(afterFreed.status, "WAITING_REPAIR", "🔴 잠금을 풀었는데도 안 옮겨졌다");
    assert.equal(afterFreed.stepOrder, targetOrder);
    assert.equal((await autoMoveRows(caseId)).length, 1);
  });
});

// ─────────────────────── 3. 내자 정리 행 추가 통로 + 갈 단계가 없는 갈래
describe("3. 통로 ③ 내자 정리 행 추가 — 그리고 갈 단계가 없으면 조용히 아무 일도", () => {
  test("🔴 그 상태의 단계가 없는 워크플로에서는 저장이 **성공하고** 단계는 그대로다", async () => {
    // 🔴 이 갈래가 운영의 **무상(WARRANTY_*)·레거시 MATCHER** 다 — 그쪽에는 그 상태의
    //    단계가 하나도 없다(2026-11-26 운영 조회). 여기서 저장이 거절되면 무상 건의
    //    PO발행일을 아예 못 적게 된다.
    const caseId = await createTestCase(); // 🔵 단계를 **안 끼운다** — 0번이 그 사실을 샀다
    const before = await caseState(caseId);
    const historyBefore = await historyCount(caseId);

    const created = await createDomesticOrder({
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-10-20" }),
      actorUserId,
    });
    assert.equal(created.ok, true, `🔴 갈 단계가 없다고 저장이 거절됐다: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");

    // 날짜는 **적혔다** — 기능이 막은 것이 없다.
    const [row] = await db
      .select({ orderIssuedDate: domesticOrders.orderIssuedDate })
      .from(domesticOrders)
      .where(eq(domesticOrders.id, created.id));
    assert.equal(row.orderIssuedDate, "2091-10-20");

    const after = await caseState(caseId);
    assert.equal(after.stepKey, before.stepKey, "갈 단계가 없는데 어딘가로 옮겼다");
    assert.equal(after.version, before.version, "안 움직였는데 version 이 올랐다");
    assert.equal(await historyCount(caseId), historyBefore, "안 움직였는데 이력이 남았다");
  });

  test("🔴 행을 추가하면서 PO발행일을 함께 적어도 옮겨진다 — 이 통로도 걸려 있다", async () => {
    // 🔵 바로 위 시험의 **대조**다. 위만 두면 「이 통로에 애초에 안 걸려 있다」와
    //    구별되지 않는다 — 둘 다 「아무 일도 안 일어남」으로 보이기 때문이다.
    const caseId = await createTestCase();
    const targetOrder = await insertWaitingRepairStep(caseId);
    const before = await caseState(caseId);
    assert.ok(before.stepOrder < targetOrder);

    const created = await createDomesticOrder({
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-10-20" }),
      actorUserId,
    });
    assert.equal(created.ok, true, `줄 만들기가 막혔다: ${JSON.stringify(created)}`);

    const after = await caseState(caseId);
    assert.equal(after.status, "WAITING_REPAIR", "🔴 행 추가 통로가 안 걸려 있다");
    assert.equal(after.stepOrder, targetOrder);
    assert.ok(after.version > before.version);
    assert.equal((await autoMoveRows(caseId)).length, 1);
  });

  test("🔴 수리 건이 안 붙은 줄(기타건)은 아무 일도 없이 저장된다", async () => {
    const created = await createDomesticOrder({
      fields: fields({ repairCaseId: null, orderIssuedDate: "2091-10-20" }),
      actorUserId,
    });
    assert.equal(created.ok, true, `기타건 저장이 막혔다: ${JSON.stringify(created)}`);
    if (!created.ok) throw new Error("unreachable");
    // 🔵 걷어야 한다 — repair_case_id 가 null 이라 아래 removeFixtures 의 그물에 안 걸린다.
    await db.delete(domesticOrders).where(eq(domesticOrders.id, created.id));
  });

  test("🔴 PO발행일을 안 건드린 저장은 단계를 흔들지 않는다", async () => {
    // 🔵 사람이 일부러 되돌려 놓은 건이 비고 한 줄 고칠 때마다 다시 앞으로 가면 안 된다.
    const caseId = await createTestCase();
    const targetOrder = await insertWaitingRepairStep(caseId);

    const created = await createDomesticOrder({
      fields: fields({ repairCaseId: caseId, orderIssuedDate: "2091-10-20" }),
      actorUserId,
    });
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error("unreachable");
    // 여기서 이미 옮겨졌다. 사람이 **되돌려 놓는다**.
    assert.equal((await caseState(caseId)).stepOrder, targetOrder);
    await placeCaseAtOrder(caseId, targetOrder - 1);
    const parked = await caseState(caseId);
    const historyParked = await historyCount(caseId);

    // 날짜는 그대로 두고 **다른 칸만** 고친다.
    const touched = await updateDomesticOrder({
      id: created.id,
      expectedVersion: created.version,
      fields: fields({
        repairCaseId: caseId,
        orderIssuedDate: "2091-10-20",
        etcNote: "비고만 고친다",
      }),
      actorUserId,
    });
    assert.equal(touched.ok, true, `비고 저장이 막혔다: ${JSON.stringify(touched)}`);

    const after = await caseState(caseId);
    assert.equal(after.stepOrder, parked.stepOrder, "🔴 날짜를 안 건드렸는데 단계가 움직였다");
    assert.equal(after.version, parked.version, "🔴 날짜를 안 건드렸는데 version 이 올랐다");
    assert.equal(await historyCount(caseId), historyParked, "이력이 늘었다");
  });
});
