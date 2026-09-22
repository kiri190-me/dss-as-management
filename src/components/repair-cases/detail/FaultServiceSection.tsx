import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import type { DerivedServiceSummary } from "@/lib/db/queries/repair-case-work-records";
import FaultServiceEditForm from "./edit/FaultServiceEditForm";
import { KyosanMemoText } from "@/components/kyosan/KyosanText";

/**
 * 🔴 `whitespace-pre-wrap` 은 **원래 없던 결함을 고친 것**이다(2026-09-22). 이 칸에
 * 들어오는 값은 전부 여러 줄이 될 수 있는 자유 기술인데(신고 증상 · 작업 기록에서
 * 파생된 요약 셋 · 비고), 없으면 줄바꿈이 죽어 `[교산 연락서] [사내 확인 결과]
 * 不具合内容 … 電源基板` 처럼 한 줄로 뭉개져 읽을 수 없었다.
 *
 * 🔴 `KyosanMemoText` 는 **보여 주는 층에서만** 한글을 곁들인다 — 교산 연락서를
 * 넣은 값에는 일본어 원문이 그대로 들어 있고, 저장된 글자는 한 글자도 바뀌지
 * 않는다(`lib/kyosan/report-detail-values.ts` 의 「원문을 고치지 않는다」).
 * 사람이 손으로 적은 값은 줄마다 그대로 보인다.
 *
 * ⚠️ 이 `Field` 는 **읽기 전용 자리**에만 쓴다. 사람이 고치는 자리
 * (`edit/FaultServiceEditForm.tsx`)에는 걸지 않는다 — 고칠 글자와 보이는 글자가
 * 달라지면 안 된다.
 */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">
        {value === null ? "-" : <KyosanMemoText value={value} />}
      </dd>
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
