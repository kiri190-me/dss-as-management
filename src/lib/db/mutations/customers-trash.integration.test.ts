import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  endUserContacts,
  endUsers,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase, softDeleteRepairCase } from "./repair-cases";
import { permanentlyDeleteCustomer, restoreCustomer, softDeleteCustomer } from "./customers-trash";
import { listPurgeEligibleCustomerIds, purgeExpiredCustomer, runMasterDataPurgeSweep } from "./master-data-purge";
import { MASTER_DATA_TRASH_RETENTION_DAYS } from "@/lib/domain/master-data-trash-retention";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * 고객사 휴지통 — 실제 DB 통합 테스트.
 *
 * 세션·역할 관문은 여기서 보지 않는다(서버 액션의 몫이고
 * customer-authorization.test.ts가 따로 본다). 여기서 확인하는 것은 mutation
 * 자체의 약속이다: 무엇이 함께 딸려 가는가, 무엇이 삭제를 막는가, 복원이
 * 무엇까지 되살리는가, 그리고 만료된 것만 자동으로 지워지는가.
 *
 * 다른 통합 테스트 파일과 같은 자기 정리 규칙을 따른다 — 이 파일만의 이름
 * 접두사와 이 파일만의 인수번호 월(9703; 98xx·99xx는 이미 다른 파일들이
 * 전부 예약했고 9701·9702도 쓰인다)을 쓰고, 만든 것만 지운다.
 *
 * 15일을 실제로 기다릴 수는 없으므로 deleted_at을 직접 과거로 돌린다 —
 * 이 파일이 만든 행에만 하는 일이고, repair-cases-purge.integration.test.ts가
 * 이미 같은 방식을 쓴다.
 */

const RUN_TOKEN = randomUUID();
const TEST_CUSTOMER_PREFIX = `AS-TEST-CUST-TRASH-${RUN_TOKEN}-`;
const TEST_MODEL_PREFIX = `CUST-TRASH-TEST-${RUN_TOKEN}-`;
const TEST_YEAR_MONTH = "9703";
const TEST_RECEIVED_AT = "2097-03-01";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let engineerId: string;
let actorId: string;

/**
 * 감사 로그 정리를 위해 이 파일이 만든 id를 엔티티별로 나눠 모아 둔다.
 * target_record_id만으로 범위를 잡으면 같은 id를 가진 다른 엔티티의 감사
 * 기록까지 함께 걸릴 수 있다 — 감사 로그는 3년 보존 대상이므로
 * (엔티티, 대상 id) 쌍으로만 지운다.
 */
const touchedCustomerIds: string[] = [];
const touchedEndUserIds: string[] = [];
/**
 * createRepairCase는 감사 행을 남기지 않는다 — 이 파일에서 repair_cases 감사
 * 행이 생기는 곳은 softDeleteRepairCase를 부르는 테스트 하나뿐이므로 거기서만
 * 담는다.
 */
const touchedRepairCaseIds: string[] = [];

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "AS_ENGINEER"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.isDeleted, false)))
    .limit(1);
  // 행위자는 감사 로그의 actor_user_id로만 쓰인다 — 역할 판정은 여기서
  // 하지 않으므로 관리자가 없으면 엔지니어로 대신해도 검증이 흐려지지 않는다.
  actorId = admin?.id ?? engineerId;
});

