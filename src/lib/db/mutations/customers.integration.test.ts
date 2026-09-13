import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { auditLogs, customers, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "./repair-cases";
import { createCustomer, updateCustomer } from "./customers";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising
 * updateCustomer() (the mutation layer behind update-customer.ts's Server
 * Action) directly — same layering choice repair-cases-update.integration.
 * test.ts makes for updateRepairCase(): the session/role-authorization gate
 * lives entirely in the Server Action (unit-tested separately in
 * customer-authorization.test.ts) and is not exercised here.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-EDIT-") and intake month ("9803" — distinct
 * from every other integration test file's own reserved month; the intake
 * number's year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree) so no two files ever race on the same
 * sequence row or customer namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-EDIT-";
const TEST_MODEL_PREFIX = "CUSTOMER-EDIT-TEST-";
const TEST_YEAR_MONTH = "9803";
const TEST_RECEIVED_AT = "2098-03-01";

let engineerId: string;
/** createCustomer 가 만든 고객사 — 감사 로그 정리에 쓴다(고객사 행은 이름 접두사로 지운다). */
const createdCustomerIds: string[] = [];

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the dev DB");
  engineerId = engineer.id;
});

after(async () => {
  if (createdCustomerIds.length > 0) {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "customers"), inArray(auditLogs.targetRecordId, createdCustomerIds)));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

