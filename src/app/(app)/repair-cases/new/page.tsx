import type { Metadata } from "next";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import IntakeForm from "@/components/repair-cases/new/IntakeForm";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";

export const metadata: Metadata = {
  title: "A/S 접수 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseNewPage() {
  const writeSource = getRepairCaseWriteSource();

  // Only queried in database mode — local mode keeps using mockCustomers/
  // mockEndUsers/mockUsers exactly as before (no DB access at all).
  const referenceData = writeSource === "database" ? await getIntakeReferenceData() : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">A/S 접수</h1>
        <DemoReferenceNotice />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {writeSource === "database"
          ? "이 화면에서 등록한 접수 건은 데이터베이스에 저장됩니다."
          : "이 화면에서 등록한 접수 건은 이 브라우저에만 저장되는 로컬 데모 데이터입니다."}
      </p>
      <IntakeForm writeSource={writeSource} referenceData={referenceData} />
    </div>
  );
}
