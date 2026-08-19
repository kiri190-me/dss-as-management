"use client";

import { useState, type FormEvent } from "react";
import { useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass } from "./EditSectionActions";

/**
 * 상단 요약 카드의 보고서번호 편집 — EngineerEditCell과 정확히 같은 구조이며,
 * 담당 엔지니어와 같은 이유로 여기가 이 값의 유일한 정상 편집 지점이다
 * (IntakeInfoEditForm은 더 이상 이 필드를 렌더링하지 않는다). 제출은 기존
 * INTAKE 섹션/useSectionEditSubmit/updateRepairCaseAction 경로를 그대로
 * 타므로 권한(isFieldEditable "legacyReportNumber")·버전 충돌·출하 잠금
 * 처리는 하나도 바뀌지 않는다 — 화면 위치만 옮겨온 것이다.
 *
 * 보고서번호는 자동 채번도 형식 규칙도 없는 수기 값이라, 비워서 제출하면
 * null로 지워진다(검증은 길이만 본다).
 */
export default function ReportNumberEditCell({
  repairCaseId,
  version,
  legacyReportNumber,
  canEdit,
}: {
  repairCaseId: string;
  version: number;
  legacyReportNumber: string | null;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(legacyReportNumber ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId,
      version,
      section: "INTAKE",
      onDone: () => setIsEditing(false),
    });

  if (!isEditing) {
    return (
      <span className="inline-flex items-center gap-2">
        {legacyReportNumber ?? "—"}
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setValue(legacyReportNumber ?? "");
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
    void submit({ legacyReportNumber: value.trim() || null });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-1 flex flex-col gap-1">
      <input
        className={editInputClass}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      {fieldErrors.legacyReportNumber && <p className={editErrorClass}>{fieldErrors.legacyReportNumber}</p>}
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
