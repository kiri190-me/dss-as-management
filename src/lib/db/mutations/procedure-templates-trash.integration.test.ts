import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  auditLogs,
  procedureCaseExecutions,
  procedureTemplateEdges,
  procedureTemplateNodes,
  procedureTemplates,
  repairCases,
  users,
} from "../schema";
import {
  createNewDraftVersion,
  permanentlyDeleteProcedureTemplate,
  publishProcedureTemplate,
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

/**
 * 감사 로그 정리를 위해 이 파일이 만든 절차 id를 모아 둔다. 이 파일이 만드는
 * 감사 행은 전부 procedure_templates 엔티티다(노드·엣지는 감사 행을 따로
 * 남기지 않는다) — target_record_id만으로 범위를 잡으면 같은 id를 가진 다른
 * 엔티티의 감사 기록까지 걸리므로 (엔티티, 대상 id) 쌍으로만 지운다.
 */
const touchedTemplateIds: string[] = [];

/**
 * 이 파일이 직접 꽂은 수행 기록(2026-11-04, 줄기 B-⑥). 실제 수리 건에 붙이므로
 * **반드시 치운다** — 남으면 그 수리 건을 보는 남의 시험이 까닭 없이 깨진다.
 * 시험 안에서도 지우고 after 에서 한 번 더 지운다(중간에 터져도 남지 않게).
 */
const touchedExecutionIds: string[] = [];

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
  if (touchedExecutionIds.length > 0) {
    await db.delete(procedureCaseExecutions).where(inArray(procedureCaseExecutions.id, touchedExecutionIds));
  }
  if (touchedTemplateIds.length > 0) {
    await db.delete(auditLogs).where(and(
      eq(auditLogs.targetEntity, "procedure_templates"),
      inArray(auditLogs.targetRecordId, touchedTemplateIds)
    ));
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
  touchedTemplateIds.push(row.id);

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

/**
 * ============================================================================
 * 줄기 B-⑥ — [새 DRAFT 버전 만들기]와 [초안 버리기]가 맞물리는 자리
 * ============================================================================
 * 2026-11-04. 사용자가 말한 것: "게시한 [기술 작업 절차]를 [새 DRAFT 버전
 * 만들기]로 편집할 때 버전 관리를 제대로 해줘." 그 자리에 세 가지를 더했고,
 * 셋이 서로를 떠받친다 — 하나만 빠져도 나머지가 뜻을 잃는다.
 *
 *  가. 막을 때 **그 초안으로 가는 길**을 함께 준다(existingDraftId).
 *  나. [새 DRAFT 버전 만들기]에는 확인 창을 두지 않는다 — 되돌릴 수 있는
 *      일이기 때문이고, "되돌릴 수 있다"를 참으로 만드는 것이 다번이다.
 *  다. 편집기에서 그 초안을 버린다(requireStatus="DRAFT").
 *
 * 🔴 여기서 가장 조용히 깨질 수 있는 것은 **판 번호**다. 휴지통의 행은
 * (code, version) 자리를 계속 차지하므로(그 유니크 인덱스는 부분 인덱스가
 * 아니다), "부모 + 1"로 세면 버린 뒤 새 초안 만들기가 23505 로 터진다. 그
 * 오류는 액션이 "일시적으로 처리할 수 없습니다"로 바꿔 보여 주기 때문에
 * 화면만 봐서는 영영 원인을 모른다 — 그래서 값으로 못 박는다.
 */

/** 노드 둘과 그 사이 연결선 하나를 가진, 게시된 기술 절차. 자리 값·경로점까지 채워 둔다. */
async function publishedTemplateWithLayout(suffix: string) {
  const template = await createTestTemplate(suffix, { nodeCount: 2 });
  const nodes = await db
    .select()
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, template.id))
    .orderBy(procedureTemplateNodes.nodeCode);
  assert.equal(nodes.length, 2, "표본 확인 — 노드가 둘이어야 아래 자리 값·연결선이 뜻을 갖는다");

  // 사람이 끌어 놓은 자리와 손으로 꺾은 경로 — 줄기 B-⑤ 가 복제 목록에 넣은 셋이다.
  await db
    .update(procedureTemplateNodes)
    .set({ userPositionX: 11, userPositionY: 22 })
    .where(eq(procedureTemplateNodes.id, nodes[0].id));
  await db
    .update(procedureTemplateNodes)
    .set({ userPositionX: 33, userPositionY: 44 })
    .where(eq(procedureTemplateNodes.id, nodes[1].id));
  await db.insert(procedureTemplateEdges).values({
    procedureTemplateId: template.id,
    fromNodeId: nodes[0].id,
    toNodeId: nodes[1].id,
    branchType: "DEFAULT",
    sortOrder: 0,
    userRoutePoints: [{ x: 7, y: 8 }],
  });

  const published = await publishProcedureTemplate(template.id, adminId);
  assert.equal(published.ok, true, `publish failed: ${JSON.stringify(published)}`);
  return template;
}

