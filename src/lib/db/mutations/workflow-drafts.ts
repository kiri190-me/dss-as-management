import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  validateWorkflowDraft,
  workflowExitsWithoutTerminalStep,
  type DraftValidationIssue,
} from "@/lib/domain/workflow-draft-validation";
import type { WorkflowType } from "@/lib/domain/types";

/**
 * ============================================================================
 * 워크플로 초안 생성 / 발행 / 폐기 (Phase 4b)
 * ============================================================================
 * DATABASE_DESIGN.md #13이 정한 버전 모델을 그대로 따른다: 발행된 버전의 단계
 * 구성은 불변이고, 바꾸려면 **복제 → 새 DRAFT → 편집 → 발행**한다. 진행 중인
 * 접수 건은 접수 시점에 고정된 버전을 계속 쓰므로 발행의 영향을 받지 않는다.
 *
 * 발행은 이 프로젝트에서 가장 위험한 쓰기다 — 잘못된 구조가 나가면 그
 * 워크플로의 접수 건이 전부 멈춘다. 그래서 화면이 무엇을 보여 줬든
 * validateWorkflowDraft를 서버에서 다시 실행하고, 오류가 하나라도 있으면
 * 거부한다(경고는 통과시킨다 — 판단은 사람 몫인 것들이다).
 * ============================================================================
 */

export type WorkflowDraftResultCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "NO_PUBLISHED_VERSION"
  | "DRAFT_ALREADY_EXISTS"
  | "NOT_A_DRAFT"
  | "VALIDATION_FAILED"
  | "VERSION_IN_USE";

export type WorkflowDraftResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: WorkflowDraftResultCode; message: string; issues?: DraftValidationIssue[] };

async function resolveActor(actorUserId: string) {
  const [actor] = await db
    .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
  return actor ?? null;
}

/**
 * 현재 발행 버전을 복제해 새 DRAFT를 만든다. 단계와 이동 규칙을 모두 복사하므로,
 * 편집자는 빈 화면이 아니라 "지금 돌아가는 그대로"에서 시작한다.
 *
 * 템플릿당 DRAFT는 하나만 둔다. 여러 개를 허용하면 "어느 초안이 진짜인가"를
 * 사람이 관리해야 하고, 서로 다른 초안이 각자 발행되며 앞의 변경을 덮는다.
 */
