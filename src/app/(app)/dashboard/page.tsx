import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "대시보드 | DSS A/S 관리 시스템",
};

export default function DashboardPage() {
  return (
    <PlaceholderPage
      title="대시보드"
      description="추후 이 화면에 대시보드 통계가 표시될 예정입니다."
    />
  );
}
