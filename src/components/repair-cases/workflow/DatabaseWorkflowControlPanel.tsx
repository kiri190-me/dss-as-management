"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { workflowSteps } from "@/lib/domain/mock-data";
import { roleLabels } from "@/lib/domain/types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { checkHoldEligibility, checkTransitionEligibility } from "@/lib/domain/local/workflow/permissions";
import { getStepCategory, roleForCategory } from "@/lib/domain/local/workflow/step-category";
import { findTransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";
import type { HoldState } from "@/lib/domain/local/workflow/workflow-types";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { CurrentHoldState, WorkflowHistoryEntry } from "@/lib/db/queries/workflow-history";
import type { CurrentApprovalState } from "@/lib/db/queries/repair-case-approvals";
import { transitionWorkflowAction } from "@/lib/server/actions/transition-workflow";
import type { WorkflowActionCode } from "@/lib/validation/workflow-transition-input";
import HoldDialog from "./HoldDialog";
import ReleaseHoldDialog from "./ReleaseHoldDialog";
import ShipmentCompletionDialog from "./ShipmentCompletionDialog";
import TransitionDialog from "./TransitionDialog";
import WorkflowActionList, { type WorkflowActionItem } from "./WorkflowActionList";
import DatabaseWorkflowHistoryList from "./DatabaseWorkflowHistoryList";
import DatabaseWorkflowSummaryCard from "./DatabaseWorkflowSummaryCard";

function stepLabelAndOrder(workflowType: ResolvedRepairCase["workflowType"], stepKey: string) {
  const step = workflowSteps.find((s) => s.workflowType === workflowType && s.key === stepKey);
  return { label: step?.label ?? stepKey, order: step?.order ?? null };
}

function toHoldState(current: CurrentHoldState): HoldState {
  return {
    isOnHold: current.isOnHold,
    reason: current.reason,
    startedByUserId: current.startedByUserId,
    startedByNameSnapshot: current.startedByName,
    startedAt: current.startedAt,
  };
}

type StatusMessage = { type: "success" | "error"; text: string };
type DialogKind = "advance" | "return" | "hold" | "release" | "ship" | null;

/**
 * Database-mode counterpart to WorkflowControlPanel.tsx (local mode) —
 * rendered instead of it when resolved.source === "DATABASE"
 * (RepairCaseDetailView.tsx). Reuses WorkflowActionList and all four
 * transition dialogs verbatim (already pure/prop-driven, no localStorage
 * coupling) and the same eligibility-computation functions the local panel
 * uses (findTransitionDefinition/checkTransitionEligibility/
 * checkHoldEligibility) purely for UI hints — the Server Action
 * independently re-evaluates everything; nothing here is trusted.
 *
 * Approval-gated transitions (requiredApprovalType set) check
 * currentApprovals (repair_case_approvals, fetched server-side) for a
 * matching APPROVED, still-current-version row — same UI-hint-only
 * discipline as every other check here: transitionWorkflow() (the Server
 * Action's mutation) independently re-derives and re-verifies this from
 * the DB, never trusting what this component computed.
 */
export default function DatabaseWorkflowControlPanel({
  resolved,
  actingUser,
  history,
  holdState,
  currentApprovals,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  history: WorkflowHistoryEntry[];
  holdState: CurrentHoldState;
  currentApprovals: CurrentApprovalState[];
}) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<DialogKind>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConflict, setIsConflict] = useState(false);

  const currentStepKey = resolved.currentWorkflowStepKey;
  const holdStateForCheck = toHoldState(holdState);

  const advanceTransition = findTransitionDefinition(resolved.workflowType, "STEP_ADVANCED", currentStepKey);
  const returnTransition = findTransitionDefinition(resolved.workflowType, "STEP_RETURNED", currentStepKey);
  const shipmentTransition = findTransitionDefinition(resolved.workflowType, "SHIPMENT_COMPLETED", currentStepKey);

  const stepInfo = stepLabelAndOrder(resolved.workflowType, currentStepKey);
  const category = getStepCategory(resolved.workflowType, currentStepKey);
  const responsibleRoleLabel = category
    ? `관리자 또는 ${roleLabels[roleForCategory(category)]}`
    : "관리자(SUPER_ADMIN/ADMIN)";

  function evaluate(actionCode: "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED") {
    const transition =
      actionCode === "STEP_ADVANCED" ? advanceTransition : actionCode === "STEP_RETURNED" ? returnTransition : shipmentTransition;
    if (!transition) {
      return {
        available: false as const,
        reason:
          actionCode === "STEP_ADVANCED"
            ? "이 단계에서는 다음 단계로 진행할 수 없습니다."
            : actionCode === "STEP_RETURNED"
              ? "이 단계에서는 이전 단계로 되돌릴 수 없습니다."
              : "현재 단계에서는 출하 완료 처리를 할 수 없습니다.",
      };
    }
    if (!actingUser) return { available: false as const, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };

    const eligibility = checkTransitionEligibility(transition, actingUser, resolved.assignedEngineerId, holdStateForCheck);
    if (!eligibility.allowed) return { available: false as const, reason: eligibility.reason };

    if (transition.requiredApprovalType) {
      const approval = currentApprovals.find((a) => a.approvalType === transition.requiredApprovalType)?.latest ?? null;
      if (!approval || approval.status !== "APPROVED") {
        return {
          available: false as const,
          reason:
            transition.requiredApprovalType === "REPAIR_INSPECTION"
              ? "수리 검수 승인이 완료되어야 합니다."
              : "최종 출하 승인이 완료되어야 합니다.",
        };
      }
      if (approval.repairCaseVersionAtRequest !== resolved.version) {
        return {
          available: false as const,
          reason: "접수 건 정보가 승인 이후 변경되어 기존 승인을 다시 받아야 합니다.",
        };
      }
    }
    return { available: true as const };
  }

  function evaluateHold(isRelease: boolean) {
    if (!actingUser) return { available: false as const, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };
    if (isRelease && !holdState.isOnHold) return { available: false as const, reason: "보류 중이 아닙니다." };
    if (!isRelease && holdState.isOnHold) return { available: false as const, reason: "이미 보류 중입니다." };
    const eligibility = checkHoldEligibility(resolved.workflowType, currentStepKey, actingUser, resolved.assignedEngineerId);
    if (!eligibility.allowed) return { available: false as const, reason: eligibility.reason };
    return { available: true as const };
  }

  const advanceAvailability = evaluate("STEP_ADVANCED");
  const returnAvailability = evaluate("STEP_RETURNED");
  const shipAvailability = evaluate("SHIPMENT_COMPLETED");
  const holdStartAvailability = evaluateHold(false);
  const holdReleaseAvailability = evaluateHold(true);

  async function submit(actionCode: WorkflowActionCode, reason: string | null, successText: string) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const result = await transitionWorkflowAction({
        repairCaseId: resolved.id,
        expectedVersion: resolved.version,
        actionCode,
        reason,
      });
      if (!result.ok) {
        if (result.code === "CONFLICT") {
          setIsConflict(true);
        }
        setStatusMessage({ type: "error", text: result.message });
        return;
      }
      setOpenDialog(null);
      setStatusMessage({ type: "success", text: successText });
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    setIsConflict(false);
    setOpenDialog(null);
  }

  const actions: WorkflowActionItem[] = [
    {
      key: "advance",
      label: advanceTransition
        ? `다음 단계로 진행 (${stepLabelAndOrder(resolved.workflowType, advanceTransition.toStepKey).label})`
        : "다음 단계로 진행",
      availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : advanceAvailability,
      onClick: () => setOpenDialog("advance"),
    },
    {
      key: "return",
      label: returnTransition
        ? `이전 단계로 되돌리기 (${stepLabelAndOrder(resolved.workflowType, returnTransition.toStepKey).label})`
        : "이전 단계로 되돌리기",
      availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : returnAvailability,
      onClick: () => setOpenDialog("return"),
      tone: "warning",
    },
    holdState.isOnHold
      ? {
          key: "release",
          label: "보류 해제",
          availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : holdReleaseAvailability,
          onClick: () => setOpenDialog("release"),
          tone: "success",
        }
      : {
          key: "hold",
          label: "보류 시작",
          availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : holdStartAvailability,
          onClick: () => setOpenDialog("hold"),
          tone: "warning",
        },
    {
      key: "ship",
      label: "출하 완료 처리",
      availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : shipAvailability,
      onClick: () => setOpenDialog("ship"),
      tone: "success",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DatabaseWorkflowSummaryCard
        resolved={resolved}
        stepLabel={stepInfo.label}
        stepOrder={stepInfo.order}
        responsibleRoleLabel={responsibleRoleLabel}
        holdState={holdState}
      />

      {statusMessage && (
        <p
          role={statusMessage.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            statusMessage.type === "error"
              ? "rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
              : "rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          }
        >
          {statusMessage.text}
        </p>
      )}

      {isConflict && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={reloadAfterConflict}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            최신 정보 다시 불러오기
          </button>
        </div>
      )}

      <WorkflowActionList actions={actions} />

      <DatabaseWorkflowHistoryList entries={history} />

      <TransitionDialog
        isOpen={openDialog === "advance"}
        mode="advance"
        fromStepLabel={stepInfo.label}
        toStepLabel={advanceTransition ? stepLabelAndOrder(resolved.workflowType, advanceTransition.toStepKey).label : ""}
        toStatusLabel={advanceTransition?.toStatus ?? ""}
        requiresApprovalLabel={
          advanceTransition?.requiredApprovalType === "REPAIR_INSPECTION"
            ? "수리 검수 승인이 완료되어 있어야 진행할 수 있습니다."
            : null
        }
        isSubmitting={isSubmitting}
        onConfirm={() => void submit("STEP_ADVANCED", null, "다음 단계로 진행했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <TransitionDialog
        isOpen={openDialog === "return"}
        mode="return"
        fromStepLabel={stepInfo.label}
        toStepLabel={returnTransition ? stepLabelAndOrder(resolved.workflowType, returnTransition.toStepKey).label : ""}
        toStatusLabel={returnTransition?.toStatus ?? ""}
        requiresApprovalLabel={null}
        isSubmitting={isSubmitting}
        onConfirm={(reason) => void submit("STEP_RETURNED", reason, "이전 단계로 되돌렸습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <HoldDialog
        isOpen={openDialog === "hold"}
        isSubmitting={isSubmitting}
        onConfirm={(reason) => void submit("HOLD_STARTED", reason, "보류를 시작했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <ReleaseHoldDialog
        isOpen={openDialog === "release"}
        holdReason={holdState.reason}
        isSubmitting={isSubmitting}
        onConfirm={(reason) => void submit("HOLD_RELEASED", reason, "보류를 해제했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <ShipmentCompletionDialog
        isOpen={openDialog === "ship"}
        isSubmitting={isSubmitting}
        onConfirm={(note) => void submit("SHIPMENT_COMPLETED", note, "출하 완료로 처리했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />
    </div>
  );
}
