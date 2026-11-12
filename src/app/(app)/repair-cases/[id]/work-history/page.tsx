import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { canOpenRepairCaseDetailTab } from "@/lib/auth/repair-case-detail-tab-access";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import DatabaseWorkHistoryScreen from "@/components/repair-cases/work-history/DatabaseWorkHistoryScreen";
import { editWorkRecordAction, invalidateWorkRecordAction } from "@/lib/server/actions/repair-case-work-records";
import { getWorkRecordCaseContext, getWorkRecordHistoryForCase } from "@/lib/db/queries/repair-case-work-records";
import { getWorkflowHistoryForCase } from "@/lib/db/queries/workflow-history";
import { canEditWorkRecord } from "@/lib/auth/repair-case-work-record-authorization";
import { actorMay } from "@/lib/auth/developer-promotion";

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

  /**
   * 🔴 **주소를 직접 쳐도 막힌다**(2026-11-12). 탭 줄이 이 탭을 감추는 것은 관문이
   * 아니다 — 관문은 여기다. 레이아웃과 **같은 창구·같은 열쇠**를 부른다
   * (`auth/repair-case-detail-tab-access.ts`).
   *
   * 🔴 세션·행위자를 읽는 자리가 **아래 조회들보다 위로 올라왔다.** 예전에는 무효화
   * 권한을 정하려고 조회가 끝난 뒤에 읽었는데, 막을 사람의 작업 기록을 먼저 읽고 나서
   * 버리는 꼴이 된다. 같은 값을 아래에서 그대로 쓴다 — 두 번 읽지 않는다.
   *
   * 🔴 이 탭의 열쇠는 `repairCases.workHistory` 로 **`workRecords` 와 다르다.** 두 탭이
   * 같은 작업 기록을 다루지만 하는 일이 다르다(저쪽은 적는 자리, 이쪽은 지나간 것을
   * 보는 자리). 그래서 [작업내용]을 닫아도 이 목록은 그대로 보이고, 아래의 고치기·
   * 무효 처리 단추만 사라진다.
   */
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  if (!(await canOpenRepairCaseDetailTab(actingUser, "workHistory"))) {
    return (
      <PlaceholderPage
        title="작업 이력"
        description="「작업 이력」 탭을 볼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요."
      />
    );
  }

  const [{ rows, total }, workflowHistory, caseContext] = await Promise.all([
    getWorkRecordHistoryForCase(resolved.id, { limit: WORK_HISTORY_PAGE_SIZE, offset: (page - 1) * WORK_HISTORY_PAGE_SIZE }),
    getWorkflowHistoryForCase(resolved.id),
    // 고치기 권한 판정에 쓰는 건 맥락(담당 엔지니어·잠금) — 서버 액션도
    // 같은 값을 제 트랜잭션에서 다시 읽고 다시 판정한다.
    getWorkRecordCaseContext(resolved.id),
  ]);

  /**
   * 작업 기록 무효화 권한 — 작업내용 탭(execution/page.tsx)이 쓰던 판정을
   * 글자 그대로 옮긴 것이다: hasPermission(actingUser, "repairCases.workRecords",
   * "MANAGE"). 세션이 없거나 그 세션으로 실제 사용자를 못 찾으면 무효화를
   * 내주지 않는다(상위 (app)/layout.tsx가 이미 두 경우를 로그인으로 돌려보내
   * 므로 여기까지 오지 않지만, 이 화면 혼자서도 닫혀 있어야 한다).
   * 서버 액션도 자기 검사를 그대로 하므로 이 판정은 "보여줄지"만 정한다.
   *
   * 🔴 `actingUser` 는 위 탭 관문에서 이미 읽어 둔 그 값이다(2026-11-12) — 여기서
   * 다시 읽지 않는다. 열쇠는 여전히 **`workRecords`** 다: 이 탭에 들어오는 열쇠
   * (`workHistory`)와 **일부러 다르다.**
   */
  const canInvalidate = actingUser
    ? await hasPermission(actingUser, "repairCases.workRecords", "MANAGE")
    : false;

  /**
   * 자기가 쓴 작업 기록을 고칠 수 있는가(2026-10-02).
   *
   * 🔴 권한 축은 **WRITE** 다 — manage(무효 처리)가 아니다. 수정은 제 규칙을
   * 가진 별개의 일이고, 관리자가 그 역할을 READ 로 낮추면 남기기와 함께
   * 막혀야 한다(canEditWorkRecord 주석).
   *
   * 여기서 보는 것은 「이 역할이 **자기 것**을 고칠 수 있는가」까지다
   * (isAuthor: true 를 넣어 묻는다). 「이 줄이 정말 내 것인가」는 화면이
   * currentUserId 로 줄마다 가리고, 서버 액션이 제 트랜잭션에서 다시 판정한다.
   */
  const isAssignedToCase = actingUser !== null && caseContext?.assignedEngineerId === actingUser.id;
  const canEditOwnRecords =
    actingUser !== null &&
    actorMay(actingUser, (role) =>
      canEditWorkRecord(role, {
        isAuthor: true,
        isAssignedToCase,
        isCaseLocked: caseContext?.isLocked ?? false,
      })
    ) &&
    (await hasPermission(actingUser, "repairCases.workRecords", "WRITE"));

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
      canEditOwnRecords={canEditOwnRecords}
      currentUserId={actingUser?.id ?? null}
      editAction={editWorkRecordAction}
    />
  );
}
