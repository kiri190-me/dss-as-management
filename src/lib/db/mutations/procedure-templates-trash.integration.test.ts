import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  procedureTemplateEdges,
  procedureTemplateNodes,
  procedureTemplates,
  users,
} from "../schema";
import {
  permanentlyDeleteProcedureTemplate,
  restoreProcedureTemplate,
  softDeleteProcedureTemplate,
} from "./procedure-templates";
import {
  listPurgeEligibleProcedureTemplateIds,
  purgeExpiredProcedureTemplate,
  runMasterDataPurgeSweep,
} from "./master-data-purge";
import {
  listDeletedTechnicalProcedureTemplates,
  listTechnicalProcedureTemplates,
} from "../queries/procedure-templates";
import { MASTER_DATA_TRASH_RETENTION_DAYS } from "@/lib/domain/master-data-trash-retention";

/**
 * 기술 절차 휴지통 — 실제 DB 통합 테스트.
 *
 * 다른 마스터와 확인하는 약속은 같다(무엇이 삭제를 막는가, 부속물이 함께
 * 움직이는가, 복원되는가, 만료된 것만 자동으로 지워지는가). 이 화면만의
 * 약속이 둘 더 있다:
 *  - **분류로 막힌다**: TECHNICAL_TASK가 아니면 어떤 역할로도 지울 수 없다.
 *  - **삭제된 절차는 어느 목록에도 나오지 않는다**: 컬럼만 넣고 조회를
 *    고치지 않으면 지운 절차가 계속 보인다 — 그 회귀를 여기서 잡는다.
 *
 * 이 파일만의 code 접두사를 쓰고 만든 것만 지운다. 15일은 deleted_at을 직접
 * 과거로 돌려 대신한다.
 */

const RUN_TOKEN = randomUUID().slice(0, 8);
const TEST_CODE_PREFIX = `test-proc-trash-${RUN_TOKEN}-`;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let adminId: string;
let engineerId: string;

const touchedRecordIds: string[] = [];

before(async () => {
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
  assert.ok(admin, "expected an approved ADMIN in the test DB");
  adminId = admin.id;

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
  if (touchedRecordIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.targetRecordId, touchedRecordIds));
  }
  const leftovers = await db
    .select({ id: procedureTemplates.id })
    .from(procedureTemplates)
    .where(like(procedureTemplates.code, `${TEST_CODE_PREFIX}%`));
  const ids = leftovers.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(procedureTemplateEdges).where(inArray(procedureTemplateEdges.procedureTemplateId, ids));
    await db.delete(procedureTemplateNodes).where(inArray(procedureTemplateNodes.procedureTemplateId, ids));
    await db.delete(procedureTemplates).where(inArray(procedureTemplates.id, ids));
  }
  await pgClient.end({ timeout: 5 });
});

async function createTestTemplate(
  suffix: string,
  overrides: { category?: "TECHNICAL_TASK" | "FULL_SERVICE"; nodeCount?: number } = {}
) {
  const [row] = await db
    .insert(procedureTemplates)
    .values({
      code: `${TEST_CODE_PREFIX}${suffix}`,
      name: `테스트 절차 ${suffix}`,
      equipmentType: "RFG",
      category: overrides.category ?? "TECHNICAL_TASK",
      isReferenceOnly: false,
      sourceType: "MANUAL",
      createdByUserId: adminId,
    })
    .returning();
  touchedRecordIds.push(row.id);

  for (let i = 0; i < (overrides.nodeCount ?? 0); i += 1) {
    await db.insert(procedureTemplateNodes).values({
      procedureTemplateId: row.id,
      nodeCode: `N${i}`,
      nodeType: "TASK",
      title: `노드 ${i}`,
      sourceWorksheet: "TEST",
    });
  }

  return row;
}

async function readTemplate(id: string) {
  const [row] = await db.select().from(procedureTemplates).where(eq(procedureTemplates.id, id));
  return row;
}

async function backdateDeletion(templateId: string, days: number) {
  await db
    .update(procedureTemplates)
    .set({ deletedAt: new Date(Date.now() - days * MS_PER_DAY) })
    .where(eq(procedureTemplates.id, templateId));
}

