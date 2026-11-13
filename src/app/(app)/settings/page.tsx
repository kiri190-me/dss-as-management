import { hasPermission } from "@/lib/auth/permission-resolver";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import SettingsTabs from "@/components/settings/SettingsTabs";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { mayManageBadgeVisibility } from "@/lib/auth/badge-visibility-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { buildBadgeVisibilityView } from "@/lib/db/queries/badge-visibility-settings";
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

  // 🔴 2026-11-13: 설정이 둘이 되면서 탭으로 갈라졌다(components/settings/SettingsTabs).
  //    첫 탭은 지금까지 이 화면에 있던 카드 그대로다 — 자료도 권한도 한 글자도
  //    바뀌지 않았다(고객 안내 상태 목록은 여전히 `customerPortal` 의 관리가 정한다).
  //
  // 🔵 네 조회·판정이 서로를 기다리지 않는다. 배지 쪽 읽기는 **표가 없을 때를 삼키지
  //    않는다**(queries/badge-visibility-settings.ts 의 buildBadgeVisibilityView) —
  //    값을 바꾸러 온 화면이 표가 없다는 사실을 감추면 [저장]을 눌렀을 때에야 터진다.
  const [options, badges, canManageStatusOptions, canManageBadges] = await Promise.all([
    listAllStatusOptions(),
    buildBadgeVisibilityView(),
    hasPermission(actingUser, "customerPortal", "MANAGE"),
    // 🔴 화면에서 단추를 감추는 것만으로는 막은 것이 아니다 — 서버 액션과 mutation 이
    //    **같은 함수**로 다시 본다(auth/badge-visibility-authorization.ts).
    mayManageBadgeVisibility(actingUser),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          시스템 설정
        </h1>
      </header>

      <SettingsTabs
        statusOptions={options}
        canManageStatusOptions={canManageStatusOptions}
        badges={badges}
        canManageBadges={canManageBadges}
      />
    </div>
  );
}
