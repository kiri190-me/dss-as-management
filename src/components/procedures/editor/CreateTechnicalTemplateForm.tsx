"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PROCEDURE_EQUIPMENT_TYPE_CODES, procedureEquipmentTypeLabels, type ProcedureEquipmentType } from "@/lib/domain/procedure-template-types";
import { createManualTechnicalProcedureTemplateAction } from "@/lib/server/actions/procedure-templates";

/**
 * Phase 5C-5B — manual TECHNICAL_TASK DRAFT creation. Only code/name/
 * equipmentType/description are ever collected — category/isReferenceOnly/
 * status/version/sourceType are all server-authoritative (see
 * createManualTechnicalProcedureTemplate's own doc comment), so there is no
 * field here through which a client could request anything but a
 * TECHNICAL_TASK DRAFT. Redirects straight into the new draft's editor on
 * success, same UX as CreateDraftVersionButton.
 */
export default function CreateTechnicalTemplateForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [equipmentType, setEquipmentType] = useState<ProcedureEquipmentType>("COMMON");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = code.trim().length > 0 && name.trim().length > 0 && !isSubmitting;

  async function handleCreate() {
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createManualTechnicalProcedureTemplateAction({
      code,
      name,
      equipmentType,
      description: description.trim() || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }
    router.push(`/procedures/${result.id}/edit`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs dark:border-blue-900 dark:bg-blue-950">
      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">새 기술 절차 만들기</h3>
      <label className="flex flex-col gap-1">
        코드 (필수)
        <input value={code} onChange={(e) => setCode(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        이름 (필수)
        <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <label className="flex flex-col gap-1">
        설비 유형
        <select value={equipmentType} onChange={(e) => setEquipmentType(e.target.value as ProcedureEquipmentType)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {PROCEDURE_EQUIPMENT_TYPE_CODES.map((t) => (
            <option key={t} value={t}>
              {procedureEquipmentTypeLabels[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        설명 (선택)
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void handleCreate()}
          className="rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "생성 중..." : "만들기"}
        </button>
        <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">
          취소
        </button>
      </div>
    </div>
  );
}