describe("softDeleteProcedureTemplate", () => {
  test("절차가 휴지통으로 가고 감사 로그가 남는다", async () => {
    const template = await createTestTemplate("PLAIN", { nodeCount: 2 });

    const result = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: "테스트 삭제",
    });
    assert.equal(result.ok, true, `soft delete failed: ${JSON.stringify(result)}`);

    const deleted = await readTemplate(template.id);
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.deletedBy, adminId);
    assert.equal(deleted.deleteReason, "테스트 삭제");
    assert.ok(deleted.deletedAt);

    // 부속물은 소프트 삭제 단계에서 건드리지 않는다 — 복원이 그대로 되살릴 수
    // 있어야 하고, 완전삭제 시점에 한꺼번에 지운다.
    const nodes = await db
      .select()
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.procedureTemplateId, template.id));
    assert.equal(nodes.length, 2, "노드는 그대로 남아 있어야 한다");

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, template.id), eq(auditLogs.actionType, "SOFT_DELETE")));
    assert.ok(log, "expected a SOFT_DELETE audit row");
    assert.equal(log.actorUserId, adminId);
  });

  test("삭제한 절차는 사용중 목록에서 사라지고 휴지통 목록에 나타난다", async () => {
    const template = await createTestTemplate("LISTS", { nodeCount: 3 });

    const before = await listTechnicalProcedureTemplates(true);
    assert.ok(before.some((row) => row.id === template.id), "삭제 전에는 사용중 목록에 있어야 한다");

    const deleted = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: null,
    });
    assert.equal(deleted.ok, true);

    const after = await listTechnicalProcedureTemplates(true);
    assert.equal(
      after.some((row) => row.id === template.id),
      false,
      "삭제한 절차가 사용중 목록에 남아 있다 — 조회에 is_deleted 필터가 빠졌다"
    );

    const trash = await listDeletedTechnicalProcedureTemplates();
    const trashed = trash.find((row) => row.id === template.id);
    assert.ok(trashed, "휴지통 목록에 없다");
    assert.equal(trashed.nodeCount, 3);
    assert.equal(trashed.status, "DRAFT");
  });

  test("전체 서비스 절차는 어떤 역할로도 지울 수 없다 — 분류로 막는다", async () => {
    const template = await createTestTemplate("FULL-SERVICE", { category: "FULL_SERVICE" });

    const result = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
    assert.equal((await readTemplate(template.id)).isDeleted, false);
  });

  test("엔지니어는 기술 절차를 지울 수 없다", async () => {
    const template = await createTestTemplate("ENGINEER-FORBIDDEN");

    const result = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: engineerId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "FORBIDDEN");
    assert.equal((await readTemplate(template.id)).isDeleted, false);
  });

  test("후속 버전이 이어받은 절차는 지울 수 없다", async () => {
    const original = await createTestTemplate("SUPERSEDED");
    const successor = await createTestTemplate("SUCCESSOR");
    await db
      .update(procedureTemplates)
      .set({ supersedesTemplateId: original.id })
      .where(eq(procedureTemplates.id, successor.id));

    const result = await softDeleteProcedureTemplate({
      templateId: original.id,
      actorUserId: adminId,
      reason: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.match(result.message, /후속 버전/);
    assert.equal((await readTemplate(original.id)).isDeleted, false);

    // 정리를 위해 참조를 끊는다(after 훅이 지울 수 있도록).
    await db
      .update(procedureTemplates)
      .set({ supersedesTemplateId: null })
      .where(eq(procedureTemplates.id, successor.id));
  });

  test("이미 휴지통에 있는 절차는 다시 삭제되지 않는다", async () => {
    const template = await createTestTemplate("DOUBLE-DELETE");
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);

    const second = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: null,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "NOT_FOUND");
  });
});

describe("restoreProcedureTemplate", () => {
  test("휴지통의 절차가 부속물과 함께 되살아난다", async () => {
    const template = await createTestTemplate("RESTORE", { nodeCount: 2 });
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);

    const restored = await restoreProcedureTemplate({ templateId: template.id, actorUserId: adminId });
    assert.equal(restored.ok, true, `restore failed: ${JSON.stringify(restored)}`);

    const back = await readTemplate(template.id);
    assert.equal(back.isDeleted, false);
    assert.equal(back.deletedAt, null);
    assert.equal(back.deletedBy, null);
    assert.equal(back.deleteReason, null);

    const list = await listTechnicalProcedureTemplates(true);
    assert.ok(list.some((row) => row.id === template.id), "복원한 절차가 사용중 목록에 돌아와야 한다");

    const nodes = await db
      .select()
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.procedureTemplateId, template.id));
    assert.equal(nodes.length, 2);
  });

  test("휴지통에 없는 절차는 복원 대상이 아니다", async () => {
    const template = await createTestTemplate("RESTORE-ACTIVE");
    const result = await restoreProcedureTemplate({ templateId: template.id, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_FOUND");
  });
});

describe("permanentlyDeleteProcedureTemplate", () => {
  test("절차와 노드가 DB에서 사라지고 PURGE 감사 로그가 남는다", async () => {
    const template = await createTestTemplate("PERMANENT", { nodeCount: 4 });
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);

    const purged = await permanentlyDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: "테스트 완전 삭제",
    });
    assert.equal(purged.ok, true, `permanent delete failed: ${JSON.stringify(purged)}`);

    assert.equal(await readTemplate(template.id), undefined);
    const nodes = await db
      .select()
      .from(procedureTemplateNodes)
      .where(eq(procedureTemplateNodes.procedureTemplateId, template.id));
    assert.equal(nodes.length, 0, "노드가 함께 지워져야 한다");

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, template.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log);
    assert.equal(log.actorUserId, adminId, "사람이 지웠으면 행위자가 남아야 한다");
  });

  test("사유 없이 완전 삭제할 수 없다", async () => {
    const template = await createTestTemplate("PERMANENT-NO-REASON");
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);

    const result = await permanentlyDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: "  ",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_INPUT");
    assert.ok(await readTemplate(template.id), "거절됐으면 절차는 그대로 있어야 한다");
  });
});