after(async () => {
  // 이 파일이 만든 감사 행만 (엔티티, 대상 id) 쌍으로 지운다. 담긴 id가 없는
  // 엔티티는 아예 범위에 넣지 않아, 어느 경우에도 조건 없는 삭제가 되지 않는다.
  const customerScope = touchedCustomerIds.length > 0
    ? and(eq(auditLogs.targetEntity, "customers"), inArray(auditLogs.targetRecordId, touchedCustomerIds))
    : undefined;
  const endUserScope = touchedEndUserIds.length > 0
    ? and(eq(auditLogs.targetEntity, "end_users"), inArray(auditLogs.targetRecordId, touchedEndUserIds))
    : undefined;
  const repairCaseScope = touchedRepairCaseIds.length > 0
    ? and(eq(auditLogs.targetEntity, "repair_cases"), inArray(auditLogs.targetRecordId, touchedRepairCaseIds))
    : undefined;
  if (customerScope || endUserScope || repairCaseScope) {
    await db.delete(auditLogs).where(or(customerScope, endUserScope, repairCaseScope));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));

  const leftovers = await db
    .select({ id: customers.id })
    .from(customers)
    .where(like(customers.name, `${TEST_CUSTOMER_PREFIX}%`));
  const leftoverIds = leftovers.map((row) => row.id);
  if (leftoverIds.length > 0) {
    const leftoverEndUsers = await db
      .select({ id: endUsers.id })
      .from(endUsers)
      .where(inArray(endUsers.customerId, leftoverIds));
    const leftoverEndUserIds = leftoverEndUsers.map((row) => row.id);
    if (leftoverEndUserIds.length > 0) {
      await db.delete(endUserContacts).where(inArray(endUserContacts.endUserId, leftoverEndUserIds));
      await db.delete(endUsers).where(inArray(endUsers.id, leftoverEndUserIds));
    }
    await db.delete(customers).where(inArray(customers.id, leftoverIds));
  }

  await pgClient.end({ timeout: 5 });
});

async function createTestCustomer(suffix: string) {
  const [row] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_PREFIX}${suffix}` })
    .returning();
  touchedCustomerIds.push(row.id);
  return row;
}

async function createTestEndUser(customerId: string, name: string) {
  const [row] = await db.insert(endUsers).values({ customerId, name }).returning();
  touchedEndUserIds.push(row.id);
  return row;
}

async function createTestContact(endUserId: string, contactName: string) {
  const [row] = await db.insert(endUserContacts).values({ endUserId, contactName }).returning();
  return row;
}

async function createTestRepairCase(customerId: string, endUserId: string | null = null) {
  const suffix = randomUUID().slice(0, 8);
  const input: ValidatedCreateRepairCaseInput = {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId,
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
  const result = await createRepairCase(input);
  assert.equal(result.ok, true, `createRepairCase failed: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

async function readCustomer(id: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  return row;
}

/** deleted_at을 N일 과거로 돌린다 — 15일을 실제로 기다리는 대신. */
async function backdateDeletion(customerId: string, days: number) {
  const past = new Date(Date.now() - days * MS_PER_DAY);
  await db.update(customers).set({ deletedAt: past }).where(eq(customers.id, customerId));
  return past;
}

