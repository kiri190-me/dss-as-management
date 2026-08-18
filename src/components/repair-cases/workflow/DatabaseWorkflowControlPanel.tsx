"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { roleLabels } from "@/lib/domain/types";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { roleForCategory } from "@/lib/domain/local/workflow/step-category";
import { findTransitionInDto, type WorkflowRulesDto } from "@/lib/domain/workflow-rules-view";
import type { HoldState } from "@/lib/domain/local/workflow/workflow-types";
import {
  evaluateAddCaseStepAvailability,
  evaluateHoldAvailabilityForCategory,
  evaluateTransitionAvailability,
  explainUnavailableWorkflowActions,
  type ApprovalGateStatus,
} from "@/lib/domain/local/workflow/workflow-action-availability";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { CurrentHoldState } from "@/lib/db/queries/workflow-history";
import type { CurrentApprovalState } from "@/lib/db/queries/repair-case-approvals";
import { addCaseWorkflowStepAction } from "@/lib/server/actions/case-workflow-steps";
import { transitionWorkflowAction } from "@/lib/server/actions/transition-workflow";
import type { WorkflowActionCode } from "@/lib/validation/workflow-transition-input";
import CaseWorkflowStepDialog from "./CaseWorkflowStepDialog";
import HoldDialog from "./HoldDialog";
import ReleaseHoldDialog from "./ReleaseHoldDialog";
import ShipmentCompletionDialog from "./ShipmentCompletionDialog";
import TransitionDialog from "./TransitionDialog";
import WorkflowActionList, { type WorkflowActionItem } from "./WorkflowActionList";
import WorkflowStageStatus from "./WorkflowStageStatus";

/**
 * Phase 2d: 단계 라벨·순서를 mock-data의 TS 표가 아니라 서버가 내려준 규칙
 * (DB)에서 찾는다. 이 패널은 DATABASE 모드 전용이므로 TS 표를 볼 이유가 없다 —
 * 로컬 데모 모드에는 WorkflowControlPanel.tsx가 따로 있다.
 */
