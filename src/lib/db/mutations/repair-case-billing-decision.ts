import "server-only";

import { and, eq } from "drizzle-orm";
import { isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";
import { deriveWorkflowType, workflowKindOf } from "@/lib/domain/workflow-kind";
import { db } from "../client";
import {
  procedureCaseExecutions,
  repairCaseApprovals,
  repairCaseBillingDecisionHistories,
  repairCaseFlowcharts,
  repairCaseWorkRecords,
  repairCases,
  statusChangeHistories,
  workflowSteps,
  workflowTemplates,
  workflowVersions,
} from "../schema";
import { insertAuditLog } from "./audit-logs";
import { resolveEligibleActor } from "./procedure-templates";

export const FINAL_BILLING_DECISION_CODES = ["PAID", "PARTIAL_PAID", "WARRANTY"] as const;
export type FinalBillingDecision = (typeof FINAL_BILLING_DECISION_CODES)[number];

export type ResolveRepairCaseBillingResult =
  | {
      ok: true;
      repairCaseId: string;
      billingType: FinalBillingDecision;
      workflowVersionId: string;
      currentWorkflowStepId: string;
      version: number;
      historyId: string;
    }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "STALE_VERSION"
        | "BILLING_ALREADY_DECIDED"
        | "WORKFLOW_REASSIGNMENT_NOT_ALLOWED"
        | "RELATED_ACTIVITY_EXISTS"
        | "WORKFLOW_NOT_ALLOWED";
      message: string;
    };

class BillingDecisionError extends Error {
  constructor(readonly result: Extract<ResolveRepairCaseBillingResult, { ok: false }>) {
    super(result.message);
  }
}

function fail(
  code: Extract<ResolveRepairCaseBillingResult, { ok: false }>['code'],
  message: string
): never {
  throw new BillingDecisionError({ ok: false, code, message });
}

async function hasRelatedActivity(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  repairCaseId: string
): Promise<boolean> {
  const [statusHistory] = await tx.select({ id: statusChangeHistories.id })
    .from(statusChangeHistories).where(eq(statusChangeHistories.repairCaseId, repairCaseId)).limit(1);
  if (statusHistory) return true;
  const [workRecord] = await tx.select({ id: repairCaseWorkRecords.id })
    .from(repairCaseWorkRecords).where(eq(repairCaseWorkRecords.repairCaseId, repairCaseId)).limit(1);
  if (workRecord) return true;
  const [approval] = await tx.select({ id: repairCaseApprovals.id })
    .from(repairCaseApprovals).where(eq(repairCaseApprovals.repairCaseId, repairCaseId)).limit(1);
  if (approval) return true;
  const [procedure] = await tx.select({ id: procedureCaseExecutions.id })
    .from(procedureCaseExecutions).where(eq(procedureCaseExecutions.repairCaseId, repairCaseId)).limit(1);
  if (procedure) return true;
  const [flowchart] = await tx.select({ id: repairCaseFlowcharts.id })
    .from(repairCaseFlowcharts).where(eq(repairCaseFlowcharts.repairCaseId, repairCaseId)).limit(1);
  return Boolean(flowchart);
}

/**
 * One-way resolution of an Excel-imported pending billing decision. The
 * locked Repair Case is only reassigned while it is still pristine at the
 * pending intake_inspection step. No source Excel text is copied to either
 * history sink.
 */
