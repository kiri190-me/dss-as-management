"use client";

import { useState, type FormEvent } from "react";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import { useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass, editLabelClass } from "./EditSectionActions";

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className={editLabelClass}>{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value ?? "-"}</dd>
    </div>
  );
}

/**
 * 인수점검 결과/현재 진단·조치 요약/다음 예정 작업은 record_kind 분류
 * 체크포인트부터 이 폼에 없다 — FaultServiceSection이 항상 derived
 * 요약값(repair_case_work_records 기반, 읽기 전용)을 별도로 렌더링한다.
 * 사내 목표 검수 완료일도 이 폼에 없다(인수정보/A/S 접수 일정 체크포인트 —
 * 인수정보가 단독 소관이다). 이 폼은 이제 신고 증상/비고만 다룬다.
 */
export default function FaultServiceEditForm({
  resolved,
  editableFields,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  editableFields: readonly string[];
  onDone: () => void;
}) {
  const canEdit = (field: string) => editableFields.includes(field);

  const [reportedSymptom, setReportedSymptom] = useState(resolved.reportedSymptom ?? "");
  const [notes, setNotes] = useState(resolved.notes ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId: resolved.id,
      version: resolved.version,
      section: "FAULT_SERVICE",
      onDone,
    });

  const disabled = isSubmitting || isConflict;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const fields: Record<string, unknown> = {};
    if (canEdit("reportedSymptom")) fields.reportedSymptom = reportedSymptom || null;
    if (canEdit("notes")) fields.notes = notes || null;
    void submit(fields);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-2">
        {canEdit("reportedSymptom") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>신고 증상</label>
            <textarea rows={2} className={editInputClass} value={reportedSymptom} disabled={disabled}
              onChange={(e) => setReportedSymptom(e.target.value)} />
            {fieldErrors.reportedSymptom && <p className={editErrorClass}>{fieldErrors.reportedSymptom}</p>}
          </div>
        ) : (
          <ReadOnlyField label="신고 증상" value={resolved.reportedSymptom} />
        )}

        {canEdit("notes") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>비고</label>
            <textarea rows={2} className={editInputClass} value={notes} disabled={disabled}
              onChange={(e) => setNotes(e.target.value)} />
            {fieldErrors.notes && <p className={editErrorClass}>{fieldErrors.notes}</p>}
          </div>
        ) : (
          <ReadOnlyField label="비고" value={resolved.notes} />
        )}
      </dl>

      <EditSectionActions
        isSubmitting={isSubmitting}
        isConflict={isConflict}
        submitError={submitError}
        onCancel={onDone}
        onReloadAfterConflict={reloadAfterConflict}
      />
    </form>
  );
}
