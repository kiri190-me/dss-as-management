import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customers, endUserContacts, endUsers, products, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "./repair-cases";
import {
  createEndUser,
  createEndUserContact,
  removeEndUserContact,
  renameEndUser,
  updateEndUserContact,
} from "./end-users";
import { listEndUserContactsByCustomerId } from "../queries/customers";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";
import { validateEndUserContactFields } from "@/lib/validation/end-user-input";

/**
 * Real-DB integration test against dss-as-postgres-dev, exercising the
 * End-User + multi-contact management mutation layer directly — same
 * layering choice customers.integration.test.ts makes for updateCustomer():
 * the session/role-authorization gate lives entirely in end-users.ts's
 * Server Actions (unit-tested separately in customer-authorization.test.ts)
 * and is not exercised here.
 *
 * Deliberately self-cleaning and isolated to a test-only customer-name
 * prefix ("AS-TEST-CUSTOMER-EU-") and intake month ("9805" — distinct from
 * every other integration test file's own reserved month; the intake
 * number's year-month is derived from receivedAt, so TEST_YEAR_MONTH and
 * TEST_RECEIVED_AT must always agree) so no two files ever race on the same
 * sequence row or customer namespace.
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-CUSTOMER-EU-";
const TEST_MODEL_PREFIX = "CUSTOMER-EU-TEST-";
const TEST_YEAR_MONTH = "9805";
const TEST_RECEIVED_AT = "2098-05-01";

let engineerId: string;

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
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  // Contacts before end_users (FK-restrict on end_user_id), end_users before
  // customers (FK-restrict on customer_id) — every End-User/contact created
  // by this file is always test-prefixed by name (createEndUser is always
  // called with a TEST_CUSTOMER_NAME_PREFIX-prefixed name here).
  const prefixedEndUsers = await db
    .select({ id: endUsers.id })
    .from(endUsers)
    .where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
  for (const eu of prefixedEndUsers) {
    await db.delete(endUserContacts).where(eq(endUserContacts.endUserId, eu.id));
  }
  await db.delete(endUsers).where(like(endUsers.name, `${TEST_CUSTOMER_NAME_PREFIX}%`));
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
 * 지나친 뒤 유니크 색인에서 부딪히게 한다. 같은 이름의 행을 넣고 커밋하지 않은
 * 트랜잭션을 붙들어 두면 두 호출은 사전 검사에서 그 행을 보지 못하고 쓰기에서
 * 기다린다. 둘 다 기다리는 것을 확인한 뒤 되감으면 하나가 먼저 쓰고 다른 하나는
 * 23505 를 받는다(그냥 Promise.all 은 대개 사전 검사가 먼저 걸러 버린다 — 위
 * "concurrent creates" 시험이 세이브포인트 없는 코드로도 통과한 까닭).
 * customers.integration.test.ts 의 같은 도우미와 같다.
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

describe("createEndUser", () => {
  test("valid creation succeeds and returns id/name/updatedAt", async () => {
    const customer = await createTestCustomer("CREATE-OK");
    const result = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}본사-${randomUUID().slice(0, 8)}` });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.ok(result.id);
    assert.ok(result.updatedAt);
  });

  test("duplicate normalized name under the same customer is rejected", async () => {
    const customer = await createTestCustomer("DUP");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}지사-${randomUUID().slice(0, 8)}`;
    const first = await createEndUser({ customerId: customer.id, name });
    assert.equal(first.ok, true);

    const second = await createEndUser({ customerId: customer.id, name: `  ${name.toUpperCase()}  ` });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "VALIDATION_ERROR");
    assert.ok(second.fieldErrors?.name);
  });

  test("the same name is allowed under a DIFFERENT customer — scoped per customer, not global", async () => {
    const customerA = await createTestCustomer("SCOPE-A");
    const customerB = await createTestCustomer("SCOPE-B");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}본사-${randomUUID().slice(0, 8)}`;

    const first = await createEndUser({ customerId: customerA.id, name });
    const second = await createEndUser({ customerId: customerB.id, name });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true, `expected the same name under a different customer to succeed: ${JSON.stringify(second)}`);
  });

  test("NOT_FOUND for a nonexistent customer", async () => {
    const result = await createEndUser({ customerId: randomUUID(), name: `${TEST_CUSTOMER_NAME_PREFIX}x` });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("concurrent creates with the same normalized name under the same customer — exactly one succeeds", async () => {
    const customer = await createTestCustomer("RACE");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}RACE-${randomUUID().slice(0, 8)}`;

    const [a, b] = await Promise.all([
      createEndUser({ customerId: customer.id, name }),
      createEndUser({ customerId: customer.id, name }),
    ]);
    assert.deepEqual([a.ok, b.ok].sort(), [false, true], "exactly one of the two concurrent creates should succeed");
  });

  test("사전 검사를 둘 다 지나친 동시 추가 — 진 쪽도 날것의 23505 가 아니라 이름 중복 오류를 받는다", async () => {
    const customer = await createTestCustomer("RACE-HELD");
    const name = `${TEST_CUSTOMER_NAME_PREFIX}RACE-HELD-${randomUUID().slice(0, 8)}`;

    const results = await raceBehindUncommittedName(
      async (tx) => {
        await tx.insert(endUsers).values({ customerId: customer.id, name });
      },
      () => [createEndUser({ customerId: customer.id, name }), createEndUser({ customerId: customer.id, name })]
    );

    const losers = results.filter((result) => !result.ok);
    assert.equal(losers.length, 1, `정확히 하나만 이겨야 한다: ${JSON.stringify(results)}`);
    const [loser] = losers;
    if (loser.ok) return;
    assert.equal(loser.code, "VALIDATION_ERROR");
    assert.equal(loser.fieldErrors?.name, "이미 존재하는 End-User명입니다.");

    const rows = await db
      .select()
      .from(endUsers)
      .where(and(eq(endUsers.customerId, customer.id), eq(endUsers.name, name), eq(endUsers.isDeleted, false)));
    assert.equal(rows.length, 1, "붙든 행은 되감겼고 이긴 쪽 하나만 남아야 한다");
  });
});

describe("renameEndUser", () => {
  test("valid rename succeeds", async () => {
    const customer = await createTestCustomer("RENAME-OK");
    const created = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}old-${randomUUID().slice(0, 8)}` });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const newName = `${TEST_CUSTOMER_NAME_PREFIX}new-${randomUUID().slice(0, 8)}`;
    const result = await renameEndUser({ endUserId: created.id, expectedUpdatedAt: created.updatedAt, name: newName });
    assert.equal(result.ok, true, `rename failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.name, newName);
  });

  test("renaming to another End-User's normalized name under the same customer is rejected", async () => {
    const customer = await createTestCustomer("RENAME-DUP");
    const a = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}A-${randomUUID().slice(0, 8)}` });
    const b = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}B-${randomUUID().slice(0, 8)}` });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;

    const result = await renameEndUser({ endUserId: b.id, expectedUpdatedAt: b.updatedAt, name: a.name });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION_ERROR");
  });

  test("stale expectedUpdatedAt returns CONFLICT and does not modify the row", async () => {
    const customer = await createTestCustomer("RENAME-CONFLICT");
    const created = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}v1-${randomUUID().slice(0, 8)}` });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const staleTimestamp = created.updatedAt;
    const first = await renameEndUser({ endUserId: created.id, expectedUpdatedAt: staleTimestamp, name: `${TEST_CUSTOMER_NAME_PREFIX}v2-${randomUUID().slice(0, 8)}` });
    assert.equal(first.ok, true);

    const second = await renameEndUser({ endUserId: created.id, expectedUpdatedAt: staleTimestamp, name: `${TEST_CUSTOMER_NAME_PREFIX}v3-should-not-apply` });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
  });

  test("NOT_FOUND for a nonexistent End-User id", async () => {
    const result = await renameEndUser({ endUserId: randomUUID(), expectedUpdatedAt: new Date().toISOString(), name: "x" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("사전 검사를 둘 다 지나친 동시 이름 변경 — 진 쪽도 날것의 23505 가 아니라 이름 중복 오류를 받는다", async () => {
    const customer = await createTestCustomer("RENAME-RACE-HELD");
    const a = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}RA-${randomUUID().slice(0, 8)}` });
    const b = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}RB-${randomUUID().slice(0, 8)}` });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    if (!a.ok || !b.ok) return;
    const target = `${TEST_CUSTOMER_NAME_PREFIX}RENAME-RACE-${randomUUID().slice(0, 8)}`;

    const results = await raceBehindUncommittedName(
      async (tx) => {
        await tx.insert(endUsers).values({ customerId: customer.id, name: target });
      },
      () => [
        renameEndUser({ endUserId: a.id, expectedUpdatedAt: a.updatedAt, name: target }),
        renameEndUser({ endUserId: b.id, expectedUpdatedAt: b.updatedAt, name: target }),
      ]
    );

    const losers = results.filter((result) => !result.ok);
    assert.equal(losers.length, 1, `정확히 하나만 이겨야 한다: ${JSON.stringify(results)}`);
    const [loser] = losers;
    if (loser.ok) return;
    assert.equal(loser.code, "VALIDATION_ERROR");
    assert.equal(loser.fieldErrors?.name, "이미 존재하는 End-User명입니다.");

    const rows = await db
      .select()
      .from(endUsers)
      .where(and(eq(endUsers.customerId, customer.id), eq(endUsers.name, target), eq(endUsers.isDeleted, false)));
    assert.equal(rows.length, 1, "붙든 행은 되감겼고 이긴 쪽 하나만 그 이름을 가져야 한다");
  });
});

describe("End-User contacts (create/update/remove)", () => {
  test("createEndUserContact: valid creation succeeds; contactEmail is optional", async () => {
    const customer = await createTestCustomer("CONTACT-OK");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;

    const result = await createEndUserContact({ endUserId: endUser.id, contactName: "김담당", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(result.ok, true, `create contact failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.contactName, "김담당");
    assert.equal(result.contactEmail, null);
  });

  test("createEndUserContact: NOT_FOUND for a nonexistent End-User", async () => {
    const result = await createEndUserContact({ endUserId: randomUUID(), contactName: "x", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_FOUND");
  });

  test("updateEndUserContact: valid update persists both fields", async () => {
    const customer = await createTestCustomer("CONTACT-EDIT");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "이전", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const result = await updateEndUserContact({
      contactId: contact.id,
      expectedUpdatedAt: contact.updatedAt,
      contactName: "이후",
      contactEmail: "after@example.test",
      title: null,
      phone: null,
      memo: null,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.contactName, "이후");
    assert.equal(result.contactEmail, "after@example.test");
  });

  test("updateEndUserContact: stale expectedUpdatedAt returns CONFLICT", async () => {
    const customer = await createTestCustomer("CONTACT-CONFLICT");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "v1", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const staleTimestamp = contact.updatedAt;
    const first = await updateEndUserContact({ contactId: contact.id, expectedUpdatedAt: staleTimestamp, contactName: "v2", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(first.ok, true);

    const second = await updateEndUserContact({ contactId: contact.id, expectedUpdatedAt: staleTimestamp, contactName: "v3-should-not-apply", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
  });

  // ── 직급·전화·메모(2026-09-13) ────────────────────────────────────────

  async function createTestEndUser(label: string) {
    const customer = await createTestCustomer(label);
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true, `setup End-User failed: ${JSON.stringify(endUser)}`);
    if (!endUser.ok) throw new Error("setup End-User failed");
    return { customer, endUser };
  }

  test("createEndUserContact: 직급·전화·메모가 저장되고 결과에도 실린다", async () => {
    const { endUser } = await createTestEndUser("CONTACT-EXTRA-CREATE");

    const result = await createEndUserContact({
      endUserId: endUser.id,
      contactName: "박담당",
      contactEmail: "park@example.test",
      title: "대리",
      phone: "010-4444-5555",
      memo: "야간 연락 불가\n메일 우선",
    });
    assert.equal(result.ok, true, `create contact failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.title, "대리");
    assert.equal(result.phone, "010-4444-5555");
    assert.equal(result.memo, "야간 연락 불가\n메일 우선");

    const [row] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, result.id));
    assert.equal(row.contactName, "박담당");
    assert.equal(row.contactEmail, "park@example.test");
    assert.equal(row.title, "대리");
    assert.equal(row.phone, "010-4444-5555");
    assert.equal(row.memo, "야간 연락 불가\n메일 우선", "메모의 줄바꿈이 그대로 남아야 한다");
  });

  test("updateEndUserContact: 직급·전화·메모를 바꾸고 비울 수 있다 — 결과에도 실린다", async () => {
    const { endUser } = await createTestEndUser("CONTACT-EXTRA-UPDATE");
    const contact = await createEndUserContact({
      endUserId: endUser.id,
      contactName: "최담당",
      contactEmail: null,
      title: "사원",
      phone: "010-0000-1111",
      memo: "처음 메모",
    });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const changed = await updateEndUserContact({
      contactId: contact.id,
      expectedUpdatedAt: contact.updatedAt,
      contactName: "최담당",
      contactEmail: null,
      title: "과장",
      phone: "02-123-4567",
      memo: "바뀐 메모\n둘째 줄",
    });
    assert.equal(changed.ok, true, `update failed: ${JSON.stringify(changed)}`);
    if (!changed.ok) return;
    assert.equal(changed.title, "과장");
    assert.equal(changed.phone, "02-123-4567");
    assert.equal(changed.memo, "바뀐 메모\n둘째 줄");

    const [afterChange] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(afterChange.title, "과장");
    assert.equal(afterChange.phone, "02-123-4567");
    assert.equal(afterChange.memo, "바뀐 메모\n둘째 줄");

    const cleared = await updateEndUserContact({
      contactId: contact.id,
      expectedUpdatedAt: changed.updatedAt,
      contactName: "최담당",
      contactEmail: null,
      title: null,
      phone: null,
      memo: null,
    });
    assert.equal(cleared.ok, true, `clear failed: ${JSON.stringify(cleared)}`);
    if (!cleared.ok) return;
    assert.equal(cleared.title, null);
    assert.equal(cleared.phone, null);
    assert.equal(cleared.memo, null);

    const [row] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(row.title, null);
    assert.equal(row.phone, null);
    assert.equal(row.memo, null);
    assert.equal(row.contactName, "최담당", "비운 것은 직급·전화·메모뿐이다");
  });

  test("🔴 폼이 다섯 칸을 다시 보내는 길 그대로 — 이름만 고쳐도 직급·전화·메모가 남는다", async () => {
    // 수정 폼(EndUserContactList)은 목록 조회(listEndUserContactsByCustomerId) 값으로 칸을
    // 채우고 저장할 때 다섯 칸을 다 보낸다. 서버 액션은 validateEndUserContactFields 로
    // 거른 뒤 통째로 펼쳐 updateEndUserContact 에 넘긴다(server/actions/end-users.ts).
    // 검증은 빠진 키를 null 로 읽으므로, 이 길 어디서든 새 칸이 빠지면 지워진다.
    const { customer, endUser } = await createTestEndUser("CONTACT-EXTRA-KEEP");
    const contact = await createEndUserContact({
      endUserId: endUser.id,
      contactName: "정담당",
      contactEmail: "jung@example.test",
      title: "차장",
      phone: "010-7777-0000",
      memo: "현장 출입 시 사전 연락\n주차 불가",
    });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const listed = (await listEndUserContactsByCustomerId(customer.id)).find((row) => row.id === contact.id);
    assert.ok(listed, "목록 조회가 방금 만든 담당자를 돌려줘야 한다");
    if (!listed) return;
    assert.equal(listed.title, "차장", "목록 조회가 직급을 실어야 폼이 채울 수 있다");
    assert.equal(listed.phone, "010-7777-0000", "목록 조회가 전화를 실어야 폼이 채울 수 있다");
    assert.equal(listed.memo, "현장 출입 시 사전 연락\n주차 불가", "목록 조회가 메모를 실어야 폼이 채울 수 있다");

    // 폼이 보내는 모양 그대로 — 채워 둔 값을 모두 다시 싣고, 이름만 새 값이다.
    const validation = validateEndUserContactFields({
      contactName: "정담당(수정)",
      contactEmail: listed.contactEmail,
      title: listed.title,
      phone: listed.phone,
      memo: listed.memo,
    });
    assert.equal(validation.ok, true, `validation failed: ${JSON.stringify(validation)}`);
    if (!validation.ok) return;

    const result = await updateEndUserContact({
      contactId: listed.id,
      expectedUpdatedAt: listed.updatedAt,
      ...validation.data,
    });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);

    const [row] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(row.contactName, "정담당(수정)", "고친 칸은 바뀌어야 한다");
    assert.equal(row.contactEmail, "jung@example.test");
    assert.equal(row.title, "차장", "이름만 고친 저장이 직급을 지우면 안 된다");
    assert.equal(row.phone, "010-7777-0000", "이름만 고친 저장이 전화를 지우면 안 된다");
    assert.equal(row.memo, "현장 출입 시 사전 연락\n주차 불가", "이름만 고친 저장이 메모를 지우면 안 된다");
  });

  test("removeEndUserContact: soft-deletes — no longer returned as active, and a second removal is NOT_FOUND", async () => {
    const customer = await createTestCustomer("CONTACT-REMOVE");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}eu-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "제거대상", contactEmail: null, title: null, phone: null, memo: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;

    const actorUserId = engineerId;
    const result = await removeEndUserContact({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt, actorUserId });
    assert.equal(result.ok, true, `remove failed: ${JSON.stringify(result)}`);

    const [row] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(row.isDeleted, true);
    assert.equal(row.deletedBy, actorUserId);

    // Already soft-deleted — NOT_FOUND regardless of expectedUpdatedAt, since
    // the row is no longer found among active contacts at all (the
    // concurrency check never even runs).
    const second = await removeEndUserContact({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt, actorUserId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "NOT_FOUND");
  });

  test("End-User + contact CRUD never touches an existing repair case's contact snapshot", async () => {
    const customer = await createTestCustomer("SNAPSHOT");
    const endUser = await createEndUser({ customerId: customer.id, name: `${TEST_CUSTOMER_NAME_PREFIX}snap-${randomUUID().slice(0, 8)}` });
    assert.equal(endUser.ok, true);
    if (!endUser.ok) return;

    const created = await createRepairCase(
      baseCreateInput(customer.id, {
        endUserId: endUser.id,
        contactName: "인수 시점 담당자",
        contactPhone: "010-1111-2222",
        contactEmail: "intake-snapshot@example.test",
      })
    );
    assert.equal(created.ok, true, `setup create failed: ${JSON.stringify(created)}`);
    if (!created.ok) return;

    const renamed = await renameEndUser({ endUserId: endUser.id, expectedUpdatedAt: endUser.updatedAt, name: `${endUser.name}-renamed` });
    assert.equal(renamed.ok, true);
    const contact = await createEndUserContact({ endUserId: endUser.id, contactName: "새 담당자", contactEmail: "new@example.test", title: null, phone: null, memo: null });
    assert.equal(contact.ok, true);
    if (!contact.ok) return;
    const edited = await updateEndUserContact({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt, contactName: "수정된 담당자", contactEmail: "edited@example.test", title: null, phone: null, memo: null });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    const removed = await removeEndUserContact({ contactId: contact.id, expectedUpdatedAt: edited.updatedAt, actorUserId: engineerId });
    assert.equal(removed.ok, true);

    const [caseRow] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    assert.equal(caseRow.contactNameSnapshot, "인수 시점 담당자", "per-case snapshot must survive End-User/contact CRUD unchanged");
    assert.equal(caseRow.contactPhoneSnapshot, "010-1111-2222");
    assert.equal(caseRow.contactEmailSnapshot, "intake-snapshot@example.test");
  });
});
