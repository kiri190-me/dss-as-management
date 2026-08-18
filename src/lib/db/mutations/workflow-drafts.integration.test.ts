import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import {
  users,
  workflowSteps,
  workflowTemplates,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import {
  createWorkflowDraft,
  discardWorkflowDraft,
  findWorkflowDraft,
  publishWorkflowDraft,
} from "./workflow-drafts";

/**
 * 발행은 이 프로젝트에서 가장 위험한 쓰기다 — 잘못 나가면 그 워크플로의 접수
 * 건이 전부 멈춘다. 그래서 "되는 경로"보다 **막혀야 할 경로**를 더 촘촘히
 * 고정한다.
 *
 * 대상 워크플로는 WARRANTY_TOTAL_CONTROLLER 하나로 고정한다. 각 테스트는 자기가
 * 만든 초안을 정리하며, 발행 테스트는 원래 발행본을 다시 current로 되돌린다 —
 * 이 DB의 다른 통합 테스트가 워크플로 구성에 의존하기 때문이다.
 */

const TEMPLATE_CODE = "WARRANTY_TOTAL_CONTROLLER";

let adminId: string;
let salesId: string;
let templateId: string;
let originalCurrentVersionId: string;
const createdVersionIds: string[] = [];

before(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(admin, "승인된 SUPER_ADMIN이 필요합니다");
  adminId = admin.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales, "승인된 SALES가 필요합니다");
  salesId = sales.id;

  const [template] = await db
    .select({ id: workflowTemplates.id })
    .from(workflowTemplates)
    .where(eq(workflowTemplates.code, TEMPLATE_CODE));
  assert.ok(template);
  templateId = template.id;

  const [current] = await db
    .select({ id: workflowVersions.id })
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
  assert.ok(current, "현재 발행 버전이 있어야 합니다");
  originalCurrentVersionId = current.id;
});

after(async () => {
  // 이 테스트가 만든 버전을 전부 지우고, 원래 발행본을 current로 되돌린다.
  for (const id of createdVersionIds) {
    await db.delete(workflowTransitions).where(eq(workflowTransitions.workflowVersionId, id));
    await db.delete(workflowSteps).where(eq(workflowSteps.workflowVersionId, id));
  }
  if (createdVersionIds.length > 0) {
    await db.delete(workflowVersions).where(inArray(workflowVersions.id, createdVersionIds));
  }
  await db
    .update(workflowVersions)
    .set({ status: "PUBLISHED", isCurrent: true })
    .where(eq(workflowVersions.id, originalCurrentVersionId));
  await pgClient.end({ timeout: 5 });
});

async function makeDraft() {
  const result = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: adminId });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("unreachable");
  createdVersionIds.push(result.versionId);
  return result;
}

