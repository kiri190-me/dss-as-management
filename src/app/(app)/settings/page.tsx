import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "시스템 설정 | DSS A/S 관리 시스템",
};

export default function SettingsPage() {
  return (
    <PlaceholderPage
      title="시스템 설정"
      description="추후 이 화면에서 시스템 설정을 관리할 수 있습니다."
    />
  );
}
