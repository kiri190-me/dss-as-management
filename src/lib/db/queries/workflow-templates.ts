import "server-only";

import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../client";
import {
  repairCases,
  users,
  workflowSteps,
  workflowTemplates,
  workflowTransitions,
  workflowVersions,
} from "../schema";
import { WORKFLOW_TYPE_CODES, type RepairStatus, type WorkflowType } from "@/lib/domain/types";
import type { StepCategory } from "@/lib/domain/local/workflow/step-category";
import {
  validateWorkflowDraft,
  workflowExitsWithoutTerminalStep,
  type DraftValidationResult,
} from "@/lib/domain/workflow-draft-validation";

/**
 * 워크플로 기본 틀 조회(Phase 3). 읽기 전용이며, 목록/버전 이력 화면이 쓴다.
 *
 * 접수 건 수를 함께 세는 이유는 "이 워크플로를 실제로 쓰고 있는가"가 편집
 * 판단의 첫 정보이기 때문이다 — 쓰는 건이 없는 워크플로와 250건이 걸린
 * 워크플로는 같은 무게로 다룰 수 없다.
 */

export type WorkflowTemplateSummary = {
  code: WorkflowType;
  name: string;
  /** current PUBLISHED 버전이 없을 수도 있다(아카이브된 워크플로). */
  currentVersionNumber: number | null;
  currentVersionId: string | null;
  stepCount: number;
  transitionCount: number;
  activeCaseCount: number;
  isArchived: boolean;
};

/**
 * DB에 남아 있지만 더 이상 이 서비스의 워크플로가 아닌 템플릿을 걸러 낸다.
 *
 * 지금 걸리는 것은 레거시 "MATCHER"(Matcher (기존 이력)) 하나다. 2026-08-19에
 * 도메인에서 없앴지만 그 코드를 쓰는 행과 감사 이력이 남아 있어 DB에서는 지울
 * 수 없다(db/schema/workflow.ts의 workflowTypeEnum 주석). 코드 목록으로 거르므로
 * 나중에 또 이런 것이 생겨도 여기를 고칠 필요가 없다 — 이름표(workflowTypeLabels)
 * 가 없는 것은 목록에도 나오지 않는다.
 */
function isKnownWorkflowType(code: string): code is WorkflowType {
  return (WORKFLOW_TYPE_CODES as readonly string[]).includes(code);
}

export async function listWorkflowTemplateSummaries(): Promise<WorkflowTemplateSummary[]> {
  const allTemplates = await db
    .select({ id: workflowTemplates.id, code: workflowTemplates.code, name: workflowTemplates.name })
    .from(workflowTemplates)
    .orderBy(asc(workflowTemplates.code));
  const templates = allTemplates.filter((t) => isKnownWorkflowType(t.code));

  const current = await db
    .select({
      templateId: workflowVersions.workflowTemplateId,
      versionId: workflowVersions.id,
      versionNumber: workflowVersions.versionNumber,
    })
    .from(workflowVersions)
    .where(and(eq(workflowVersions.isCurrent, true), eq(workflowVersions.status, "PUBLISHED")));
  const currentByTemplate = new Map(current.map((c) => [c.templateId, c]));

  const stepCounts = await db
    .select({ versionId: workflowSteps.workflowVersionId, n: count() })
    .from(workflowSteps)
    .groupBy(workflowSteps.workflowVersionId);
  const stepCountByVersion = new Map(stepCounts.map((s) => [s.versionId, Number(s.n)]));

  const transitionCounts = await db
    .select({ versionId: workflowTransitions.workflowVersionId, n: count() })
    .from(workflowTransitions)
    .groupBy(workflowTransitions.workflowVersionId);
  const transitionCountByVersion = new Map(transitionCounts.map((t) => [t.versionId, Number(t.n)]));

  // 접수 건은 버전이 아니라 템플릿 단위로 센다 — 과거 버전에 걸린 건도 그
  // 워크플로를 쓰는 건이다.
  const caseCounts = await db
    .select({ templateId: workflowVersions.workflowTemplateId, n: count() })
    .from(repairCases)
    .innerJoin(workflowVersions, eq(workflowVersions.id, repairCases.workflowVersionId))
    .where(eq(repairCases.isDeleted, false))
    .groupBy(workflowVersions.workflowTemplateId);
  const caseCountByTemplate = new Map(caseCounts.map((c) => [c.templateId, Number(c.n)]));

  return templates.map((template) => {
    const cur = currentByTemplate.get(template.id) ?? null;
    return {
      code: template.code as WorkflowType,
      name: template.name,
      currentVersionNumber: cur?.versionNumber ?? null,
      currentVersionId: cur?.versionId ?? null,
      stepCount: cur ? (stepCountByVersion.get(cur.versionId) ?? 0) : 0,
      transitionCount: cur ? (transitionCountByVersion.get(cur.versionId) ?? 0) : 0,
      activeCaseCount: caseCountByTemplate.get(template.id) ?? 0,
      // current PUBLISHED 버전이 없다 = 신규 접수가 배정되지 않는다.
      isArchived: cur === null,
    };
  });
}