async function createTestCustomer(nameSuffix: string) {
  const [row] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_NAME_PREFIX}${nameSuffix}-${randomUUID().slice(0, 8)}` })
    .returning();
  return row;
}

type RaceHoldTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** 붙든 트랜잭션을 되감는 신호 — 이것만 삼키고 나머지 오류는 그대로 올린다. */
const RELEASE_NAME_HOLD = new Error("release name hold");

/** 붙든 트랜잭션(holderPid)을 기다리며 멈춘 세션이 expected 개가 될 때까지 기다린다. */
async function waitUntilBlockedBy(holderPid: number, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await db.execute<{ waiting: number }>(
      sql`select count(*)::int as waiting from pg_stat_activity where ${holderPid} = any(pg_blocking_pids(pid))`
    );
    if (row.waiting >= expected) return;
    if (Date.now() > deadline) {
      throw new Error(`붙든 트랜잭션(pid ${holderPid})을 기다리는 호출이 ${row.waiting}개뿐이다 — ${expected}개를 기다렸다`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * 이름 중복 경쟁을 매번 같은 모양으로 만든다 — 두 호출이 **둘 다** 사전 검사를
 * 지나친 뒤 유니크 색인에서 부딪히게 한다.
 *
 * 그냥 Promise.all 로 두 번 부르면 대개 늦은 쪽의 사전 검사가 먼저 끝난 쪽의
 * 커밋을 보고 걸러 버려서 23505 갈래까지 가지 않는다(위 "concurrent rename race"
 * 시험은 세이브포인트가 없던 코드로도 통과했다). 그래서 같은 이름의 행을 넣고
 * **커밋하지 않은** 트랜잭션을 하나 붙들어 둔다. 두 호출은 사전 검사에서 그 행을
 * 보지 못하고(READ COMMITTED) 쓰기에서 색인에 막혀 그 트랜잭션을 기다린다. 둘 다
 * 기다리는 것을 pg_blocking_pids 로 확인한 뒤 되감으면 하나가 먼저 쓰고, 다른
 * 하나는 그 행에 막혔다가 커밋을 보고 23505 를 받는다. 시간에 기대지 않으므로
 * 결과가 매번 같다. 붙든 행은 되감기므로 정리할 것이 남지 않는다.
 */
async function raceBehindUncommittedName<T>(
  holdName: (tx: RaceHoldTx) => Promise<void>,
  startRacers: () => Promise<T>[]
): Promise<T[]> {
  const state: { racing?: Promise<T[]> } = {};
  try {
    await db.transaction(async (tx) => {
      await holdName(tx);
      const [holder] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const racing = Promise.all(startRacers());
      // 되감기 전에 거절돼도 처리 안 된 거절로 새지 않게 한다 — 결과는 아래에서 다시 기다린다.
      racing.catch(() => undefined);
      state.racing = racing;
      await waitUntilBlockedBy(holder.pid, 2);
      throw RELEASE_NAME_HOLD;
    });
  } catch (err) {
    if (err !== RELEASE_NAME_HOLD) throw err;
  }
  if (!state.racing) throw new Error("경쟁을 시작하지 못했다");
  return state.racing;
}

function baseCreateInput(
  customerId: string,
  overrides: Partial<ValidatedCreateRepairCaseInput> = {}
): ValidatedCreateRepairCaseInput {
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
    ...overrides,
  };
}

describe("updateCustomer", () => {
  test("valid update persists name/contact fields and returns a new updatedAt", async () => {
    const customer = await createTestCustomer("EDIT-OK");
    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: `${customer.name}-RENAMED`,
      contactName: "담당자",
      contactEmail: "contact@example.com",
      contactPhone: "010-1234-5678",
      rowColor: null,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.name, `${customer.name}-RENAMED`);
    assert.equal(row.contactName, "담당자");
    assert.equal(row.contactEmail, "contact@example.com");
    assert.equal(row.contactPhone, "010-1234-5678");
    assert.equal(row.updatedAt.toISOString(), result.updatedAt);
    assert.notEqual(row.updatedAt.toISOString(), customer.updatedAt.toISOString());
  });

  test("contact fields can be cleared back to null", async () => {
    const customer = await createTestCustomer("EDIT-CLEAR");
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "temp",
      contactEmail: "temp@example.com",
      contactPhone: "010-0000-0000",
      rowColor: null,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: first.updatedAt,
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(result.ok, true);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.contactName, null);
    assert.equal(row.contactEmail, null);
    assert.equal(row.contactPhone, null);
  });

  test("renaming to another active customer's normalized name is rejected (case/whitespace-insensitive)", async () => {
    const customerA = await createTestCustomer("DUP-A");
    const customerB = await createTestCustomer("DUP-B");

    const result = await updateCustomer({
      customerId: customerB.id,
      expectedUpdatedAt: customerB.updatedAt.toISOString(),
      name: `  ${customerA.name.toUpperCase()}  `,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.ok(result.fieldErrors?.name);

    const [rowB] = await db.select().from(customers).where(eq(customers.id, customerB.id));
    assert.equal(rowB.name, customerB.name, "rejected rename must not have applied");
  });

  test("renaming a customer to its own current name (no-op rename) is allowed, never treated as a duplicate of itself", async () => {
    const customer = await createTestCustomer("SELF-RENAME");
    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "unchanged-update",
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
  });

  test("stale expectedUpdatedAt returns CONFLICT and does not modify the row", async () => {
    const customer = await createTestCustomer("CONFLICT");
    const staleTimestamp = customer.updatedAt.toISOString();
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: staleTimestamp,
      name: customer.name,
      contactName: "v1",
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(first.ok, true);

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: staleTimestamp,
      name: customer.name,
      contactName: "v2-should-not-apply",
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.contactName, "v1", "the conflicting second update must not have applied");
  });

  test("NOT_FOUND for a nonexistent id and for an already soft-deleted customer", async () => {
    const missing = await updateCustomer({
      customerId: randomUUID(),
      expectedUpdatedAt: new Date().toISOString(),
      name: "x",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "NOT_FOUND");

    const customer = await createTestCustomer("DELETED-TARGET");
    await db.update(customers).set({ isDeleted: true }).where(eq(customers.id, customer.id));
    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: "y",
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("concurrent rename race: two different customers renamed to the same normalized name at once — exactly one succeeds", async () => {
    const target = `${TEST_CUSTOMER_NAME_PREFIX}RACE-TARGET-${randomUUID().slice(0, 8)}`;
    const customerA = await createTestCustomer("RACE-A");
    const customerB = await createTestCustomer("RACE-B");

    const [resultA, resultB] = await Promise.all([
      updateCustomer({
        customerId: customerA.id,
        expectedUpdatedAt: customerA.updatedAt.toISOString(),
        name: target,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        rowColor: null,
      }),
      updateCustomer({
        customerId: customerB.id,
        expectedUpdatedAt: customerB.updatedAt.toISOString(),
        name: target,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        rowColor: null,
      }),
    ]);

    assert.deepEqual([resultA.ok, resultB.ok].sort(), [false, true], "exactly one of the two concurrent renames should succeed");
  });

  test("사전 검사를 둘 다 지나친 동시 이름 수정 — 진 쪽도 날것의 23505 가 아니라 이름 중복 오류를 받는다", async () => {
    const target = `${TEST_CUSTOMER_NAME_PREFIX}RACE-HELD-${randomUUID().slice(0, 8)}`;
    const customerA = await createTestCustomer("RACE-HELD-A");
    const customerB = await createTestCustomer("RACE-HELD-B");
    const renameToTarget = (customer: typeof customerA) =>
      updateCustomer({
        customerId: customer.id,
        expectedUpdatedAt: customer.updatedAt.toISOString(),
        name: target,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        rowColor: null,
      });

    const results = await raceBehindUncommittedName(
      async (tx) => {
        await tx.insert(customers).values({ name: target });
      },
      () => [renameToTarget(customerA), renameToTarget(customerB)]
    );

    const losers = results.filter((result) => !result.ok);
    assert.equal(losers.length, 1, `정확히 하나만 이겨야 한다: ${JSON.stringify(results)}`);
    const [loser] = losers;
    if (loser.ok) return;
    assert.equal(loser.code, "VALIDATION_ERROR");
    assert.equal(loser.fieldErrors?.name, "이미 존재하는 고객사명입니다.");

    const holders = await db
      .select()
      .from(customers)
      .where(and(eq(customers.name, target), eq(customers.isDeleted, false)));
    assert.equal(holders.length, 1, "붙든 행은 되감겼고 이긴 쪽 하나만 그 이름을 가져야 한다");
  });

  test("never rewrites an existing repair case's contact snapshot when the customer's master contact info changes", async () => {
    const customer = await createTestCustomer("SNAPSHOT");
    const created = await createRepairCase(
      baseCreateInput(customer.id, {
        contactName: "인수 시점 담당자",
        contactPhone: "010-1111-2222",
        contactEmail: "intake-snapshot@example.com",
      })
    );
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "새 마스터 담당자",
      contactEmail: "new-master@example.com",
      contactPhone: "010-9999-8888",
      rowColor: null,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const [caseRow] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    assert.equal(caseRow.contactNameSnapshot, "인수 시점 담당자", "per-case snapshot must survive a customer-master contact edit unchanged");
    assert.equal(caseRow.contactPhoneSnapshot, "010-1111-2222");
    assert.equal(caseRow.contactEmailSnapshot, "intake-snapshot@example.com");
  });

  test("rowColor: 팔레트 키가 그대로 저장된다 — 색 코드가 아니라 키다", async () => {
    const customer = await createTestCustomer("ROW-COLOR-SET");
    assert.equal(customer.rowColor, null, "새 고객사는 색이 없는 것이 기본이다");

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: "amber",
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.rowColor, "amber");
  });

  test("rowColor: 다른 색으로 바꿀 수 있고, 비우면 null 로 돌아간다", async () => {
    const customer = await createTestCustomer("ROW-COLOR-EDIT");
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: "sky",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: first.updatedAt,
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: "violet",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const [changed] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(changed.rowColor, "violet");

    const cleared = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: second.updatedAt,
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
    });
    assert.equal(cleared.ok, true);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.rowColor, null, "비운 색은 빈 문자열이 아니라 null 이어야 한다");
  });

  test("rowColor: 색만 바꿔도 이름·연락처는 그대로 남는다", async () => {
    const customer = await createTestCustomer("ROW-COLOR-KEEPS");
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      name: customer.name,
      contactName: "담당자",
      contactEmail: "keep@example.com",
      contactPhone: "010-5555-6666",
      rowColor: null,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: first.updatedAt,
      name: customer.name,
      contactName: "담당자",
      contactEmail: "keep@example.com",
      contactPhone: "010-5555-6666",
      rowColor: "emerald",
    });
    assert.equal(result.ok, true);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.rowColor, "emerald");
    assert.equal(row.name, customer.name);
    assert.equal(row.contactName, "담당자");
    assert.equal(row.contactEmail, "keep@example.com");
    assert.equal(row.contactPhone, "010-5555-6666");
  });

  test("rowColor: 낡은 expectedUpdatedAt 이면 색도 바뀌지 않는다", async () => {
    const customer = await createTestCustomer("ROW-COLOR-CONFLICT");
    const staleTimestamp = customer.updatedAt.toISOString();
    const first = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: staleTimestamp,
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: "teal",
    });
    assert.equal(first.ok, true);

    const result = await updateCustomer({
      customerId: customer.id,
      expectedUpdatedAt: staleTimestamp,
      name: customer.name,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: "rose",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.rowColor, "teal", "충돌한 두 번째 수정은 색도 적용하지 않는다");
  });
});

/**
 * 고객사 관리 화면의 [고객사 추가](2026-09-13). 권한 관문은 서버 액션에 있고
 * (create-customer.ts — 단위 시험은 customer-authorization.test.ts ·
 * permission-features.test.ts), 여기서는 mutation 의 데이터 규칙만 본다.
 */
describe("createCustomer", () => {
  function uniqueName(label: string): string {
    return `${TEST_CUSTOMER_NAME_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
  }

  async function create(overrides: { name: string } & Partial<Parameters<typeof createCustomer>[0]>) {
    const result = await createCustomer({
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      rowColor: null,
      actorUserId: engineerId,
      ...overrides,
    });
    if (result.ok) createdCustomerIds.push(result.id);
    return result;
  }

  test("이름·연락처 셋·줄 색이 그대로 저장되고 활성 고객사로 생긴다", async () => {
    const name = uniqueName("CREATE-OK");
    const result = await create({
      name,
      contactName: "담당자",
      contactEmail: "create@example.com",
      contactPhone: "010-2222-3333",
      rowColor: "amber",
    });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(customers).where(eq(customers.id, result.id));
    assert.equal(row.name, name);
    assert.equal(row.contactName, "담당자");
    assert.equal(row.contactEmail, "create@example.com");
    assert.equal(row.contactPhone, "010-2222-3333");
    assert.equal(row.rowColor, "amber");
    assert.equal(row.isDeleted, false);
  });

  test("이름의 앞뒤 공백은 걷어서 저장한다", async () => {
    const name = uniqueName("CREATE-TRIM");
    const result = await create({ name: `   ${name}  ` });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const [row] = await db.select().from(customers).where(eq(customers.id, result.id));
    assert.equal(row.name, name);
  });

  test("활성 고객사와 정규화 기준으로 같은 이름은 거절한다 — 기존 고객사를 조용히 돌려주지 않는다", async () => {
    const existing = await createTestCustomer("CREATE-DUP");
    const result = await create({ name: `  ${existing.name.toUpperCase()}  ` });

    assert.equal(result.ok, false, "대소문자·앞뒤 공백만 다른 이름이 새로 만들어졌다");
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
    assert.equal(result.fieldErrors.name, "이미 존재하는 고객사명입니다.");

    const sameUpper = await db.select().from(customers).where(eq(customers.name, existing.name.toUpperCase()));
    assert.equal(sameUpper.length, 0, "거절된 추가가 행을 남기면 안 된다");
  });

  test("휴지통에 있는 같은 이름은 막지 않는다 — 유니크 인덱스가 활성 고객사만 본다", async () => {
    const trashed = await createTestCustomer("CREATE-TRASHED");
    await db
      .update(customers)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(customers.id, trashed.id));

    const result = await create({ name: trashed.name });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.notEqual(result.id, trashed.id);

    const [row] = await db.select().from(customers).where(eq(customers.id, result.id));
    assert.equal(row.isDeleted, false);
  });

  test("같은 트랜잭션에서 CREATE 감사 로그를 정확히 1행 남기고, 연락처는 담지 않는다", async () => {
    const name = uniqueName("CREATE-AUDIT");
    const result = await create({
      name,
      contactName: "감사담당",
      contactEmail: "audit-create@example.com",
      contactPhone: "010-7777-8888",
      rowColor: "sky",
    });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;

    const logs = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, "customers"), eq(auditLogs.targetRecordId, result.id)));
    assert.equal(logs.length, 1);
    const [log] = logs;
    assert.equal(log.actionType, "CREATE");
    assert.equal(log.actorUserId, engineerId);
    assert.equal(log.previousValue, null);
    const newValue = log.newValue as Record<string, unknown>;
    assert.equal(newValue.id, result.id);
    assert.equal(newValue.name, name);
    assert.equal(newValue.rowColor, "sky");

    // 연락처는 개인정보다 — customers-trash.ts 와 같은 규칙.
    const serialized = JSON.stringify(log.newValue);
    for (const secret of ["감사담당", "audit-create@example.com", "010-7777-8888"]) {
      assert.ok(!serialized.includes(secret), `감사 로그에 연락처(${secret})가 들어갔다`);
    }
  });

  test("같은 이름을 동시에 두 번 추가하면 정확히 하나만 성공한다", async () => {
    const name = uniqueName("CREATE-RACE");
    const [first, second] = await Promise.all([create({ name }), create({ name })]);
    assert.deepEqual([first.ok, second.ok].sort(), [false, true], "동시에 들어온 같은 이름 중 하나만 생겨야 한다");

    const rows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.name, name), eq(customers.isDeleted, false)));
    assert.equal(rows.length, 1);
  });
});
