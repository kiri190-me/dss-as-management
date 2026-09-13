import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { customerContacts, customers, users } from "../schema";
import { createCustomerContact, removeCustomerContact, updateCustomerContact } from "./customer-contacts";
import { listCustomerContactsByCustomerId } from "../queries/customers";

/**
 * 고객사 담당자(customer_contacts) 저장 — 실제 DB 통합 시험.
 *
 * 세션·권한 관문은 서버 액션(server/actions/customer-contacts.ts)의 몫이라 여기서
 * 보지 않는다 — end-users.integration.test.ts 가 End-User 담당자에 대해 같은 선을
 * 긋는다. 여기서 확인하는 것은 mutation 의 약속이다: 활성 고객사에만 붙는다,
 * 수정은 updated_at 이 맞을 때만 된다, 삭제는 소프트 삭제다, 대표 담당자 칸은
 * 건드리지 않는다. 고객사 휴지통과의 연쇄는 customers-trash.integration.test.ts 가 본다.
 *
 * 자기 정리 규칙: 이 파일만의 고객사 이름 접두사로 만들고, 그 고객사의 담당자 →
 * 고객사 순으로(FK RESTRICT) 만든 것만 지운다. 이 파일은 감사 로그를 남기는 호출을
 * 하지 않는다 — 휴지통 고객사는 softDeleteCustomer 대신 칸을 직접 바꿔 만든다.
 */

const RUN_TOKEN = randomUUID();
const TEST_CUSTOMER_PREFIX = `AS-TEST-CUST-CONTACT-${RUN_TOKEN}-`;

let actorId: string;

before(async () => {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(user, "expected at least one approved user in the test DB");
  actorId = user.id;
});

after(async () => {
  const ours = await db
    .select({ id: customers.id })
    .from(customers)
    .where(like(customers.name, `${TEST_CUSTOMER_PREFIX}%`));
  const ourIds = ours.map((row) => row.id);
  if (ourIds.length > 0) {
    await db.delete(customerContacts).where(inArray(customerContacts.customerId, ourIds));
    await db.delete(customers).where(inArray(customers.id, ourIds));
  }
  await pgClient.end({ timeout: 5 });
});

async function createTestCustomer(suffix: string) {
  const [row] = await db
    .insert(customers)
    .values({
      name: `${TEST_CUSTOMER_PREFIX}${suffix}`,
      contactName: "대표 담당자",
      contactPhone: "02-000-0000",
      contactEmail: "rep@example.test",
    })
    .returning();
  return row;
}

const FULL = {
  contactName: "홍길동",
  title: "과장",
  phone: "010-1234-5678",
  email: "hong@example.test",
  memo: "오전에만 통화 가능\n금요일 휴무",
};

const EMPTY_OPTIONAL = { title: null, phone: null, email: null, memo: null };

async function readContact(id: string) {
  const [row] = await db.select().from(customerContacts).where(eq(customerContacts.id, id));
  return row;
}