describe("softDeleteCustomer", () => {
  test("고객사와 함께 End-User·담당자가 같은 순간으로 딸려 간다", async () => {
    const customer = await createTestCustomer("CASCADE");
    const endUser = await createTestEndUser(customer.id, "딸려가는 End-User");
    const contact = await createTestContact(endUser.id, "담당자 이름");

    const result = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: "테스트 삭제",
    });
    assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.endUserCount, 1);

    const deletedCustomer = await readCustomer(customer.id);
    assert.equal(deletedCustomer.isDeleted, true);
    assert.equal(deletedCustomer.deletedBy, actorId);
    assert.equal(deletedCustomer.deleteReason, "테스트 삭제");
    assert.ok(deletedCustomer.deletedAt);

    const [deletedEndUser] = await db.select().from(endUsers).where(eq(endUsers.id, endUser.id));
    const [deletedContact] = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(deletedEndUser.isDeleted, true);
    assert.equal(deletedContact.isDeleted, true);

    // 같은 순간이어야 복원이 '이번 삭제로 딸려 간 것'을 알아본다.
    assert.equal(deletedEndUser.deletedAt?.getTime(), deletedCustomer.deletedAt?.getTime());
    assert.equal(deletedContact.deletedAt?.getTime(), deletedCustomer.deletedAt?.getTime());
  });

  test("감사 로그에 연락처는 남기지 않고, 함께 움직인 수는 남긴다", async () => {
    const customer = await createTestCustomer("AUDIT");
    const endUser = await createTestEndUser(customer.id, "감사 End-User");
    await createTestContact(endUser.id, "노출되면 안 되는 이름");

    await db
      .update(customers)
      .set({ contactName: "노출되면 안 되는 담당자", contactPhone: "010-0000-0000" })
      .where(eq(customers.id, customer.id));
    const refreshed = await readCustomer(customer.id);

    const result = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: refreshed.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, true);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, customer.id), eq(auditLogs.actionType, "SOFT_DELETE")));
    assert.ok(log, "expected a SOFT_DELETE audit row for the customer");

    const serialized = JSON.stringify({ previous: log.previousValue, next: log.newValue });
    assert.ok(!serialized.includes("노출되면 안 되는"), "감사 로그에 연락처가 들어갔다");
    assert.ok(!serialized.includes("010-0000-0000"), "감사 로그에 전화번호가 들어갔다");

    const newValue = log.newValue as { cascadedEndUserIds: string[]; cascadedContactCount: number };
    assert.deepEqual(newValue.cascadedEndUserIds, [endUser.id]);
    assert.equal(newValue.cascadedContactCount, 1);
  });

  test("A/S 접수 건이 있으면 REFERENCED로 막고 아무것도 바꾸지 않는다", async () => {
    const customer = await createTestCustomer("REFERENCED");
    const endUser = await createTestEndUser(customer.id, "참조 End-User");
    await createTestRepairCase(customer.id, endUser.id);

    const result = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REFERENCED");

    const untouched = await readCustomer(customer.id);
    assert.equal(untouched.isDeleted, false);
    const [untouchedEndUser] = await db.select().from(endUsers).where(eq(endUsers.id, endUser.id));
    assert.equal(untouchedEndUser.isDeleted, false);
  });

  test("휴지통에 있는 접수 건도 삭제를 막는다 — FK는 is_deleted를 보지 않는다", async () => {
    const customer = await createTestCustomer("REF-TRASHED");
    const created = await createTestRepairCase(customer.id);
    const [caseRow] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    // 아래 소프트 삭제가 repair_cases 감사 행을 하나 남긴다 — 정리 범위에
    // 넣어 두지 않으면 실행할 때마다 한 행씩 쌓인다.
    touchedRepairCaseIds.push(created.id);
    const softDeleted = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: caseRow.version,
      actorUserId: actorId,
      reason: "테스트",
    });
    assert.equal(softDeleted.ok, true);

    const result = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REFERENCED");
  });

  test("updated_at이 어긋나면 CONFLICT", async () => {
    const customer = await createTestCustomer("CONFLICT");
    const result = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: new Date(0).toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
  });
});

