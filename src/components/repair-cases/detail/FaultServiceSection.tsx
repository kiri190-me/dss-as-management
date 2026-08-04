import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

export default function FaultServiceSection({ resolved }: { resolved: ResolvedRepairCase }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        고장 및 서비스 정보
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-y-3 sm:grid-cols-2">
        <Field label="신고 증상" value={resolved.reportedSymptom} />
        <Field label="인수점검 결과" value={resolved.intakeInspectionResult} />
        <Field label="현재 진단/조치 요약" value={resolved.currentDiagnosisSummary} />
        <Field label="다음 예정 작업" value={resolved.nextPlannedAction} />
        <Field label="Part Number" value={resolved.partNumber} />
        <Field label="동봉 액세서리" value={resolved.accessoryList} />
        <Field label="외관 상태 요약" value={resolved.externalConditionSummary} />
        <Field label="탈거 사유" value={resolved.reasonForRemoval} />
        <Field label="비고" value={resolved.notes} />
        <Field label="연락처(성함)" value={resolved.contactName} />
        <Field label="연락처(전화)" value={resolved.contactPhone} />
        <Field label="연락처(이메일)" value={resolved.contactEmail} />
      </dl>
    </section>
  );
}
