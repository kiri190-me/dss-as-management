import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { listRepairCases } from "@/lib/db/queries/repair-cases";
import DashboardContent from "@/components/dashboard/DashboardContent";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";

export const metadata: Metadata = {
  title: "대시보드 | DSS A/S 관리 시스템",
};

// DB-backed rows must never be statically cached — this route always
// re-queries at request time in database mode (and does no I/O at all in
// mock mode, so this has no cost there). Same reasoning, same wording as
// repair-cases/page.tsx: 대시보드 카드는 그 목록과 같은 행을 세는 화면이므로
// 캐시 정책도 같아야 한다 — 한쪽만 캐시되면 두 화면 숫자가 다시 어긋난다.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // (app)/layout.tsx already gates session + approval status for every
  // route in this group; this repeats the no-session check at the point of
  // the DB query itself (same defensive pattern repair-cases/page.tsx
  // already uses) so the query can never run without a validated session.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // Mock 모드에서는 서버 조회를 아예 하지 않고 이전과 완전히 동일하게
  // 렌더한다 — DashboardContent가 prop 없이 mock base를 쓰던 기존 경로
  // 그대로다. Database 모드에서만 전체 A/S 현황(repair-cases/page.tsx)과
  // 똑같은 listRepairCases()를 호출해 같은 행 집합을 넘긴다: 두 화면이
  // 같은 쿼리를 공유하는 것이 "연동"의 실체이고, 대시보드가 자체 집계
  // 쿼리를 따로 갖지 않는 이유다(집계는 클라이언트에서 그 행들로부터
  // computeDashboardSummary가 계산한다 — dashboard-metrics.ts 참고).
  const readSource = getRepairCaseReadSource();
  const serverBaseCases = readSource === "database" ? await listRepairCases() : undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          대시보드
        </h1>
        <DemoReferenceNotice />
      </div>
      <DashboardContent serverBaseCases={serverBaseCases} />
    </div>
  );
}
