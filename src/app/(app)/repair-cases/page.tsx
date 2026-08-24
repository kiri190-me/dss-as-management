import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { listDeletedRepairCases, listRepairCases } from "@/lib/db/queries/repair-cases";
import {
  canDecideAnyRepairCaseApproval,
  listRepairCasesPendingMyApproval,
} from "@/lib/db/queries/repair-case-approvals-pending";
import RepairCaseListPage from "@/components/repair-cases/RepairCaseListPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "전체 A/S 현황 | DSS A/S 관리 시스템",
};

// DB-backed rows must never be statically cached — this route always
// re-queries at request time in database mode (and does no I/O at all in
// mock mode, so this has no cost there).
export const dynamic = "force-dynamic";

export default async function RepairCasesPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("repairCases");

  // (app)/layout.tsx already gates session + approval status for every
  // route in this group; this repeats the no-session check at the point of
  // the DB query itself (same defensive pattern [id]/page.tsx already
  // uses) so the query can never run without a validated session.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  const readSource = getRepairCaseReadSource();

  if (readSource === "mock") {
    return (
      <Suspense>
        <RepairCaseListPage />
      </Suspense>
    );
  }

  const serverBaseCases = await listRepairCases();

  // Bulk soft-delete checkpoint — UX hint only (canBulkDeleteRepairCases is
  // independently re-checked by bulkDeleteRepairCasesAction regardless of
  // what this renders). Only ever true in DATABASE write-source mode, same
  // gate create-repair-case.ts/update-repair-case.ts's Server Actions
  // enforce for their own writes.
  const actingUser = await resolveActingUserForSession(session);
  const isDatabaseWriteMode = getRepairCaseWriteSource() === "database";
  // 일괄 삭제·복원·영구 삭제는 한 노드가 지배한다 — 세 함수의 역할 집합이
  // 정확히 같음을 확인하고 접었다(전부 관리자 이상). 한 번만 묻는다.
  const mayManageLifecycle =
    isDatabaseWriteMode &&
    actingUser !== null &&
    (await hasPermission(actingUser.role, "repairCases.lifecycle", "MANAGE"));
  const canBulkDelete = mayManageLifecycle;

  // Repair Case Trash + Restore checkpoint — same UX-hint-only precedent as
  // canBulkDelete (restoreRepairCasesAction independently re-checks role/
  // write-source). The 휴지통 query only ever runs for an admin session in
  // DATABASE mode — every other role/mode never even fetches deleted rows.
  const canRestore = mayManageLifecycle;
  const serverTrashCases = canRestore ? await listDeletedRepairCases() : undefined;

  // Repair Case Permanent Delete checkpoint — same UX-hint-only precedent
  // as canBulkDelete/canRestore (permanentlyDeleteRepairCasesAction
  // independently re-checks role/write-source).
  const canPermanentlyDelete = mayManageLifecycle;

  // "내게 온 결재 요청" 필터의 근거. 세션에서 푼 사용자 id만 넘긴다 — 이 조회에는
  // 다른 사람의 목록을 요구할 수 있는 인자가 없고, 결재 권한 판정도 조회
  // 함수가 서버에서 스스로 한다(화면이 보낸 값은 아무것도 신뢰하지 않는다).
  // 결재 권한이 아예 없는 세션은 빈 배열을 받으므로, 필터는 보이되 0건이 되는
  // 대신 아래에서 undefined로 접어 조건 자체를 감춘다.
  const pendingApprovalItems = await listRepairCasesPendingMyApproval(session.userId);
  // 0건일 때 "결재할 게 없다"와 "애초에 결재자가 아니다"는 다르다 — 전자는
  // 조건을 보여 주고(딥링크로 들어와도 그대로 동작한다), 후자는 눌러도 늘
  // 0건인 조건을 아예 감춘다.
  const canFilterMyPendingApproval =
    pendingApprovalItems.length > 0 || (await canDecideAnyRepairCaseApproval(session.userId));
  const myPendingApprovalCaseIds = canFilterMyPendingApproval
    ? [...new Set(pendingApprovalItems.map((item) => item.repairCaseId))]
    : undefined;

  return (
    <Suspense>
      <RepairCaseListPage
        serverBaseCases={serverBaseCases}
        canBulkDelete={canBulkDelete}
        serverTrashCases={serverTrashCases}
        canRestore={canRestore}
        canPermanentlyDelete={canPermanentlyDelete}
        myPendingApprovalCaseIds={myPendingApprovalCaseIds}
      />
    </Suspense>
  );
}
