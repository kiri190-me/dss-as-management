import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { users, workflowSteps, workflowTransitions, workflowVersions } from "../schema";
import { insertAuditLog } from "./audit-logs";
import { hasPermission } from "@/lib/auth/permission-resolver";
import type { Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 초안의 이동 규칙 편집 (Phase 5)
 * ============================================================================
 * 단계 편집(Phase 4c)이 "어떤 칸이 있는가"를 정한다면, 여기는 "그 칸 사이를
 * 어떻게 오가는가"를 정한다. 단계만 추가하면 그 단계로 가는 길이 없어 발행
 * 검증이 "도달할 방법이 없습니다"로 걸리는데, 그 길을 여기서 만든다.
 *
 * (버전, 동작, 출발 단계)가 유니크하므로 저장은 자연스럽게 upsert다 — "이
 * 단계에서 진행을 누르면 어디로 가는가"는 하나뿐이고, 화면도 그 하나를 고르는
 * 형태다. 대상을 "없음"으로 두는 것이 곧 규칙 삭제다.
 *
 * 단계 편집과 마찬가지로 DRAFT에서만 동작한다.
 * ============================================================================
 */

export type DraftTransitionResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NOT_A_DRAFT"
  | "INVALID_INPUT"
  | "STEP_VERSION_MISMATCH";

export type DraftTransitionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; code: DraftTransitionResultCode; message: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireEditableDraft(
  tx: Tx,
  versionId: string,
  actorUserId: string
): Promise<{ ok: true; actorId: string } | { ok: false; code: DraftTransitionResultCode; message: string }> {
  const [actor] = await tx
    .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor.role, "workflows.editDraft", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "워크플로를 편집할 권한이 없습니다." };
  }
  const [version] = await tx
    .select({ id: workflowVersions.id, status: workflowVersions.status })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, versionId))
    .for("update");
  if (!version) return { ok: false, code: "NOT_FOUND", message: "버전을 찾을 수 없습니다." };
  if (version.status !== "DRAFT") {
    return {
      ok: false,
      code: "NOT_A_DRAFT",
      message: "발행된 버전의 이동 규칙은 변경할 수 없습니다. 새 초안을 만들어 주세요.",
    };
  }
  return { ok: true, actorId: actor.id };
}

export type UpsertDraftTransitionInput = {
  versionId: string;
  actionCode: "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED";
  fromStepId: string;
  toStepId: string;
  allowedRoles: Role[];
  requiresAssignedEngineer: boolean;
  requiresReason: boolean;
  requiredApprovalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT" | null;
  actorUserId: string;
};

export async function upsertWorkflowDraftTransition(
  input: UpsertDraftTransitionInput
): Promise<DraftTransitionResult<{ transitionId: string }>> {
  if (input.allowedRoles.length === 0) {
    // 아무도 할 수 없는 이동은 존재할 이유가 없다. DB의 체크 제약과 같은
    // 규칙이지만, 여기서 먼저 막아야 사용자에게 제약 위반 오류 대신 문장을
    // 보여 줄 수 있다.
    return { ok: false, code: "INVALID_INPUT", message: "이 이동을 할 수 있는 역할을 하나 이상 선택해 주세요." };
  }
  if (input.fromStepId === input.toStepId) {
    return { ok: false, code: "INVALID_INPUT", message: "같은 단계로 되돌아오는 이동은 만들 수 없습니다." };
  }

  return db.transaction(async (tx) => {
    const guard = await requireEditableDraft(tx, input.versionId, input.actorUserId);
    if (!guard.ok) return guard;

    // 두 단계가 모두 이 버전에 속하는지 확인한다. FK만으로는 "다른 버전의
    // 단계를 가리키는 규칙"을 막지 못하고, 그런 규칙이 생기면 접수 건이 자기
    // 워크플로 밖의 단계로 이동한다.
    const steps = await tx
      .select({ id: workflowSteps.id, key: workflowSteps.key, label: workflowSteps.label })
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, input.versionId));
    const byId = new Map(steps.map((s) => [s.id, s]));
    const from = byId.get(input.fromStepId);
    const to = byId.get(input.toStepId);
    if (!from || !to) {
      return {
        ok: false as const,
        code: "STEP_VERSION_MISMATCH" as const,
        message: "이 초안에 속하지 않은 단계를 가리키고 있습니다.",
      };
    }

    const [existing] = await tx
      .select({ id: workflowTransitions.id, toStepId: workflowTransitions.toStepId })
      .from(workflowTransitions)
      .where(
        and(
          eq(workflowTransitions.workflowVersionId, input.versionId),
          eq(workflowTransitions.actionCode, input.actionCode),
          eq(workflowTransitions.fromStepId, input.fromStepId)
        )
      );

    const values = {
      toStepId: input.toStepId,
      allowedRoles: input.allowedRoles,
      requiresAssignedEngineer: input.requiresAssignedEngineer,
      requiresReason: input.requiresReason,
      requiredApprovalType: input.requiredApprovalType,
      updatedAt: new Date(),
    };

    let transitionId: string;
    if (existing) {
      await tx.update(workflowTransitions).set(values).where(eq(workflowTransitions.id, existing.id));
      transitionId = existing.id;
    } else {
      const [created] = await tx
        .insert(workflowTransitions)
        .values({
          workflowVersionId: input.versionId,
          actionCode: input.actionCode,
          fromStepId: input.fromStepId,
          ...values,
        })
        .returning({ id: workflowTransitions.id });
      transitionId = created.id;
    }

    await insertAuditLog(tx, {
      actorUserId: guard.actorId,
      actionType: "UPDATE",
      targetEntity: "workflow_transitions",
      targetRecordId: transitionId,
      previousValue: existing ? { toStepId: existing.toStepId } : null,
      newValue: {
        versionId: input.versionId,
        actionCode: input.actionCode,
        from: from.key,
        to: to.key,
        allowedRoles: input.allowedRoles,
        requiresAssignedEngineer: input.requiresAssignedEngineer,
        requiresReason: input.requiresReason,
        requiredApprovalType: input.requiredApprovalType,
      },
    });

    return { ok: true as const, transitionId };
  });
}

export async function removeWorkflowDraftTransition(params: {
  transitionId: string;
  actorUserId: string;
}): Promise<DraftTransitionResult> {
  return db.transaction(async (tx) => {
    const [transition] = await tx
      .select({
        id: workflowTransitions.id,
        versionId: workflowTransitions.workflowVersionId,
        actionCode: workflowTransitions.actionCode,
        fromStepId: workflowTransitions.fromStepId,
        toStepId: workflowTransitions.toStepId,
      })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.id, params.transitionId));
    if (!transition) return { ok: false as const, code: "NOT_FOUND" as const, message: "이동 규칙을 찾을 수 없습니다." };

    const guard = await requireEditableDraft(tx, transition.versionId, params.actorUserId);
    if (!guard.ok) return guard;

    await tx.delete(workflowTransitions).where(eq(workflowTransitions.id, transition.id));

    await insertAuditLog(tx, {
      actorUserId: guard.actorId,
      actionType: "SOFT_DELETE",
      targetEntity: "workflow_transitions",
      targetRecordId: transition.id,
      previousValue: {
        versionId: transition.versionId,
        actionCode: transition.actionCode,
        fromStepId: transition.fromStepId,
        toStepId: transition.toStepId,
      },
      newValue: null,
    });

    return { ok: true as const };
  });
}