export type WorkflowVersionSummary = {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  isCurrent: boolean;
  publishedAt: string | null;
  createdAt: string;
  createdByName: string;
  stepCount: number;
  transitionCount: number;
  caseCount: number;
};

export type WorkflowTemplateDetail = {
  code: WorkflowType;
  name: string;
  versions: WorkflowVersionSummary[];
  /**
   * 목록에서 걸러낸 "건 전용 버전"의 수. 이 화면은 템플릿을 관리하는 곳이므로
   * 접수 건 하나에만 붙은 변주는 목록에 올리지 않는다. 다만 그 버전들도 같은
   * 템플릿의 번호를 하나씩 가져가므로 목록의 버전 번호가 v1, v2, v5처럼 건너뛴다
   * — 빠진 번호가 사라진 것이 아님을 알리기 위해 수만 함께 넘긴다.
   */
  caseScopedVersionCount: number;
};

export async function getWorkflowTemplateDetail(code: string): Promise<WorkflowTemplateDetail | null> {
  // 목록에서 감춘 것을 주소로 직접 열 수 있으면 감춘 것이 아니다.
  if (!isKnownWorkflowType(code)) return null;

  const [template] = await db
    .select({ id: workflowTemplates.id, code: workflowTemplates.code, name: workflowTemplates.name })
    .from(workflowTemplates)
    .where(eq(workflowTemplates.code, code as WorkflowType));
  if (!template) return null;

  const versions = await db
    .select({
      id: workflowVersions.id,
      versionNumber: workflowVersions.versionNumber,
      status: workflowVersions.status,
      isCurrent: workflowVersions.isCurrent,
      publishedAt: workflowVersions.publishedAt,
      createdAt: workflowVersions.createdAt,
      createdByName: users.name,
      stepCount: sql<number>`(select count(*)::int from ${workflowSteps} where ${workflowSteps.workflowVersionId} = ${workflowVersions.id})`,
      transitionCount: sql<number>`(select count(*)::int from ${workflowTransitions} where ${workflowTransitions.workflowVersionId} = ${workflowVersions.id})`,
      caseCount: sql<number>`(select count(*)::int from ${repairCases} where ${repairCases.workflowVersionId} = ${workflowVersions.id} and ${repairCases.isDeleted} = false)`,
    })
    .from(workflowVersions)
    .innerJoin(users, eq(users.id, workflowVersions.createdBy))
    .where(and(eq(workflowVersions.workflowTemplateId, template.id), eq(workflowVersions.isCaseScoped, false)))
    .orderBy(desc(workflowVersions.versionNumber));

  const [caseScoped] = await db
    .select({ n: count() })
    .from(workflowVersions)
    .where(and(eq(workflowVersions.workflowTemplateId, template.id), eq(workflowVersions.isCaseScoped, true)));

  return {
    code: template.code as WorkflowType,
    name: template.name,
    caseScopedVersionCount: Number(caseScoped?.n ?? 0),
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      isCurrent: v.isCurrent,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
      createdByName: v.createdByName,
      stepCount: Number(v.stepCount),
      transitionCount: Number(v.transitionCount),
      caseCount: Number(v.caseCount),
    })),
  };
}

export type WorkflowDraftStepView = {
  id: string;
  key: string;
  label: string;
  order: number;
  isActive: boolean;
  status: RepairStatus | null;
  category: StepCategory | null;
};