export async function createWorkflowDraft(params: {
  templateCode: string;
  actorUserId: string;
}): Promise<WorkflowDraftResult<{ versionId: string; versionNumber: number }>> {
  const actor = await resolveActor(params.actorUserId);
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor.role, "workflows.editDraft", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "워크플로를 편집할 권한이 없습니다." };
  }

  return db.transaction(async (tx) => {
    const [template] = await tx
      .select({ id: workflowTemplates.id, code: workflowTemplates.code })
      .from(workflowTemplates)
      .where(eq(workflowTemplates.code, params.templateCode as WorkflowType));
    if (!template) return { ok: false as const, code: "NOT_FOUND" as const, message: "워크플로를 찾을 수 없습니다." };

    const [existingDraft] = await tx
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(and(eq(workflowVersions.workflowTemplateId, template.id), eq(workflowVersions.status, "DRAFT")));
    if (existingDraft) {
      return {
        ok: false as const,
        code: "DRAFT_ALREADY_EXISTS" as const,
        message: "이미 작성 중인 초안이 있습니다. 그 초안을 이어서 편집하거나 폐기해 주세요.",
      };
    }

    const [source] = await tx
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowTemplateId, template.id),
          eq(workflowVersions.status, "PUBLISHED"),
          eq(workflowVersions.isCurrent, true)
        )
      );
    if (!source) {
      // 복제할 원본이 없으면 빈 초안을 만들지 않고 멈춘다 — 빈 초안은 검증을
      // 통과할 수 없으므로 만들어 봐야 발행하지 못하는 껍데기다.
      return {
        ok: false as const,
        code: "NO_PUBLISHED_VERSION" as const,
        message: "복제할 현재 발행 버전이 없습니다.",
      };
    }

    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${workflowVersions.versionNumber}), 0)` })
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowTemplateId, template.id));

    const [draft] = await tx
      .insert(workflowVersions)
      .values({
        workflowTemplateId: template.id,
        versionNumber: Number(max) + 1,
        status: "DRAFT",
        isCurrent: false,
        createdBy: actor.id,
      })
      .returning({ id: workflowVersions.id, versionNumber: workflowVersions.versionNumber });

    const sourceSteps = await tx
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, source.id));

    const stepIdMap = new Map<string, string>();
    for (const step of sourceSteps) {
      const [copied] = await tx
        .insert(workflowSteps)
        .values({
          workflowVersionId: draft.id,
          stepOrder: step.stepOrder,
          key: step.key,
          label: step.label,
          repairStatus: step.repairStatus,
          category: step.category,
          isActive: step.isActive,
        })
        .returning({ id: workflowSteps.id });
      stepIdMap.set(step.id, copied.id);
    }

    const sourceTransitions = await tx
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, source.id));

    for (const transition of sourceTransitions) {
      const from = stepIdMap.get(transition.fromStepId);
      const to = stepIdMap.get(transition.toStepId);
      // 원본의 단계를 전부 복사했으므로 정상적으로는 발생하지 않는다.
      if (!from || !to) continue;
      await tx.insert(workflowTransitions).values({
        workflowVersionId: draft.id,
        actionCode: transition.actionCode,
        fromStepId: from,
        toStepId: to,
        allowedRoles: transition.allowedRoles,
        requiresAssignedEngineer: transition.requiresAssignedEngineer,
        requiresReason: transition.requiresReason,
        requiredApprovalType: transition.requiredApprovalType,
      });
    }

    await insertAuditLog(tx, {
      actorUserId: actor.id,
      actionType: "CREATE",
      targetEntity: "workflow_versions",
      targetRecordId: draft.id,
      previousValue: null,
      newValue: {
        templateCode: template.code,
        versionNumber: draft.versionNumber,
        copiedFromVersionId: source.id,
        stepCount: sourceSteps.length,
        transitionCount: sourceTransitions.length,
      },
    });

    return { ok: true as const, versionId: draft.id, versionNumber: draft.versionNumber };
  });
}

/**
 * 초안을 발행한다. 검증을 통과해야만 하며, 같은 트랜잭션에서 기존 발행본을
 * 먼저 내리고 새 버전을 올린다 — "템플릿당 PUBLISHED+current 하나"를 강제하는
 * 부분 유니크 인덱스 때문에 순서를 바꿀 수 없다.
 */
export async function publishWorkflowDraft(params: {
  versionId: string;
  actorUserId: string;
}): Promise<WorkflowDraftResult<{ versionId: string; versionNumber: number; archivedVersionId: string | null }>> {
  const actor = await resolveActor(params.actorUserId);
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor.role, "workflows.publish", "MANAGE"))) {
    return { ok: false, code: "FORBIDDEN", message: "워크플로를 발행할 권한이 없습니다." };
  }

  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select({
        id: workflowVersions.id,
        templateId: workflowVersions.workflowTemplateId,
        templateCode: workflowTemplates.code,
        versionNumber: workflowVersions.versionNumber,
        status: workflowVersions.status,
      })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(eq(workflowVersions.id, params.versionId))
      .for("update");
    if (!draft) return { ok: false as const, code: "NOT_FOUND" as const, message: "버전을 찾을 수 없습니다." };
    if (draft.status !== "DRAFT") {
      return { ok: false as const, code: "NOT_A_DRAFT" as const, message: "초안 상태의 버전만 발행할 수 있습니다." };
    }

    const steps = await tx
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.workflowVersionId, draft.id));
    const transitions = await tx
      .select({
        actionCode: workflowTransitions.actionCode,
        fromStepId: workflowTransitions.fromStepId,
        toStepId: workflowTransitions.toStepId,
      })
      .from(workflowTransitions)
      .where(eq(workflowTransitions.workflowVersionId, draft.id));

    const stepKeyById = new Map(steps.map((s) => [s.id, s.key]));
    const validation = validateWorkflowDraft(
      steps.map((s) => ({
        key: s.key,
        label: s.label,
        order: s.stepOrder,
        isActive: s.isActive,
        status: s.repairStatus,
        category: s.category,
      })),
      transitions.map((t) => ({
        actionCode: t.actionCode,
        fromStepKey: stepKeyById.get(t.fromStepId) ?? "",
        toStepKey: stepKeyById.get(t.toStepId) ?? "",
      })),
      {
        exitsWithoutTerminalStep: workflowExitsWithoutTerminalStep(draft.templateCode),
      }
    );
    if (!validation.ok) {
      return {
        ok: false as const,
        code: "VALIDATION_FAILED" as const,
        message: "구조 검증을 통과하지 못해 발행할 수 없습니다.",
        issues: validation.errors,
      };
    }

    const [currentPublished] = await tx
      .select({ id: workflowVersions.id })
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.workflowTemplateId, draft.templateId),
          eq(workflowVersions.status, "PUBLISHED"),
          eq(workflowVersions.isCurrent, true)
        )
      );

    // 순서 고정: 내리고 → 올린다. 반대로 하면 부분 유니크 인덱스에 걸린다.
    if (currentPublished) {
      await tx
        .update(workflowVersions)
        .set({ status: "ARCHIVED", isCurrent: false })
        .where(eq(workflowVersions.id, currentPublished.id));
    }

    await tx
      .update(workflowVersions)
      .set({ status: "PUBLISHED", isCurrent: true, publishedAt: new Date() })
      .where(eq(workflowVersions.id, draft.id));

    await insertAuditLog(tx, {
      actorUserId: actor.id,
      actionType: "UPDATE",
      targetEntity: "workflow_versions",
      targetRecordId: draft.id,
      previousValue: { status: "DRAFT", isCurrent: false, previousCurrentVersionId: currentPublished?.id ?? null },
      newValue: {
        status: "PUBLISHED",
        isCurrent: true,
        templateCode: draft.templateCode,
        versionNumber: draft.versionNumber,
        warnings: validation.warnings.map((w) => w.code),
      },
    });

    return {
      ok: true as const,
      versionId: draft.id,
      versionNumber: draft.versionNumber,
      archivedVersionId: currentPublished?.id ?? null,
    };
  });
}

/** 초안을 버린다. 발행된 적이 없으므로 접수 건과 이력이 걸려 있지 않다. */
export async function discardWorkflowDraft(params: {
  versionId: string;
  actorUserId: string;
}): Promise<WorkflowDraftResult<{ versionId: string }>> {
  const actor = await resolveActor(params.actorUserId);
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor.role, "workflows.editDraft", "WRITE"))) {
    return { ok: false, code: "FORBIDDEN", message: "워크플로를 편집할 권한이 없습니다." };
  }

  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select({
        id: workflowVersions.id,
        status: workflowVersions.status,
        templateCode: workflowTemplates.code,
        versionNumber: workflowVersions.versionNumber,
      })
      .from(workflowVersions)
      .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
      .where(eq(workflowVersions.id, params.versionId))
      .for("update");
    if (!draft) return { ok: false as const, code: "NOT_FOUND" as const, message: "버전을 찾을 수 없습니다." };
    if (draft.status !== "DRAFT") {
      return { ok: false as const, code: "NOT_A_DRAFT" as const, message: "초안 상태의 버전만 폐기할 수 있습니다." };
    }

    // 초안에는 접수 건이 걸릴 수 없지만(배정은 current 버전에만 일어난다),
    // 확인하지 않고 지우면 그 가정이 깨졌을 때 조용히 데이터를 잃는다.
    const [inUse] = await tx
      .select({ id: repairCases.id })
      .from(repairCases)
      .where(eq(repairCases.workflowVersionId, draft.id))
      .limit(1);
    if (inUse) {
      return {
        ok: false as const,
        code: "VERSION_IN_USE" as const,
        message: "이 버전을 사용하는 접수 건이 있어 폐기할 수 없습니다.",
      };
    }

    // FK가 restrict이므로 전이 → 단계 → 버전 순으로 지운다.
    await tx.delete(workflowTransitions).where(eq(workflowTransitions.workflowVersionId, draft.id));
    await tx.delete(workflowSteps).where(eq(workflowSteps.workflowVersionId, draft.id));
    await tx.delete(workflowVersions).where(eq(workflowVersions.id, draft.id));

    await insertAuditLog(tx, {
      actorUserId: actor.id,
      actionType: "SOFT_DELETE",
      targetEntity: "workflow_versions",
      targetRecordId: draft.id,
      previousValue: { templateCode: draft.templateCode, versionNumber: draft.versionNumber, status: "DRAFT" },
      newValue: null,
    });

    return { ok: true as const, versionId: draft.id };
  });
}

/** 템플릿의 현재 작성 중인 초안(있으면). 화면이 "이어서 편집"을 걸기 위해 쓴다. */
export async function findWorkflowDraft(templateCode: string): Promise<{ id: string; versionNumber: number } | null> {
  const [draft] = await db
    .select({ id: workflowVersions.id, versionNumber: workflowVersions.versionNumber })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .where(and(eq(workflowTemplates.code, templateCode as WorkflowType), eq(workflowVersions.status, "DRAFT")))
    .orderBy(desc(workflowVersions.versionNumber));
  return draft ?? null;
}
