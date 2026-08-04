"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import DetailHeader from "@/components/repair-cases/detail/DetailHeader";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import IntakeInfoSection from "@/components/repair-cases/detail/IntakeInfoSection";
import ProductInfoSection from "@/components/repair-cases/detail/ProductInfoSection";
import FaultServiceSection from "@/components/repair-cases/detail/FaultServiceSection";
import WorkflowProgress from "@/components/repair-cases/detail/WorkflowProgress";
import WorkflowControlPanel from "@/components/repair-cases/workflow/WorkflowControlPanel";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { useEffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";

/**
 * mock(서버 조회)과 local(클라이언트 조회) 두 경로가 모두 이 컴포넌트 하나로
 * 수렴한다. Stage E-1부터 이 컴포넌트가 워크플로 재정의를 적용하는 단일
 * 지점이다 — useEffectiveRepairCase가 계산한 effective 값만 하위 컴포넌트에
 * 전달하며, 그 아래 어떤 컴포넌트도 원본 resolved와 override를 직접
 * 병합하지 않는다.
 */
export default function RepairCaseDetailView({
  resolved,
  related,
  actingUser,
}: {
  resolved: ResolvedRepairCase;
  related: RelatedMatch[];
  actingUser: ActingUser | null;
}) {
  const { effective, isHydrated } = useEffectiveRepairCase(resolved);

  if (!isHydrated || !effective) {
    return <LoadingNotice />;
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader resolved={effective} />
      <ExceptionStatusNotice exceptionStatus={effective.exceptionStatus} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntakeInfoSection resolved={effective} />
        <ProductInfoSection resolved={effective} related={related} />
      </div>
      <FaultServiceSection resolved={effective} />
      <WorkflowProgress workflowType={effective.workflowType} currentWorkflowStepKey={effective.effectiveWorkflowStepKey} />
      <WorkflowControlPanel effective={effective} actingUser={actingUser} />
    </div>
  );
}
