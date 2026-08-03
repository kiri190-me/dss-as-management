import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "A/S 접수 | DSS A/S 관리 시스템",
};

export default function RepairCaseNewPage() {
  return (
    <PlaceholderPage
      title="A/S 접수"
      description="추후 이 화면에서 신규 A/S를 접수할 수 있습니다."
    />
  );
}
