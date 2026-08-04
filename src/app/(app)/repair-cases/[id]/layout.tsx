import { notFound } from "next/navigation";
import { mockRepairCases } from "@/lib/domain/mock-data";
import { isLocalId } from "@/lib/domain/local/local-types";
import DetailTabs from "@/components/repair-cases/detail/DetailTabs";
import LocalCaseGate from "@/components/repair-cases/detail/LocalCaseGate";

export default async function RepairCaseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // local- id는 서버가 localStorage를 볼 수 없으므로 여기서 notFound()를
  // 호출하지 않는다 — 존재 확인은 클라이언트 하이드레이션 이후 LocalCaseGate가
  // 담당한다. 일반 mock ID의 기존 실제 HTTP 404 동작은 아래에서 그대로 유지한다.
  if (isLocalId(id)) {
    return <LocalCaseGate id={id}>{children}</LocalCaseGate>;
  }

  const exists = mockRepairCases.some((candidate) => candidate.id === id);

  if (!exists) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailTabs id={id} />
      {children}
    </div>
  );
}
