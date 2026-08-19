import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import IntakeInfoEditForm from "./edit/IntakeInfoEditForm";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

export default function IntakeInfoSection({
  resolved,
  editableFields,
  editingSection,
  referenceData,
  onStartEdit,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  /** null when the current user cannot edit any field in this section — hides the Edit button entirely. */
  editableFields: readonly string[] | null;
  editingSection: RepairCaseEditSection | null;
  referenceData: IntakeReferenceData | null;
  onStartEdit: () => void;
  onDone: () => void;
}) {
  const isEditing = editingSection === "INTAKE";
  const canShowEditButton = editableFields !== null && editingSection === null;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">인수 정보</h2>
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
          <IntakeInfoEditForm
            resolved={resolved}
            editableFields={editableFields}
            referenceData={referenceData}
            onDone={onDone}
          />
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="인수일" value={resolved.receivedAt} />
          <Field label="유상/무상" value={resolved.paidOrWarranty} />
          <Field label="고객사" value={resolved.customerName} />
          <Field label="End-User" value={resolved.endUserName ?? "-"} />
          <Field
            label="고객 요청 납기일"
            value={resolved.customerRequestedDueDate ?? "-"}
          />
          <Field
            label="사내 목표 검수 완료일"
            value={resolved.internalTargetInspectionCompletionDate ?? "-"}
          />
          <Field
            label="사내 목표 출하일"
            value={resolved.internalTargetShipmentDate ?? "-"}
          />
          <Field label="실제 출하일" value={resolved.actualShipmentDate ?? "-"} />
          <Field label="담당자 성함" value={resolved.contactName ?? "-"} />
          <Field label="연락처(전화)" value={resolved.contactPhone ?? "-"} />
          <Field label="연락처(이메일)" value={resolved.contactEmail ?? "-"} />
        </dl>
      )}
    </section>
  );
}