/** 초안 편집 화면이 이동 규칙 한 줄을 그리는 데 필요한 전부. */
export type WorkflowDraftTransitionView = {
  id: string;
  actionCode: string;
  fromStepId: string;
  toStepId: string;
  fromStepKey: string;
  toStepKey: string;
  allowedRoles: string[];
  requiresAssignedEngineer: boolean;
  requiresReason: boolean;
  requiredApprovalType: string | null;
};

export type WorkflowDraftDetail = {
  versionId: string;
  versionNumber: number;
  templateCode: WorkflowType;
  templateName: string;
  createdByName: string;
  steps: WorkflowDraftStepView[];
  transitions: WorkflowDraftTransitionView[];
  validation: DraftValidationResult;
};

/**
 * 초안 편집 화면이 쓰는 조회. 검증 결과를 함께 돌려주는 이유는, 편집자가
 * "지금 발행하면 무엇이 걸리는지"를 저장할 때마다 보아야 하기 때문이다.
 * 같은 판정을 발행 mutation이 서버에서 다시 실행하며, 예외 판단
 * (workflowExitsWithoutTerminalStep)도 같은 함수를 공유한다.
 */
export async function getWorkflowDraftDetail(versionId: string): Promise<WorkflowDraftDetail | null> {
  const [version] = await db
    .select({
      id: workflowVersions.id,
      versionNumber: workflowVersions.versionNumber,
      status: workflowVersions.status,
      templateCode: workflowTemplates.code,
      templateName: workflowTemplates.name,
      createdByName: users.name,
    })
    .from(workflowVersions)
    .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
    .innerJoin(users, eq(users.id, workflowVersions.createdBy))
    .where(eq(workflowVersions.id, versionId));
  if (!version || version.status !== "DRAFT") return null;

  const stepRows = await db
    .select({
      id: workflowSteps.id,
      key: workflowSteps.key,
      label: workflowSteps.label,
      order: workflowSteps.stepOrder,
      isActive: workflowSteps.isActive,
      status: workflowSteps.repairStatus,
      category: workflowSteps.category,
    })
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowVersionId, versionId))
    .orderBy(asc(workflowSteps.stepOrder));

  const transitionRows = await db
    .select({
      id: workflowTransitions.id,
      actionCode: workflowTransitions.actionCode,
      fromStepId: workflowTransitions.fromStepId,
      toStepId: workflowTransitions.toStepId,
      allowedRoles: workflowTransitions.allowedRoles,
      requiresAssignedEngineer: workflowTransitions.requiresAssignedEngineer,
      requiresReason: workflowTransitions.requiresReason,
      requiredApprovalType: workflowTransitions.requiredApprovalType,
    })
    .from(workflowTransitions)
    .where(eq(workflowTransitions.workflowVersionId, versionId));

  const keyById = new Map(stepRows.map((s) => [s.id, s.key]));
  const transitions: WorkflowDraftTransitionView[] = transitionRows.map((t) => ({
    id: t.id,
    actionCode: t.actionCode as string,
    fromStepId: t.fromStepId,
    toStepId: t.toStepId,
    fromStepKey: keyById.get(t.fromStepId) ?? "",
    toStepKey: keyById.get(t.toStepId) ?? "",
    allowedRoles: t.allowedRoles as string[],
    requiresAssignedEngineer: t.requiresAssignedEngineer,
    requiresReason: t.requiresReason,
    requiredApprovalType: t.requiredApprovalType,
  }));

  const validation = validateWorkflowDraft(
    stepRows.map((s) => ({
      key: s.key,
      label: s.label,
      order: s.order,
      isActive: s.isActive,
      status: s.status,
      category: s.category,
    })),
    transitions.map((t) => ({
      actionCode: t.actionCode as "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED",
      fromStepKey: t.fromStepKey,
      toStepKey: t.toStepKey,
    })),
    { exitsWithoutTerminalStep: workflowExitsWithoutTerminalStep(version.templateCode) }
  );

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    templateCode: version.templateCode as WorkflowType,
    templateName: version.templateName,
    createdByName: version.createdByName,
    steps: stepRows,
    transitions,
    validation,
  };
}
