"use client";

import { useState } from "react";
import { workflowSteps } from "@/lib/domain/mock-data";
import { roleLabels } from "@/lib/domain/types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { findRecordFor, getDisplayStatus } from "@/lib/domain/local/approval/transitions";
import { useApprovalStore } from "@/lib/domain/local/approval/use-approval-data";
import {
  advanceStep,
  completeShipment,
  releaseHold,
  returnStep,
  startHold,
  type WorkflowActionResult,
} from "@/lib/domain/local/workflow/actions";
import { checkHoldEligibility, checkTransitionEligibility } from "@/lib/domain/local/workflow/permissions";
import { getStepCategory, roleForCategory } from "@/lib/domain/local/workflow/step-category";
import { findTransitionDefinition } from "@/lib/domain/local/workflow/transition-definitions";
import { useWorkflowStore } from "@/lib/domain/local/workflow/use-workflow-data";
import { RELEASED_HOLD_STATE } from "@/lib/domain/local/workflow/workflow-types";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import HoldDialog from "./HoldDialog";
import ReleaseHoldDialog from "./ReleaseHoldDialog";
import ShipmentCompletionDialog from "./ShipmentCompletionDialog";
import TransitionDialog from "./TransitionDialog";
import WorkflowActionList, { type WorkflowActionItem } from "./WorkflowActionList";
import WorkflowEventTimeline from "./WorkflowEventTimeline";
import WorkflowSummaryCard from "./WorkflowSummaryCard";

function stepLabelAndOrder(workflowType: EffectiveRepairCase["workflowType"], stepKey: string) {
  const step = workflowSteps.find((s) => s.workflowType === workflowType && s.key === stepKey);
  return { label: step?.label ?? stepKey, order: step?.order ?? null };
}

type StatusMessage = { type: "success" | "error"; text: string };
type DialogKind = "advance" | "return" | "hold" | "release" | "ship" | null;