describe("purgeExpiredProcedureTemplate", () => {
  test("15일이 지나지 않았으면 지우지 않는다", async () => {
    const template = await createTestTemplate("PURGE-YOUNG");
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);

    await backdateDeletion(template.id, MASTER_DATA_TRASH_RETENTION_DAYS - 1);
    assert.equal(await purgeExpiredProcedureTemplate(template.id), "SKIPPED_NOT_ELIGIBLE");
    assert.ok(await readTemplate(template.id));
    assert.equal((await listPurgeEligibleProcedureTemplateIds()).includes(template.id), false);
  });

  test("15일이 지나면 절차와 노드가 함께 사라진다", async () => {
    const template = await createTestTemplate("PURGE-EXPIRED", { nodeCount: 3 });
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);
    await backdateDeletion(template.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    assert.ok((await listPurgeEligibleProcedureTemplateIds()).includes(template.id));
    assert.equal(await purgeExpiredProcedureTemplate(template.id), "PURGED");
    assert.equal(await readTemplate(template.id), undefined);
    assert.equal(
      (await db.select().from(procedureTemplateNodes).where(eq(procedureTemplateNodes.procedureTemplateId, template.id)))
        .length,
      0
    );

    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetRecordId, template.id), eq(auditLogs.actionType, "PURGE")));
    assert.ok(log);
    assert.equal(log.actorUserId, null, "자동 정리는 사람이 한 일이 아니다");
  });

  test("복원된 뒤라면 만료 목록에 있었더라도 지우지 않는다", async () => {
    const template = await createTestTemplate("PURGE-RESTORED");
    assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);
    await backdateDeletion(template.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    assert.equal((await restoreProcedureTemplate({ templateId: template.id, actorUserId: adminId })).ok, true);

    assert.equal(await purgeExpiredProcedureTemplate(template.id), "SKIPPED_RESTORED");
    assert.ok(await readTemplate(template.id));
  });

  test("이미 사라진 행은 오류가 아니라 건너뜀이다", async () => {
    assert.equal(await purgeExpiredProcedureTemplate(randomUUID()), "SKIPPED_ALREADY_GONE");
  });

  test("후속 버전이 걸린 채 휴지통에 들어가 있으면 지우지 않고 건너뛴다", async () => {
    const original = await createTestTemplate("PURGE-REFERENCED");
    const successor = await createTestTemplate("PURGE-REFERENCED-NEXT");
    assert.equal((await softDeleteProcedureTemplate({ templateId: original.id, actorUserId: adminId, reason: null })).ok, true);
    await backdateDeletion(original.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);

    // 정상 경로로는 만들 수 없는 상태다 — softDeleteProcedureTemplate이 참조를
    // 보고 막는다. 그 관문을 우회해 직접 만들어, 자동 정리가 DB 오류로 터지는
    // 대신 건너뛴다는 것을 확인한다.
    await db
      .update(procedureTemplates)
      .set({ supersedesTemplateId: original.id })
      .where(eq(procedureTemplates.id, successor.id));

    assert.equal(await purgeExpiredProcedureTemplate(original.id), "SKIPPED_REFERENCED");
    assert.ok(await readTemplate(original.id));

    await db
      .update(procedureTemplates)
      .set({ supersedesTemplateId: null })
      .where(eq(procedureTemplates.id, successor.id));
    await db.update(procedureTemplates).set({ isDeleted: false, deletedAt: null }).where(eq(procedureTemplates.id, original.id));
  });

  test("정리 회차가 기술 절차까지 함께 돈다", async () => {
    const expired = await createTestTemplate("SWEEP-EXPIRED");
    const young = await createTestTemplate("SWEEP-YOUNG");

    for (const template of [expired, young]) {
      assert.equal((await softDeleteProcedureTemplate({ templateId: template.id, actorUserId: adminId, reason: null })).ok, true);
    }
    await backdateDeletion(expired.id, MASTER_DATA_TRASH_RETENTION_DAYS + 1);
    await backdateDeletion(young.id, 1);

    const summary = await runMasterDataPurgeSweep();
    assert.ok(summary.procedureTemplates.eligible >= 1);
    assert.ok(summary.procedureTemplates.purged >= 1);
    assert.equal(summary.procedureTemplates.errored, 0, JSON.stringify(summary.procedureTemplates.errors));

    assert.equal(await readTemplate(expired.id), undefined, "만료된 절차는 지워져야 한다");
    assert.ok(await readTemplate(young.id), "아직 만료가 아닌 절차는 남아 있어야 한다");
  });
});
