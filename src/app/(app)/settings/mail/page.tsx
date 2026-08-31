import type { Metadata } from "next";
import { redirect } from "next/navigation";
import IntakeMailSettingsScreen from "@/components/settings/IntakeMailSettingsScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { canManageIntakeMailSettings } from "@/lib/auth/intake-mail-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getIntakeMailSettings } from "@/lib/db/queries/intake-mail-settings";

export const metadata: Metadata = {
  title: "메일 설정 | DSS A/S 관리 시스템",
};

// 수신자 목록과 문구는 방금 바뀌었을 수 있다 — 캐시된 값을 보여 주면
// 관리자가 두 번 저장한다.
export const dynamic = "force-dynamic";

/**
 * A/S 접수 알림 메일 설정.
 *
 * 권한을 두 곳에서 본다 — 여기(영역 가드 + 역할)와 저장 액션. 겹치지만
 * 여기서 정한 문구가 전사원 메일로 나가고 수신자 목록이 곧 "누가 고객사·S/N·
 * 증상을 받아 보는가"라, 한쪽이 무너져도 다른 쪽이 남아야 한다.
 */
export default async function MailSettingsPage() {
  // 역할별 접근 권한에서 이 메뉴가 꺼져 있으면 주소를 직접 입력해도 못 들어온다.
  await requireAreaAccessForCurrentUser("mailSettings", "MANAGE");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="메일 설정"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  if (!canManageIntakeMailSettings(actingUser.role)) {
    return (
      <PlaceholderPage
        title="메일 설정"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  const initial = await getIntakeMailSettings();

  return (
    <div className="p-6">
      <IntakeMailSettingsScreen initial={initial} />
    </div>
  );
}
