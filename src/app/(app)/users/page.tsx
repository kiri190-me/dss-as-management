import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "사용자 관리 | DSS A/S 관리 시스템",
};

export default function UsersPage() {
  return (
    <PlaceholderPage
      title="사용자 관리"
      description="추후 이 화면에서 사용자 계정을 관리할 수 있습니다."
    />
  );
}
