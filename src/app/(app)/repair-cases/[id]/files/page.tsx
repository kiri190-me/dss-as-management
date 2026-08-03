import type { Metadata } from "next";
import PlaceholderPage from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = {
  title: "파일 관리 | DSS A/S 관리 시스템",
};

export default function RepairCaseFilesPage() {
  return (
    <PlaceholderPage
      title="파일 관리"
      description="추후 이 화면에서 사진 및 파일을 관리할 수 있습니다."
    />
  );
}
