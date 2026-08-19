"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PRIORITY_CODES,
  billingTypeLabels,
  MANUAL_INTAKE_BILLING_TYPE_CODES,
  priorityLabels,
  workflowTypeLabels,
  type BillingType,
} from "@/lib/domain/types";
import { normalizeEntityName, rankSimilarNames } from "@/lib/domain/entity-name-match";
import {
  deriveWorkflowType,
  workflowKindLabels,
  workflowKindOf,
  type WorkflowKind,
} from "@/lib/domain/workflow-kind";
import { mockCustomers, mockEndUsers, mockUsers } from "@/lib/domain/mock-data";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";
import { useIntakeDraft } from "@/lib/domain/local/use-intake-draft";
import type { IntakeDraftData } from "@/lib/domain/local/draft-storage";
import { estimateIntakeNumber, isValidIntakeNumberFormat } from "@/lib/domain/local/intake-number";
import { submitNewLocalCase, type IntakeSubmissionInput } from "@/lib/domain/local/submit-intake";
import { resolveAllRepairCases } from "@/lib/domain/local/resolved-repair-case";
import { findProductHistoryMatchesForDraft } from "@/lib/domain/local/product-history-match";
import { isValidDateString, isNotEarlierThan } from "@/lib/domain/local/validation";
import { nextTargetInspectionCompletionDate } from "@/lib/domain/local/draft-storage";
import { createRepairCaseAction } from "@/lib/server/actions/create-repair-case";
import type { CreateRepairCaseResultCode } from "@/lib/validation/repair-case-input";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import DerivedProductFields from "./DerivedProductFields";
import ProductHistoryNotice from "./ProductHistoryNotice";
import ClearDraftDialog from "./ClearDraftDialog";
import DraftStatusLine from "./DraftStatusLine";

type FieldKey =
  | "customerId"
  | "endUserId"
  | "assignedEngineerId"
  | "billingType"
  | "receivedAt"
  | "internalTargetInspectionCompletionDate"
  | "internalTargetShipmentDate"
  | "customerRequestedDueDate"
  | "modelName"
  | "lotNumber"
  | "serialNumber"
  | "intakeNumber";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";
const errorClass = "mt-1 text-xs text-red-600 dark:text-red-400";