describe("restoreCustomer", () => {
  test("이번 삭제로 딸려 간 것만 되살린다 — 먼저 지워져 있던 End-User는 그대로 둔다", async () => {
    const customer = await createTestCustomer("RESTORE-PARTIAL");
    const alreadyDeleted = await createTestEndUser(customer.id, "미리 지워진 End-User");
    const cascaded = await createTestEndUser(customer.id, "딸려 갈 End-User");

    // 고객사를 지우기 전에 따로 지워 둔다 — deleted_at이 다른 순간이 된다.
    await db
      .update(endUsers)
      .set({ isDeleted: true, deletedAt: new Date(Date.now() - MS_PER_DAY), deletedBy: actorId })
      .where(eq(endUsers.id, alreadyDeleted.id));

    const deleted = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    assert.equal(deleted.endUserCount, 1, "이미 지워져 있던 End-User는 세지 않는다");

    const afterDelete = await readCustomer(customer.id);
    const restored = await restoreCustomer({
      customerId: customer.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    assert.equal(restored.ok, true, `restore failed: ${JSON.stringify(restored)}`);
    if (!restored.ok) return;
    assert.equal(restored.endUserCount, 1);

    const back = await readCustomer(customer.id);
    assert.equal(back.isDeleted, false);
    assert.equal(back.deletedAt, null);
    assert.equal(back.deletedBy, null);
    assert.equal(back.deleteReason, null);

    const [cascadedRow] = await db.select().from(endUsers).where(eq(endUsers.id, cascaded.id));
    const [alreadyDeletedRow] = await db.select().from(endUsers).where(eq(endUsers.id, alreadyDeleted.id));
    assert.equal(cascadedRow.isDeleted, false, "딸려 갔던 End-User는 돌아와야 한다");
    assert.equal(alreadyDeletedRow.isDeleted, true, "미리 지워져 있던 End-User는 그대로여야 한다");
  });

  test("같은 이름의 고객사가 새로 생겼으면 NAME_TAKEN", async () => {
    const customer = await createTestCustomer("NAME-TAKEN");
    const deleted = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    // 부분 유니크 인덱스(is_deleted = false)라 같은 이름이 다시 들어올 수 있다.
    const replacement = await createTestCustomer("NAME-TAKEN");
    assert.equal(replacement.name, customer.name);

    const afterDelete = await readCustomer(customer.id);
    const restored = await restoreCustomer({
      customerId: customer.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    assert.equal(restored.ok, false);
    if (restored.ok) return;
    assert.equal(restored.code, "NAME_TAKEN");

    const stillDeleted = await readCustomer(customer.id);
    assert.equal(stillDeleted.isDeleted, true, "복원에 실패했으면 휴지통에 그대로 있어야 한다");
  });
});

describe("permanentlyDeleteCustomer", () => {
  test("고객사·End-User·담당자가 DB에서 사라지고 PURGE 감사 로그가 남는다", async () => {
    const customer = await createTestCustomer("PERMANENT");
    const endUser = await createTestEndUser(customer.id, "영구삭제 End-User");
    const contact = await createTestContact(endUser.id, "영구삭제 담당자");

    const deleted = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    const afterDelete = await readCustomer(customer.id);
    const purged = await permanentlyDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: "테스트 완전 삭제",
    });
    assert.equal(purged.ok, true, `permanent delete failed: ${JSON.stringify(purged)}`);

    assert.equal(await readCustomer(customer.id), undefined);
    const remainingEndUsers = await db.select().from(endUsers).where(eq(endUsers.id, endUser.id));
    const remainingContacts = await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id));
    assert.equal(remainingEndUsers.length, 0);
    assert.equal(remainingContacts.length, 0);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, customer.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log, "expected a PURGE audit row");
    assert.equal(log.actorUserId, actorId, "사람이 지웠으면 행위자가 남아야 한다");
  });

  test("휴지통에 없는 고객사는 완전 삭제 대상이 아니다", async () => {
    const customer = await createTestCustomer("PERMANENT-ACTIVE");
    const result = await permanentlyDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: "테스트",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
    assert.ok(await readCustomer(customer.id), "활성 고객사가 지워지면 안 된다");
  });
});