/** 복제본의 자리 값·경로점을 한 덩어리로 읽는다. */
async function readLayout(templateId: string) {
  const nodes = await db
    .select()
    .from(procedureTemplateNodes)
    .where(eq(procedureTemplateNodes.procedureTemplateId, templateId))
    .orderBy(procedureTemplateNodes.nodeCode);
  const edges = await db
    .select()
    .from(procedureTemplateEdges)
    .where(eq(procedureTemplateEdges.procedureTemplateId, templateId));
  return {
    positions: nodes.map((n) => [n.userPositionX, n.userPositionY]),
    routes: edges.map((e) => e.userRoutePoints),
  };
}

describe("줄기 B-⑥ 가 — 막을 때 그 초안으로 가는 길을 함께 준다", () => {
  test("🔴 「이미 진행 중인 초안」을 돌려줄 때 **그 초안의 id** 가 실린다", async () => {
    const template = await publishedTemplateWithLayout("CONFLICT-LINK");

    const first = await createNewDraftVersion(template.id, adminId);
    assert.equal(first.ok, true, `first draft failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    touchedTemplateIds.push(first.id);

    // 🔵 표본 확인 — 같은 줄기에 살아 있는 초안이 **정확히 하나**여야 아래
    //    단언이 "어느 초안이든 맞다"로 흐려지지 않는다.
    const liveDrafts = await db
      .select({ id: procedureTemplates.id })
      .from(procedureTemplates)
      .where(
        and(
          eq(procedureTemplates.code, template.code),
          eq(procedureTemplates.status, "DRAFT"),
          eq(procedureTemplates.isDeleted, false)
        )
      );
    assert.deepEqual(liveDrafts.map((row) => row.id), [first.id]);

    const second = await createNewDraftVersion(template.id, adminId);
    assert.equal(second.ok, false, "같은 줄기에 초안이 둘일 수는 없다");
    if (second.ok) return;
    assert.equal(second.code, "CONFLICT");
    assert.match(second.message, /이미 진행 중인 초안/);
    assert.equal(
      second.existingDraftId,
      first.id,
      "막기만 하고 어디 있는지 안 알려 주면 사람이 목록에서 같은 이름의 판을 손으로 찾아야 한다"
    );
  });

  test("🔵 보낼 곳이 없는 실패에는 그 칸이 비어 있다 — 아무 id 나 싣지 않는다", async () => {
    const template = await createTestTemplate("CONFLICT-LINK-NONE");
    // 게시본이 아니라 초안이다 → "게시 상태만 새 버전을 만들 수 있습니다".
    const result = await createNewDraftVersion(template.id, adminId);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.equal(result.existingDraftId, undefined);
  });
});

describe("줄기 B-⑥ 다 — [초안 버리기]는 초안만 버린다", () => {
  test("🔴 게시본은 이 길로 지울 수 없다 — 상태를 이유로 거절하고 행은 그대로다", async () => {
    const template = await createTestTemplate("DISCARD-PUBLISHED");
    const published = await publishProcedureTemplate(template.id, adminId);
    assert.equal(published.ok, true, `publish failed: ${JSON.stringify(published)}`);
    // 🔵 표본 확인 — 이 절차를 붙잡고 있는 것이 **하나도 없다.** 그래서 아래
    //    거절은 참조가 아니라 오직 상태 때문이다.
    assert.equal((await readTemplate(template.id)).status, "PUBLISHED");

    const result = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: null,
      requireStatus: "DRAFT",
    });
    assert.equal(result.ok, false, "게시본이 [초안 버리기]로 사라지면 안 된다");
    if (result.ok) return;
    assert.equal(result.code, "CONFLICT");
    assert.match(result.message, /초안.*상태의 절차만/);
    assert.match(result.message, /게시/, "왜 안 되는지를 상태로 말해야 한다");
    assert.equal((await readTemplate(template.id)).isDeleted, false);
  });

  test("🔵 requireStatus 를 안 넘기면 상태를 보지 않는다 — 목록 화면의 일괄 삭제는 전과 똑같다", async () => {
    // 🔴 이 시험은 "게시본을 일괄 삭제로 지우는 것이 옳다"고 말하지 않는다.
    //    줄기 B-⑥ 이 **그 길을 한 글자도 안 바꿨다**는 울타리다. 휴지통 화면의
    //    「삭제 당시 상태」 칸이 그 동작 위에 서 있어서(발행본도 올 수 있다는
    //    전제), 바꿀지 말지는 사용자가 정할 일이다.
    const template = await createTestTemplate("DISCARD-BULK-UNCHANGED");
    assert.equal((await publishProcedureTemplate(template.id, adminId)).ok, true);

    const result = await softDeleteProcedureTemplate({
      templateId: template.id,
      actorUserId: adminId,
      reason: null,
    });
    assert.equal(result.ok, true, `bulk path changed behavior: ${JSON.stringify(result)}`);
    assert.equal((await readTemplate(template.id)).isDeleted, true);
  });

  test("🔴 수리 건이 물고 있는 판본은 못 지운다 — 실제 수행 기록 한 줄로 막힌다", async () => {
    const template = await createTestTemplate("DISCARD-EXECUTED");
    assert.equal((await publishProcedureTemplate(template.id, adminId)).ok, true);

    const [repairCase] = await db.select({ id: repairCases.id }).from(repairCases).limit(1);
    assert.ok(repairCase, "expected at least one repair case in the test DB");

    const [execution] = await db
      .insert(procedureCaseExecutions)
      .values({
        repairCaseId: repairCase.id,
        procedureTemplateId: template.id,
        templateCategory: "TECHNICAL_TASK",
        startedBy: adminId,
      })
      .returning({ id: procedureCaseExecutions.id });
    touchedExecutionIds.push(execution.id);

    try {
      const result = await softDeleteProcedureTemplate({
        templateId: template.id,
        actorUserId: adminId,
        reason: null,
      });
      assert.equal(result.ok, false, "실제 수리 작업의 기록이 달린 판본이 사라지면 안 된다");
      if (!result.ok) {
        assert.equal(result.code, "CONFLICT");
        assert.match(result.message, /수행 기록/);
      }
      assert.equal((await readTemplate(template.id)).isDeleted, false);
    } finally {
      // 🔴 남의 수리 건에 꽂은 줄이다 — 단언이 깨져도 반드시 치운다.
      await db.delete(procedureCaseExecutions).where(eq(procedureCaseExecutions.id, execution.id));
    }
  });

  test("🔴 후속 버전이 이어받은 초안도 못 버린다 — 버리는 길에도 같은 참조 검사가 돈다", async () => {
    const draft = await createTestTemplate("DISCARD-SUPERSEDED-DRAFT");
    const successor = await createTestTemplate("DISCARD-SUPERSEDED-NEXT");
    await db
      .update(procedureTemplates)
      .set({ supersedesTemplateId: draft.id })
      .where(eq(procedureTemplates.id, successor.id));

    const result = await softDeleteProcedureTemplate({
      templateId: draft.id,
      actorUserId: adminId,
      reason: null,
      requireStatus: "DRAFT",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "CONFLICT");
      assert.match(result.message, /후속 버전/);
    }
    assert.equal((await readTemplate(draft.id)).isDeleted, false);

    await db
      .update(procedureTemplates)
      .set({ supersedesTemplateId: null })
      .where(eq(procedureTemplates.id, successor.id));
  });

  test("🔵 초안은 버려진다 — 부속물은 그대로 따라가고 게시본은 남는다", async () => {
    const template = await publishedTemplateWithLayout("DISCARD-DRAFT-OK");
    const draft = await createNewDraftVersion(template.id, adminId);
    assert.equal(draft.ok, true, `draft failed: ${JSON.stringify(draft)}`);
    if (!draft.ok) return;
    touchedTemplateIds.push(draft.id);

    const result = await softDeleteProcedureTemplate({
      templateId: draft.id,
      actorUserId: adminId,
      reason: null,
      requireStatus: "DRAFT",
    });
    assert.equal(result.ok, true, `discard failed: ${JSON.stringify(result)}`);

    assert.equal((await readTemplate(draft.id)).isDeleted, true);
    assert.equal((await readTemplate(template.id)).isDeleted, false, "게시본은 그대로 남아야 한다");
    assert.equal((await readTemplate(template.id)).status, "PUBLISHED");

    // 노드·연결선은 소프트 삭제 단계에서 건드리지 않는다 — 복원이 그대로 되살린다.
    const layout = await readLayout(draft.id);
    assert.equal(layout.positions.length, 2);
    assert.equal(layout.routes.length, 1);

    const trash = await listDeletedTechnicalProcedureTemplates();
    assert.ok(trash.some((row) => row.id === draft.id), "버린 초안이 휴지통에 보여야 복원할 수 있다");
  });
});

describe("줄기 B-⑥ 나 — 버린 뒤에도 다시 만들 수 있다(되돌릴 수 있는 일로 만드는 것)", () => {
  test("🔴 버린 판 번호를 다시 쓰지 않는다 — 다음 번호로 만들어지고 유니크 위반으로 안 터진다", async () => {
    const template = await publishedTemplateWithLayout("REMAKE-AFTER-DISCARD");
    assert.equal((await readTemplate(template.id)).version, 1, "표본 확인 — 게시본이 v1 이어야 아래 번호가 뜻을 갖는다");

    const first = await createNewDraftVersion(template.id, adminId);
    assert.equal(first.ok, true, `first draft failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    touchedTemplateIds.push(first.id);
    assert.equal((await readTemplate(first.id)).version, 2);

    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: first.id, actorUserId: adminId, reason: null, requireStatus: "DRAFT" })).ok,
      true
    );
    // 🔴 버린 행은 **여전히 (code, 2) 자리를 차지한다** — 이것이 이 시험의 전제다.
    const trashed = await readTemplate(first.id);
    assert.equal(trashed.isDeleted, true);
    assert.equal(trashed.version, 2);

    const second = await createNewDraftVersion(template.id, adminId);
    assert.equal(
      second.ok,
      true,
      `버린 뒤 새 초안을 못 만들면 "되돌릴 수 있다"가 거짓말이 된다: ${JSON.stringify(second)}`
    );
    if (!second.ok) return;
    touchedTemplateIds.push(second.id);

    const remade = await readTemplate(second.id);
    assert.equal(remade.version, 3, "휴지통이 쥐고 있는 2 를 건너뛰고 다음 번호여야 한다");
    assert.equal(remade.status, "DRAFT");
    assert.equal(remade.supersedesTemplateId, template.id, "부모는 여전히 게시본이다");
  });

  test("🔴 다시 만든 초안도 자리 값·경로점을 그대로 물려받는다 — 줄기 B-⑤ 를 안 깼다", async () => {
    const template = await publishedTemplateWithLayout("REMAKE-KEEPS-LAYOUT");
    // 🔵 표본 확인 — 부모가 실제로 그 값을 들고 있어야 아래 비교가 공짜로 통과하지 않는다.
    const parentLayout = await readLayout(template.id);
    assert.deepEqual(parentLayout.positions, [[11, 22], [33, 44]]);
    assert.deepEqual(parentLayout.routes, [[{ x: 7, y: 8 }]]);

    const first = await createNewDraftVersion(template.id, adminId);
    assert.equal(first.ok, true, `first draft failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    touchedTemplateIds.push(first.id);
    assert.deepEqual(await readLayout(first.id), parentLayout);

    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: first.id, actorUserId: adminId, reason: null, requireStatus: "DRAFT" })).ok,
      true
    );

    const second = await createNewDraftVersion(template.id, adminId);
    assert.equal(second.ok, true, `second draft failed: ${JSON.stringify(second)}`);
    if (!second.ok) return;
    touchedTemplateIds.push(second.id);
    assert.deepEqual(
      await readLayout(second.id),
      parentLayout,
      "판 번호를 세는 방식을 바꾸면서 복제 목록을 건드리면 배치가 통째로 사라진다"
    );
  });
});

/**
 * ============================================================================
 * 줄기 B-⑦ — 복원이 초안을 겹치게 하지 않는다
 * ============================================================================
 * 🔴 **개발 DB 에서 실제로 난 일이다.** 한 줄기(`기본 통전 검사 (3상 입력)`)에
 * 살아 있는 DRAFT 가 둘이었고, 두 행이 78초 차이로 만들어져 있었다. 길은 이것뿐
 * 이다:
 *
 *   v1 게시 → 새 초안 v2 → v2 를 [초안 버리기] → 다시 새 초안 v3
 *   → 휴지통에서 v2 를 [복원]  ⇒ v2·v3 가 둘 다 살아 있다
 *
 * createNewDraftVersion 은 "이미 진행 중인 초안이 있다"로 막지만 **버린 초안은
 * 일부러 안 센다**(목록에 안 보이는 행이 새 초안 만들기를 막으면 안 된다). 그
 * 판단은 그대로 옳고, 세는 줄이 한 줄도 없던 쪽은 복원이었다.
 *
 * 🔴 줄기 B-⑥ 이 이 구멍을 **넓혔다**. 판 번호를 "아직 안 쓴 다음 번호"로 바꾸기
 * 전에는 셋째 걸음(다시 새 초안)이 유니크 위반으로 터져 애초에 성립하지 않았다.
 * 그래서 이 시험들은 B-⑥ 의 길을 **그대로 걸어서** 겹침을 만들어 본다.
 *
 * 🔴 막는 것은 **초안뿐이다.** 게시본·보관본이 한 줄기에 여럿인 것은 판 이력
 * 그 자체라, 거기까지 막으면 멀쩡한 복원이 죽는다 — 아래 둘이 그 울타리다.
 * ============================================================================
 */

/**
 * 같은 줄기(code)에 판 하나를 더 꽂는다. 판 번호와 상태를 시험이 직접 정한다 —
 * createNewDraftVersion 으로는 만들 수 없는 모양(살아 있는 초안 옆의 보관본
 * 같은 것)이 필요해서다. 부모(supersedes)는 매지 않는다: 매면 참조 검사에
 * 걸려 그 판을 휴지통에 넣을 수조차 없다.
 */
async function addVersionToLine(
  code: string,
  version: number,
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
) {
  const [row] = await db
    .insert(procedureTemplates)
    .values({
      code,
      name: `테스트 절차 ${code} v${version}`,
      equipmentType: "RFG",
      category: "TECHNICAL_TASK",
      isReferenceOnly: false,
      sourceType: "MANUAL",
      createdByUserId: adminId,
      version,
      status,
    })
    .returning();
  touchedTemplateIds.push(row.id);
  return row;
}

/** 그 줄기에 **살아 있는** 초안들. 표본 확인에 쓴다. */
async function liveDraftIdsOf(code: string): Promise<string[]> {
  const rows = await db
    .select({ id: procedureTemplates.id })
    .from(procedureTemplates)
    .where(
      and(
        eq(procedureTemplates.code, code),
        eq(procedureTemplates.status, "DRAFT"),
        eq(procedureTemplates.isDeleted, false)
      )
    );
  return rows.map((row) => row.id);
}

describe("줄기 B-⑦ 가 — 복원이 초안을 겹치게 하지 않는다", () => {
  test("🔴 실제로 난 길을 그대로 걸으면 복원이 막힌다 — 그리고 **그 초안의 id** 가 함께 온다", async () => {
    const template = await publishedTemplateWithLayout("RESTORE-OVERLAP");

    const first = await createNewDraftVersion(template.id, adminId);
    assert.equal(first.ok, true, `first draft failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    touchedTemplateIds.push(first.id);

    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: first.id, actorUserId: adminId, reason: null, requireStatus: "DRAFT" })).ok,
      true
    );

    const second = await createNewDraftVersion(template.id, adminId);
    assert.equal(second.ok, true, `second draft failed: ${JSON.stringify(second)}`);
    if (!second.ok) return;
    touchedTemplateIds.push(second.id);

    // 🔵 표본 확인 — 복원하기 **직전에** 살아 있는 초안이 정확히 하나여야,
    //    아래 단언이 "어느 초안이든 맞다"로 흐려지지 않는다.
    assert.deepEqual(await liveDraftIdsOf(template.code), [second.id]);
    assert.equal((await readTemplate(second.id)).version, 3, "표본 확인 — 글에 실릴 판 번호다");

    const restored = await restoreProcedureTemplate({ templateId: first.id, actorUserId: adminId });
    assert.equal(restored.ok, false, "🔴 복원이 통과하면 한 줄기에 살아 있는 초안이 둘이 된다");
    if (restored.ok) return;
    assert.equal(restored.code, "CONFLICT");
    assert.match(restored.message, /이미 진행 중인 초안\(v3\)/, "어느 초안이 막고 있는지를 글에도 적어야 한다 — 휴지통 창은 글만 그린다");
    assert.equal(
      restored.existingDraftId,
      second.id,
      "막기만 하고 어디 있는지 안 알려 주면 사람이 같은 이름의 판을 목록에서 손으로 찾아야 한다"
    );

    // 막힌 복원은 **아무것도 안 바꾼다.**
    assert.equal((await readTemplate(first.id)).isDeleted, true);
    assert.deepEqual(await liveDraftIdsOf(template.code), [second.id]);
  });

  test("🔵 막는 것은 겹칠 때뿐이다 — 살아 있는 초안을 치우면 같은 행이 그대로 돌아온다", async () => {
    const template = await publishedTemplateWithLayout("RESTORE-OVERLAP-CLEARED");

    const first = await createNewDraftVersion(template.id, adminId);
    assert.equal(first.ok, true, `first draft failed: ${JSON.stringify(first)}`);
    if (!first.ok) return;
    touchedTemplateIds.push(first.id);
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: first.id, actorUserId: adminId, reason: null, requireStatus: "DRAFT" })).ok,
      true
    );

    const second = await createNewDraftVersion(template.id, adminId);
    assert.equal(second.ok, true, `second draft failed: ${JSON.stringify(second)}`);
    if (!second.ok) return;
    touchedTemplateIds.push(second.id);
    assert.equal((await restoreProcedureTemplate({ templateId: first.id, actorUserId: adminId })).ok, false, "표본 확인 — 지금은 막혀 있어야 한다");

    // 살아 있는 초안을 치운다 → 막을 까닭이 사라진다.
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: second.id, actorUserId: adminId, reason: null, requireStatus: "DRAFT" })).ok,
      true
    );
    assert.deepEqual(await liveDraftIdsOf(template.code), []);

    const restored = await restoreProcedureTemplate({ templateId: first.id, actorUserId: adminId });
    assert.equal(restored.ok, true, `복원을 영영 막으면 휴지통이 쓸모없어진다: ${JSON.stringify(restored)}`);
    assert.deepEqual(await liveDraftIdsOf(template.code), [first.id]);
  });

  test("🔴 게시본 복원은 살아 있는 초안이 있어도 그대로 된다 — 이 검사는 초안에만 건다", async () => {
    const base = await createTestTemplate("RESTORE-PUBLISHED-OK");
    assert.equal((await publishProcedureTemplate(base.id, adminId)).ok, true);
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: base.id, actorUserId: adminId, reason: null })).ok,
      true
    );

    const live = await addVersionToLine(base.code, 2, "DRAFT");
    // 🔵 표본 확인 — 살아 있는 초안이 **실제로 있다.** 없으면 이 시험은
    //    "막는 조건이 아예 안 걸렸다"를 모르고 공짜로 통과한다.
    assert.deepEqual(await liveDraftIdsOf(base.code), [live.id]);
    assert.equal((await readTemplate(base.id)).status, "PUBLISHED");

    const restored = await restoreProcedureTemplate({ templateId: base.id, actorUserId: adminId });
    assert.equal(restored.ok, true, `게시본 복원까지 막으면 멀쩡한 복원이 죽는다: ${JSON.stringify(restored)}`);
    const back = await readTemplate(base.id);
    assert.equal(back.isDeleted, false);
    assert.equal(back.status, "PUBLISHED");
  });

  test("🔴 보관본 복원도 그대로 된다", async () => {
    const base = await createTestTemplate("RESTORE-ARCHIVED-OK");
    await db.update(procedureTemplates).set({ status: "ARCHIVED" }).where(eq(procedureTemplates.id, base.id));
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: base.id, actorUserId: adminId, reason: null })).ok,
      true
    );

    const live = await addVersionToLine(base.code, 2, "DRAFT");
    assert.deepEqual(await liveDraftIdsOf(base.code), [live.id]);

    const restored = await restoreProcedureTemplate({ templateId: base.id, actorUserId: adminId });
    assert.equal(restored.ok, true, `보관본 복원까지 막으면 멀쩡한 복원이 죽는다: ${JSON.stringify(restored)}`);
    assert.equal((await readTemplate(base.id)).status, "ARCHIVED");
  });

  test("🔴 일괄 복원 — 한 건이 막혀도 나머지는 돌아온다", async () => {
    // restoreProcedureTemplatesAction 은 runEach 로 **한 건씩 순서대로, 건마다
    // 제 트랜잭션**을 돌린다(그 모양을 안 바꿨다는 것은
    // procedure-structural-save-notice.test.ts 가 원본 글자로 지킨다). 여기서는
    // 그 순서를 그대로 밟아 **DB 가 실제로 어떻게 답하는지**를 잰다.
    const base = await createTestTemplate("RESTORE-BULK-MIXED");
    assert.equal((await publishProcedureTemplate(base.id, adminId)).ok, true);

    const trashedDraft = await addVersionToLine(base.code, 2, "DRAFT");
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: trashedDraft.id, actorUserId: adminId, reason: null })).ok,
      true
    );
    const live = await addVersionToLine(base.code, 3, "DRAFT");
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: base.id, actorUserId: adminId, reason: null })).ok,
      true
    );

    // 🔵 표본 확인 — 휴지통에 둘(초안 v2 · 게시본 v1), 살아 있는 초안은 v3 하나.
    assert.deepEqual(await liveDraftIdsOf(base.code), [live.id]);
    assert.equal((await readTemplate(trashedDraft.id)).isDeleted, true);
    assert.equal((await readTemplate(base.id)).isDeleted, true);

    const results = [];
    for (const id of [trashedDraft.id, base.id]) {
      results.push(await restoreProcedureTemplate({ templateId: id, actorUserId: adminId }));
    }

    assert.equal(results[0].ok, false, "초안은 막혀야 한다");
    assert.equal(
      results[1].ok,
      true,
      `막힌 건이 뒤 건을 멈추면 "둘 골라 복원"이 한 건 때문에 통째로 실패한다: ${JSON.stringify(results[1])}`
    );
    assert.equal((await readTemplate(trashedDraft.id)).isDeleted, true);
    assert.equal((await readTemplate(base.id)).isDeleted, false);
  });

  test("🔴 일괄 복원 — 같은 줄기의 초안 둘을 한 번에 고르면 첫째만 살아난다", async () => {
    const base = await createTestTemplate("RESTORE-BULK-TWO-DRAFTS");
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: base.id, actorUserId: adminId, reason: null })).ok,
      true
    );
    const other = await addVersionToLine(base.code, 2, "DRAFT");
    assert.equal(
      (await softDeleteProcedureTemplate({ templateId: other.id, actorUserId: adminId, reason: null })).ok,
      true
    );

    // 🔵 표본 확인 — 지금은 살아 있는 초안이 **하나도 없다.** 그래서 첫째는
    //    반드시 통과해야 하고, 둘째가 막히는 까닭은 오직 첫째 때문이다.
    assert.deepEqual(await liveDraftIdsOf(base.code), []);

    const firstResult = await restoreProcedureTemplate({ templateId: base.id, actorUserId: adminId });
    assert.equal(firstResult.ok, true, `첫째가 막히면 이 시험은 아무것도 안 재고 있다: ${JSON.stringify(firstResult)}`);

    const secondResult = await restoreProcedureTemplate({ templateId: other.id, actorUserId: adminId });
    assert.equal(secondResult.ok, false, "건마다 제 트랜잭션이라 둘째는 첫째가 커밋한 결과를 본다");
    if (secondResult.ok) return;
    assert.equal(secondResult.code, "CONFLICT");
    assert.equal(secondResult.existingDraftId, base.id);
    assert.deepEqual(await liveDraftIdsOf(base.code), [base.id]);
  });
});
