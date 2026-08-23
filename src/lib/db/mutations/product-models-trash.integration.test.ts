import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  customers,
  productModels,
  products,
  repairCaseIntakeSequences,
  repairCases,
  users,
} from "../schema";
import { createRepairCase, softDeleteRepairCase } from "./repair-cases";
import {
  permanentlyDeleteProductModel,
  restoreProductModel,
  softDeleteProductModel,
} from "./product-models-trash";
import {
  listPurgeEligibleProductModelIds,
  purgeExpiredProductModel,
  runMasterDataPurgeSweep,
} from "./master-data-purge";
import { MASTER_DATA_TRASH_RETENTION_DAYS } from "@/lib/domain/master-data-trash-retention";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * 제품 모델 휴지통 — 실제 DB 통합 테스트. 고객사 쪽
 * customers-trash.integration.test.ts와 같은 구성이고, 확인하는 약속도 같다:
 * 무엇이 함께 딸려 가는가, 무엇이 삭제를 막는가, 복원이 무엇까지 되살리는가,
 * 만료된 것만 자동으로 지워지는가.
 *
 * 이 파일만의 이름 접두사와 이 파일만의 인수번호 월(9704)을 쓰고, 만든 것만
 * 지운다. 15일은 deleted_at을 직접 과거로 돌려 대신한다 — 이 파일이 만든
 * 행에만 하는 일이다.
 */

const RUN_TOKEN = randomUUID();
const TEST_MODEL_PREFIX = `PM-TRASH-TEST-${RUN_TOKEN}-`;
const TEST_CUSTOMER_PREFIX = `AS-TEST-CUST-PMTRASH-${RUN_TOKEN}-`;
const TEST_YEAR_MONTH = "9704";
const TEST_RECEIVED_AT = "2097-04-01";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let engineerId: string;
let actorId: string;
let customerId: string;

/**
 * 감사 로그 정리를 위해 이 파일이 만든 id를 엔티티별로 나눠 모아 둔다 —
 * 모델·등록 장비·접수 건 셋 다 자기 엔티티로 감사 행을 남긴다.
 * target_record_id만으로 범위를 잡으면 같은 id를 가진 다른 엔티티의 감사
 * 기록까지 함께 걸린다. 감사 로그는 3년 보존 대상이므로 (엔티티, 대상 id)
 * 쌍으로 이 파일이 만든 감사 행만 골라 그 행의 PK로 지운다.
 */
const touchedProductModelIds: string[] = [];
const touchedProductIds: string[] = [];
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
  actorId = admin?.id ?? engineerId;

  const [customer] = await db
    .insert(customers)
    .values({ name: `${TEST_CUSTOMER_PREFIX}OWNER` })
    .returning();
  customerId = customer.id;
});

after(async () => {
  const auditScopes: { entity: string; ids: string[] }[] = [
    { entity: "product_models", ids: touchedProductModelIds },
    { entity: "products", ids: touchedProductIds },
    { entity: "repair_cases", ids: touchedRepairCaseIds },
  ];
  const createdAuditIds: string[] = [];
  for (const scope of auditScopes) {
    if (scope.ids.length === 0) continue;
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetEntity, scope.entity), inArray(auditLogs.targetRecordId, scope.ids)));
    createdAuditIds.push(...rows.map((row) => row.id));
  }
  if (createdAuditIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.id, createdAuditIds));
  }
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(repairCaseIntakeSequences).where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(productModels).where(like(productModels.modelName, `${TEST_MODEL_PREFIX}%`));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

async function createTestModel(suffix: string) {
  const [row] = await db
    .insert(productModels)
    .values({ modelName: `${TEST_MODEL_PREFIX}${suffix}`, kind: "MATCHER" })
    .returning();
  touchedProductModelIds.push(row.id);
  return row;
}

