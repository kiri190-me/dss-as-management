import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import ReportScreen from "@/components/repair-cases/report/ReportScreen";

export const metadata: Metadata = {
  title: "보고서 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // approval/files/work-history page.tsx와 동일한 기존 인증 로직(readSession)을
  // 그대로 재사용한다. 상위 (app) 레이아웃이 이미 세션을 확인했으므로 여기
  // 도달했다면 정상적으로는 항상 세션이 존재하지만, 방어적으로 한 번 더
  // 확인한다. 이 스테이지는 새 쓰기 동작을 추가하지 않는다 — 보고서 생성자
  // 표시용으로만 최소 검증된 사용자 정보를 클라이언트에 넘긴다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // 클라이언트에는 최소한의 검증된 정보만 넘긴다(id/name/role/approvalStatus).
  // 세션 쿠키 자체나 원본 세션 payload를 내려보내지 않는다.
  const generatedByUser: ActingUser | null = await resolveActingUserForSession(session);

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다(실제 HTTP 404를 그대로 보존한다).
  if (!resolved) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        검사·수리 보고서로 들어가는 문. 자식 주소(`.../report/service-report`)라
        여기서도 「보고서」 탭이 강조된 채로 남는다(resolveActiveTabHref 의 최장
        일치). 아래 ReportScreen 은 데모 자료 계층 위의 옛 화면이라 건드리지
        않는다 — 나중에 통째로 걷어낼 것이다.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">검사 · 수리 보고서</h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            원본 양식 그대로 채워 Excel 파일로 내려받습니다.
          </p>
        </div>
        <Link
          href={`/repair-cases/${id}/report/service-report`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          보고서 만들기
        </Link>
      </div>

      <ReportScreen resolved={resolved} generatedByUser={generatedByUser} />
    </div>
  );
}
