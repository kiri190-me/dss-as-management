import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import type { DerivedServiceSummary } from "@/lib/db/queries/repair-case-work-records";
import FaultServiceEditForm from "./edit/FaultServiceEditForm";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

/**
 * 인수점검 결과/현재 진단·조치 요약/다음 예정 작업은 record_kind 분류
 * 체크포인트부터 항상 derivedServiceSummary(repair_case_work_records
 * 기반, 결정론적 파생값)에서만 읽는다 — resolved.intakeInspectionResult 등
 * 레거시 repair_cases 컬럼은 여기서 더 이상 참조하지 않으며(스키마/데이터는
 * 그대로 보존), 편집 모드에서도 항상 읽기 전용이다(FaultServiceEditForm에는
 * 더 이상 이 3개 필드의 편집 컨트롤이 없다). null이면 Field가 "-"를 표시한다.
 */
export default function FaultServiceSection({
  resolved,
  editableFields,
  editingSection,
  derivedServiceSummary,
  onStartEdit,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  editableFields: readonly string[] | null;
  editingSection: RepairCaseEditSection | null;
  derivedServiceSummary: DerivedServiceSummary | null;
  onStartEdit: () => void;
  onDone: () => void;
}) {
  const isEditing = editingSection === "FAULT_SERVICE";
  const canShowEditButton = editableFields !== null && editingSection === null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          고장 및 서비스 정보
        </h2>
        {canShowEditButton && (
          <button
            type="button"
            onClick={onStartEdit}
            className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
          >
            수정
          </button>
        )}
      </div>

      {isEditing && editableFields ? (
        <div className="mt-3">
          <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2">
            <Field label="인수점검 결과" value={derivedServiceSummary?.intakeInspectionResult ?? null} />
            <Field label="현재 진단/조치 요약" value={derivedServiceSummary?.currentDiagnosisSummary ?? null} />
            <Field label="다음 예정 작업" value={derivedServiceSummary?.nextPlannedAction ?? null} />
          </dl>
          <div className="mt-3">
            <FaultServiceEditForm
              resolved={resolved}
              editableFields={editableFields}
              onDone={onDone}
            />
          </div>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-1 gap-y-3 sm:grid-cols-2">
          <Field label="신고 증상" value={resolved.reportedSymptom} />
          <Field label="인수점검 결과" value={derivedServiceSummary?.intakeInspectionResult ?? null} />
          <Field label="현재 진단/조치 요약" value={derivedServiceSummary?.currentDiagnosisSummary ?? null} />
          <Field label="다음 예정 작업" value={derivedServiceSummary?.nextPlannedAction ?? null} />
          <Field label="비고" value={resolved.notes} />
        </dl>
      )}
    </section>
  );
}
