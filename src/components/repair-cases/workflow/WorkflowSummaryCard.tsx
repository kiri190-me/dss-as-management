import { HoldBadge, StatusBadge, WorkflowOverrideBadge } from "@/components/repair-cases/badges";
import { workflowTypeLabels } from "@/lib/domain/types";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import { approvalTypeLabels, approvalStatusLabels } from "@/lib/domain/local/approval/approval-types";
import type { DisplayApprovalStatus } from "@/lib/domain/local/approval/approval-types";

type WorkflowSummaryCardProps = {
  effective: EffectiveRepairCase;
  stepLabel: string;
  stepOrder: number | null;
  responsibleRoleLabel: string;
  inspectionApprovalStatus: DisplayApprovalStatus;
  shipmentApprovalStatus: DisplayApprovalStatus;
};

export default function WorkflowSummaryCard({
  effective,
  stepLabel,
  stepOrder,
  responsibleRoleLabel,
  inspectionApprovalStatus,
  shipmentApprovalStatus,
}: WorkflowSummaryCardProps) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 제어</h2>
        <div className="flex flex-wrap items-center gap-2">
          <WorkflowOverrideBadge hasOverride={effective.hasWorkflowOverride} />
          <HoldBadge isOnHold={effective.holdState?.isOnHold ?? false} />
          <StatusBadge status={effective.effectiveStatus} />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">워크플로 유형</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{workflowTypeLabels[effective.workflowType]}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">현재 단계</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {stepOrder !== null ? `${stepOrder}. ` : ""}
            {stepLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 역할</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{responsibleRoleLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            {approvalTypeLabels.REPAIR_INSPECTION}
          </dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{approvalStatusLabels[inspectionApprovalStatus]}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{approvalTypeLabels.FINAL_SHIPMENT}</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">{approvalStatusLabels[shipmentApprovalStatus]}</dd>
        </div>
      </dl>

      {effective.holdState?.isOnHold && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          보류 사유: {effective.holdState.reason} (시작: {effective.holdState.startedByNameSnapshot})
        </p>
      )}

      {effective.effectiveWorkflowStepKey === "shipment_approved" && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          &ldquo;출하 승인&rdquo;은 워크플로 단계 이름이며, 내부 최종 출하 승인 기록과는 별개입니다.
        </p>
      )}

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        이 워크플로 상태는 이 브라우저에만 저장되는 데모이며, 역할·승인 검사는 서버가 아닌 화면 코드가 수행하는
        데모 시뮬레이션입니다. 실제 감사 로그나 법적 효력이 있는 기록이 아닙니다.
      </p>
    </section>
  );
}
