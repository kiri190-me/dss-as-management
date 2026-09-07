import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import DatabaseWorkHistoryScreen from "@/components/repair-cases/work-history/DatabaseWorkHistoryScreen";
import { invalidateWorkRecordAction } from "@/lib/server/actions/repair-case-work-records";
import { getWorkRecordHistoryForCase } from "@/lib/db/queries/repair-case-work-records";
import { getWorkflowHistoryForCase } from "@/lib/db/queries/workflow-history";

const WORK_HISTORY_PAGE_SIZE = 20;

export const metadata: Metadata = {
  title: "작업 이력 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Stage E-2 (더는 사실이 아님): 이 화면은 쓰기 동작이 없어 readSession()이
 * 필요 없었다. 작업 기록 무효화가 작업내용 탭에서 이 탭으로 옮겨 오면서
 * 쓰기 동작이 생겼으므로, 이제 세션과 실제 사용자를 읽어 권한을 판정한다.
 *
 * 이 탭이 그리는 것은 DatabaseWorkHistoryScreen 하나다 — 작업 기록을 본문으로,
 * 워크플로/상태 이력을 접히는 하위 구역으로 보여 준다.
 * resolveRepairCaseForServer가 내놓는 값은 DATABASE 소스이거나 null 뿐이므로
 * (옛 브라우저 저장소 타임라인은 사라졌다) 소스에 따른 분기가 없다.
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

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const [{ rows, total }, workflowHistory] = await Promise.all([
    getWorkRecordHistoryForCase(resolved.id, { limit: WORK_HISTORY_PAGE_SIZE, offset: (page - 1) * WORK_HISTORY_PAGE_SIZE }),
    getWorkflowHistoryForCase(resolved.id),
  ]);

  /**
   * 작업 기록 무효화 권한 — 작업내용 탭(execution/page.tsx)이 쓰던 판정을
   * 글자 그대로 옮긴 것이다: hasPermission(actingUser, "repairCases.workRecords",
   * "MANAGE"). 세션이 없거나 그 세션으로 실제 사용자를 못 찾으면 무효화를
   * 내주지 않는다(상위 (app)/layout.tsx가 이미 두 경우를 로그인으로 돌려보내
   * 므로 여기까지 오지 않지만, 이 화면 혼자서도 닫혀 있어야 한다).
   * 서버 액션도 자기 검사를 그대로 하므로 이 판정은 "보여줄지"만 정한다.
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canInvalidate = actingUser
    ? await hasPermission(actingUser, "repairCases.workRecords", "MANAGE")
    : false;

  return (
    <DatabaseWorkHistoryScreen
      repairCaseId={resolved.id}
      records={rows}
      total={total}
      page={page}
      pageSize={WORK_HISTORY_PAGE_SIZE}
      workflowHistory={workflowHistory}
      canInvalidate={canInvalidate}
      invalidateAction={invalidateWorkRecordAction}
    />
  );
}
