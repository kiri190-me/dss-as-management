import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "일본 본사 Excel 생성 | DSS A/S 관리 시스템",
};

export default function KyosanIntakeListPage() {
  return (
    <PlaceholderPage
      title="일본 본사 Excel 생성"
      description="추후 이 화면에서 일본 본사 제출용 인수품 목록 Excel을 생성할 수 있습니다."
    />
  );
}
