import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import {
  customers,
  customerStatusOptions,
  products,
  repairCaseCustomerStatus,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase } from "./repair-cases";
import { setCustomerStatuses } from "./customer-portal";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 고객 안내 현황의 **한 번에 저장** — 전부 저장되거나, 아무것도 저장되지 않거나
 * ============================================================================
 * 2026-10-07 사용자 지시로 표의 줄마다 있던 [저장]이 화면에 하나가 되었다
 * (CustomerPortalScreen). 화면·통로의 모양은 글자로 보는 시험이 따로 본다
 * (components/customer-portal/customer-portal-form-view.test.ts 의 「10.」 묶음).
 * 여기서 재는 것은 **실제 DB 에서 그 약속이 성립하는가**다 — 트랜잭션 경계는
 * 글자로 못 박을 수 없고, 깨져도 아무 오류 없이 반만 저장된다.
 *
 *  1. 여러 줄이 **한 번에** 만들어진다(새 줄은 version 1).
 *  2. 🔴 **한 줄이라도 version 이 어긋나면 아무것도 저장되지 않는다.** 함께 보낸
 *     멀쩡한 줄의 값도 그대로여야 한다 — 반만 저장되면 사람은 「저장됐다」고 믿고
 *     그대로 엑셀을 만들어 고객사에 보낸다.
 *  3. 🔴 어긋난 줄이 **어느 줄인지** 돌려준다(여럿이면 여럿 다).
 *  4. 쓸 수 없는 상태를 고른 줄이 섞이면 DB 에 닿기 전에 멈춘다.
 *  5. 같은 접수가 두 번 들어오면 막는다 — 그대로 두면 첫 줄이 올린 version 때문에
 *     둘째 줄이 「충돌」로 잡혀, 고치지도 않은 줄이 어긋났다는 말을 듣는다.
 *  6. 🔴 `formValues` 를 **안 넘긴 줄**은 적어 둔 값이 그대로 남는다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9607", 고객사 접두사 "AS-TEST-PORTAL-SAVE-",
 * 제품 모델 접두사 "PORTAL-SAVE-TEST-", 상태 이름 접두사 "PORTAL-SAVE-TEST-".
 * 인수번호의 연월은 receivedAt 에서 나오므로 TEST_YEAR_MONTH 와
 * TEST_RECEIVED_AT 은 같은 달을 가리켜야 한다.
 *
 * 🔴 디스크에는 아무것도 쓰지 않는다 — 접수 만들기가 파일을 건드리지 않는다.
 * after() 는 FK 순서대로 지운다: 접수(상태 줄이 cascade 로 함께 간다) → 제품 →
 * 인수번호 자리 → 고객사 → 상태 목록. 감사 기록은 건드리지 않는다(지우는 쪽이
 * 더 위험하다 — test-cleanup-static-safety.test.ts).
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-PORTAL-SAVE-";
const TEST_MODEL_PREFIX = "PORTAL-SAVE-TEST-";
const TEST_STATUS_LABEL_PREFIX = "PORTAL-SAVE-TEST-";
const TEST_YEAR_MONTH = "9607";
const TEST_RECEIVED_AT = "2096-07-05";

let actorUserId: string;
let engineerId: string;
let customerId: string;
/** 쓸 수 있는 상태 둘과, 내려 둔 상태 하나. */
let activeOptionId: string;
let otherOptionId: string;
let retiredOptionId: string;
const createdOptionIds: string[] = [];

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

/** 지금 저장돼 있는 줄. 없으면 null. */
async function readStatusRow(repairCaseId: string) {
  const [row] = await db
    .select({
      statusOptionId: repairCaseCustomerStatus.statusOptionId,
      note: repairCaseCustomerStatus.note,
      formValues: repairCaseCustomerStatus.formValues,
      version: repairCaseCustomerStatus.version,
    })
    .from(repairCaseCustomerStatus)
    .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));
  return row ?? null;
}

