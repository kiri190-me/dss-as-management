import {
  HoldBadge,
  OverdueBadge,
  PriorityBadge,
  SourceBadge,
  StatusBadge,
  WorkflowOverrideBadge,
} from "@/components/repair-cases/badges";
import EngineerEditCell from "@/components/repair-cases/detail/edit/EngineerEditCell";
import ReportNumberEditCell from "@/components/repair-cases/detail/edit/ReportNumberEditCell";
import { workflowTypeLabels } from "@/lib/domain/types";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";

/**
 * Stage E-1부터 원본 resolved.status/isOverdue가 아니라 effectiveStatus/
 * effectiveIsOverdue를 표시한다 — 워크플로 재정의가 있으면 그 결과를,
 * 없으면 원본과 동일한 값을 그대로 보여준다(effective-repair-case.ts 참고).
 *
 * 담당 엔지니어와 보고서번호는 이 카드가 유일한 정상 편집 지점이다(각각 고장
 * 및 서비스 정보 / 인수 정보의 편집 폼에는 더 이상 없다) —
 * canEditEngineer/canEditReportNumber/referenceData는 RepairCaseDetailView가
 * 계산해 그대로 전달한다.
 */
export default function DetailHeader({
  resolved,
  canEditEngineer,
  canEditReportNumber,
  referenceData,
}: {
  resolved: EffectiveRepairCase;
  canEditEngineer: boolean;
  canEditReportNumber: boolean;
  referenceData: IntakeReferenceData | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {resolved.intakeNumber}
        </h1>
        {/* 편집 중에는 이 자리에 form이 렌더링되므로 p가 아니라 div다
            (p 안의 form/div는 브라우저가 다시 배치해 hydration이 깨진다). */}
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          보고서번호{" "}
          <ReportNumberEditCell
            repairCaseId={resolved.id}
            version={resolved.version}
            legacyReportNumber={resolved.legacyReportNumber}
            canEdit={canEditReportNumber}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={resolved.effectiveStatus} />
        <PriorityBadge priority={resolved.priority} />
        <OverdueBadge isOverdue={resolved.effectiveIsOverdue} />
        <HoldBadge isOnHold={resolved.holdState?.isOnHold ?? false} />
        <WorkflowOverrideBadge hasOverride={resolved.hasWorkflowOverride} />
        <SourceBadge source={resolved.source} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">워크플로 유형</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            {workflowTypeLabels[resolved.workflowType]}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">담당 엔지니어</dt>
          <dd className="text-zinc-900 dark:text-zinc-50">
            <EngineerEditCell
              repairCaseId={resolved.id}
              version={resolved.version}
              assignedEngineerId={resolved.assignedEngineerId}
              engineerName={resolved.engineerName}
              canEdit={canEditEngineer}
              referenceData={referenceData}
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}
