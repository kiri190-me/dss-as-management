import type { RepairCaseDetail } from "@/lib/domain/repair-case-detail";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

export default function FaultServiceSection({ detail }: { detail: RepairCaseDetail }) {
  const { repairCase } = detail;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        고장 및 서비스 정보
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-y-3 sm:grid-cols-2">
        <Field label="신고 증상" value={repairCase.reportedSymptom} />
        <Field label="인수점검 결과" value={repairCase.intakeInspectionResult} />
        <Field label="현재 진단/조치 요약" value={repairCase.currentDiagnosisSummary} />
        <Field label="다음 예정 작업" value={repairCase.nextPlannedAction} />
      </dl>
    </section>
  );
}
