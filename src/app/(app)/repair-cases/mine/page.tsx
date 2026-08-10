import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { canViewMyActiveWork } from "@/lib/auth/my-active-work-authorization";
import { listMyActiveRepairCases } from "@/lib/db/queries/repair-cases-mine";
import MyActiveWorkScreen from "@/components/repair-cases/mine/MyActiveWorkScreen";

export const metadata: Metadata = {
  title: "내 담당 제품 | DSS A/S 관리 시스템",
};

// DB-backed rows must never be statically cached — always re-query at
// request time, same convention as /repair-cases and /procedures.
export const dynamic = "force-dynamic";

/**
 * Phase 5C-3 — "내 담당 제품" / My Active Work. AS_ENGINEER-only, both here
 * (server-side, the real enforcement boundary) and in navigation.ts (the
 * nav-visibility UX convenience) — hiding the nav item alone is never
 * sufficient. This is a database-mode-only capability: it depends on a
 * real repair_cases.assigned_engineer_id matching a real session identity,
 * neither of which mock/local mode meaningfully provides, so mock mode
 * gets the same PlaceholderPage treatment /procedures already established
 * for this exact situation.
 */
export default async function MyActiveWorkPage() {
  const readSourceIsDatabase = getRepairCaseReadSource() === "database";
  if (!readSourceIsDatabase) {
    return (
      <PlaceholderPage
        title="내 담당 제품"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!canViewMyActiveWork(actingUser.role)) {
    return (
      <PlaceholderPage
        title="내 담당 제품"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const rows = await listMyActiveRepairCases(actingUser.id);

  return <MyActiveWorkScreen rows={rows} />;
}
