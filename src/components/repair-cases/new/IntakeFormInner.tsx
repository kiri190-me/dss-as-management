"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRIORITY_CODES,
  WORKFLOW_TYPE_CODES,
  priorityLabels,
  workflowTypeLabels,
} from "@/lib/domain/types";
import { mockCustomers, mockEndUsers, mockUsers } from "@/lib/domain/mock-data";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import { useIntakeDraft } from "@/lib/domain/local/use-intake-draft";
import type { IntakeDraftData } from "@/lib/domain/local/draft-storage";
import { estimateIntakeNumber } from "@/lib/domain/local/intake-number";
import { submitNewLocalCase, type IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { resolveAllRepairCases } from "@/lib/domain/local/resolved-repair-case";
import { findProductHistoryMatchesForDraft } from "@/lib/domain/local/product-history-match";
import { isValidDateString, isNotEarlierThan } from "@/lib/domain/local/validation";
import DerivedProductFields from "./DerivedProductFields";
import ProductHistoryNotice from "./ProductHistoryNotice";
import ClearDraftDialog from "./ClearDraftDialog";
import DraftStatusLine from "./DraftStatusLine";

type FieldKey =
  | "customerId"
  | "assignedEngineerId"
  | "receivedAt"
  | "internalTargetShipmentDate"
  | "customerRequestedDueDate"
  | "modelName"
  | "lotNumber"
  | "serialNumber";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";
const errorClass = "mt-1 text-xs text-red-600 dark:text-red-400";

function validateDraft(draft: IntakeDraftData): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};

  if (!draft.customerId) errors.customerId = "고객사를 선택해 주세요.";
  if (!draft.assignedEngineerId) errors.assignedEngineerId = "담당 엔지니어를 선택해 주세요.";

  if (!isValidDateString(draft.receivedAt)) {
    errors.receivedAt = "인수일을 올바른 날짜로 입력해 주세요.";
  }

  if (!draft.internalTargetShipmentDate) {
    errors.internalTargetShipmentDate = "사내 목표 출하일을 입력해 주세요.";
  } else if (!isValidDateString(draft.internalTargetShipmentDate)) {
    errors.internalTargetShipmentDate = "사내 목표 출하일을 올바른 날짜로 입력해 주세요.";
  } else if (
    isValidDateString(draft.receivedAt) &&
    !isNotEarlierThan(draft.internalTargetShipmentDate, draft.receivedAt)
  ) {
    errors.internalTargetShipmentDate = "사내 목표 출하일은 인수일보다 이전일 수 없습니다.";
  }

  if (draft.customerRequestedDueDate) {
    if (!isValidDateString(draft.customerRequestedDueDate)) {
      errors.customerRequestedDueDate = "고객 요청 납기일을 올바른 날짜로 입력해 주세요.";
    } else if (
      isValidDateString(draft.receivedAt) &&
      !isNotEarlierThan(draft.customerRequestedDueDate, draft.receivedAt)
    ) {
      errors.customerRequestedDueDate = "고객 요청 납기일은 인수일보다 이전일 수 없습니다.";
    }
  }

  if (!draft.modelName.trim()) errors.modelName = "Model을 입력해 주세요.";
  if (!draft.lotNumber.trim()) errors.lotNumber = "L/N을 입력해 주세요.";
  if (!draft.serialNumber.trim()) errors.serialNumber = "S/N을 입력해 주세요.";

  return errors;
}

const FIELD_ORDER: FieldKey[] = [
  "customerId",
  "assignedEngineerId",
  "receivedAt",
  "internalTargetShipmentDate",
  "customerRequestedDueDate",
  "modelName",
  "lotNumber",
  "serialNumber",
];

