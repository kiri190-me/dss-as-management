import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "검수/승인 | DSS A/S 관리 시스템",
};

export default function RepairCaseApprovalPage() {
  return (
    <PlaceholderPage
      title="검수/승인"
      description="추후 이 화면에서 수리 검수 및 출하 승인을 진행할 수 있습니다."
    />
  );
}