describe("workflow drafts", () => {
  test("초안 생성: 현재 발행본의 단계와 이동 규칙을 그대로 복제한다", async () => {
    const [sourceStepCount] = await db
      .select({ n: workflowSteps.id })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, originalCurrentVersionId))
      .limit(1);
    assert.ok(sourceStepCount, "원본에 단계가 있어야 한다");

    const sourceSteps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, originalCurrentVersionId));
    const sourceTransitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, originalCurrentVersionId));

    const draft = await makeDraft();

    const draftSteps = await db.select().from(workflowSteps).where(eq(workflowSteps.workflowVersionId, draft.versionId));
    const draftTransitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, draft.versionId));

    assert.equal(draftSteps.length, sourceSteps.length, "단계 수가 같아야 한다");
    assert.equal(draftTransitions.length, sourceTransitions.length, "이동 규칙 수가 같아야 한다");
    assert.deepEqual(
      draftSteps.map((s) => `${s.key}:${s.stepOrder}:${s.repairStatus}:${s.category}:${s.isActive}`).sort(),
      sourceSteps.map((s) => `${s.key}:${s.stepOrder}:${s.repairStatus}:${s.category}:${s.isActive}`).sort(),
      "단계의 내용까지 같아야 한다 — 편집자는 지금 돌아가는 그대로에서 시작해야 한다"
    );

    // 복제본은 원본과 다른 행이어야 한다(같은 행을 가리키면 초안 편집이 발행본을 바꾼다).
    const sourceIds = new Set(sourceSteps.map((s) => s.id));
    assert.equal(draftSteps.some((s) => sourceIds.has(s.id)), false);
  });

  test("초안은 템플릿당 하나만 만들 수 있다", async () => {
    // 앞 테스트가 이미 초안을 하나 만들어 두었다.
    const existing = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(existing, "이 시점에 초안이 있어야 한다");

    const second = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: adminId });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.code, "DRAFT_ALREADY_EXISTS");
  });

  test("영업 담당자는 초안을 만들 수도 발행할 수도 없다", async () => {
    const draft = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(draft);

    const created = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: salesId });
    assert.equal(created.ok, false);
    if (!created.ok) assert.equal(created.code, "FORBIDDEN");

    const published = await publishWorkflowDraft({ versionId: draft.id, actorUserId: salesId });
    assert.equal(published.ok, false);
    if (!published.ok) assert.equal(published.code, "FORBIDDEN");

    const discarded = await discardWorkflowDraft({ versionId: draft.id, actorUserId: salesId });
    assert.equal(discarded.ok, false);
    if (!discarded.ok) assert.equal(discarded.code, "FORBIDDEN");
  });

  test("구조가 깨진 초안은 발행이 거부된다", async () => {
    const draft = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(draft);

    // 신규 접수가 배치되는 단계를 지우면 A/S 접수 자체가 실패한다.
    // 전이가 먼저 참조하므로 그 전이부터 지운다.
    const [intakeStep] = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.workflowVersionId, draft.id), eq(workflowSteps.key, "intake_inspection")));
    assert.ok(intakeStep);
    await db.delete(workflowTransitions).where(eq(workflowTransitions.workflowVersionId, draft.id));
    await db.delete(workflowSteps).where(eq(workflowSteps.id, intakeStep.id));

    const result = await publishWorkflowDraft({ versionId: draft.id, actorUserId: adminId });
    assert.equal(result.ok, false, "검증을 통과하지 못해야 한다");
    if (!result.ok) {
      assert.equal(result.code, "VALIDATION_FAILED");
      assert.ok(result.issues?.some((i) => i.code === "MISSING_START_STEP"), JSON.stringify(result.issues));
    }

    // 거부됐으니 상태가 그대로여야 한다 — 실패한 발행이 절반만 적용되면 안 된다.
    const [after] = await db
      .select({ status: workflowVersions.status, isCurrent: workflowVersions.isCurrent })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, draft.id));
    assert.equal(after.status, "DRAFT");
    assert.equal(after.isCurrent, false);

    const [stillCurrent] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    assert.equal(stillCurrent.id, originalCurrentVersionId, "기존 발행본이 그대로 current여야 한다");
  });

  test("깨진 초안은 폐기할 수 있고, 폐기 후에는 새 초안을 만들 수 있다", async () => {
    const draft = await findWorkflowDraft(TEMPLATE_CODE);
    assert.ok(draft);
    const result = await discardWorkflowDraft({ versionId: draft.id, actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [gone] = await db.select({ id: workflowVersions.id }).from(workflowVersions).where(eq(workflowVersions.id, draft.id));
    assert.equal(gone, undefined, "버전 행이 남아 있으면 안 된다");
    assert.equal(await findWorkflowDraft(TEMPLATE_CODE), null);
  });

  test("정상 초안은 발행되고, 기존 발행본은 보관 상태로 내려간다", async () => {
    const draft = await makeDraft();

    const result = await publishWorkflowDraft({ versionId: draft.versionId, actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.archivedVersionId, originalCurrentVersionId);

    const [published] = await db
      .select({ status: workflowVersions.status, isCurrent: workflowVersions.isCurrent, publishedAt: workflowVersions.publishedAt })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, draft.versionId));
    assert.equal(published.status, "PUBLISHED");
    assert.equal(published.isCurrent, true);
    assert.ok(published.publishedAt, "발행 시각이 기록되어야 한다");

    const [archived] = await db
      .select({ status: workflowVersions.status, isCurrent: workflowVersions.isCurrent })
      .from(workflowVersions)
      .where(eq(workflowVersions.id, originalCurrentVersionId));
    assert.equal(archived.status, "ARCHIVED");
    assert.equal(archived.isCurrent, false);

    // 템플릿당 current는 정확히 하나여야 한다(부분 유니크 인덱스가 강제하지만,
    // 발행 순서가 잘못되면 인덱스 위반으로 트랜잭션이 통째로 실패한다).
    const currents = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    assert.equal(currents.length, 1);
  });

  test("이미 발행된 버전은 다시 발행할 수 없다", async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    const result = await publishWorkflowDraft({ versionId: current.id, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_A_DRAFT");
  });

  test("발행된 버전은 폐기할 수 없다", async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, templateId), eq(workflowVersions.isCurrent, true)));
    const result = await discardWorkflowDraft({ versionId: current.id, actorUserId: adminId });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NOT_A_DRAFT");
  });
});
