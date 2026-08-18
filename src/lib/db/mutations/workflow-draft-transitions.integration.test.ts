import "../../../../scripts/load-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { db, pgClient } from "../connection";
import { users, workflowSteps, workflowTemplates, workflowTransitions, workflowVersions } from "../schema";
import { createWorkflowDraft, discardWorkflowDraft, findWorkflowDraft } from "./workflow-drafts";
import { addWorkflowDraftStep } from "./workflow-draft-steps";
import { removeWorkflowDraftTransition, upsertWorkflowDraftTransition } from "./workflow-draft-transitions";

/**
 * 이동 규칙 편집은 "새로 추가한 단계로 가는 길"을 만드는 기능이다. 그 길이
 * 잘못 놓이면(다른 버전의 단계를 가리키거나, 아무도 못 하는 규칙이거나, 같은
 * 출발점에 규칙이 둘이거나) 발행 후에야 드러난다.
 */

const TEMPLATE_CODE = "PAID_TOTAL_CONTROLLER";

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
    .select({ id: workflowSteps.id, key: workflowSteps.key })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, versionId))
    .orderBy(asc(workflowSteps.stepOrder));
}

describe("workflow draft transitions", () => {
  test("새로 추가한 단계로 가는 길을 만들 수 있다", async () => {
    const added = await addWorkflowDraftStep({
      versionId: draftId,
      key: "final_review",
      label: "최종 검토",
      status: "IN_REPAIR",
      category: "TECHNICAL",
      actorUserId: adminId,
    });
    assert.equal(added.ok, true);
    if (!added.ok) return;

    const steps = await stepsOf(draftId);
    const intake = steps.find((s) => s.key === "intake_inspection");
    assert.ok(intake);

    const result = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_RETURNED",
      fromStepId: added.stepId,
      toStepId: intake.id,
      allowedRoles: ["SUPER_ADMIN", "ADMIN", "AS_ENGINEER"],
      requiresAssignedEngineer: true,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [saved] = await db
      .select()
      .from(workflowTransitions)
      .where(
        and(
          eq(workflowTransitions.workflowVersionId, draftId),
          eq(workflowTransitions.fromStepId, added.stepId)
        )
      );
    assert.ok(saved);
    assert.equal(saved.toStepId, intake.id);
    assert.deepEqual([...saved.allowedRoles].sort(), ["ADMIN", "AS_ENGINEER", "SUPER_ADMIN"]);
    assert.equal(saved.requiresAssignedEngineer, true);
    assert.equal(saved.requiresReason, false);
    assert.equal(saved.requiredApprovalType, null);
  });

  test("같은 (동작, 출발 단계)에 다시 저장하면 새로 만들지 않고 갱신한다", async () => {
    const steps = await stepsOf(draftId);
    const from = steps[1];
    const firstTarget = steps[2];
    const secondTarget = steps[3];

    const first = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_ADVANCED",
      fromStepId: from.id,
      toStepId: firstTarget.id,
      allowedRoles: ["ADMIN"],
      requiresAssignedEngineer: false,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_ADVANCED",
      fromStepId: from.id,
      toStepId: secondTarget.id,
      allowedRoles: ["ADMIN", "SALES"],
      requiresAssignedEngineer: false,
      requiresReason: true,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.equal(second.transitionId, first.transitionId, "행이 늘어나면 안 된다 — 유니크 키가 같다");

    const rows = await db
      .select({ toStepId: workflowTransitions.toStepId, requiresReason: workflowTransitions.requiresReason })
      .from(workflowTransitions)
      .where(
        and(
          eq(workflowTransitions.workflowVersionId, draftId),
          eq(workflowTransitions.actionCode, "STEP_ADVANCED"),
          eq(workflowTransitions.fromStepId, from.id)
        )
      );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].toStepId, secondTarget.id);
    assert.equal(rows[0].requiresReason, true);
  });

  test("역할을 하나도 고르지 않으면 거부한다", async () => {
    const steps = await stepsOf(draftId);
    const result = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_ADVANCED",
      fromStepId: steps[0].id,
      toStepId: steps[1].id,
      allowedRoles: [],
      requiresAssignedEngineer: false,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false, "아무도 할 수 없는 이동은 존재할 이유가 없다");
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("같은 단계로 되돌아오는 규칙을 거부한다", async () => {
    const steps = await stepsOf(draftId);
    const result = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_ADVANCED",
      fromStepId: steps[0].id,
      toStepId: steps[0].id,
      allowedRoles: ["ADMIN"],
      requiresAssignedEngineer: false,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_INPUT");
  });

  test("다른 버전의 단계를 가리키는 규칙을 거부한다", async () => {
    // FK만으로는 못 막는다 — 그런 규칙이 생기면 접수 건이 자기 워크플로 밖의
    // 단계로 이동한다.
    const steps = await stepsOf(draftId);
    const [otherVersion] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(and(eq(workflowTemplates.code, "PAID_GENERATOR"), eq(workflowVersions.isCurrent, true)));
    const [foreignStep] = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, otherVersion.id))
      .limit(1);

    const result = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_ADVANCED",
      fromStepId: steps[0].id,
      toStepId: foreignStep.id,
      allowedRoles: ["ADMIN"],
      requiresAssignedEngineer: false,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "STEP_VERSION_MISMATCH");
  });

  test("규칙을 삭제한다", async () => {
    const steps = await stepsOf(draftId);
    const [existing] = await db
      .select({ id: workflowTransitions.id })
      .from(workflowTransitions)
      .where(and(eq(workflowTransitions.workflowVersionId, draftId), eq(workflowTransitions.fromStepId, steps[1].id)))
      .limit(1);
    assert.ok(existing, "복제된 초안에 규칙이 있어야 한다");

    const result = await removeWorkflowDraftTransition({ transitionId: existing.id, actorUserId: adminId });
    assert.equal(result.ok, true, JSON.stringify(result));

    const [gone] = await db
      .select({ id: workflowTransitions.id })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.id, existing.id));
    assert.equal(gone, undefined);
  });

  test("발행된 버전의 규칙은 편집할 수 없다", async () => {
    const [current] = await db
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(and(eq(workflowTemplates.code, TEMPLATE_CODE), eq(workflowVersions.isCurrent, true)));
    const publishedSteps = await stepsOf(current.id);

    const upserted = await upsertWorkflowDraftTransition({
      versionId: current.id,
      actionCode: "STEP_ADVANCED",
      fromStepId: publishedSteps[0].id,
      toStepId: publishedSteps[1].id,
      allowedRoles: ["ADMIN"],
      requiresAssignedEngineer: false,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: adminId,
    });
    assert.equal(upserted.ok, false);
    if (!upserted.ok) assert.equal(upserted.code, "NOT_A_DRAFT");

    const [publishedTransition] = await db
      .select({ id: workflowTransitions.id })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, current.id))
      .limit(1);
    const removed = await removeWorkflowDraftTransition({
      transitionId: publishedTransition.id,
      actorUserId: adminId,
    });
    assert.equal(removed.ok, false);
    if (!removed.ok) assert.equal(removed.code, "NOT_A_DRAFT");
  });

  test("영업 담당자는 규칙을 편집할 수 없다", async () => {
    const steps = await stepsOf(draftId);
    const result = await upsertWorkflowDraftTransition({
      versionId: draftId,
      actionCode: "STEP_ADVANCED",
      fromStepId: steps[0].id,
      toStepId: steps[1].id,
      allowedRoles: ["ADMIN"],
      requiresAssignedEngineer: false,
      requiresReason: false,
      requiredApprovalType: null,
      actorUserId: salesId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FORBIDDEN");
  });
});
