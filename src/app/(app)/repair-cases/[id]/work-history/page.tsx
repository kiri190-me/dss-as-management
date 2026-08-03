import type { Metadata } from "next";
import { buildWorkHistoryRows } from "@/lib/domain/work-history-rows";
import WorkHistoryList from "@/components/repair-cases/work-history/WorkHistoryList";

export const metadata: Metadata = {
  title: "작업 이력 | DSS A/S 관리 시스템",
};

export default async function WorkHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 상위 layout.tsx가 존재 여부를 이미 확인했으므로(notFound() 처리) 여기서는
  // 별도의 존재 확인 없이 바로 이력을 조회한다.
  const entries = buildWorkHistoryRows(id);

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 이력</h2>
      <WorkHistoryList entries={entries} />
    </div>
  );
}
