import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "전체 A/S 현황 | DSS A/S 관리 시스템",
};

export default function RepairCasesPage() {
  return (
    <PlaceholderPage
      title="전체 A/S 현황"
      description="추후 이 화면에 전체 A/S 접수 현황 목록이 표시될 예정입니다."
    />
  );
}