describe("createCustomerContact", () => {
  test("활성 고객사에 다섯 칸을 그대로 붙이고, 활성 목록에 나온다", async () => {
    const customer = await createTestCustomer("CREATE");
    const result = await createCustomerContact({ customerId: customer.id, ...FULL });
    assert.equal(result.ok, true, `create failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.deepEqual(
      { contactName: result.contactName, title: result.title, phone: result.phone, email: result.email, memo: result.memo },
      FULL
    );
    assert.ok(result.updatedAt);

    const row = await readContact(result.id);
    assert.equal(row.customerId, customer.id);
    assert.equal(row.isDeleted, false);
    assert.equal(row.memo, FULL.memo);

    const listed = await listCustomerContactsByCustomerId(customer.id);
    assert.deepEqual(
      listed.map((c) => c.id),
      [result.id]
    );
    assert.equal(listed[0].updatedAt, result.updatedAt, "목록의 updatedAt 이 그대로 수정·삭제의 기대값이 된다");
  });

  test("선택 칸은 비워 둘 수 있다", async () => {
    const customer = await createTestCustomer("CREATE-MIN");
    const result = await createCustomerContact({ customerId: customer.id, contactName: "김담당", ...EMPTY_OPTIONAL });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.title, null);
    assert.equal(result.phone, null);
    assert.equal(result.email, null);
    assert.equal(result.memo, null);
  });

  test("없는 고객사는 NOT_FOUND", async () => {
    const result = await createCustomerContact({ customerId: randomUUID(), contactName: "x", ...EMPTY_OPTIONAL });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });

  test("휴지통에 든 고객사에는 붙이지 않는다 — NOT_FOUND 이고 줄이 생기지 않는다", async () => {
    const customer = await createTestCustomer("CREATE-TRASHED");
    await db
      .update(customers)
      .set({ isDeleted: true, deletedAt: new Date(), deletedBy: actorId })
      .where(eq(customers.id, customer.id));

    const result = await createCustomerContact({ customerId: customer.id, ...FULL });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");

    const rows = await db.select().from(customerContacts).where(eq(customerContacts.customerId, customer.id));
    assert.equal(rows.length, 0);
  });
});

describe("updateCustomerContact", () => {
  test("다섯 칸을 바꾸고 updated_at 이 새로 찍힌다", async () => {
    const customer = await createTestCustomer("UPDATE");
    const created = await createCustomerContact({ customerId: customer.id, contactName: "이전", ...EMPTY_OPTIONAL });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await updateCustomerContact({ contactId: created.id, expectedUpdatedAt: created.updatedAt, ...FULL });
    assert.equal(result.ok, true, `update failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.notEqual(result.updatedAt, created.updatedAt);

    const row = await readContact(created.id);
    assert.deepEqual(
      { contactName: row.contactName, title: row.title, phone: row.phone, email: row.email, memo: row.memo },
      FULL
    );

    // 선택 칸을 다시 비울 수 있다.
    const cleared = await updateCustomerContact({
      contactId: created.id,
      expectedUpdatedAt: result.updatedAt,
      contactName: "이후",
      ...EMPTY_OPTIONAL,
    });
    assert.equal(cleared.ok, true);
    const clearedRow = await readContact(created.id);
    assert.equal(clearedRow.contactName, "이후");
    assert.equal(clearedRow.memo, null);
  });

  test("updated_at 이 어긋나면 CONFLICT 이고 줄은 그대로다", async () => {
    const customer = await createTestCustomer("UPDATE-CONFLICT");
    const created = await createCustomerContact({ customerId: customer.id, contactName: "v1", ...EMPTY_OPTIONAL });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const stale = created.updatedAt;
    const first = await updateCustomerContact({ contactId: created.id, expectedUpdatedAt: stale, contactName: "v2", ...EMPTY_OPTIONAL });
    assert.equal(first.ok, true);

    const second = await updateCustomerContact({
      contactId: created.id,
      expectedUpdatedAt: stale,
      contactName: "v3-should-not-apply",
      ...EMPTY_OPTIONAL,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
    assert.equal((await readContact(created.id)).contactName, "v2");
  });

  test("없는 담당자는 NOT_FOUND", async () => {
    const result = await updateCustomerContact({
      contactId: randomUUID(),
      expectedUpdatedAt: new Date().toISOString(),
      contactName: "x",
      ...EMPTY_OPTIONAL,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("removeCustomerContact", () => {
  test("소프트 삭제다 — 행은 남고 활성 목록에서 빠지며, 다시 지우거나 고치면 NOT_FOUND", async () => {
    const customer = await createTestCustomer("REMOVE");
    const kept = await createCustomerContact({ customerId: customer.id, contactName: "남는 사람", ...EMPTY_OPTIONAL });
    const removed = await createCustomerContact({ customerId: customer.id, contactName: "지울 사람", ...EMPTY_OPTIONAL });
    assert.equal(kept.ok, true);
    assert.equal(removed.ok, true);
    if (!kept.ok || !removed.ok) return;

    const result = await removeCustomerContact({
      contactId: removed.id,
      expectedUpdatedAt: removed.updatedAt,
      actorUserId: actorId,
    });
    assert.equal(result.ok, true, `remove failed: ${JSON.stringify(result)}`);

    const row = await readContact(removed.id);
    assert.equal(row.isDeleted, true);
    assert.ok(row.deletedAt);
    assert.equal(row.deletedBy, actorId);

    const listed = await listCustomerContactsByCustomerId(customer.id);
    assert.deepEqual(
      listed.map((c) => c.id),
      [kept.id]
    );

    const again = await removeCustomerContact({ contactId: removed.id, expectedUpdatedAt: removed.updatedAt, actorUserId: actorId });
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "NOT_FOUND");

    const edit = await updateCustomerContact({
      contactId: removed.id,
      expectedUpdatedAt: removed.updatedAt,
      contactName: "되살리면 안 됨",
      ...EMPTY_OPTIONAL,
    });
    assert.equal(edit.ok, false);
    if (!edit.ok) assert.equal(edit.code, "NOT_FOUND");
  });

  test("updated_at 이 어긋나면 CONFLICT 이고 지우지 않는다", async () => {
    const customer = await createTestCustomer("REMOVE-CONFLICT");
    const created = await createCustomerContact({ customerId: customer.id, contactName: "충돌", ...EMPTY_OPTIONAL });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await removeCustomerContact({
      contactId: created.id,
      expectedUpdatedAt: new Date(0).toISOString(),
      actorUserId: actorId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.equal((await readContact(created.id)).isDeleted, false);
  });
});

describe("listCustomerContactsByCustomerId · 대표 담당자와의 관계", () => {
  test("이름순이고, 다른 고객사의 담당자는 섞이지 않는다", async () => {
    const customer = await createTestCustomer("LIST");
    const other = await createTestCustomer("LIST-OTHER");
    for (const name of ["하나", "가나", "다라"]) {
      const created = await createCustomerContact({ customerId: customer.id, contactName: name, ...EMPTY_OPTIONAL });
      assert.equal(created.ok, true);
    }
    const foreign = await createCustomerContact({ customerId: other.id, contactName: "남의 담당자", ...EMPTY_OPTIONAL });
    assert.equal(foreign.ok, true);

    const listed = await listCustomerContactsByCustomerId(customer.id);
    assert.deepEqual(
      listed.map((c) => c.contactName),
      ["가나", "다라", "하나"]
    );
  });

  test("담당자를 추가·수정·삭제해도 대표 담당자 칸(customers.contact_*)은 그대로다", async () => {
    const customer = await createTestCustomer("REPRESENTATIVE");
    const created = await createCustomerContact({ customerId: customer.id, ...FULL });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = await updateCustomerContact({
      contactId: created.id,
      expectedUpdatedAt: created.updatedAt,
      ...FULL,
      contactName: "바뀐 이름",
    });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    const removed = await removeCustomerContact({ contactId: created.id, expectedUpdatedAt: updated.updatedAt, actorUserId: actorId });
    assert.equal(removed.ok, true);

    const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
    assert.equal(row.contactName, "대표 담당자");
    assert.equal(row.contactPhone, "02-000-0000");
    assert.equal(row.contactEmail, "rep@example.test");
    assert.equal(row.updatedAt.toISOString(), customer.updatedAt.toISOString(), "고객사 행 자체를 건드리지 않는다");
  });
});