function stepLabelAndOrder(rules: WorkflowRulesDto, stepKey: string) {
  const step = rules.steps.find((s) => s.key === stepKey);
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
type DialogKind = "advance" | "return" | "hold" | "release" | "ship" | "addStep" | null;

/**
 * Database-mode counterpart to WorkflowControlPanel.tsx (local mode) —
 * rendered on the /execution ("작업내용") screen for a DATABASE-sourced case
 * (execution/page.tsx), not on 기본 정보 (Phase 5C-1 moved it off that
 * screen). Reuses WorkflowActionList and all four transition dialogs
 * verbatim (already pure/prop-driven, no localStorage coupling) and the
 * same eligibility-computation functions the local panel uses
 * (findTransitionDefinition/checkTransitionEligibility/
 * checkHoldEligibility) purely for UI hints — the Server Action
 * independently re-evaluates everything; nothing here is trusted. History
 * (DatabaseWorkflowHistoryList) is rendered separately by the page as a
 * collapsible "워크플로 변경 이력" section, not by this component.
 *
 * Approval-gated transitions (requiredApprovalType set) check
 * currentApprovals (repair_case_approvals, fetched server-side) for a
 * matching APPROVED, still-current-version row — same UI-hint-only
 * discipline as every other check here: transitionWorkflow() (the Server
 * Action's mutation) independently re-derives and re-verifies this from
 * the DB, never trusting what this component computed.
 *
 * The four availability checks (evaluate/evaluateHold) and the "why is
 * everything disabled" summary banner (actionExplanation) both delegate to
 * workflow-action-availability.ts — pure, unit-tested functions, extracted
 * so this exact behavior can be verified without a router-dependent
 * component render. isCaseLocked is checked first and unconditionally in
 * both (no admin/superadmin bypass, matching workflow-transitions.ts's own
 * `if (current.isLocked)` check, which has always applied backend-side to
 * every action code). The banner never shows for a role/hold reason a
 * per-button message already covers more specifically — see that file's
 * doc comment for the exact priority.
 */
export default function DatabaseWorkflowControlPanel({
  resolved,
  actingUser,
  holdState,
  currentApprovals,
  isCaseLocked,
  rules,
}: {
  resolved: ResolvedRepairCase;
  actingUser: ActingUser | null;
  holdState: CurrentHoldState;
  currentApprovals: CurrentApprovalState[];
  /** Authoritative repair_cases.is_locked, already loaded by execution/page.tsx (same value the WorkRecordsSection lock-hint already uses) — reused here rather than re-fetched, per the disabled-buttons audit's finding that this panel never checked it. */
  isCaseLocked: boolean;
  /**
   * 서버가 이 접수 건의 workflow_version에서 읽어 내려준 규칙(Phase 2d).
   * 화면 표시는 어차피 힌트일 뿐이지만, 그 힌트가 서버 판정과 다른 표를 보면
   * "버튼은 눌리는데 서버가 거부한다"(또는 그 반대)가 된다.
   */
  rules: WorkflowRulesDto;
}) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<DialogKind>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConflict, setIsConflict] = useState(false);

  const currentStepKey = resolved.currentWorkflowStepKey;
  const holdStateForCheck = toHoldState(holdState);

  const advanceTransition = findTransitionInDto(rules, "STEP_ADVANCED", currentStepKey);
  const returnTransition = findTransitionInDto(rules, "STEP_RETURNED", currentStepKey);
  const shipmentTransition = findTransitionInDto(rules, "SHIPMENT_COMPLETED", currentStepKey);

  const stepInfo = stepLabelAndOrder(rules, currentStepKey);
  const category = rules.steps.find((s) => s.key === currentStepKey)?.category ?? null;
  const responsibleRoleLabel = category
    ? `관리자 또는 ${roleLabels[roleForCategory(category)]}`
    : "관리자(SUPER_ADMIN/ADMIN)";

  function approvalGateStatusFor(transition: ReturnType<typeof findTransitionInDto> | null): ApprovalGateStatus {
    if (!transition?.requiredApprovalType) return "SATISFIED";
    const approval = currentApprovals.find((a) => a.approvalType === transition.requiredApprovalType)?.latest ?? null;
    if (!approval || approval.status !== "APPROVED") return "NOT_APPROVED";
    if (approval.repairCaseVersionAtRequest !== resolved.version) return "STALE";
    return "SATISFIED";
  }

  function evaluate(actionCode: "STEP_ADVANCED" | "STEP_RETURNED" | "SHIPMENT_COMPLETED") {
    const transition =
      (actionCode === "STEP_ADVANCED" ? advanceTransition : actionCode === "STEP_RETURNED" ? returnTransition : shipmentTransition) ?? null;
    return evaluateTransitionAvailability({
      transition,
      actionCode,
      actingUser,
      assignedEngineerId: resolved.assignedEngineerId,
      holdState: holdStateForCheck,
      isCaseLocked,
      approvalGateStatus: approvalGateStatusFor(transition),
    });
  }

  function evaluateHold(isRelease: boolean) {
    // 분류는 이 건의 DB 규칙(rules)에서 온다 — TS 분류표에는 건별로 추가한
    // 단계(case_step_N)가 없어서, 표로 찾으면 서버가 허용하는 보류를 화면이
    // 잠근다.
    return evaluateHoldAvailabilityForCategory({
      isRelease,
      actingUser,
      holdState: holdStateForCheck,
      stepCategory: category,
      assignedEngineerId: resolved.assignedEngineerId,
      isCaseLocked,
    });
  }

  const advanceAvailability = evaluate("STEP_ADVANCED");
  const returnAvailability = evaluate("STEP_RETURNED");
  const shipAvailability = evaluate("SHIPMENT_COMPLETED");
  const holdStartAvailability = evaluateHold(false);
  const holdReleaseAvailability = evaluateHold(true);
  const addStepAvailability = evaluateAddCaseStepAvailability({
    actingUser,
    assignedEngineerId: resolved.assignedEngineerId,
    isCaseLocked,
  });

  const actionExplanation = actingUser
    ? explainUnavailableWorkflowActions({
        workflowType: resolved.workflowType,
        currentStepKey,
        actingRole: actingUser.role,
        isCaseLocked,
        isOnHold: holdState.isOnHold,
      })
    : null;

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

  async function submitAddStep(input: { label: string; status: string; category: string | null }) {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const result = await addCaseWorkflowStepAction({
        repairCaseId: resolved.id,
        expectedVersion: resolved.version,
        label: input.label,
        status: input.status,
        category: input.category,
      });
      if (!result.ok) {
        setStatusMessage({ type: "error", text: result.message });
        return;
      }
      setOpenDialog(null);
      setStatusMessage({ type: "success", text: result.message });
      // 단계를 끼워넣으면 이 건의 workflow_version이 통째로 바뀐다 —
      // 화면이 들고 있는 rules가 곧바로 낡으므로 반드시 다시 읽어야 한다.
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
        ? `다음 단계로 진행 (${stepLabelAndOrder(rules, advanceTransition.toStepKey).label})`
        : "다음 단계로 진행",
      availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : advanceAvailability,
      onClick: () => setOpenDialog("advance"),
    },
    {
      key: "return",
      label: returnTransition
        ? `이전 단계로 되돌리기 (${stepLabelAndOrder(rules, returnTransition.toStepKey).label})`
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
      key: "add-step",
      label: "이 건에만 단계 추가",
      availability: isConflict ? { available: false, reason: "최신 정보를 다시 불러와야 합니다." } : addStepAvailability,
      onClick: () => setOpenDialog("addStep"),
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
      <WorkflowStageStatus
        stepLabel={stepInfo.label}
        stepOrder={stepInfo.order}
        responsibleRoleLabel={responsibleRoleLabel}
        isOnHold={holdState.isOnHold}
        holdReason={holdState.reason}
        holdStartedByName={holdState.startedByName}
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

      {actionExplanation && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {actionExplanation.message}
        </p>
      )}

      <WorkflowActionList actions={actions} />

      <TransitionDialog
        isOpen={openDialog === "advance"}
        mode="advance"
        fromStepLabel={stepInfo.label}
        toStepLabel={advanceTransition ? stepLabelAndOrder(rules, advanceTransition.toStepKey).label : ""}
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
        toStepLabel={returnTransition ? stepLabelAndOrder(rules, returnTransition.toStepKey).label : ""}
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

      <CaseWorkflowStepDialog
        isOpen={openDialog === "addStep"}
        currentStepLabel={stepInfo.label}
        nextStepLabel={advanceTransition ? stepLabelAndOrder(rules, advanceTransition.toStepKey).label : null}
        isSubmitting={isSubmitting}
        onConfirm={(input) => void submitAddStep(input)}
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