/** 이 모델로 등록된 장비 하나. 접수 건 없이 장비만 필요할 때 쓴다. */
async function createTestUnit(model: { id: string; modelName: string }) {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(products)
    .values({
      modelName: model.modelName,
      productModelId: model.id,
      lotNumber: `LOT-${suffix}`,
      serialNumber: `SN-${suffix}`,
    })
    .returning();
  touchedProductIds.push(row.id);
  return row;
}

async function createTestRepairCase(model: { id: string; modelName: string }) {
  const suffix = randomUUID().slice(0, 8);
  const input: ValidatedCreateRepairCaseInput = {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    modelName: model.modelName,
    productModelId: model.id,
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

async function readModel(id: string) {
  const [row] = await db.select().from(productModels).where(eq(productModels.id, id));
  return row;
}

async function backdateDeletion(modelId: string, days: number) {
  const past = new Date(Date.now() - days * MS_PER_DAY);
  await db.update(productModels).set({ deletedAt: past }).where(eq(productModels.id, modelId));
  return past;
}

describe("softDeleteProductModel", () => {
  test("모델과 함께 등록 장비가 같은 순간으로 딸려 간다", async () => {
    const model = await createTestModel("CASCADE");
    const unit = await createTestUnit(model);

    const result = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: "테스트 삭제",
    });
    assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);
    if (!result.ok) return;
    assert.equal(result.unitCount, 1);

    const deletedModel = await readModel(model.id);
    assert.equal(deletedModel.isDeleted, true);
    assert.equal(deletedModel.deletedBy, actorId);
    assert.equal(deletedModel.deleteReason, "테스트 삭제");

    const [deletedUnit] = await db.select().from(products).where(eq(products.id, unit.id));
    assert.equal(deletedUnit.isDeleted, true);
    // 같은 순간이어야 복원이 '이번 삭제로 딸려 간 것'을 알아본다.
    assert.equal(deletedUnit.deletedAt?.getTime(), deletedModel.deletedAt?.getTime());
    // 장비의 모델 연결은 끊지 않는다 — 복원하면 그대로 돌아와야 한다.
    assert.equal(deletedUnit.productModelId, model.id);
  });

  test("등록 장비의 A/S 접수 건이 있으면 REFERENCED로 막고 아무것도 바꾸지 않는다", async () => {
    const model = await createTestModel("REFERENCED");
    const created = await createTestRepairCase(model);
    touchedRepairCaseIds.push(created.id);

    const result = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REFERENCED");

    const untouched = await readModel(model.id);
    assert.equal(untouched.isDeleted, false);
    const units = await db.select().from(products).where(eq(products.productModelId, model.id));
    assert.ok(units.every((unit) => !unit.isDeleted), "장비도 그대로여야 한다");
  });

  test("휴지통에 있는 접수 건도 삭제를 막는다 — FK는 is_deleted를 보지 않는다", async () => {
    const model = await createTestModel("REF-TRASHED");
    const created = await createTestRepairCase(model);
    touchedRepairCaseIds.push(created.id);

    const [caseRow] = await db.select().from(repairCases).where(eq(repairCases.id, created.id));
    const softDeleted = await softDeleteRepairCase({
      id: created.id,
      expectedVersion: caseRow.version,
      actorUserId: actorId,
      reason: "테스트",
    });
    assert.equal(softDeleted.ok, true);

    const result = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "REFERENCED");
  });

  test("updated_at이 어긋나면 CONFLICT", async () => {
    const model = await createTestModel("CONFLICT");
    const result = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: new Date(0).toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
  });
});

