import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import {
  canBulkDeleteRepairCases,
  canPermanentlyDeleteRepairCases,
  canRestoreRepairCases,
} from "@/lib/auth/repair-case-edit-authorization";
import { listDeletedRepairCases, listRepairCases } from "@/lib/db/queries/repair-cases";
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
  const canBulkDelete = isDatabaseWriteMode && actingUser !== null && canBulkDeleteRepairCases(actingUser.role);

  // Repair Case Trash + Restore checkpoint — same UX-hint-only precedent as
  // canBulkDelete (restoreRepairCasesAction independently re-checks role/
  // write-source). The 휴지통 query only ever runs for an admin session in
  // DATABASE mode — every other role/mode never even fetches deleted rows.
  const canRestore = isDatabaseWriteMode && actingUser !== null && canRestoreRepairCases(actingUser.role);
  const serverTrashCases = canRestore ? await listDeletedRepairCases() : undefined;

  // Repair Case Permanent Delete checkpoint — same UX-hint-only precedent
  // as canBulkDelete/canRestore (permanentlyDeleteRepairCasesAction
  // independently re-checks role/write-source).
  const canPermanentlyDelete =
    isDatabaseWriteMode && actingUser !== null && canPermanentlyDeleteRepairCases(actingUser.role);

  return (
    <Suspense>
      <RepairCaseListPage
        serverBaseCases={serverBaseCases}
        canBulkDelete={canBulkDelete}
        serverTrashCases={serverTrashCases}
        canRestore={canRestore}
        canPermanentlyDelete={canPermanentlyDelete}
      />
    </Suspense>
  );
}