function validateDraft(
  draft: IntakeDraftData,
  ctx: { requireProductModelSelection: boolean; canRegisterProductModel: boolean }
): Partial<Record<FieldKey, string>> {
  const errors: Partial<Record<FieldKey, string>> = {};

  if (!draft.customerId && !draft.customerCreateNew) {
    errors.customerId = draft.customerName.trim()
      ? "등록된 고객사를 선택하거나 '새 고객사로 등록'을 눌러주세요."
      : "고객사를 입력해 주세요.";
  }
  if (!draft.endUserId && !draft.endUserCreateNew && draft.endUserName.trim()) {
    errors.endUserId = "등록된 End-User를 선택하거나 '새 End-User로 등록'을 눌러주세요.";
  }

  if (!draft.billingType) {
    errors.billingType = "유상/무상을 선택해 주세요.";
  }

  if (!isValidDateString(draft.receivedAt)) {
    errors.receivedAt = "인수일을 올바른 날짜로 입력해 주세요.";
  }

  if (draft.internalTargetInspectionCompletionDate) {
    if (!isValidDateString(draft.internalTargetInspectionCompletionDate)) {
      errors.internalTargetInspectionCompletionDate = "사내 목표 검수 완료일을 올바른 날짜로 입력해 주세요.";
    } else if (
      isValidDateString(draft.receivedAt) &&
      !isNotEarlierThan(draft.internalTargetInspectionCompletionDate, draft.receivedAt)
    ) {
      errors.internalTargetInspectionCompletionDate = "사내 목표 검수 완료일은 인수일보다 이전일 수 없습니다.";
    }
  }

  if (draft.internalTargetShipmentDate) {
    if (!isValidDateString(draft.internalTargetShipmentDate)) {
      errors.internalTargetShipmentDate = "사내 목표 출하일을 올바른 날짜로 입력해 주세요.";
    } else if (
      isValidDateString(draft.receivedAt) &&
      !isNotEarlierThan(draft.internalTargetShipmentDate, draft.receivedAt)
    ) {
      errors.internalTargetShipmentDate = "사내 목표 출하일은 인수일보다 이전일 수 없습니다.";
    }
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

  if (!draft.modelName.trim()) {
    errors.modelName = "Model을 입력해 주세요.";
  } else if (ctx.requireProductModelSelection && !draft.productModelId && !draft.productModelCreateNew) {
    errors.modelName = ctx.canRegisterProductModel
      ? "등록된 Model을 선택하거나 '새 모델로 등록'을 눌러주세요."
      : "등록된 Model을 선택해 주세요.";
  }
  if (!draft.lotNumber.trim()) errors.lotNumber = "L/N을 입력해 주세요.";
  if (!draft.serialNumber.trim()) errors.serialNumber = "S/N을 입력해 주세요.";

  return errors;
}

const FIELD_ORDER: FieldKey[] = [
  "customerId",
  "endUserId",
  "assignedEngineerId",
  "billingType",
  "receivedAt",
  "internalTargetInspectionCompletionDate",
  "internalTargetShipmentDate",
  "customerRequestedDueDate",
  "intakeNumber",
  "modelName",
  "lotNumber",
  "serialNumber",
];

type IntakeFormInnerProps = {
  writeSource: "local" | "database";
  referenceData: IntakeReferenceData | null;
  /** Product Model Master 연결 체크포인트 — SUPER_ADMIN/ADMIN만 true. DB
   * 모드에서만 의미 있다(로컬 모드는 애초에 콤보박스를 렌더링하지 않는다). */
  canRegisterProductModel: boolean;
};

// 사용자는 workflowType을 직접 고르지 않는다 — "종류"와 유상/무상
// + "유상/무상" 두 값의 조합으로부터 내부적으로 유도한다(workflow-kind.ts —
// 접수/상세 편집 양쪽이 재사용하는 단일 매핑 규칙). workflowType 자체는
// 워크플로 템플릿/버전/단계 선택을 위해 그대로 저장/사용된다(변경 없음) —
// 조합으로 신규 생성 가능한 6종 중 하나를 결정한다.

// Server Action result codes → Korean message. Field-attributable codes
// also populate `errors` via fieldErrors so the existing inline per-field
// error UI (and focusFirstInvalid) works unchanged for server-detected
// problems too, not just client-side validateDraft() failures.
const RESULT_CODE_MESSAGES: Record<CreateRepairCaseResultCode, string> = {
  VALIDATION_ERROR: "입력값을 확인해 주세요.",
  UNAUTHORIZED: "로그인이 필요합니다. 다시 로그인해 주세요.",
  FORBIDDEN: "A/S 접수 등록 권한이 없습니다.",
  REFERENCE_NOT_FOUND: "선택한 값을 확인할 수 없습니다. 다시 선택해 주세요.",
  REFERENCE_MISMATCH: "선택한 End-User가 고객사와 일치하지 않습니다. 다시 선택해 주세요.",
  ENGINEER_NOT_ALLOWED: "선택한 담당 엔지니어는 배정할 수 없습니다. 다시 선택해 주세요.",
  WORKFLOW_NOT_ALLOWED: "선택한 워크플로를 사용할 수 없습니다.",
  INTAKE_SEQUENCE_EXHAUSTED:
    "선택한 달의 인수번호를 모두 사용했습니다(99건 초과). 다른 인수일을 선택해 주세요.",
  INTAKE_NUMBER_DUPLICATE: "이미 사용 중인 인수번호입니다. 다른 번호를 입력해 주세요.",
  CONFLICT: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요.",
  DATABASE_UNAVAILABLE: "일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  SUBMISSION_IN_PROGRESS: "이전 제출이 아직 처리 중입니다. 잠시 후 다시 시도해 주세요.",
};

export default function IntakeFormInner({ writeSource, referenceData, canRegisterProductModel }: IntakeFormInnerProps) {
  const router = useRouter();
  const { cases: localCases } = useLocalRepairCases();
  const { draft, updateDraft, isEmpty, clear, idempotencyKey } = useIntakeDraft();

  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 인수번호는 제출 시점에만 최종 확정되므로 초안(useIntakeDraft)에는 절대
  // 저장하지 않는다 — 이 override는 컴포넌트 로컬 state로만 존재한다.
  const [intakeNumberOverride, setIntakeNumberOverride] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLElement | null>>>({});

  // Database mode must offer real database rows (UUID-keyed) — the mock
  // string IDs (mockCustomers/mockEndUsers/mockUsers, e.g. "c-001") do not
  // exist in Postgres at all. Local mode keeps the exact original data
  // source (referenceData is always null in that mode), plus any customer/
  // End-User previously created by an earlier LOCAL intake (free-entry
  // "새로 등록" — local mode has no separate customers table, so these are
  // only discoverable by scanning existing local cases' own snapshots; see
  // local-entity-resolve.ts for the matching submission-time counterpart).
  const localCustomerOptions = useMemo(() => {
    if (referenceData) return [];
    const mockIds = new Set(mockCustomers.map((c) => c.id));
    const seen = new Map<string, { id: string; name: string }>();
    for (const c of localCases) {
      if (mockIds.has(c.customerId) || seen.has(c.customerId)) continue;
      seen.set(c.customerId, { id: c.customerId, name: c.customerNameSnapshot });
    }
    return [...seen.values()];
  }, [referenceData, localCases]);
  const localEndUserOptions = useMemo(() => {
    if (referenceData) return [];
    const mockIds = new Set(mockEndUsers.map((e) => e.id));
    const seen = new Map<string, { id: string; customerId: string; name: string }>();
    for (const c of localCases) {
      if (!c.endUserId || !c.endUserNameSnapshot) continue;
      if (mockIds.has(c.endUserId) || seen.has(c.endUserId)) continue;
      seen.set(c.endUserId, { id: c.endUserId, customerId: c.customerId, name: c.endUserNameSnapshot });
    }
    return [...seen.values()];
  }, [referenceData, localCases]);
  const customerOptions = useMemo(
    () => (referenceData ? referenceData.customers : [...mockCustomers, ...localCustomerOptions]),
    [referenceData, localCustomerOptions]
  );
  const allEndUserOptions = useMemo(
    () => (referenceData ? referenceData.endUsers : [...mockEndUsers, ...localEndUserOptions]),
    [referenceData, localEndUserOptions]
  );

  const eligibleEngineers = useMemo(
    () =>
      referenceData
        ? referenceData.engineers
        : mockUsers.filter((u) => u.role === "AS_ENGINEER" && u.approvalStatus === "APPROVED"),
    [referenceData]
  );
  const availableEndUsers = useMemo(
    () => allEndUserOptions.filter((e) => e.customerId === draft.customerId),
    [allEndUserOptions, draft.customerId]
  );
  const MAX_SUGGESTIONS = 8;
  const customerSuggestions = useMemo(
    () => rankSimilarNames(draft.customerName, customerOptions).slice(0, MAX_SUGGESTIONS),
    [draft.customerName, customerOptions]
  );
  const endUserSuggestions = useMemo(
    () => rankSimilarNames(draft.endUserName, availableEndUsers).slice(0, MAX_SUGGESTIONS),
    [draft.endUserName, availableEndUsers]
  );

  // Product Model Master — DB 모드에서만 존재한다(referenceData가 null이면
  // 로컬 모드이고, 아래 JSX가 그 경우 기존 자유 입력 필드를 그대로 렌더링해
  // 이 목록/제안을 아예 쓰지 않는다).
  const productModelOptions = useMemo(() => referenceData?.productModels ?? [], [referenceData]);
  const productModelSuggestions = useMemo(
    () => rankSimilarNames(draft.modelName, productModelOptions).slice(0, MAX_SUGGESTIONS),
    [draft.modelName, productModelOptions]
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

  // 고객사/End-User는 편집 가능한 콤보박스다: 자유 입력 + 기존 등록 값
  // 제안(rankSimilarNames로 정렬됨). 제출에 쓰이는 실제 값은 customerId/
  // endUserId(해석된 ID)이거나, 사용자가 명시적으로 "새로 등록"을 눌렀을
  // 때만 채워지는 customerCreateNew/endUserCreateNew다 — 입력한 문자열이
  // 기존 이름과 정규화 기준(trim + 공백 축약 + 대소문자 무시) 정확히
  // 일치할 때만 자동으로 연결된다. 일치하지 않으면 매 키 입력마다 새로
  // 만들지 않고, validateDraft()가 이를 "선택하거나 새로 등록" 오류로
  // 표시한다 — 명시적으로 등록 버튼을 눌러야만 새 레코드로 확정된다.
  function handleCustomerNameChange(text: string) {
    const match = customerOptions.find((c) => normalizeEntityName(c.name) === normalizeEntityName(text));
    const resolvedCustomerId = match?.id ?? "";
    // 새로 매칭된 고객사가 이전과 동일한 기존 고객사가 아니면(신규 등록으로
    // 전환되거나, 다른 고객사로 바뀌거나, 매칭이 풀리는 모든 경우) End-User
    // 선택/등록 의사를 전부 초기화한다 — 엉뚱한 고객사에 조용히 붙는 것을
    // 막는다.
    const customerUnchanged = resolvedCustomerId !== "" && resolvedCustomerId === draft.customerId;
    updateDraft({
      customerName: text,
      customerId: resolvedCustomerId,
      customerCreateNew: false,
      ...(customerUnchanged ? {} : { endUserId: null, endUserName: "", endUserCreateNew: false }),
    });
  }

  function handleCreateNewCustomer() {
    updateDraft({ customerCreateNew: true });
  }

  function handleEndUserNameChange(text: string) {
    if (!text.trim()) {
      updateDraft({ endUserName: "", endUserId: null, endUserCreateNew: false });
      return;
    }
    const match = availableEndUsers.find((e) => normalizeEntityName(e.name) === normalizeEntityName(text));
    updateDraft({ endUserName: text, endUserId: match?.id ?? null, endUserCreateNew: false });
  }

  function handleCreateNewEndUser() {
    updateDraft({ endUserCreateNew: true });
  }

  // 고객사/End-User와 같은 원칙 — DB 모드에서만 쓰인다(referenceData가 null인
  // 로컬 모드에서는 이 핸들러들이 호출될 UI 자체가 없다). 텍스트가 기존
  // Model과 정확히(정규화 기준) 일치할 때만 productModelId가 채워지고, 그
  // 외에는 SUPER_ADMIN/ADMIN만 "새 모델로 등록"을 눌러 명시적으로 확정한다.
  function handleModelNameChange(text: string) {
    const match = productModelOptions.find((m) => normalizeEntityName(m.name) === normalizeEntityName(text));
    updateDraft({ modelName: text, productModelId: match?.id ?? "", productModelCreateNew: false });
  }

  function handleCreateNewProductModel() {
    updateDraft({ productModelCreateNew: true });
  }

  function handleWorkflowKindChange(kind: WorkflowKind) {
    // 아직 유상/무상을 고르지 않은 채 종류를 선택하는 중간 상태는
    // 정상이다 — deriveWorkflowType은 이럴 때 절대 추측하지 않고 null을
    // 반환하므로, 내부 표시용 workflowType은 임시 기본값(PAID_GENERATOR)을
    // 쓴다. 실제 제출은 billingType 자체의 필수 검증이 막는다.
    const currentBillingType = draft.billingType === "" ? null : draft.billingType;
    const fallbackByKind = {
      MATCHER: "PAID_MATCHER",
      GENERATOR: "PAID_GENERATOR",
      TOTAL_CONTROLLER: "PAID_TOTAL_CONTROLLER",
    } as const;
    const workflowType = deriveWorkflowType(kind, currentBillingType) ?? fallbackByKind[kind];
    updateDraft({ workflowType });
  }

  function handleBillingTypeChange(billingType: BillingType | "") {
    const resolvedBillingType = billingType === "" ? null : billingType;
    const workflowType =
      deriveWorkflowType(workflowKindOf(draft.workflowType), resolvedBillingType) ?? draft.workflowType;
    updateDraft({ billingType, workflowType });
  }

  // 사내 목표 검수 완료일 기본값 = 인수일 + 14일. 사용자가 이 필드를 아직
  // 직접 손대지 않은 동안(internalTargetInspectionCompletionDateTouched가
  // false인 동안)에만 인수일 변경 시 자동으로 다시 계산한다 — 한 번이라도
  // 직접 손대면(빈 값으로 지우는 것 포함) 그 이후로는 인수일이 바뀌어도
  // 절대 덮어쓰지 않는다(draft-storage.ts의 타입 주석 참고).
  function handleReceivedAtChange(value: string) {
    updateDraft({
      receivedAt: value,
      internalTargetInspectionCompletionDate: nextTargetInspectionCompletionDate({
        newReceivedAt: value,
        touched: draft.internalTargetInspectionCompletionDateTouched,
        currentValue: draft.internalTargetInspectionCompletionDate,
      }),
    });
  }

  function handleInternalTargetInspectionCompletionDateChange(value: string) {
    updateDraft({
      internalTargetInspectionCompletionDate: value,
      internalTargetInspectionCompletionDateTouched: true,
    });
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    // Guards double-click/Enter-twice: the button is also disabled while
    // isSubmitting, but this is a second, state-based backstop that holds
    // even if a click somehow lands before the disabled attribute commits.
    if (isSubmitting) return;

    const fieldErrors = validateDraft(draft, {
      requireProductModelSelection: writeSource === "database",
      canRegisterProductModel,
    });
    const trimmedIntakeNumberOverride = intakeNumberOverride.trim();
    if (trimmedIntakeNumberOverride && !isValidIntakeNumberFormat(trimmedIntakeNumberOverride)) {
      fieldErrors.intakeNumber = "인수번호 형식이 올바르지 않습니다. (예: D260601)";
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      focusFirstInvalid(fieldErrors);
      return;
    }
    // validateDraft() above already required this to be non-empty — this
    // guard only gives TS real narrowing from BillingType | "" to BillingType.
    if (!draft.billingType) return;

    const input: IntakeSubmissionInput = {
      workflowType: draft.workflowType,
      billingType: draft.billingType,
      customerId: draft.customerId || null,
      newCustomerName: draft.customerCreateNew ? draft.customerName.trim() : null,
      endUserId: draft.endUserId,
      newEndUserName: draft.endUserCreateNew ? draft.endUserName.trim() : null,
      assignedEngineerId: draft.assignedEngineerId || null,
      priority: draft.priority,
      receivedAt: draft.receivedAt,
      customerRequestedDueDate: draft.customerRequestedDueDate || null,
      internalTargetInspectionCompletionDate: draft.internalTargetInspectionCompletionDate || null,
      internalTargetShipmentDate: draft.internalTargetShipmentDate || null,
      intakeNumber: trimmedIntakeNumberOverride || null,
      modelName: draft.modelName,
      productModelId: draft.productModelCreateNew ? null : draft.productModelId || null,
      newProductModelName: draft.productModelCreateNew ? draft.modelName.trim() : null,
      lotNumber: draft.lotNumber,
      serialNumber: draft.serialNumber,
      partNumber: draft.partNumber,
      accessoryList: draft.accessoryList,
      externalConditionSummary: draft.externalConditionSummary,
      reasonForRemoval: draft.reasonForRemoval,
      reportedSymptom: draft.reportedSymptom,
      notes: draft.notes,
      contactName: draft.contactName,
      contactPhone: draft.contactPhone,
      contactEmail: draft.contactEmail,
    };

    if (writeSource === "database") {
      setIsSubmitting(true);
      try {
        const result = await createRepairCaseAction(input, idempotencyKey);
        if (!result.ok) {
          if (result.fieldErrors) {
            setErrors((prev) => ({ ...prev, ...result.fieldErrors }));
            focusFirstInvalid(result.fieldErrors as Partial<Record<FieldKey, string>>);
          }
          setSubmitError(result.message || RESULT_CODE_MESSAGES[result.code]);
          return;
        }
        clear();
        router.push(`/repair-cases/${result.id}?registered=1`);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const result = submitNewLocalCase(input);
    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        INVALID_CUSTOMER: "선택한 고객사를 확인할 수 없습니다. 다시 선택해 주세요.",
        INVALID_END_USER: "선택한 End-User가 고객사와 일치하지 않습니다. 다시 선택해 주세요.",
        INVALID_ENGINEER: "선택한 담당 엔지니어를 확인할 수 없습니다. 다시 선택해 주세요.",
        SEQUENCE_EXHAUSTED:
          "선택한 달의 인수번호를 모두 사용했습니다(99건 초과). 다른 인수일을 선택해 주세요.",
        STORAGE_CONFLICT: "저장 중 충돌이 발생했습니다. 다시 시도해 주세요.",
        INTAKE_NUMBER_INVALID_FORMAT: "인수번호 형식이 올바르지 않습니다. (예: D260601)",
        INTAKE_NUMBER_DUPLICATE: "이미 사용 중인 인수번호입니다. 다른 번호를 입력해 주세요.",
      };
      if (result.reason === "INTAKE_NUMBER_INVALID_FORMAT" || result.reason === "INTAKE_NUMBER_DUPLICATE") {
        const intakeNumberFieldErrors = { intakeNumber: messages[result.reason] };
        setErrors((prev) => ({ ...prev, ...intakeNumberFieldErrors }));
        focusFirstInvalid(intakeNumberFieldErrors);
      }
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
        <DraftStatusLine />
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
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="workflowKind" className={labelClass}>종류 *</label>
            <select
              id="workflowKind"
              className={inputClass}
              value={workflowKindOf(draft.workflowType)}
              onChange={(e) => handleWorkflowKindChange(e.target.value as WorkflowKind)}
            >
              {(Object.keys(workflowKindLabels) as WorkflowKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {workflowKindLabels[kind]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="billingType" className={labelClass}>유상/무상 *</label>
            <select
              id="billingType"
              ref={(el) => {
                fieldRefs.current.billingType = el;
              }}
              className={inputClass}
              value={draft.billingType}
              onChange={(e) => handleBillingTypeChange(e.target.value as IntakeDraftData["billingType"])}
              aria-invalid={Boolean(errors.billingType)}
              aria-describedby={errors.billingType ? "billingType-error" : undefined}
            >
              <option value="">선택해 주세요</option>
              {MANUAL_INTAKE_BILLING_TYPE_CODES.map((type) => (
                <option key={type} value={type}>
                  {billingTypeLabels[type]}
                </option>
              ))}
            </select>
            {errors.billingType && <p id="billingType-error" className={errorClass}>{errors.billingType}</p>}
          </div>
          <div>
            <label htmlFor="intakeNumber" className={labelClass}>인수번호</label>
            <input
              id="intakeNumber"
              ref={(el) => {
                fieldRefs.current.intakeNumber = el;
              }}
              className={inputClass}
              placeholder={estimatedIntakeNumber ?? undefined}
              value={intakeNumberOverride}
              onChange={(e) => setIntakeNumberOverride(e.target.value)}
              aria-invalid={Boolean(errors.intakeNumber)}
              aria-describedby={errors.intakeNumber ? "intakeNumber-error" : "intakeNumber-help"}
            />
            {errors.intakeNumber ? (
              <p id="intakeNumber-error" className={errorClass}>{errors.intakeNumber}</p>
            ) : (
              <p id="intakeNumber-help" className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                비워두면 예상 인수번호({estimatedIntakeNumber ?? "-"})가 자동으로 채번됩니다. 직접 입력한 값은 제출 시 형식과 중복 여부를 다시 확인합니다.
              </p>
            )}
          </div>
        </div>
        <div className="mt-3">
          <DerivedProductFields workflowType={draft.workflowType} />
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          적용 워크플로: {workflowTypeLabels[draft.workflowType]} (종류/유상·무상 선택에 따라 자동 결정됩니다)
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">고객 / 담당자</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="customerId" className={labelClass}>고객사 *</label>
            <input
              id="customerId"
              list="customerId-suggestions"
              autoComplete="off"
              ref={(el) => {
                fieldRefs.current.customerId = el;
              }}
              className={inputClass}
              placeholder="고객사명을 입력하세요"
              value={draft.customerName}
              onChange={(e) => handleCustomerNameChange(e.target.value)}
              aria-invalid={Boolean(errors.customerId)}
              aria-describedby={errors.customerId ? "customerId-error" : "customerId-help"}
            />
            <datalist id="customerId-suggestions">
              {customerSuggestions.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            {errors.customerId && <p id="customerId-error" className={errorClass}>{errors.customerId}</p>}
            {!draft.customerId && draft.customerName.trim() && (
              draft.customerCreateNew ? (
                <p id="customerId-help" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 새 고객사 &apos;{draft.customerName.trim()}&apos;로 등록됩니다.{" "}
                  <button
                    type="button"
                    onClick={() => updateDraft({ customerCreateNew: false })}
                    className="underline"
                  >
                    취소
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  id="customerId-help"
                  onClick={handleCreateNewCustomer}
                  className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  새 고객사로 등록: &apos;{draft.customerName.trim()}&apos;
                </button>
              )
            )}
          </div>

          <div>
            <label htmlFor="endUserId" className={labelClass}>End-User</label>
            <input
              id="endUserId"
              list="endUserId-suggestions"
              autoComplete="off"
              ref={(el) => {
                fieldRefs.current.endUserId = el;
              }}
              className={inputClass}
              placeholder="End-User명을 입력하세요 (선택)"
              value={draft.endUserName}
              disabled={!draft.customerId && !draft.customerCreateNew}
              onChange={(e) => handleEndUserNameChange(e.target.value)}
              aria-invalid={Boolean(errors.endUserId)}
              aria-describedby={errors.endUserId ? "endUserId-error" : "endUserId-help"}
            />
            <datalist id="endUserId-suggestions">
              {endUserSuggestions.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>
            {errors.endUserId && <p id="endUserId-error" className={errorClass}>{errors.endUserId}</p>}
            {!draft.endUserId && draft.endUserName.trim() && (
              draft.endUserCreateNew ? (
                <p id="endUserId-help" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 새 End-User &apos;{draft.endUserName.trim()}&apos;로 등록됩니다.{" "}
                  <button
                    type="button"
                    onClick={() => updateDraft({ endUserCreateNew: false })}
                    className="underline"
                  >
                    취소
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  id="endUserId-help"
                  onClick={handleCreateNewEndUser}
                  className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  새 End-User로 등록: &apos;{draft.endUserName.trim()}&apos;
                </button>
              )
            )}
          </div>

          <div>
            <label htmlFor="assignedEngineerId" className={labelClass}>담당 엔지니어</label>
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
              <option value="">선택 안 함</option>
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
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
              onChange={(e) => handleReceivedAtChange(e.target.value)}
              aria-invalid={Boolean(errors.receivedAt)}
              aria-describedby={errors.receivedAt ? "receivedAt-error" : undefined}
            />
            {errors.receivedAt && <p id="receivedAt-error" className={errorClass}>{errors.receivedAt}</p>}
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

          <div>
            <label htmlFor="internalTargetInspectionCompletionDate" className={labelClass}>
              사내 목표 검수 완료일
            </label>
            <input
              id="internalTargetInspectionCompletionDate"
              type="date"
              ref={(el) => {
                fieldRefs.current.internalTargetInspectionCompletionDate = el;
              }}
              className={inputClass}
              value={draft.internalTargetInspectionCompletionDate}
              onChange={(e) => handleInternalTargetInspectionCompletionDateChange(e.target.value)}
              aria-invalid={Boolean(errors.internalTargetInspectionCompletionDate)}
              aria-describedby={
                errors.internalTargetInspectionCompletionDate
                  ? "internalTargetInspectionCompletionDate-error"
                  : undefined
              }
            />
            {errors.internalTargetInspectionCompletionDate && (
              <p id="internalTargetInspectionCompletionDate-error" className={errorClass}>
                {errors.internalTargetInspectionCompletionDate}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="internalTargetShipmentDate" className={labelClass}>사내 목표 출하일</label>
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
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">제품 정보</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="modelName" className={labelClass}>Model *</label>
            {referenceData ? (
              <>
                <input
                  id="modelName"
                  list="modelName-suggestions"
                  autoComplete="off"
                  ref={(el) => {
                    fieldRefs.current.modelName = el;
                  }}
                  className={inputClass}
                  placeholder="Model명을 입력하세요"
                  value={draft.modelName}
                  onChange={(e) => handleModelNameChange(e.target.value)}
                  aria-invalid={Boolean(errors.modelName)}
                  aria-describedby={errors.modelName ? "modelName-error" : "modelName-help"}
                />
                <datalist id="modelName-suggestions">
                  {productModelSuggestions.map((m) => (
                    <option key={m.id} value={m.name} />
                  ))}
                </datalist>
                {errors.modelName && <p id="modelName-error" className={errorClass}>{errors.modelName}</p>}
                {!draft.productModelId && draft.modelName.trim() && (
                  draft.productModelCreateNew ? (
                    <p id="modelName-help" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                      ✓ 새 Model &apos;{draft.modelName.trim()}&apos;로 등록됩니다.{" "}
                      <button
                        type="button"
                        onClick={() => updateDraft({ productModelCreateNew: false })}
                        className="underline"
                      >
                        취소
                      </button>
                    </p>
                  ) : canRegisterProductModel ? (
                    <button
                      type="button"
                      id="modelName-help"
                      onClick={handleCreateNewProductModel}
                      className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      새 모델로 등록: &apos;{draft.modelName.trim()}&apos;
                    </button>
                  ) : (
                    <p id="modelName-help" className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      등록된 Model 중에서 선택해 주세요. 목록에 없다면 관리자에게 등록을 요청해 주세요.
                    </p>
                  )
                )}
              </>
            ) : (
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
            )}
            {!referenceData && errors.modelName && <p id="modelName-error" className={errorClass}>{errors.modelName}</p>}
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
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {isSubmitting
            ? "저장 중..."
            : writeSource === "database"
              ? "A/S 접수 등록"
              : "A/S 접수 등록 (로컬 데모)"}
        </button>
      </div>
    </form>
  );
}
