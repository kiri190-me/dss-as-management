import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "시스템 설정 | DSS A/S 관리 시스템",
};

export default async function SettingsPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("settings");

  return (
    <PlaceholderPage
      title="시스템 설정"
      description="추후 이 화면에서 시스템 설정을 관리할 수 있습니다."
    />
  );
}
