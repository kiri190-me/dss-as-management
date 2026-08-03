import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { mockRepairCases } from "@/lib/domain/mock-data";

export const metadata: Metadata = {
  title: "A/S 상세 | DSS A/S 관리 시스템",
};

export default async function RepairCaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repairCase = mockRepairCases.find((candidate) => candidate.id === id);

  if (!repairCase) {
    return (
      <PlaceholderPage
        title="접수 건을 찾을 수 없습니다"
        description="요청하신 인수번호를 확인할 수 없습니다. 전체 A/S 현황 목록에서 다시 선택해 주세요."
      />
    );
  }

  return (
    <PlaceholderPage
      title={repairCase.intakeNumber}
      description="A/S 상세 화면은 준비 중입니다. 다음 단계에서 제공될 예정입니다."
    />
  );
}
