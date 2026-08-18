import "../../../../scripts/load-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { users, workflowSteps, workflowTemplates, workflowTransitions, workflowVersions } from "../schema";
import { createWorkflowDraft, discardWorkflowDraft, findWorkflowDraft } from "./workflow-drafts";
import {
  addWorkflowDraftStep,
  removeWorkflowDraftStep,
  reorderWorkflowDraftSteps,
  updateWorkflowDraftStep,
} from "./workflow-draft-steps";

/**
 * 단계 편집은 초안에서만 되어야 하고(발행본은 불변), 순서 재배치가 유니크
 * 인덱스에 걸리지 않아야 하며, 단계를 지울 때 그 단계를 오가는 이동 규칙이
 * 함께 정리되어야 한다. 셋 다 조용히 실패하면 발행 시점에야 드러난다.
 *
 * 대상은 WARRANTY_MATCHER 하나로 고정하고, 매 테스트마다 새 초안을 만들어
 * 끝나면 폐기한다 — 이 DB의 다른 통합 테스트가 워크플로 구성에 의존한다.
 */

const TEMPLATE_CODE = "WARRANTY_MATCHER";

let adminId: string;
let salesId: string;
let draftId: string;

before(async () => {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(admin);
  adminId = admin.id;

  const [sales] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "SALES"), eq(users.approvalStatus, "APPROVED"), eq(users.isDeleted, false)))
    .limit(1);
  assert.ok(sales);
  salesId = sales.id;
});

beforeEach(async () => {
  const existing = await findWorkflowDraft(TEMPLATE_CODE);
  if (existing) await discardWorkflowDraft({ versionId: existing.id, actorUserId: adminId });
  const created = await createWorkflowDraft({ templateCode: TEMPLATE_CODE, actorUserId: adminId });
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) throw new Error("unreachable");
  draftId = created.versionId;
});

after(async () => {
  const existing = await findWorkflowDraft(TEMPLATE_CODE);
  if (existing) await discardWorkflowDraft({ versionId: existing.id, actorUserId: adminId });
  await pgClient.end({ timeout: 5 });
});

async function stepsOf(versionId: string) {
  return db
    .select({
      id: workflowSteps.id,
      key: workflowSteps.key,
      label: workflowSteps.label,
      order: workflowSteps.stepOrder,
      status: workflowSteps.repairStatus,
      category: workflowSteps.category,
      isActive: workflowSteps.isActive,
    })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, versionId))
    .orderBy(asc(workflowSteps.stepOrder));
}

