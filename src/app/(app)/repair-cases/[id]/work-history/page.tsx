import type { Metadata } from "next";
import { isLocalId } from "@/lib/domain/local/local-types";
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
  // 상위 layout.tsx가 존재 여부를 이미 확인했으므로(notFound() 처리 또는
  // LocalCaseGate) 여기서는 별도의 존재 확인 없이 바로 이력을 조회한다.
  //
  // local- 접수 건은 이 스테이지에서 작업 이력 생성 기능이 구현되지 않았으므로
  // "항상 빈 배열"이 명시적인 결정이다 — mockWorkHistories를 local id로 조회했을
  // 때 우연히 빈 배열이 나오는 것에 기대지 않는다.
  const entries = isLocalId(id) ? [] : buildWorkHistoryRows(id);

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">작업 이력</h2>
      <WorkHistoryList entries={entries} />
    </div>
  );
}
