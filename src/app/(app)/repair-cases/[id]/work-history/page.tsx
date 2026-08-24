import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import ActivityTimelineScreen from "@/components/repair-cases/work-history/ActivityTimelineScreen";
import DatabaseWorkHistoryScreen from "@/components/repair-cases/work-history/DatabaseWorkHistoryScreen";
import { getWorkRecordHistoryForCase } from "@/lib/db/queries/repair-case-work-records";
import { getWorkflowHistoryForCase } from "@/lib/db/queries/workflow-history";

const WORK_HISTORY_PAGE_SIZE = 20;

export const metadata: Metadata = {
  title: "작업 이력 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Stage E-2: 이 화면은 쓰기 동작을 추가하지 않으므로 readSession()은 필요 없다.
 *
 * Stage G-2 Batch 3: resolveMockRepairCaseById → resolveRepairCaseForServer로
 * 교체해 database 모드의 UUID도 이 탭에 도달할 수 있게 한다. mockWorkHistories/
 * 로컬 이벤트 병합 로직 자체는 변경하지 않는다 — MOCK/LOCAL_DEMO 소스 건은
 * 대응하는 mockWorkHistories/로컬 이벤트가 없으므로 기존 "이력 없음" 빈 상태를
 * 그대로 보여준다(ActivityTimelineScreen, 이번 배치에서도 변경하지 않음).
 *
 * Phase 5C-2: a DATABASE-sourced case now gets its own branch —
 * DatabaseWorkHistoryScreen (work records as primary content, workflow/
 * status history as a secondary collapsible subsection) — entirely
 * additive, ActivityTimelineScreen's local-only merge logic is untouched.
 */
export default async function WorkHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  if (resolved.source !== "DATABASE") {
    return <ActivityTimelineScreen resolved={resolved} />;
  }

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [{ rows, total }, workflowHistory] = await Promise.all([
    getWorkRecordHistoryForCase(resolved.id, { limit: WORK_HISTORY_PAGE_SIZE, offset: (page - 1) * WORK_HISTORY_PAGE_SIZE }),
    getWorkflowHistoryForCase(resolved.id),
  ]);

  return (
    <DatabaseWorkHistoryScreen
      repairCaseId={resolved.id}
      records={rows}
      total={total}
      page={page}
      pageSize={WORK_HISTORY_PAGE_SIZE}
      workflowHistory={workflowHistory}
    />
  );
}
