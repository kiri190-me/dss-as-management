import { hasPermission } from "@/lib/auth/permission-resolver";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CustomerStatusOptionSettings from "@/components/customer-portal/CustomerStatusOptionSettings";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listAllStatusOptions } from "@/lib/db/queries/customer-portal";

export const metadata: Metadata = {
  title: "시스템 설정 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("settings");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="시스템 설정"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  const options = await listAllStatusOptions();

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          시스템 설정
        </h1>
      </header>

      {/*
        이 화면의 첫 항목이다. 지금까지 빈 껍데기였고, 앞으로 설정이 늘면
        여기에 구역이 하나씩 붙는다.
      */}
      <CustomerStatusOptionSettings
        options={options}
        canManage={await hasPermission(actingUser, "customerPortal", "MANAGE")}
      />
    </div>
  );
}