export async function resolveRepairCaseBillingDecision(params: {
  repairCaseId: string;
  expectedVersion: number;
  nextBillingType: FinalBillingDecision;
  actorUserId: string;
}): Promise<ResolveRepairCaseBillingResult> {
  try {
    return await db.transaction(async (tx) => {
      let actor: Awaited<ReturnType<typeof resolveEligibleActor>>;
      try {
        actor = await resolveEligibleActor(tx, params.actorUserId);
      } catch {
        fail("FORBIDDEN", "사용자 정보를 확인할 수 없습니다.");
      }
      if (!isFieldEditable(actor.role, "billingType")) {
        fail("FORBIDDEN", "유·무상을 확정할 권한이 없습니다.");
      }

      const [current] = await tx
        .select({
          id: repairCases.id,
          version: repairCases.version,
          billingType: repairCases.billingType,
          workflowVersionId: repairCases.workflowVersionId,
          currentWorkflowStepId: repairCases.currentWorkflowStepId,
        })
        .from(repairCases)
        .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
        .for("update");
      if (!current) fail("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
      if (current.version !== params.expectedVersion) {
        fail("STALE_VERSION", "다른 사용자가 접수 건을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.");
      }
      if (current.billingType !== "PENDING_DECISION") {
        fail("BILLING_ALREADY_DECIDED", "이미 유·무상이 확정된 접수 건입니다.");
      }
      const [currentWorkflow] = await tx
        .select({ currentStepKey: workflowSteps.key, workflowType: workflowTemplates.code })
        .from(workflowVersions)
        .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
        .innerJoin(workflowSteps, eq(workflowSteps.id, current.currentWorkflowStepId))
        .where(eq(workflowVersions.id, current.workflowVersionId));
      if (!currentWorkflow || !currentWorkflow.workflowType.startsWith("PENDING_")) {
        fail("WORKFLOW_REASSIGNMENT_NOT_ALLOWED", "추후결정 워크플로 상태를 확인할 수 없습니다.");
      }
      if (currentWorkflow.currentStepKey !== "intake_inspection") {
        fail("WORKFLOW_REASSIGNMENT_NOT_ALLOWED", "최초 접수 단계에서만 유·무상을 확정할 수 있습니다.");
      }
      if (await hasRelatedActivity(tx, current.id)) {
        fail("RELATED_ACTIVITY_EXISTS", "이미 수리 진행 기록이 있어 유·무상을 자동 전환할 수 없습니다.");
      }

      const targetWorkflowType = deriveWorkflowType(
        workflowKindOf(currentWorkflow.workflowType),
        params.nextBillingType
      );
      if (!targetWorkflowType || targetWorkflowType.startsWith("PENDING_")) {
        fail("WORKFLOW_NOT_ALLOWED", "대상 워크플로를 결정할 수 없습니다.");
      }

      const [target] = await tx
        .select({ workflowVersionId: workflowVersions.id, workflowStepId: workflowSteps.id })
        .from(workflowVersions)
        .innerJoin(workflowTemplates, eq(workflowTemplates.id, workflowVersions.workflowTemplateId))
        .innerJoin(
          workflowSteps,
          and(
            eq(workflowSteps.workflowVersionId, workflowVersions.id),
            eq(workflowSteps.key, "intake_inspection")
          )
        )
        .where(
          and(
            eq(workflowTemplates.code, targetWorkflowType),
            eq(workflowVersions.status, "PUBLISHED"),
            eq(workflowVersions.isCurrent, true)
          )
        );
      if (!target) fail("WORKFLOW_NOT_ALLOWED", "현재 사용할 수 있는 대상 워크플로를 찾을 수 없습니다.");

      const [updated] = await tx
        .update(repairCases)
        .set({
          billingType: params.nextBillingType,
          workflowVersionId: target.workflowVersionId,
          currentWorkflowStepId: target.workflowStepId,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(repairCases.id, current.id),
            eq(repairCases.version, current.version),
            eq(repairCases.billingType, "PENDING_DECISION")
          )
        )
        .returning({ version: repairCases.version });
      if (!updated) fail("STALE_VERSION", "다른 사용자가 접수 건을 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.");

      const [history] = await tx
        .insert(repairCaseBillingDecisionHistories)
        .values({
          repairCaseId: current.id,
          previousBillingType: "PENDING_DECISION",
          nextBillingType: params.nextBillingType,
          previousWorkflowVersionId: current.workflowVersionId,
          nextWorkflowVersionId: target.workflowVersionId,
          previousWorkflowStepId: current.currentWorkflowStepId,
          nextWorkflowStepId: target.workflowStepId,
          decidedBy: actor.id,
        })
        .returning({ id: repairCaseBillingDecisionHistories.id });

      await insertAuditLog(tx, {
        actorUserId: actor.id,
        actionType: "UPDATE",
        targetEntity: "repair_cases",
        targetRecordId: current.id,
        previousValue: {
          billingType: current.billingType,
          workflowVersionId: current.workflowVersionId,
          workflowStepId: current.currentWorkflowStepId,
        },
        newValue: {
          billingType: params.nextBillingType,
          workflowVersionId: target.workflowVersionId,
          workflowStepId: target.workflowStepId,
        },
      });

      return {
        ok: true,
        repairCaseId: current.id,
        billingType: params.nextBillingType,
        workflowVersionId: target.workflowVersionId,
        currentWorkflowStepId: target.workflowStepId,
        version: updated.version,
        historyId: history.id,
      };
    });
  } catch (error) {
    if (error instanceof BillingDecisionError) return error.result;
    throw error;
  }
}
