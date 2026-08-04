import type { Metadata } from "next";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import IntakeForm from "@/components/repair-cases/new/IntakeForm";

export const metadata: Metadata = {
  title: "A/S 접수 | DSS A/S 관리 시스템",
};

export default function RepairCaseNewPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">A/S 접수</h1>
        <DemoReferenceNotice />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        이 화면에서 등록한 접수 건은 이 브라우저에만 저장되는 로컬 데모 데이터입니다.
      </p>
      <IntakeForm />
    </div>
  );
}
