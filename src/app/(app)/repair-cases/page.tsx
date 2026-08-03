import type { Metadata } from "next";
import { Suspense } from "react";
import RepairCaseListPage from "@/components/repair-cases/RepairCaseListPage";

export const metadata: Metadata = {
  title: "전체 A/S 현황 | DSS A/S 관리 시스템",
};

export default function RepairCasesPage() {
  return (
    <Suspense>
      <RepairCaseListPage />
    </Suspense>
  );
}
