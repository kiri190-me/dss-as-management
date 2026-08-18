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
import type { WorkflowType } from "@/lib/domain/types";

/**
 * 워크플로 기본 틀 조회(Phase 3). 읽기 전용이며, 목록/버전 이력 화면이 쓴다.
 *
 * 접수 건 수를 함께 세는 이유는 "이 워크플로를 실제로 쓰고 있는가"가 편집
 * 판단의 첫 정보이기 때문이다 — 쓰는 건이 없는 워크플로(예: 아카이브된 레거시
 * MATCHER)와 250건이 걸린 워크플로는 같은 무게로 다룰 수 없다.
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

export async function listWorkflowTemplateSummaries(): Promise<WorkflowTemplateSummary[]> {
  const templates = await db
    .select({ id: workflowTemplates.id, code: workflowTemplates.code, name: workflowTemplates.name })
    .from(workflowTemplates)
    .orderBy(asc(workflowTemplates.code));

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
};

export async function getWorkflowTemplateDetail(code: string): Promise<WorkflowTemplateDetail | null> {
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
    .where(eq(workflowVersions.workflowTemplateId, template.id))
    .orderBy(desc(workflowVersions.versionNumber));

  return {
    code: template.code as WorkflowType,
    name: template.name,
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
