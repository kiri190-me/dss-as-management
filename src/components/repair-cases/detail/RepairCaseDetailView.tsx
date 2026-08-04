import DetailHeader from "@/components/repair-cases/detail/DetailHeader";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import IntakeInfoSection from "@/components/repair-cases/detail/IntakeInfoSection";
import ProductInfoSection from "@/components/repair-cases/detail/ProductInfoSection";
import FaultServiceSection from "@/components/repair-cases/detail/FaultServiceSection";
import WorkflowProgress from "@/components/repair-cases/detail/WorkflowProgress";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import type { RelatedMatch } from "@/lib/domain/local/product-history-match";

/**
 * mock(서버 조회)과 local(클라이언트 조회) 두 경로가 모두 이 컴포넌트 하나로
 * 수렴한다 — 이미 ResolvedRepairCase로 정규화된 데이터만 받으므로 이 컴포넌트
 * 자체는 source를 분기하지 않는다.
 */
export default function RepairCaseDetailView({
  resolved,
  related,
}: {
  resolved: ResolvedRepairCase;
  related: RelatedMatch[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <DetailHeader resolved={resolved} />
      <ExceptionStatusNotice exceptionStatus={resolved.exceptionStatus} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntakeInfoSection resolved={resolved} />
        <ProductInfoSection resolved={resolved} related={related} />
      </div>
      <FaultServiceSection resolved={resolved} />
      <WorkflowProgress resolved={resolved} />
    </div>
  );
}