describe("purgeExpiredCustomer", () => {
  test("15일이 지나지 않았으면 지우지 않는다", async () => {
    const customer = await createTestCustomer("PURGE-YOUNG");
    const deleted = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    await backdateDeletion(customer.id, MASTER_DATA_TRASH_RETENTION_DAYS - 1);
    assert.equal(await purgeExpiredCustomer(customer.id), "SKIPPED_NOT_ELIGIBLE");
    assert.ok(await readCustomer(customer.id));

    const eligible = await listPurgeEligibleCustomerIds();
    assert.equal(eligible.includes(customer.id), false, "아직 만료가 아니면 후보에도 없어야 한다");
  });

  test("15일이 지나면 고객사와 딸려 갔던 것들이 함께 사라진다", async () => {
    const customer = await createTestCustomer("PURGE-EXPIRED");
    const endUser = await createTestEndUser(customer.id, "만료 End-User");
    const contact = await createTestContact(endUser.id, "만료 담당자");

    const deleted = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    await backdateDeletion(customer.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    const eligible = await listPurgeEligibleCustomerIds();
    assert.ok(eligible.includes(customer.id), "만료된 고객사가 후보에 없다");

    assert.equal(await purgeExpiredCustomer(customer.id), "PURGED");
    assert.equal(await readCustomer(customer.id), undefined);
    assert.equal((await db.select().from(endUsers).where(eq(endUsers.id, endUser.id))).length, 0);
    assert.equal((await db.select().from(endUserContacts).where(eq(endUserContacts.id, contact.id))).length, 0);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, customer.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log);
    assert.equal(log.actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
  });

  test("복원된 뒤라면 만료 목록에 들어 있었더라도 지우지 않는다", async () => {
    const customer = await createTestCustomer("PURGE-RESTORED");
    const deleted = await softDeleteCustomer({
      customerId: customer.id,
      expectedUpdatedAt: customer.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    await backdateDeletion(customer.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    const afterDelete = await readCustomer(customer.id);
    const restored = await restoreCustomer({
      customerId: customer.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    assert.equal(restored.ok, true);

    assert.equal(await purgeExpiredCustomer(customer.id), "SKIPPED_RESTORED");
    assert.ok(await readCustomer(customer.id), "복원된 고객사는 살아 있어야 한다");
  });

  test("이미 사라진 행은 오류가 아니라 건너뜀이다", async () => {
    assert.equal(await purgeExpiredCustomer(randomUUID()), "SKIPPED_ALREADY_GONE");
  });

  test("접수 건이 걸린 채 휴지통에 들어가 있으면 지우지 않고 이유 있는 건너뜀으로 보고한다", async () => {
    const customer = await createTestCustomer("PURGE-REFERENCED");
    await createTestRepairCase(customer.id);

    // 정상 경로로는 만들 수 없는 상태다 — softDeleteCustomer가 접수 건을
    // 보고 막고(REFERENCED), createRepairCase는 휴지통에 있는 고객사를 고를
    // 수 없게 막는다(REFERENCE_NOT_FOUND, 이 테스트를 쓰다 확인했다). 그래서
    // 두 관문을 우회해 직접 만든다: 이 규칙이 생기기 전에 들어간 행이나
    // 경쟁으로 빠져나간 행이 있어도 자동 정리가 DB 오류로 터지는 대신
    // 건너뛴다는 것이 이 테스트가 지키는 약속이다.
    await db
      .update(customers)
      .set({
        isDeleted: true,
        deletedAt: new Date(Date.now() - (MASTER_DATA_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY),
        deletedBy: actorId,
      })
      .where(eq(customers.id, customer.id));

    assert.equal(await purgeExpiredCustomer(customer.id), "SKIPPED_REFERENCED");
    assert.ok(await readCustomer(customer.id));

    // 다음 테스트(정리 회차)가 이 행을 다시 만나 같은 이유로 건너뛰게 두지
    // 않는다 — 회차 요약의 숫자가 이 테스트 때문에 흐려지지 않아야 한다.
    await db.update(customers).set({ isDeleted: false, deletedAt: null }).where(eq(customers.id, customer.id));
  });

  test("정리 회차는 만료된 것만 지우고 결과를 세어 돌려준다", async () => {
    const expired = await createTestCustomer("SWEEP-EXPIRED");
    const young = await createTestCustomer("SWEEP-YOUNG");

    for (const customer of [expired, young]) {
      const deleted = await softDeleteCustomer({
        customerId: customer.id,
        expectedUpdatedAt: customer.updatedAt.toISOString(),
        actorUserId: actorId,
        reason: null,
      });
      assert.equal(deleted.ok, true);
    }
    await backdateDeletion(expired.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    await backdateDeletion(young.id, 1);

    const summary = await runMasterDataPurgeSweep();
    assert.ok(summary.customers.eligible >= 1);
    assert.ok(summary.customers.purged >= 1);
    assert.equal(summary.customers.errored, 0, JSON.stringify(summary.customers.errors));

    assert.equal(await readCustomer(expired.id), undefined, "만료된 고객사는 지워져야 한다");
    assert.ok(await readCustomer(young.id), "아직 만료가 아닌 고객사는 남아 있어야 한다");
  });
});
