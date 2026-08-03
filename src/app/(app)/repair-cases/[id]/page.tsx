import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildRepairCaseDetail } from "@/lib/domain/repair-case-detail";
import DetailHeader from "@/components/repair-cases/detail/DetailHeader";
import ExceptionStatusNotice from "@/components/repair-cases/detail/ExceptionStatusNotice";
import IntakeInfoSection from "@/components/repair-cases/detail/IntakeInfoSection";
import ProductInfoSection from "@/components/repair-cases/detail/ProductInfoSection";
import FaultServiceSection from "@/components/repair-cases/detail/FaultServiceSection";
import WorkflowProgress from "@/components/repair-cases/detail/WorkflowProgress";

export const metadata: Metadata = {
  title: "A/S 상세 | DSS A/S 관리 시스템",
};

export default async function RepairCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = buildRepairCaseDetail(id);

  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 detail은
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!detail) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader detail={detail} />
      <ExceptionStatusNotice exceptionStatus={detail.repairCase.exceptionStatus} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntakeInfoSection detail={detail} />
        <ProductInfoSection detail={detail} />
      </div>
      <FaultServiceSection detail={detail} />
      <WorkflowProgress repairCase={detail.repairCase} />
    </div>
  );
}
