import "server-only";

import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
 * 구성은 불변이고, 바꾸려면 **복제 → 새 DRAFT → 편집 → 발행**한다.
 *
 * 2026-09-30부터 한 가지가 달라졌다: 발행은 **진행 중인 접수 건을 새 버전으로
 * 함께 옮긴다**(사용자 요청 — "워크플로를 수정/발행 하면 현재 저장되어 있는
 * 모든 수리건에서 바로 적용"). 그 전에는 접수 시점의 버전에 고정되어, 관리자가
 * 워크플로를 고쳐 발행해도 이미 있는 건들은 옛 단계 구성으로 계속 흘렀다.
 * 옮기는 규칙은 migrateInFlightCasesToVersion의 머리말에 있다.
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
    .select({ id: users.id, role: users.role, approvalStatus: users.approvalStatus, isDeveloper: users.isDeveloper })
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
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor, "workflows.editDraft", "WRITE"))) {
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 발행 직후, 옛 버전에 묶인 채 아직 흐르고 있는 접수 건을 새 버전으로 옮긴다
 * (2026-09-30 사용자 요청). 반드시 발행과 **같은 트랜잭션**에서 부른다 —
 * 발행이 뒤집히면 이관도 함께 뒤집혀야 한다.
 *
 * 짝은 **단계의 key로만** 짓는다. label은 판마다 바뀔 수 있으므로 label로
 * 짝지으면 이름만 손본 버전에서 건이 엉뚱한 단계로 간다.
 *
 * 옮기지 않는 것 셋:
 *
 * 1. **출하 완료된 건.** 더 이상 워크플로를 따라 흐르지 않으니 옮길 실익이
 *    없고, 끝난 건의 기록을 흔들 이유도 없다. 다만 repair_status가 비어 있는
 *    단계는 **옮긴다** — 비어 있음은 "완료"가 아니라 Phase 1 이관이 아직 값을
 *    채우지 못했다는 뜻이고(workflow.ts의 repairStatus 주석), 그대로 두면 그
 *    건은 목록·대시보드를 읽을 때마다 UnmappedWorkflowStepError로 실패한다.
 *    새 버전은 validateWorkflowDraft가 STEP_WITHOUT_STATUS로 막으므로 모든
 *    단계에 값이 있다 — 옮기는 것이 곧 그 건을 고치는 것이다. SQL의 3값
 *    논리에 맡기지 않고 is null을 명시하는 이유이기도 하다(`<> 'X'`만 쓰면
 *    null 행은 조용히 빠진다).
 * 2. **삭제된 건.**
 * 3. **건 전용 변주 버전(is_case_scoped)에 묶인 건.** 그것은 "옛 버전"이 아니라
 *    그 건 하나를 위해 단계를 끼워 넣은 사본이다(case-workflow-steps.ts).
 *    템플릿 버전으로 끌어오면 그 건만을 위해 넣은 단계가 조용히 사라진다.
 *
 * 현재 단계의 key가 새 버전에 없는 건은 **옛 버전에 그대로 두고 수만 센다.**
 * 여기서 발행을 막으면 단계를 하나라도 없앨 때 그 워크플로를 영영 고치지
 * 못하게 된다.
 *
 * status_change_histories에는 **건별 기록을 남기지 않는다** — 단계가 바뀐 것이
 * 아니라 같은 단계(key)의 새 버전 행으로 옮겨간 것이다. 이동으로 적으면
 * "그때 단계가 바뀌었다"는 거짓 이력이 남는다. 발행 감사 로그 한 줄에 수만
 * 요약한다.
 */
async function migrateInFlightCasesToVersion(
  tx: Tx,
  params: { templateId: string; newVersionId: string }
): Promise<{ migratedCaseCount: number; strandedCaseCount: number }> {
  const newSteps = await tx
    .select({ id: workflowSteps.id, key: workflowSteps.key })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, params.newVersionId));
  const newStepIdByKey = new Map(newSteps.map((step) => [step.key, step.id]));

  // 대상 행을 먼저 잠근다(of: repairCases — 읽기만 하는 버전·단계 표까지 잠글
  // 이유는 없다). 잠그지 않으면 고른 뒤 쓰기 전까지의 틈에서 다른 트랜잭션이
  // 그 건의 단계를 옮길 수 있고, 그러면 그 이동을 이 쓰기가 덮어 버린다.
  const candidates = await tx
    .select({ caseId: repairCases.id, stepKey: workflowSteps.key })
    .from(repairCases)
    .innerJoin(workflowSteps, eq(workflowSteps.id, repairCases.currentWorkflowStepId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
    .where(
      and(
        eq(workflowVersions.workflowTemplateId, params.templateId),
        ne(workflowVersions.id, params.newVersionId),
        eq(workflowVersions.isCaseScoped, false),
        eq(repairCases.isDeleted, false),
        isNull(repairCases.deletedAt),
        or(isNull(workflowSteps.repairStatus), ne(workflowSteps.repairStatus, "SHIPMENT_COMPLETED"))
      )
    )
    .for("update", { of: repairCases });

  // 같은 단계로 갈 건들을 모아 한 번에 쓴다 — 건마다 UPDATE를 날리면 수백 건
  // 짜리 발행에서 왕복이 그만큼 늘어난다.
  const caseIdsByNewStepId = new Map<string, string[]>();
  let strandedCaseCount = 0;
  for (const candidate of candidates) {
    const newStepId = newStepIdByKey.get(candidate.stepKey);
    if (!newStepId) {
      strandedCaseCount += 1;
      continue;
    }
    const bucket = caseIdsByNewStepId.get(newStepId);
    if (bucket) bucket.push(candidate.caseId);
    else caseIdsByNewStepId.set(newStepId, [candidate.caseId]);
  }

  let migratedCaseCount = 0;
  for (const [newStepId, caseIds] of caseIdsByNewStepId) {
    // 바꾸는 것은 이 둘뿐이다. updated_at은 일부러 건드리지 않는다 — 사람이 그
    // 건을 손댄 것이 아니라 워크플로 구성이 갈린 것이고, 바꾸면 "최근 변경"
    // 정렬이 발행 한 번에 통째로 뒤집힌다.
    await tx
      .update(repairCases)
      .set({ workflowVersionId: params.newVersionId, currentWorkflowStepId: newStepId })
      .where(inArray(repairCases.id, caseIds));
    migratedCaseCount += caseIds.length;
  }

  return { migratedCaseCount, strandedCaseCount };
}

/**
 * 초안을 발행한다. 검증을 통과해야만 하며, 같은 트랜잭션에서 기존 발행본을
 * 먼저 내리고 새 버전을 올린다 — "템플릿당 PUBLISHED+current 하나"를 강제하는
 * 부분 유니크 인덱스 때문에 순서를 바꿀 수 없다. 그 뒤에 진행 중인 접수 건을
 * 새 버전으로 옮긴다(migrateInFlightCasesToVersion).
 */
export async function publishWorkflowDraft(params: {
  versionId: string;
  actorUserId: string;
}): Promise<
  WorkflowDraftResult<{
    versionId: string;
    versionNumber: number;
    archivedVersionId: string | null;
    /** 새 버전으로 옮긴 진행 중 접수 건 수. */
    migratedCaseCount: number;
    /** 현재 단계의 key가 새 버전에 없어 옛 버전에 그대로 둔 접수 건 수. */
    strandedCaseCount: number;
  }>
> {
  const actor = await resolveActor(params.actorUserId);
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor, "workflows.publish", "MANAGE"))) {
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

    // 새 버전이 올라선 뒤에 옮긴다 — 앞에서 하면 아직 current가 아닌 버전으로
    // 건을 밀어 넣게 되고, 뒤이어 발행이 실패하면 둘 다 함께 뒤집혀야 한다.
    const { migratedCaseCount, strandedCaseCount } = await migrateInFlightCasesToVersion(tx, {
      templateId: draft.templateId,
      newVersionId: draft.id,
    });

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
        // 건별 이력을 남기지 않기로 한 대신, 이 한 줄이 "그 발행이 몇 건을
        // 움직였는가"에 답하는 유일한 기록이다.
        migratedCaseCount,
        strandedCaseCount,
      },
    });

    return {
      ok: true as const,
      versionId: draft.id,
      versionNumber: draft.versionNumber,
      archivedVersionId: currentPublished?.id ?? null,
      migratedCaseCount,
      strandedCaseCount,
    };
  });
}

/** 초안을 버린다. 발행된 적이 없으므로 접수 건과 이력이 걸려 있지 않다. */
export async function discardWorkflowDraft(params: {
  versionId: string;
  actorUserId: string;
}): Promise<WorkflowDraftResult<{ versionId: string }>> {
  const actor = await resolveActor(params.actorUserId);
  if (!actor || actor.approvalStatus !== "APPROVED" || !(await hasPermission(actor, "workflows.editDraft", "WRITE"))) {
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