describe("restoreProductModel", () => {
  test("이번 삭제로 딸려 간 장비만 되살린다 — 먼저 지워져 있던 장비는 그대로 둔다", async () => {
    const model = await createTestModel("RESTORE-PARTIAL");
    const alreadyDeleted = await createTestUnit(model);
    const cascaded = await createTestUnit(model);

    await db
      .update(products)
      .set({ isDeleted: true, deletedAt: new Date(Date.now() - MS_PER_DAY), deletedBy: actorId })
      .where(eq(products.id, alreadyDeleted.id));

    const deleted = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    assert.equal(deleted.unitCount, 1, "이미 지워져 있던 장비는 세지 않는다");

    const afterDelete = await readModel(model.id);
    const restored = await restoreProductModel({
      productModelId: model.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    assert.equal(restored.ok, true, `restore failed: ${JSON.stringify(restored)}`);

    const back = await readModel(model.id);
    assert.equal(back.isDeleted, false);
    assert.equal(back.deletedAt, null);

    const [cascadedRow] = await db.select().from(products).where(eq(products.id, cascaded.id));
    const [alreadyDeletedRow] = await db.select().from(products).where(eq(products.id, alreadyDeleted.id));
    assert.equal(cascadedRow.isDeleted, false, "딸려 갔던 장비는 돌아와야 한다");
    assert.equal(alreadyDeletedRow.isDeleted, true, "미리 지워져 있던 장비는 그대로여야 한다");
  });

  test("같은 이름의 모델이 새로 생겼으면 NAME_TAKEN", async () => {
    const model = await createTestModel("NAME-TAKEN");
    const deleted = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    // 부분 유니크 인덱스(is_deleted = false)라 같은 이름이 다시 들어올 수 있다.
    const replacement = await createTestModel("NAME-TAKEN");
    assert.equal(replacement.modelName, model.modelName);

    const afterDelete = await readModel(model.id);
    const restored = await restoreProductModel({
      productModelId: model.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    assert.equal(restored.ok, false);
    if (restored.ok) return;
    assert.equal(restored.code, "NAME_TAKEN");
    assert.equal((await readModel(model.id)).isDeleted, true, "복원 실패면 휴지통에 그대로 있어야 한다");
  });
});

describe("permanentlyDeleteProductModel", () => {
  test("모델과 등록 장비가 DB에서 사라지고 PURGE 감사 로그가 남는다", async () => {
    const model = await createTestModel("PERMANENT");
    const unit = await createTestUnit(model);

    const deleted = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    const afterDelete = await readModel(model.id);
    const purged = await permanentlyDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: "테스트 완전 삭제",
    });
    assert.equal(purged.ok, true, `permanent delete failed: ${JSON.stringify(purged)}`);

    assert.equal(await readModel(model.id), undefined);
    assert.equal((await db.select().from(products).where(eq(products.id, unit.id))).length, 0);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, model.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log, "expected a PURGE audit row");
    assert.equal(log.actorUserId, actorId, "사람이 지웠으면 행위자가 남아야 한다");
  });

  test("휴지통에 없는 모델은 완전 삭제 대상이 아니다", async () => {
    const model = await createTestModel("PERMANENT-ACTIVE");
    const result = await permanentlyDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: "테스트",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
    assert.ok(await readModel(model.id), "활성 모델이 지워지면 안 된다");
  });
});

describe("purgeExpiredProductModel", () => {
  test("15일이 지나지 않았으면 지우지 않는다", async () => {
    const model = await createTestModel("PURGE-YOUNG");
    const deleted = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    await backdateDeletion(model.id, MASTER_DATA_TRASH_RETENTION_DAYS - 1);
    assert.equal(await purgeExpiredProductModel(model.id), "SKIPPED_NOT_ELIGIBLE");
    assert.ok(await readModel(model.id));
    assert.equal((await listPurgeEligibleProductModelIds()).includes(model.id), false);
  });

  test("15일이 지나면 모델과 딸려 갔던 장비가 함께 사라진다", async () => {
    const model = await createTestModel("PURGE-EXPIRED");
    const unit = await createTestUnit(model);

    const deleted = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    await backdateDeletion(model.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    assert.ok((await listPurgeEligibleProductModelIds()).includes(model.id), "만료된 모델이 후보에 없다");
    assert.equal(await purgeExpiredProductModel(model.id), "PURGED");
    assert.equal(await readModel(model.id), undefined);
    assert.equal((await db.select().from(products).where(eq(products.id, unit.id))).length, 0);

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, model.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log);
    assert.equal(log.actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
  });

  test("복원된 뒤라면 만료 목록에 들어 있었더라도 지우지 않는다", async () => {
    const model = await createTestModel("PURGE-RESTORED");
    const deleted = await softDeleteProductModel({
      productModelId: model.id,
      expectedUpdatedAt: model.updatedAt.toISOString(),
      actorUserId: actorId,
      reason: null,
    });
    assert.equal(deleted.ok, true);
    await backdateDeletion(model.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    const afterDelete = await readModel(model.id);
    const restored = await restoreProductModel({
      productModelId: model.id,
      expectedUpdatedAt: afterDelete.updatedAt.toISOString(),
      actorUserId: actorId,
    });
    assert.equal(restored.ok, true);

    assert.equal(await purgeExpiredProductModel(model.id), "SKIPPED_RESTORED");
    assert.ok(await readModel(model.id));
  });

  test("이미 사라진 행은 오류가 아니라 건너뜀이다", async () => {
    assert.equal(await purgeExpiredProductModel(randomUUID()), "SKIPPED_ALREADY_GONE");
  });

  test("접수 건이 걸린 채 휴지통에 들어가 있으면 지우지 않고 이유 있는 건너뜀으로 보고한다", async () => {
    const model = await createTestModel("PURGE-REFERENCED");
    const created = await createTestRepairCase(model);
    touchedRepairCaseIds.push(created.id);

    // 정상 경로로는 만들 수 없는 상태다 — softDeleteProductModel이 접수 건을
    // 보고 막는다. 그 관문을 우회해 직접 만들어, 자동 정리가 DB 오류로 터지는
    // 대신 건너뛴다는 것을 확인한다.
    await db
      .update(productModels)
      .set({
        isDeleted: true,
        deletedAt: new Date(Date.now() - (MASTER_DATA_TRASH_RETENTION_DAYS + 1) * MS_PER_DAY),
        deletedBy: actorId,
      })
      .where(eq(productModels.id, model.id));

    assert.equal(await purgeExpiredProductModel(model.id), "SKIPPED_REFERENCED");
    assert.ok(await readModel(model.id));

    // 다음 테스트(정리 회차)의 숫자가 이 행 때문에 흐려지지 않게 되돌린다.
    await db
      .update(productModels)
      .set({ isDeleted: false, deletedAt: null })
      .where(eq(productModels.id, model.id));
  });

  test("정리 회차는 고객사와 제품 모델을 함께 돌고 만료된 것만 지운다", async () => {
    const expired = await createTestModel("SWEEP-EXPIRED");
    const young = await createTestModel("SWEEP-YOUNG");

    for (const model of [expired, young]) {
      const deleted = await softDeleteProductModel({
        productModelId: model.id,
        expectedUpdatedAt: model.updatedAt.toISOString(),
        actorUserId: actorId,
        reason: null,
      });
      assert.equal(deleted.ok, true);
    }
    await backdateDeletion(expired.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    await backdateDeletion(young.id, 1);

    const summary = await runMasterDataPurgeSweep();
    assert.ok(summary.productModels.eligible >= 1);
    assert.ok(summary.productModels.purged >= 1);
    assert.equal(summary.productModels.errored, 0, JSON.stringify(summary.productModels.errors));
    // 고객사 쪽도 같은 회차에서 돈다 — 요약에 자리가 있어야 한다.
    assert.equal(summary.customers.errored, 0, JSON.stringify(summary.customers.errors));

    assert.equal(await readModel(expired.id), undefined, "만료된 모델은 지워져야 한다");
    assert.ok(await readModel(young.id), "아직 만료가 아닌 모델은 남아 있어야 한다");
  });
});
