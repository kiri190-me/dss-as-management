"use client";

import { useState, type FormEvent } from "react";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { REPAIR_CASE_SAVED_POPUP, useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass } from "./EditSectionActions";
import { buildEngineerSelectOptions } from "./engineer-select-options";

/**
 * Top-summary-card 담당 엔지니어 편집 — the only normal edit location for
 * assignedEngineerId (FaultServiceEditForm no longer renders it). Submits
 * through the same FAULT_SERVICE section/useSectionEditSubmit/
 * updateRepairCaseAction path as every other field-level edit, so
 * authorization (isFieldEditable "assignedEngineerId"), version-conflict
 * handling, and shipment-lock enforcement are unchanged — only the UI
 * surface moved.
 */
export default function EngineerEditCell({
  repairCaseId,
  version,
  assignedEngineerId,
  engineerName,
  canEdit,
  referenceData,
}: {
  repairCaseId: string;
  version: number;
  assignedEngineerId: string | null;
  engineerName: string | null;
  canEdit: boolean;
  referenceData: IntakeReferenceData | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(assignedEngineerId ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId,
      version,
      section: "FAULT_SERVICE",
      onDone: () => setIsEditing(false),
      savedPopup: REPAIR_CASE_SAVED_POPUP,
    });

  if (!isEditing) {
    return (
      <span className="inline-flex items-center gap-2">
        {engineerName ?? "미배정"}
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(assignedEngineerId ?? "");
              setIsEditing(true);
            }}
            className="text-xs font-medium text-zinc-600 hover:underline dark:text-zinc-400"
          >
            수정
          </button>
        )}
      </span>
    );
  }

  const disabled = isSubmitting || isConflict;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit({ assignedEngineerId: value || null });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-1 flex flex-col gap-1">
      <select
        className={editInputClass}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">미배정</option>
        {/* 지금 담당자가 후보 밖이면(삭제 · 역할 변경 등) 그 사람을 선택지로 하나 더한다 —
            빼면 담당이 있는데 「미배정」처럼 보인다(engineer-select-options.ts). */}
        {buildEngineerSelectOptions(referenceData?.engineers ?? [], assignedEngineerId, engineerName).map(
          (option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          )
        )}
      </select>
      {fieldErrors.assignedEngineerId && <p className={editErrorClass}>{fieldErrors.assignedEngineerId}</p>}
      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={() => setIsEditing(false)}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
