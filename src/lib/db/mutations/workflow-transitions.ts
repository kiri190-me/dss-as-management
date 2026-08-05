import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { repairCaseApprovals, repairCases, statusChangeHistories, users, workflowSteps, workflowTemplates, workflowVersions } from "../schema";
import { checkHoldEligibility, checkTransitionEligibility } from "@/lib/domain/local/workflow/permissions";
import { findTransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";
import type { HoldState } from "@/lib/domain/local/workflow/workflow-types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import type { WorkflowActionCode } from "@/lib/validation/workflow-transition-input";

/**
 * Server-side workflow transitions, reusing the exact same authorization
 * and transition-graph logic the local-demo layer already uses
 * (findTransitionDefinition, checkTransitionEligibility, checkHoldEligibility
 * — all pure, framework-agnostic functions with no browser/localStorage
 * dependency, confirmed safe to import here verbatim) — this file does NOT
 * reimplement or fork that logic, only re-evaluates it against fresh
 * database state instead of a localStorage snapshot.
 *
 * Approval-gated transitions (any TransitionDefinition with
 * requiredApprovalType set — every workflow's SHIPMENT_COMPLETED terminal
 * transition, plus one REPAIR_INSPECTION-gated advance per workflow) check
 * repair_case_approvals for a matching APPROVED row still bound to the
 * case's current version (see the approval-persistence task's final
 * report) — APPROVAL_REQUIRED when missing/rejected, APPROVAL_STALE when
 * the case changed materially since the approval was requested.
 */

export type TransitionMutationResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED"
  | "FORBIDDEN"
  | "CASE_LOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_STALE";

export type TransitionMutationResult =
  | { ok: true; id: string; version: number; currentWorkflowStepKey: string }
  | { ok: false; code: TransitionMutationResultCode; message: string };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 접수 건의 워크플로를 먼저 변경했습니다. 최신 정보를 다시 불러온 후 다시 시도해 주세요.";

const STEP_MOVING_ACTIONS = new Set<WorkflowActionCode>(["STEP_ADVANCED", "STEP_RETURNED", "SHIPMENT_COMPLETED"]);

/** Thrown only after status_change_histories has already been INSERTed in
 * the same transaction — thrown (not returned) so postgres rolls back that
 * insert along with the failed state update, keeping "history exists iff
 * the transition actually succeeded" strictly true. Caught immediately
 * outside db.transaction() and translated back to a normal result. */
class TransitionConflictError extends Error {
  code: "NOT_FOUND" | "CONFLICT";
  constructor(code: "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.code = code;
  }
}

export async function transitionWorkflow(
  repairCaseId: string,
  expectedVersion: number,
  actionCode: WorkflowActionCode,
  actorUserId: string,
  reason: string | null
): Promise<TransitionMutationResult> {
  try {
    return await db.transaction(async (tx): Promise<TransitionMutationResult> => {
      const [current] = await tx
        .select({
          id: repairCases.id,
          version: repairCases.version,
          isLocked: repairCases.isLocked,
          assignedEngineerId: repairCases.assignedEngineerId,
          workflowVersionId: repairCases.workflowVersionId,
          currentWorkflowStepId: repairCases.currentWorkflowStepId,
          currentStepKey: workflowSteps.key,
          workflowTypeCode: workflowTemplates.code,
        })
        .from(repairCases)
        .innerJoin(workflowSteps, eq(repairCases.currentWorkflowStepId, workflowSteps.id))
        .innerJoin(workflowVersions, eq(repairCases.workflowVersionId, workflowVersions.id))
        .innerJoin(workflowTemplates, eq(workflowVersions.workflowTemplateId, workflowTemplates.id))
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));

      if (!current) {
        return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
      }
      if (current.isLocked) {
        return {
          ok: false,
          code: "CASE_LOCKED",
          message: "출하 완료 후 잠금된 접수 건입니다. 이 작업을 수행할 수 없습니다.",
        };
      }

      const [actor] = await tx
        .select({ id: users.id, name: users.name, role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(and(eq(users.id, actorUserId), eq(users.isDeleted, false)));
      if (!actor) {
        return { ok: false, code: "FORBIDDEN", message: "사용자 정보를 확인할 수 없습니다." };
      }
      const actingUser: ActingUser = actor;

      // Event-sourced hold state (no dedicated columns — see Phase-1
      // report). Only `.isOnHold` is ever read by the reused permission
      // functions; the rest of HoldState is unused by them but required by
      // the shared type.
      const [latestHold] = await tx
        .select({ actionType: statusChangeHistories.actionType })
        .from(statusChangeHistories)
        .where(
          and(
            eq(statusChangeHistories.repairCaseId, repairCaseId),
            inArray(statusChangeHistories.actionType, ["HOLD_STARTED", "HOLD_RELEASED"])
          )
        )
        .orderBy(desc(statusChangeHistories.createdAt))
        .limit(1);
      const holdState: HoldState = {
        isOnHold: latestHold?.actionType === "HOLD_STARTED",
        reason: null,
        startedByUserId: null,
        startedByNameSnapshot: null,
        startedAt: null,
      };

      let toStepId = current.currentWorkflowStepId;
      let toStepKeyForResult = current.currentStepKey;
      const setValues: Record<string, unknown> = {
        version: sql`${repairCases.version} + 1`,
        updatedAt: sql`now()`,
      };

      if (STEP_MOVING_ACTIONS.has(actionCode)) {
        const transition = findTransitionDefinition(current.workflowTypeCode, actionCode, current.currentStepKey);
        if (!transition) {
          const message =
            actionCode === "STEP_ADVANCED"
              ? "이 단계에서는 다음 단계로 진행할 수 없습니다."
              : actionCode === "STEP_RETURNED"
                ? "이 단계에서는 이전 단계로 되돌릴 수 없습니다."
                : "현재 단계에서는 출하 완료 처리를 할 수 없습니다.";
          return { ok: false, code: "INVALID_TRANSITION", message };
        }
        const eligibility = checkTransitionEligibility(transition, actingUser, current.assignedEngineerId, holdState);
        if (!eligibility.allowed) {
          return { ok: false, code: "FORBIDDEN", message: eligibility.reason };
        }
        if (transition.requiresReason && !reason) {
          return {
            ok: false,
            code: "REASON_REQUIRED",
            message: actionCode === "SHIPMENT_COMPLETED" ? "출하 완료 메모를 입력해 주세요." : "되돌리기 사유를 입력해 주세요.",
          };
        }

        // Approval-gated transitions: the most recent
        // repair_case_approvals row for this (case, type) must be APPROVED
        // and still bound to the case's current version. A transition
        // never mutates repair_case_approvals itself — "consuming" an
        // approval happens implicitly, because this same transaction always
        // bumps repair_cases.version below, so a second attempt to reuse
        // the same approval immediately reads as APPROVAL_STALE.
        if (transition.requiredApprovalType) {
          const [latestApproval] = await tx
            .select({
              status: repairCaseApprovals.status,
              versionAtRequest: repairCaseApprovals.repairCaseVersionAtRequest,
            })
            .from(repairCaseApprovals)
            .where(
              and(
                eq(repairCaseApprovals.repairCaseId, repairCaseId),
                eq(repairCaseApprovals.approvalType, transition.requiredApprovalType)
              )
            )
            .orderBy(desc(repairCaseApprovals.requestedAt))
            .limit(1);

          if (!latestApproval || latestApproval.status !== "APPROVED") {
            return {
              ok: false,
              code: "APPROVAL_REQUIRED",
              message:
                transition.requiredApprovalType === "REPAIR_INSPECTION"
                  ? "수리 검수 승인이 완료되어야 진행할 수 있습니다."
                  : "최종 출하 승인이 완료되어야 진행할 수 있습니다.",
            };
          }
          if (latestApproval.versionAtRequest !== current.version) {
            return {
              ok: false,
              code: "APPROVAL_STALE",
              message: "접수 건 정보가 승인 이후 변경되어 기존 승인을 다시 받아야 합니다.",
            };
          }
        }

        const [toStep] = await tx
          .select({ id: workflowSteps.id })
          .from(workflowSteps)
          .where(and(eq(workflowSteps.workflowVersionId, current.workflowVersionId), eq(workflowSteps.key, transition.toStepKey)));
        if (!toStep) {
          return { ok: false, code: "INVALID_TRANSITION", message: "대상 단계를 확인할 수 없습니다." };
        }
        toStepId = toStep.id;
        toStepKeyForResult = transition.toStepKey;

        setValues.currentWorkflowStepId = toStepId;
        if (actionCode === "SHIPMENT_COMPLETED") {
          setValues.isLocked = true;
          setValues.actualShipmentDate = new Date().toISOString().slice(0, 10);
        }
      } else {
        // HOLD_STARTED / HOLD_RELEASED — never in transition-definitions.ts
        // (they don't move steps); eligibility is category-based, exactly
        // like the local-demo layer.
        const isRelease = actionCode === "HOLD_RELEASED";
        if (isRelease && !holdState.isOnHold) {
          return { ok: false, code: "INVALID_TRANSITION", message: "보류 중이 아닙니다." };
        }
        if (!isRelease && holdState.isOnHold) {
          return { ok: false, code: "INVALID_TRANSITION", message: "이미 보류 중입니다." };
        }

        const eligibility = checkHoldEligibility(
          current.workflowTypeCode,
          current.currentStepKey,
          actingUser,
          current.assignedEngineerId
        );
        if (!eligibility.allowed) {
          return { ok: false, code: "FORBIDDEN", message: eligibility.reason };
        }
        if (!reason) {
          return {
            ok: false,
            code: "REASON_REQUIRED",
            message: isRelease ? "보류 해제 사유를 입력해 주세요." : "보류 사유를 입력해 주세요.",
          };
        }
        // current_workflow_step_id intentionally omitted from setValues —
        // hold actions never move the step.
      }

      await tx.insert(statusChangeHistories).values({
        repairCaseId,
        workflowVersionId: current.workflowVersionId,
        fromStepId: current.currentWorkflowStepId,
        toStepId,
        actionType: actionCode,
        actorUserId: actor.id,
        reason,
      });

      const updatedRows = await tx
        .update(repairCases)
        .set(setValues)
        .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.version, expectedVersion)))
        .returning({ id: repairCases.id, version: repairCases.version });

      if (updatedRows.length === 0) {
        const [stillExists] = await tx
          .select({ id: repairCases.id })
          .from(repairCases)
          .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)));
        if (!stillExists) {
          throw new TransitionConflictError("NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");
        }
        throw new TransitionConflictError("CONFLICT", VERSION_CONFLICT_MESSAGE);
      }

      const updated = updatedRows[0];
      return { ok: true, id: updated.id, version: updated.version, currentWorkflowStepKey: toStepKeyForResult };
    });
  } catch (err) {
    if (err instanceof TransitionConflictError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }
}