export default function IntakeFormInner() {
  const router = useRouter();
  const { cases: localCases } = useLocalRepairCases();
  const { draft, updateDraft, isEmpty, savedAtLabel, clear } = useIntakeDraft();

  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});

  const eligibleEngineers = useMemo(
    () => mockUsers.filter((u) => u.role === "AS_ENGINEER" && u.approvalStatus === "APPROVED"),
    []
  );
  const availableEndUsers = useMemo(
    () => mockEndUsers.filter((e) => e.customerId === draft.customerId),
    [draft.customerId]
  );

  const estimatedIntakeNumber = useMemo(
    () => (isValidDateString(draft.receivedAt) ? estimateIntakeNumber(draft.receivedAt, localCases) : null),
    [draft.receivedAt, localCases]
  );

  const productHistoryMatches = useMemo(() => {
    if (!draft.modelName.trim() || !draft.lotNumber.trim() || !draft.serialNumber.trim()) return [];
    const all = resolveAllRepairCases(localCases);
    return findProductHistoryMatchesForDraft(all, draft);
  }, [draft, localCases]);

  function setField<K extends keyof IntakeDraftData>(key: K, value: IntakeDraftData[K]) {
    updateDraft({ [key]: value } as Partial<IntakeDraftData>);
  }

  function handleCustomerChange(customerId: string) {
    const stillValid = mockEndUsers.some(
      (e) => e.id === draft.endUserId && e.customerId === customerId
    );
    updateDraft({ customerId, endUserId: stillValid ? draft.endUserId : null });
  }

  function focusFirstInvalid(fieldErrors: Partial<Record<FieldKey, string>>) {
    const firstField = FIELD_ORDER.find((key) => fieldErrors[key]);
    if (!firstField) return;
    const el = fieldRefs.current[firstField];
    if (el) {
      el.focus();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const fieldErrors = validateDraft(draft);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      focusFirstInvalid(fieldErrors);
      return;
    }

    const input: IntakeSubmissionInput = {
      workflowType: draft.workflowType,
      customerId: draft.customerId,
      endUserId: draft.endUserId,
      assignedEngineerId: draft.assignedEngineerId,
      priority: draft.priority,
      receivedAt: draft.receivedAt,
      customerRequestedDueDate: draft.customerRequestedDueDate || null,
      internalTargetShipmentDate: draft.internalTargetShipmentDate,
      modelName: draft.modelName,
      lotNumber: draft.lotNumber,
      serialNumber: draft.serialNumber,
      partNumber: draft.partNumber,
      accessoryList: draft.accessoryList,
      externalConditionSummary: draft.externalConditionSummary,
      reasonForRemoval: draft.reasonForRemoval,
      reportedSymptom: draft.reportedSymptom,
      intakeInspectionResult: draft.intakeInspectionResult,
      currentDiagnosisSummary: draft.currentDiagnosisSummary,
      nextPlannedAction: draft.nextPlannedAction,
      notes: draft.notes,
      contactName: draft.contactName,
      contactPhone: draft.contactPhone,
      contactEmail: draft.contactEmail,
    };

    const result = submitNewLocalCase(input);
    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        INVALID_CUSTOMER: "선택한 고객사를 확인할 수 없습니다. 다시 선택해 주세요.",
        INVALID_END_USER: "선택한 End-User가 고객사와 일치하지 않습니다. 다시 선택해 주세요.",
        INVALID_ENGINEER: "선택한 담당 엔지니어를 확인할 수 없습니다. 다시 선택해 주세요.",
        SEQUENCE_EXHAUSTED:
          "선택한 달의 인수번호를 모두 사용했습니다(99건 초과). 다른 인수일을 선택해 주세요.",
        STORAGE_CONFLICT: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요.",
      };
      setSubmitError(messages[result.reason]);
      return;
    }

    clear();
    router.push(`/repair-cases/${result.repairCase.id}?registered=1`);
  }

  function handleClearClick() {
    if (isEmpty) {
      clear();
      return;
    }
    setIsClearDialogOpen(true);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <DraftStatusLine savedAtLabel={savedAtLabel} />
        <button
          type="button"
          onClick={handleClearClick}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          작성 내용 지우기
        </button>
      </div>

      <ClearDraftDialog
        isOpen={isClearDialogOpen}
        onConfirm={() => {
          clear();
          setIsClearDialogOpen(false);
        }}
        onCancel={() => setIsClearDialogOpen(false)}
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">워크플로 / 예상 인수번호</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="workflowType" className={labelClass}>워크플로 유형</label>
            <select
              id="workflowType"
              className={inputClass}
              value={draft.workflowType}
              onChange={(e) => setField("workflowType", e.target.value as IntakeDraftData["workflowType"])}
            >
              {WORKFLOW_TYPE_CODES.map((type) => (
                <option key={type} value={type}>
                  {workflowTypeLabels[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className={labelClass}>예상 인수번호</span>
            <p className="text-sm text-zinc-900 dark:text-zinc-50">
              {estimatedIntakeNumber ?? "-"}
              <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                (예상 인수번호이며, 최종 번호는 제출 시 확정됩니다)
              </span>
            </p>
          </div>
        </div>
        <div className="mt-3">
          <DerivedProductFields workflowType={draft.workflowType} />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">고객 / 담당자</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="customerId" className={labelClass}>고객사 *</label>
            <select
              id="customerId"
              ref={(el) => {
                fieldRefs.current.customerId = el;
              }}
              className={inputClass}
              value={draft.customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              aria-invalid={Boolean(errors.customerId)}
              aria-describedby={errors.customerId ? "customerId-error" : undefined}
            >
              <option value="">선택해 주세요</option>
              {mockCustomers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.customerId && <p id="customerId-error" className={errorClass}>{errors.customerId}</p>}
          </div>

          <div>
            <label htmlFor="endUserId" className={labelClass}>End-User</label>
            <select
              id="endUserId"
              className={inputClass}
              value={draft.endUserId ?? ""}
              disabled={!draft.customerId}
              onChange={(e) => setField("endUserId", e.target.value || null)}
            >
              <option value="">선택 안 함</option>
              {availableEndUsers.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="assignedEngineerId" className={labelClass}>담당 엔지니어 *</label>
            <select
              id="assignedEngineerId"
              ref={(el) => {
                fieldRefs.current.assignedEngineerId = el;
              }}
              className={inputClass}
              value={draft.assignedEngineerId}
              onChange={(e) => setField("assignedEngineerId", e.target.value)}
              aria-invalid={Boolean(errors.assignedEngineerId)}
              aria-describedby={errors.assignedEngineerId ? "assignedEngineerId-error" : undefined}
            >
              <option value="">선택해 주세요</option>
              {eligibleEngineers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {errors.assignedEngineerId && (
              <p id="assignedEngineerId-error" className={errorClass}>{errors.assignedEngineerId}</p>
            )}
          </div>

          <div>
            <label htmlFor="priority" className={labelClass}>우선순위</label>
            <select
              id="priority"
              className={inputClass}
              value={draft.priority}
              onChange={(e) => setField("priority", e.target.value as IntakeDraftData["priority"])}
            >
              {PRIORITY_CODES.map((p) => (
                <option key={p} value={p}>{priorityLabels[p]}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">일정</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="receivedAt" className={labelClass}>인수일 *</label>
            <input
              id="receivedAt"
              type="date"
              ref={(el) => {
                fieldRefs.current.receivedAt = el;
              }}
              className={inputClass}
              value={draft.receivedAt}
              onChange={(e) => setField("receivedAt", e.target.value)}
              aria-invalid={Boolean(errors.receivedAt)}
              aria-describedby={errors.receivedAt ? "receivedAt-error" : undefined}
            />
            {errors.receivedAt && <p id="receivedAt-error" className={errorClass}>{errors.receivedAt}</p>}
          </div>

          <div>
            <label htmlFor="internalTargetShipmentDate" className={labelClass}>사내 목표 출하일 *</label>
            <input
              id="internalTargetShipmentDate"
              type="date"
              ref={(el) => {
                fieldRefs.current.internalTargetShipmentDate = el;
              }}
              className={inputClass}
              value={draft.internalTargetShipmentDate}
              onChange={(e) => setField("internalTargetShipmentDate", e.target.value)}
              aria-invalid={Boolean(errors.internalTargetShipmentDate)}
              aria-describedby={
                errors.internalTargetShipmentDate ? "internalTargetShipmentDate-error" : undefined
              }
            />
            {errors.internalTargetShipmentDate && (
              <p id="internalTargetShipmentDate-error" className={errorClass}>
                {errors.internalTargetShipmentDate}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="customerRequestedDueDate" className={labelClass}>고객 요청 납기일</label>
            <input
              id="customerRequestedDueDate"
              type="date"
              ref={(el) => {
                fieldRefs.current.customerRequestedDueDate = el;
              }}
              className={inputClass}
              value={draft.customerRequestedDueDate}
              onChange={(e) => setField("customerRequestedDueDate", e.target.value)}
              aria-invalid={Boolean(errors.customerRequestedDueDate)}
              aria-describedby={
                errors.customerRequestedDueDate ? "customerRequestedDueDate-error" : undefined
              }
            />
            {errors.customerRequestedDueDate && (
              <p id="customerRequestedDueDate-error" className={errorClass}>
                {errors.customerRequestedDueDate}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">제품 정보</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="modelName" className={labelClass}>Model *</label>
            <input
              id="modelName"
              ref={(el) => {
                fieldRefs.current.modelName = el;
              }}
              className={inputClass}
              value={draft.modelName}
              onChange={(e) => setField("modelName", e.target.value)}
              aria-invalid={Boolean(errors.modelName)}
              aria-describedby={errors.modelName ? "modelName-error" : undefined}
            />
            {errors.modelName && <p id="modelName-error" className={errorClass}>{errors.modelName}</p>}
          </div>
          <div>
            <label htmlFor="lotNumber" className={labelClass}>L/N *</label>
            <input
              id="lotNumber"
              ref={(el) => {
                fieldRefs.current.lotNumber = el;
              }}
              className={inputClass}
              value={draft.lotNumber}
              onChange={(e) => setField("lotNumber", e.target.value)}
              aria-invalid={Boolean(errors.lotNumber)}
              aria-describedby={errors.lotNumber ? "lotNumber-error" : undefined}
            />
            {errors.lotNumber && <p id="lotNumber-error" className={errorClass}>{errors.lotNumber}</p>}
          </div>
          <div>
            <label htmlFor="serialNumber" className={labelClass}>S/N *</label>
            <input
              id="serialNumber"
              ref={(el) => {
                fieldRefs.current.serialNumber = el;
              }}
              className={inputClass}
              value={draft.serialNumber}
              onChange={(e) => setField("serialNumber", e.target.value)}
              aria-invalid={Boolean(errors.serialNumber)}
              aria-describedby={errors.serialNumber ? "serialNumber-error" : undefined}
            />
            {errors.serialNumber && <p id="serialNumber-error" className={errorClass}>{errors.serialNumber}</p>}
          </div>
          <div>
            <label htmlFor="partNumber" className={labelClass}>Part Number</label>
            <input
              id="partNumber"
              className={inputClass}
              value={draft.partNumber}
              onChange={(e) => setField("partNumber", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="accessoryList" className={labelClass}>동봉 액세서리</label>
            <input
              id="accessoryList"
              className={inputClass}
              value={draft.accessoryList}
              onChange={(e) => setField("accessoryList", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="externalConditionSummary" className={labelClass}>외관 상태 요약</label>
            <textarea
              id="externalConditionSummary"
              rows={2}
              className={inputClass}
              value={draft.externalConditionSummary}
              onChange={(e) => setField("externalConditionSummary", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="reasonForRemoval" className={labelClass}>탈거 사유</label>
            <input
              id="reasonForRemoval"
              className={inputClass}
              value={draft.reasonForRemoval}
              onChange={(e) => setField("reasonForRemoval", e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3">
          <ProductHistoryNotice matches={productHistoryMatches} />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">고장 및 서비스 정보</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="reportedSymptom" className={labelClass}>신고 증상</label>
            <textarea
              id="reportedSymptom"
              rows={2}
              className={inputClass}
              value={draft.reportedSymptom}
              onChange={(e) => setField("reportedSymptom", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="intakeInspectionResult" className={labelClass}>인수점검 결과</label>
            <textarea
              id="intakeInspectionResult"
              rows={2}
              className={inputClass}
              value={draft.intakeInspectionResult}
              onChange={(e) => setField("intakeInspectionResult", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="currentDiagnosisSummary" className={labelClass}>현재 진단/조치 요약</label>
            <textarea
              id="currentDiagnosisSummary"
              rows={2}
              className={inputClass}
              value={draft.currentDiagnosisSummary}
              onChange={(e) => setField("currentDiagnosisSummary", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="nextPlannedAction" className={labelClass}>다음 예정 작업</label>
            <textarea
              id="nextPlannedAction"
              rows={2}
              className={inputClass}
              value={draft.nextPlannedAction}
              onChange={(e) => setField("nextPlannedAction", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="notes" className={labelClass}>비고</label>
            <textarea
              id="notes"
              rows={2}
              className={inputClass}
              value={draft.notes}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">연락처 (선택)</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="contactName" className={labelClass}>담당자 성함</label>
            <input
              id="contactName"
              className={inputClass}
              value={draft.contactName}
              onChange={(e) => setField("contactName", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="contactPhone" className={labelClass}>연락처(전화)</label>
            <input
              id="contactPhone"
              className={inputClass}
              value={draft.contactPhone}
              onChange={(e) => setField("contactPhone", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="contactEmail" className={labelClass}>연락처(이메일)</label>
            <input
              id="contactEmail"
              type="email"
              className={inputClass}
              value={draft.contactEmail}
              onChange={(e) => setField("contactEmail", e.target.value)}
            />
          </div>
        </div>
      </section>

      {submitError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {submitError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          A/S 접수 등록 (로컬 데모)
        </button>
      </div>
    </form>
  );
}
