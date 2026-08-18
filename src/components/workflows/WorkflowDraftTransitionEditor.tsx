"use client";

import { useState } from "react";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";
import type { WorkflowDraftStepView } from "@/lib/db/queries/workflow-templates";
import type { WorkflowDraftTransitionView } from "@/lib/db/queries/workflow-templates";

const ACTION_CODES = ["STEP_ADVANCED", "STEP_RETURNED", "SHIPMENT_COMPLETED"] as const;
const ACTION_LABELS: Record<string, string> = {
  STEP_ADVANCED: "진행",
  STEP_RETURNED: "되돌리기",
  SHIPMENT_COMPLETED: "출하 완료",
};
const APPROVAL_LABELS: Record<string, string> = {
  REPAIR_INSPECTION: "수리 검수 승인",
  FINAL_SHIPMENT: "최종 출하 승인",
};

export type TransitionDraftForm = {
  toStepId: string;
  allowedRoles: Role[];
  requiresAssignedEngineer: boolean;
  requiresReason: boolean;
  requiredApprovalType: string | null;
};

/**
 * 한 단계에서 나가는 이동 규칙 세 종류(진행 / 되돌리기 / 출하 완료)를 편집한다.
 *
 * 대상 단계를 "없음"으로 두는 것이 곧 그 규칙의 삭제다 — (버전, 동작, 출발
 * 단계)가 유니크하므로 "이 단계에서 진행을 누르면 어디로 가는가"는 하나뿐이고,
 * 따라서 목록을 편집하는 UI보다 세 줄을 채우는 UI가 실제 모델에 맞는다.
 *
 * 저장은 줄 단위로 명시적으로 누른다. 다른 편집은 즉시 반영하지만 여기는
 * 값이 여러 개(대상·역할·조건)라, 하나 바꿀 때마다 서버에 보내면 중간의
 * 불완전한 조합(역할 0개 등)이 계속 거부된다.
 */
export default function WorkflowDraftTransitionEditor({
  step,
  steps,
  transitions,
  disabled,
  onSave,
  onRemove,
}: {
  step: WorkflowDraftStepView;
  steps: WorkflowDraftStepView[];
  transitions: WorkflowDraftTransitionView[];
  disabled: boolean;
  onSave: (actionCode: string, form: TransitionDraftForm) => void;
  onRemove: (transitionId: string) => void;
}) {
  const outgoing = transitions.filter((t) => t.fromStepId === step.id);
  const summary = outgoing.length === 0 ? "나가는 규칙 없음" : outgoing.map((t) => ACTION_LABELS[t.actionCode]).join(" · ");

  return (
    <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer list-none px-2 py-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        이동 규칙 — {summary}
      </summary>
      <div className="flex flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
        {ACTION_CODES.map((actionCode) => (
          <TransitionRow
            key={actionCode}
            actionCode={actionCode}
            existing={outgoing.find((t) => t.actionCode === actionCode) ?? null}
            step={step}
            steps={steps}
            disabled={disabled}
            onSave={onSave}
            onRemove={onRemove}
          />
        ))}
      </div>
    </details>
  );
}

function TransitionRow({
  actionCode,
  existing,
  step,
  steps,
  disabled,
  onSave,
  onRemove,
}: {
  actionCode: string;
  existing: WorkflowDraftTransitionView | null;
  step: WorkflowDraftStepView;
  steps: WorkflowDraftStepView[];
  disabled: boolean;
  onSave: (actionCode: string, form: TransitionDraftForm) => void;
  onRemove: (transitionId: string) => void;
}) {
  const [toStepId, setToStepId] = useState(existing?.toStepId ?? "");
  const [roles, setRoles] = useState<Role[]>(
    (existing?.allowedRoles as Role[] | undefined) ?? ["SUPER_ADMIN", "ADMIN"]
  );
  const [requiresAssignedEngineer, setRequiresAssignedEngineer] = useState(
    existing?.requiresAssignedEngineer ?? false
  );
  const [requiresReason, setRequiresReason] = useState(existing?.requiresReason ?? false);
  const [approval, setApproval] = useState<string>(existing?.requiredApprovalType ?? "");

  const targets = steps.filter((s) => s.id !== step.id);
  const canSave = toStepId !== "" && roles.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-950">
      <span className="w-16 shrink-0 font-medium text-zinc-700 dark:text-zinc-300">
        {ACTION_LABELS[actionCode]}
      </span>

      <select
        value={toStepId}
        disabled={disabled}
        onChange={(e) => setToStepId(e.target.value)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        aria-label={`${ACTION_LABELS[actionCode]} 대상 단계`}
      >
        <option value="">없음</option>
        {targets.map((target) => (
          <option key={target.id} value={target.id}>
            {target.order}. {target.label}
          </option>
        ))}
      </select>

      <span className="flex flex-wrap items-center gap-1">
        {ROLE_CODES.map((role) => (
          <label key={role} className="flex items-center gap-0.5 text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={roles.includes(role)}
              disabled={disabled}
              onChange={(e) =>
                setRoles((prev) => (e.target.checked ? [...prev, role] : prev.filter((r) => r !== role)))
              }
            />
            {roleLabels[role]}
          </label>
        ))}
      </span>

      <label className="flex items-center gap-0.5 text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={requiresAssignedEngineer}
          disabled={disabled}
          onChange={(e) => setRequiresAssignedEngineer(e.target.checked)}
        />
        담당자만
      </label>
      <label className="flex items-center gap-0.5 text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={requiresReason}
          disabled={disabled}
          onChange={(e) => setRequiresReason(e.target.checked)}
        />
        사유 필수
      </label>

      <select
        value={approval}
        disabled={disabled}
        onChange={(e) => setApproval(e.target.value)}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        aria-label={`${ACTION_LABELS[actionCode]} 승인 요건`}
      >
        <option value="">승인 불필요</option>
        {Object.entries(APPROVAL_LABELS).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-1">
        {roles.length === 0 && <span className="text-red-700 dark:text-red-400">역할 1개 이상</span>}
        <button
          type="button"
          disabled={disabled || !canSave}
          onClick={() =>
            onSave(actionCode, {
              toStepId,
              allowedRoles: roles,
              requiresAssignedEngineer,
              requiresReason,
              requiredApprovalType: approval === "" ? null : approval,
            })
          }
          className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-30 dark:border-zinc-700"
        >
          저장
        </button>
        {existing && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(existing.id)}
            className="rounded-md border border-red-300 px-2 py-1 text-red-700 disabled:opacity-40 dark:border-red-900 dark:text-red-400"
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );
}
