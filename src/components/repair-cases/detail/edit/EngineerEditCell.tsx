"use client";

import { useState, type FormEvent } from "react";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass } from "./EditSectionActions";

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
        {(referenceData?.engineers ?? []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
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
