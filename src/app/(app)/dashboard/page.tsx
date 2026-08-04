import type { Metadata } from "next";
import DashboardContent from "@/components/dashboard/DashboardContent";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";

export const metadata: Metadata = {
  title: "대시보드 | DSS A/S 관리 시스템",
};

export default function DashboardPage() {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          대시보드
        </h1>
        <DemoReferenceNotice />
      </div>
      <DashboardContent />
    </div>
  );
}
