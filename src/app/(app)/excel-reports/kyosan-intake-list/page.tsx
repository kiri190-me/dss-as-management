import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "일본 본사 Excel 생성 | DSS A/S 관리 시스템",
};

export default async function KyosanIntakeListPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("excelKyosanIntakeList");

  return (
    <PlaceholderPage
      title="일본 본사 Excel 생성"
      description="추후 이 화면에서 일본 본사 제출용 인수품 목록 Excel을 생성할 수 있습니다."
    />
  );
}
