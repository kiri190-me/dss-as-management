import { notFound } from "next/navigation";
import { mockRepairCases } from "@/lib/domain/mock-data";
import DetailTabs from "@/components/repair-cases/detail/DetailTabs";

export default async function RepairCaseDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
