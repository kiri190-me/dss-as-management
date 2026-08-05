"use client";

import { useState, type FormEvent } from "react";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
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

export default function FaultServiceEditForm({
  resolved,
  editableFields,
  referenceData,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  editableFields: readonly string[];
  referenceData: IntakeReferenceData | null;
  onDone: () => void;
}) {
  const canEdit = (field: string) => editableFields.includes(field);

  const [reportedSymptom, setReportedSymptom] = useState(resolved.reportedSymptom ?? "");
  const [intakeInspectionResult, setIntakeInspectionResult] = useState(resolved.intakeInspectionResult ?? "");
  const [currentDiagnosisSummary, setCurrentDiagnosisSummary] = useState(resolved.currentDiagnosisSummary ?? "");
  const [nextPlannedAction, setNextPlannedAction] = useState(resolved.nextPlannedAction ?? "");
  const [accessoryList, setAccessoryList] = useState(resolved.accessoryList ?? "");
  const [externalConditionSummary, setExternalConditionSummary] = useState(
    resolved.externalConditionSummary ?? ""
  );
  const [reasonForRemoval, setReasonForRemoval] = useState(resolved.reasonForRemoval ?? "");
  const [notes, setNotes] = useState(resolved.notes ?? "");
  const [assignedEngineerId, setAssignedEngineerId] = useState(resolved.assignedEngineerId ?? "");
  const [internalTargetInspectionCompletionDate, setInternalTargetInspectionCompletionDate] = useState(
    resolved.internalTargetInspectionCompletionDate ?? ""
  );
  const [internalTargetShipmentDate, setInternalTargetShipmentDate] = useState(
    resolved.internalTargetShipmentDate ?? ""
  );

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
    if (canEdit("intakeInspectionResult")) fields.intakeInspectionResult = intakeInspectionResult || null;
    if (canEdit("currentDiagnosisSummary")) fields.currentDiagnosisSummary = currentDiagnosisSummary || null;
    if (canEdit("nextPlannedAction")) fields.nextPlannedAction = nextPlannedAction || null;
    if (canEdit("accessoryList")) fields.accessoryList = accessoryList || null;
    if (canEdit("externalConditionSummary")) fields.externalConditionSummary = externalConditionSummary || null;
    if (canEdit("reasonForRemoval")) fields.reasonForRemoval = reasonForRemoval || null;
    if (canEdit("notes")) fields.notes = notes || null;
    if (canEdit("assignedEngineerId")) fields.assignedEngineerId = assignedEngineerId;
    if (canEdit("internalTargetInspectionCompletionDate")) {
      fields.internalTargetInspectionCompletionDate = internalTargetInspectionCompletionDate || null;
    }
    if (canEdit("internalTargetShipmentDate")) fields.internalTargetShipmentDate = internalTargetShipmentDate;
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

        {canEdit("intakeInspectionResult") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>인수점검 결과</label>
            <textarea rows={2} className={editInputClass} value={intakeInspectionResult} disabled={disabled}
              onChange={(e) => setIntakeInspectionResult(e.target.value)} />
            {fieldErrors.intakeInspectionResult && (
              <p className={editErrorClass}>{fieldErrors.intakeInspectionResult}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="인수점검 결과" value={resolved.intakeInspectionResult} />
        )}

        {canEdit("currentDiagnosisSummary") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>현재 진단/조치 요약</label>
            <textarea rows={2} className={editInputClass} value={currentDiagnosisSummary} disabled={disabled}
              onChange={(e) => setCurrentDiagnosisSummary(e.target.value)} />
            {fieldErrors.currentDiagnosisSummary && (
              <p className={editErrorClass}>{fieldErrors.currentDiagnosisSummary}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="현재 진단/조치 요약" value={resolved.currentDiagnosisSummary} />
        )}

        {canEdit("nextPlannedAction") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>다음 예정 작업</label>
            <textarea rows={2} className={editInputClass} value={nextPlannedAction} disabled={disabled}
              onChange={(e) => setNextPlannedAction(e.target.value)} />
            {fieldErrors.nextPlannedAction && <p className={editErrorClass}>{fieldErrors.nextPlannedAction}</p>}
          </div>
        ) : (
          <ReadOnlyField label="다음 예정 작업" value={resolved.nextPlannedAction} />
        )}

        <ReadOnlyField label="Part Number" value={resolved.partNumber} />

        {canEdit("accessoryList") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>동봉 액세서리</label>
            <input className={editInputClass} value={accessoryList} disabled={disabled}
              onChange={(e) => setAccessoryList(e.target.value)} />
            {fieldErrors.accessoryList && <p className={editErrorClass}>{fieldErrors.accessoryList}</p>}
          </div>
        ) : (
          <ReadOnlyField label="동봉 액세서리" value={resolved.accessoryList} />
        )}

        {canEdit("externalConditionSummary") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>외관 상태 요약</label>
            <textarea rows={2} className={editInputClass} value={externalConditionSummary} disabled={disabled}
              onChange={(e) => setExternalConditionSummary(e.target.value)} />
            {fieldErrors.externalConditionSummary && (
              <p className={editErrorClass}>{fieldErrors.externalConditionSummary}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="외관 상태 요약" value={resolved.externalConditionSummary} />
        )}

        {canEdit("reasonForRemoval") ? (
          <div className="sm:col-span-2">
            <label className={editLabelClass}>탈거 사유</label>
            <input className={editInputClass} value={reasonForRemoval} disabled={disabled}
              onChange={(e) => setReasonForRemoval(e.target.value)} />
            {fieldErrors.reasonForRemoval && <p className={editErrorClass}>{fieldErrors.reasonForRemoval}</p>}
          </div>
        ) : (
          <ReadOnlyField label="탈거 사유" value={resolved.reasonForRemoval} />
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

        {canEdit("assignedEngineerId") ? (
          <div>
            <label className={editLabelClass}>담당 엔지니어</label>
            <select className={editInputClass} value={assignedEngineerId} disabled={disabled}
              onChange={(e) => setAssignedEngineerId(e.target.value)}>
              <option value="">선택해 주세요</option>
              {(referenceData?.engineers ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {fieldErrors.assignedEngineerId && <p className={editErrorClass}>{fieldErrors.assignedEngineerId}</p>}
          </div>
        ) : (
          <ReadOnlyField label="담당 엔지니어" value={resolved.engineerName} />
        )}

        {canEdit("internalTargetInspectionCompletionDate") ? (
          <div>
            <label className={editLabelClass}>사내 목표 검수완료일</label>
            <input type="date" className={editInputClass} value={internalTargetInspectionCompletionDate}
              disabled={disabled} onChange={(e) => setInternalTargetInspectionCompletionDate(e.target.value)} />
            {fieldErrors.internalTargetInspectionCompletionDate && (
              <p className={editErrorClass}>{fieldErrors.internalTargetInspectionCompletionDate}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField
            label="사내 목표 검수완료일"
            value={resolved.internalTargetInspectionCompletionDate}
          />
        )}

        {canEdit("internalTargetShipmentDate") ? (
          <div>
            <label className={editLabelClass}>사내 목표 출하일</label>
            <input type="date" className={editInputClass} value={internalTargetShipmentDate} disabled={disabled}
              onChange={(e) => setInternalTargetShipmentDate(e.target.value)} />
            {fieldErrors.internalTargetShipmentDate && (
              <p className={editErrorClass}>{fieldErrors.internalTargetShipmentDate}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="사내 목표 출하일" value={resolved.internalTargetShipmentDate} />
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