export default function WorkflowControlPanel({
  effective,
  actingUser,
}: {
  effective: EffectiveRepairCase;
  actingUser: ActingUser | null;
}) {
  const approvalStore = useApprovalStore();
  const workflowStore = useWorkflowStore();

  const [openDialog, setOpenDialog] = useState<DialogKind>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  const holdState = effective.holdState ?? RELEASED_HOLD_STATE;
  const currentStepKey = effective.effectiveWorkflowStepKey;

  const advanceTransition = findTransitionDefinition(effective.workflowType, "STEP_ADVANCED", currentStepKey);
  const returnTransition = findTransitionDefinition(effective.workflowType, "STEP_RETURNED", currentStepKey);
  const shipmentTransition = findTransitionDefinition(effective.workflowType, "SHIPMENT_COMPLETED", currentStepKey);

  const inspectionRecord = findRecordFor(approvalStore.records, effective.id, "REPAIR_INSPECTION");
  const shipmentRecord = findRecordFor(approvalStore.records, effective.id, "FINAL_SHIPMENT");
  const inspectionStatus = getDisplayStatus(inspectionRecord);
  const shipmentApprovalStatus = getDisplayStatus(shipmentRecord);

  const stepInfo = stepLabelAndOrder(effective.workflowType, currentStepKey);
  const category = getStepCategory(effective.workflowType, currentStepKey);
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

    const eligibility = checkTransitionEligibility(transition, actingUser, effective.assignedEngineerId, holdState);
    if (!eligibility.allowed) return { available: false as const, reason: eligibility.reason };

    if (transition.requiredApprovalType === "REPAIR_INSPECTION" && inspectionStatus !== "APPROVED") {
      return {
        available: false as const,
        reason: approvalStore.isMalformed
          ? "승인 데이터를 확인할 수 없어 이 작업을 진행할 수 없습니다."
          : "수리 검수 승인이 완료되어야 합니다.",
      };
    }
    if (transition.requiredApprovalType === "FINAL_SHIPMENT" && shipmentApprovalStatus !== "APPROVED") {
      return {
        available: false as const,
        reason: approvalStore.isMalformed
          ? "승인 데이터를 확인할 수 없어 이 작업을 진행할 수 없습니다."
          : "최종 출하 승인이 완료되어야 합니다.",
      };
    }
    return { available: true as const };
  }

  function evaluateHold(isRelease: boolean) {
    if (!actingUser) return { available: false as const, reason: "로그인한 사용자 정보를 확인할 수 없습니다." };
    if (isRelease && !holdState.isOnHold) return { available: false as const, reason: "보류 중이 아닙니다." };
    if (!isRelease && holdState.isOnHold) return { available: false as const, reason: "이미 보류 중입니다." };
    const eligibility = checkHoldEligibility(effective.workflowType, currentStepKey, actingUser, effective.assignedEngineerId);
    if (!eligibility.allowed) return { available: false as const, reason: eligibility.reason };
    return { available: true as const };
  }

  const advanceAvailability = evaluate("STEP_ADVANCED");
  const returnAvailability = evaluate("STEP_RETURNED");
  const shipAvailability = evaluate("SHIPMENT_COMPLETED");
  const holdStartAvailability = evaluateHold(false);
  const holdReleaseAvailability = evaluateHold(true);

  function handleResult(result: WorkflowActionResult, successText: string) {
    if (result.ok) {
      setOpenDialog(null);
      setStatusMessage({ type: "success", text: successText });
    } else {
      setStatusMessage({ type: "error", text: result.message });
    }
  }

  function baseInput() {
    return {
      repairCaseId: effective.id,
      workflowType: effective.workflowType,
      assignedEngineerId: effective.assignedEngineerId,
      baselineStatus: effective.status,
      baselineStepKey: effective.currentWorkflowStepKey,
      actingUser: actingUser!,
    };
  }

  const actions: WorkflowActionItem[] = [
    {
      key: "advance",
      label: advanceTransition ? `다음 단계로 진행 (${stepLabelAndOrder(effective.workflowType, advanceTransition.toStepKey).label})` : "다음 단계로 진행",
      availability: advanceAvailability,
      onClick: () => setOpenDialog("advance"),
    },
    {
      key: "return",
      label: returnTransition ? `이전 단계로 되돌리기 (${stepLabelAndOrder(effective.workflowType, returnTransition.toStepKey).label})` : "이전 단계로 되돌리기",
      availability: returnAvailability,
      onClick: () => setOpenDialog("return"),
      tone: "warning",
    },
    holdState.isOnHold
      ? {
          key: "release",
          label: "보류 해제",
          availability: holdReleaseAvailability,
          onClick: () => setOpenDialog("release"),
          tone: "success",
        }
      : {
          key: "hold",
          label: "보류 시작",
          availability: holdStartAvailability,
          onClick: () => setOpenDialog("hold"),
          tone: "warning",
        },
    {
      key: "ship",
      label: "출하 완료 처리",
      availability: shipAvailability,
      onClick: () => setOpenDialog("ship"),
      tone: "success",
    },
  ];

  const caseEvents = workflowStore.events.filter((e) => e.repairCaseId === effective.id);

  return (
    <div className="flex flex-col gap-4">
      <WorkflowSummaryCard
        effective={effective}
        stepLabel={stepInfo.label}
        stepOrder={stepInfo.order}
        responsibleRoleLabel={responsibleRoleLabel}
        inspectionApprovalStatus={inspectionStatus}
        shipmentApprovalStatus={shipmentApprovalStatus}
      />

      {workflowStore.isMalformed && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          저장된 워크플로 데이터를 확인할 수 없어 이번 세션에서는 원본 상태만 표시합니다.
        </p>
      )}

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

      <WorkflowActionList actions={actions} />

      <WorkflowEventTimeline events={caseEvents} approvalRecords={approvalStore.records} />

      <TransitionDialog
        isOpen={openDialog === "advance"}
        mode="advance"
        fromStepLabel={stepInfo.label}
        toStepLabel={advanceTransition ? stepLabelAndOrder(effective.workflowType, advanceTransition.toStepKey).label : ""}
        toStatusLabel={advanceTransition?.toStatus ?? ""}
        requiresApprovalLabel={
          advanceTransition?.requiredApprovalType === "REPAIR_INSPECTION"
            ? "수리 검수 승인이 완료되어 있어야 진행할 수 있습니다."
            : null
        }
        isSubmitting={false}
        onConfirm={() => handleResult(advanceStep(baseInput()), "다음 단계로 진행했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <TransitionDialog
        isOpen={openDialog === "return"}
        mode="return"
        fromStepLabel={stepInfo.label}
        toStepLabel={returnTransition ? stepLabelAndOrder(effective.workflowType, returnTransition.toStepKey).label : ""}
        toStatusLabel={returnTransition?.toStatus ?? ""}
        requiresApprovalLabel={null}
        isSubmitting={false}
        onConfirm={(reason) => handleResult(returnStep({ ...baseInput(), reason: reason ?? undefined }), "이전 단계로 되돌렸습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <HoldDialog
        isOpen={openDialog === "hold"}
        isSubmitting={false}
        onConfirm={(reason) => handleResult(startHold({ ...baseInput(), reason }), "보류를 시작했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <ReleaseHoldDialog
        isOpen={openDialog === "release"}
        holdReason={holdState.reason}
        isSubmitting={false}
        onConfirm={(reason) => handleResult(releaseHold({ ...baseInput(), reason }), "보류를 해제했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />

      <ShipmentCompletionDialog
        isOpen={openDialog === "ship"}
        isSubmitting={false}
        onConfirm={(note) => handleResult(completeShipment({ ...baseInput(), note }), "출하 완료로 처리했습니다.")}
        onCancel={() => setOpenDialog(null)}
      />
    </div>
  );
}