describe("workflow draft steps", () => {
  test("단계를 맨 뒤에 추가한다", async () => {
    const before = await stepsOf(draftId);
    const result = await addWorkflowDraftStep({
      versionId: draftId,
      key: "extra_check",
      label: "추가 점검",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: adminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    const after = await stepsOf(draftId);
    assert.equal(after.length, before.length + 1);
    const added = after.find((s) => s.key === "extra_check");
    assert.ok(added);
    assert.equal(added.order, Math.max(...before.map((s) => s.order)) + 1, "맨 뒤에 붙어야 한다");
    assert.equal(added.label, "추가 점검");
    assert.equal(added.isActive, true);
  });

  test("같은 키의 단계는 두 번 만들 수 없다", async () => {
    const existing = (await stepsOf(draftId))[0];
    const result = await addWorkflowDraftStep({
      versionId: draftId,
      key: existing.key,
      label: "중복",
      status: "IN_REPAIR",
      category: null,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DUPLICATE_KEY");
  });

  test("단계 키 형식을 검사한다", async () => {
    for (const key of ["Extra", "1step", "has space", "has-dash", ""]) {
      const result = await addWorkflowDraftStep({
        versionId: draftId,
        key,
        label: "x",
        status: "IN_REPAIR",
        category: null,
        actorUserId: adminId,
      });
      assert.equal(result.ok, false, `"${key}"는 거부되어야 한다`);
      if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
    }
  });

  test("이름·상태·분류·활성 여부를 바꾼다", async () => {
    const target = (await stepsOf(draftId)).find((s) => s.key === "intake_inspection");
    assert.ok(target);
    const result = await updateWorkflowDraftStep({
      stepId: target.id,
      actorUserId: adminId,
      label: "인수점검(수정)",
      status: "WAITING_PARTS_SUPPLY",
      category: "PARTS_SHIPMENT",
      isActive: false,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const updated = (await stepsOf(draftId)).find((s) => s.id === target.id);
    assert.ok(updated);
    assert.equal(updated.label, "인수점검(수정)");
    assert.equal(updated.status, "WAITING_PARTS_SUPPLY");
    assert.equal(updated.category, "PARTS_SHIPMENT");
    assert.equal(updated.isActive, false);
    assert.equal(updated.key, "intake_inspection", "키는 바뀌지 않아야 한다");
  });

  test("순서를 뒤집어도 유니크 인덱스에 걸리지 않는다", async () => {
    // 개별 UPDATE로 맞바꾸면 중간 상태에서 (버전, 순서)가 충돌한다.
    const before = await stepsOf(draftId);
    const reversed = [...before].reverse().map((s) => s.id);

    const result = await reorderWorkflowDraftSteps({
      versionId: draftId,
      orderedStepIds: reversed,
      actorUserId: adminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const after = await stepsOf(draftId);
    assert.deepEqual(
      after.map((s) => s.id),
      reversed,
      "요청한 순서대로 정렬되어야 한다"
    );
    assert.deepEqual(
      after.map((s) => s.order),
      after.map((_, i) => i + 1),
      "순서가 1부터 촘촘히 다시 매겨져야 한다"
    );
  });

  test("일부 단계만 담은 순서 목록은 거부한다", async () => {
    const before = await stepsOf(draftId);
    const result = await reorderWorkflowDraftSteps({
      versionId: draftId,
      orderedStepIds: before.slice(0, 2).map((s) => s.id),
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");

    const after = await stepsOf(draftId);
    assert.deepEqual(after.map((s) => s.id), before.map((s) => s.id), "거부됐으면 순서가 그대로여야 한다");
  });

  test("단계를 지우면 그 단계를 오가는 이동 규칙도 함께 사라진다", async () => {
    const steps = await stepsOf(draftId);
    const target = steps.find((s) => s.key === "waiting_kyosan_reply") ?? steps[2];
    assert.ok(target);

    const relatedBefore = await db
      .select({ id: workflowTransitions.id })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, draftId));
    const relatedCount = relatedBefore.length;

    const result = await removeWorkflowDraftStep({ stepId: target.id, actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.ok(result.removedTransitions > 0, "그 단계를 오가는 규칙이 있었어야 한다");

    const remaining = await stepsOf(draftId);
    assert.equal(remaining.some((s) => s.id === target.id), false);

    const relatedAfter = await db
      .select({ fromStepId: workflowTransitions.fromStepId, toStepId: workflowTransitions.toStepId })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, draftId));
    assert.equal(relatedAfter.length, relatedCount - result.removedTransitions);
    assert.equal(
      relatedAfter.some((t) => t.fromStepId === target.id || t.toStepId === target.id),
      false,
      "없는 단계를 가리키는 규칙이 남으면 안 된다"
    );
  });

  test("발행된 버전의 단계는 편집할 수 없다", async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(and(eq(workflowTemplates.code, TEMPLATE_CODE), eq(workflowVersions.isCurrent, true)));
    const [publishedStep] = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, current.id))
      .limit(1);

    const updated = await updateWorkflowDraftStep({ stepId: publishedStep.id, actorUserId: adminId, label: "몰래 수정" });
    assert.equal(updated.ok, false);
    if (!updated.ok) assert.equal(updated.code, "NOT_A_DRAFT");

    const removed = await removeWorkflowDraftStep({ stepId: publishedStep.id, actorUserId: adminId });
    assert.equal(removed.ok, false);
    if (!removed.ok) assert.equal(removed.code, "NOT_A_DRAFT");

    const added = await addWorkflowDraftStep({
      versionId: current.id,
      key: "sneaky",
      label: "몰래 추가",
      status: "IN_REPAIR",
      category: null,
      actorUserId: adminId,
    });
    assert.equal(added.ok, false);
    if (!added.ok) assert.equal(added.code, "NOT_A_DRAFT");
  });

  test("영업 담당자는 단계를 편집할 수 없다", async () => {
    const target = (await stepsOf(draftId))[0];
    const result = await updateWorkflowDraftStep({ stepId: target.id, actorUserId: salesId, label: "x" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});