async function createOption(label: string, isActive: boolean): Promise<string> {
  const [option] = await db
    .insert(customerStatusOptions)
    .values({ label, isActive, createdBy: actorUserId, updatedBy: actorUserId })
    .returning({ id: customerStatusOptions.id });
  createdOptionIds.push(option.id);
  return option.id;
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
  // updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야 한다.
  // 역할은 상관없다(인가는 서버 액션의 몫이다).
  actorUserId = engineer.id;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}` })
    .returning({ id: customers.id });
  customerId = customer.id;

  const suffix = randomUUID().slice(0, 8);
  activeOptionId = await createOption(`${TEST_STATUS_LABEL_PREFIX}점검중-${suffix}`, true);
  otherOptionId = await createOption(`${TEST_STATUS_LABEL_PREFIX}수리중-${suffix}`, true);
  retiredOptionId = await createOption(`${TEST_STATUS_LABEL_PREFIX}내려둠-${suffix}`, false);
});

after(async () => {
  // 접수를 지우면 상태 줄이 cascade 로 함께 간다 — 상태 목록을 지우기 전에 비워야
  // 한다(status_option_id 가 RESTRICT 다).
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  if (createdOptionIds.length > 0) {
    await db
      .delete(customerStatusOptions)
      .where(inArray(customerStatusOptions.id, createdOptionIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("한 번에 저장 — 여러 줄이 한 트랜잭션으로 간다", () => {
  test("① 새 줄 둘을 한 번에 만든다 — 둘 다 version 1 이고 값이 그대로 들어간다", async () => {
    const first = await createTestRepairCase();
    const second = await createTestRepairCase();

    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId: first,
          statusOptionId: activeOptionId,
          note: "첫 줄",
          formValues: { passNumber: "P-1" },
          expectedVersion: null,
        },
        {
          repairCaseId: second,
          statusOptionId: null,
          note: "둘째 줄",
          formValues: {},
          expectedVersion: null,
        },
      ],
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.saved, 2);

    const firstRow = await readStatusRow(first);
    assert.deepEqual(
      { statusOptionId: firstRow?.statusOptionId, note: firstRow?.note, version: firstRow?.version },
      { statusOptionId: activeOptionId, note: "첫 줄", version: 1 }
    );
    assert.deepEqual(firstRow?.formValues, { passNumber: "P-1" });

    const secondRow = await readStatusRow(second);
    assert.deepEqual(
      { statusOptionId: secondRow?.statusOptionId, note: secondRow?.note, version: secondRow?.version },
      { statusOptionId: null, note: "둘째 줄", version: 1 }
    );
  });

  test("🔴 ② 한 줄의 version 이 낡았으면 **함께 보낸 멀쩡한 줄도** 저장되지 않는다", async () => {
    const good = await createTestRepairCase();
    const stale = await createTestRepairCase();

    // 두 줄을 한 번 저장해 둔다(version 1).
    const seeded = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: good, statusOptionId: null, note: "처음", formValues: {}, expectedVersion: null },
        { repairCaseId: stale, statusOptionId: null, note: "처음", formValues: {}, expectedVersion: null },
      ],
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded));

    // 그사이 다른 사람이 stale 줄을 먼저 고쳤다 — version 이 2 가 된다.
    const byOther = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId: stale,
          statusOptionId: null,
          note: "남이 먼저 고친 값",
          formValues: {},
          expectedVersion: 1,
        },
      ],
    });
    assert.equal(byOther.ok, true, JSON.stringify(byOther));

    // 내 화면은 아직 version 1 을 들고 있다.
    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: good, statusOptionId: activeOptionId, note: "내가 고친 값", formValues: { passNumber: "P-9" }, expectedVersion: 1 },
        { repairCaseId: stale, statusOptionId: activeOptionId, note: "내 옛 값", formValues: {}, expectedVersion: 1 },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.deepEqual(
      result.failures.map((failure) => ({ repairCaseId: failure.repairCaseId, code: failure.code })),
      [{ repairCaseId: stale, code: "CONFLICT" }],
      "어긋난 줄이 어느 줄인지 그대로 돌려줘야 한다"
    );

    // 🔴 여기가 이 시험의 핵심이다 — 멀쩡한 줄이 **하나도 안 바뀌어** 있어야 한다.
    const goodRow = await readStatusRow(good);
    assert.deepEqual(
      { note: goodRow?.note, statusOptionId: goodRow?.statusOptionId, version: goodRow?.version },
      { note: "처음", statusOptionId: null, version: 1 },
      "반만 저장됐다 — 사람은 「저장됐다」고 믿고 그대로 엑셀을 만든다"
    );
    assert.deepEqual(goodRow?.formValues, {}, "반만 저장됐다(손으로 적은 칸)");

    // 남이 고친 값도 내 옛 값으로 덮이지 않았다.
    const staleRow = await readStatusRow(stale);
    assert.equal(staleRow?.note, "남이 먼저 고친 값");
    assert.equal(staleRow?.version, 2);
  });

  test("🔴 ③ 어긋난 줄이 둘이면 둘 다 돌려준다 — 한 줄씩 알려 주면 저장을 여러 번 누른다", async () => {
    const first = await createTestRepairCase();
    const second = await createTestRepairCase();
    const seeded = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: first, statusOptionId: null, note: "처음", formValues: {}, expectedVersion: null },
        { repairCaseId: second, statusOptionId: null, note: "처음", formValues: {}, expectedVersion: null },
      ],
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded));

    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: first, statusOptionId: null, note: "낡은 판본", formValues: {}, expectedVersion: 99 },
        { repairCaseId: second, statusOptionId: null, note: "낡은 판본", formValues: {}, expectedVersion: 99 },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.deepEqual(
      [...result.failures.map((failure) => failure.repairCaseId)].sort(),
      [first, second].sort()
    );
    assert.ok(result.failures.every((failure) => failure.code === "CONFLICT"));
  });

  test("④ 줄이 아예 없으면 NOT_FOUND 다 — 없어진 것과 남이 고친 것을 가른다", async () => {
    const neverSaved = await createTestRepairCase();
    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: neverSaved, statusOptionId: null, note: "값", formValues: {}, expectedVersion: 1 },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.failures[0]?.code, "NOT_FOUND");
    assert.equal(await readStatusRow(neverSaved), null);
  });

  test("🔴 ⑤ 내려 둔 상태를 고른 줄이 섞이면 아무것도 저장되지 않는다", async () => {
    const good = await createTestRepairCase();
    const bad = await createTestRepairCase();

    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: good, statusOptionId: activeOptionId, note: "멀쩡한 줄", formValues: {}, expectedVersion: null },
        { repairCaseId: bad, statusOptionId: retiredOptionId, note: "내려 둔 상태", formValues: {}, expectedVersion: null },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.deepEqual(
      result.failures.map((failure) => ({ repairCaseId: failure.repairCaseId, code: failure.code })),
      [{ repairCaseId: bad, code: "INVALID" }]
    );
    assert.equal(await readStatusRow(good), null, "멀쩡한 줄이 저장돼 버렸다");
  });

  test("🔴 ⑥ 같은 접수가 두 번 들어오면 막는다 — 안 막으면 고치지도 않은 줄이 충돌로 잡힌다", async () => {
    const caseId = await createTestRepairCase();
    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: caseId, statusOptionId: null, note: "하나", formValues: {}, expectedVersion: null },
        { repairCaseId: caseId, statusOptionId: null, note: "둘", formValues: {}, expectedVersion: null },
      ],
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.failures[0]?.code, "INVALID");
    assert.equal(await readStatusRow(caseId), null);
  });

  test("🔴 ⑦ formValues 를 안 넘긴 줄은 적어 둔 값이 그대로 남는다", async () => {
    const caseId = await createTestRepairCase();
    const seeded = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId: caseId,
          statusOptionId: activeOptionId,
          note: "처음",
          formValues: { passNumber: "P-7", prvNumber: "PRV-7" },
          expectedVersion: null,
        },
      ],
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded));

    // formValues 를 아예 안 넘긴다 — "건드리지 않음"이다.
    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        { repairCaseId: caseId, statusOptionId: otherOptionId, note: "비고만 고침", expectedVersion: 1 },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const row = await readStatusRow(caseId);
    assert.deepEqual(row?.formValues, { passNumber: "P-7", prvNumber: "PRV-7" });
    assert.equal(row?.note, "비고만 고침");
    assert.equal(row?.statusOptionId, otherOptionId);
    assert.equal(row?.version, 2);
  });

  test("⑧ 보낼 줄이 없으면 아무 일도 하지 않는다", async () => {
    const result = await setCustomerStatuses({ actorUserId, rows: [] });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.saved, 0);
  });
});
