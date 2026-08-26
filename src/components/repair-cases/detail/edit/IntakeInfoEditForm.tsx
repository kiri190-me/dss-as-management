"use client";

import { useMemo, useState, type FormEvent } from "react";
import { normalizeEntityName, rankSimilarNames } from "@/lib/domain/entity-name-match";
import { BILLING_TYPE_CODES, billingTypeLabels, PRIORITY_CODES, priorityLabels, type BillingType, type Priority } from "@/lib/domain/types";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { DUE_DATE_FROM_DOMESTIC_ORDER_LABEL } from "@/lib/domain/requested-due-date-link";
import { useSectionEditSubmit } from "./useSectionEditSubmit";
import EditSectionActions, { editErrorClass, editInputClass, editLabelClass } from "./EditSectionActions";

const MAX_SUGGESTIONS = 8;

function ReadOnlyField({
  label,
  value,
  borrowedLabel,
}: {
  label: string;
  value: string;
  /**
   * 그 값이 이 건에 적힌 것이 아니라 **빌려 온 것**일 때만 적는다. 지금 이것을
   * 쓰는 칸은 `고객 요청 납기일` 하나다(아래 그 칸 주석) — 보기 모드가 붙이는
   * 표시와 같은 글자라야 수정 버튼을 눌렀다고 값의 출처가 달라 보이지 않는다.
   */
  borrowedLabel?: string;
}) {
  return (
    <div>
      <dt className={editLabelClass}>{label}</dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-50">{value}</dd>
      {borrowedLabel && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{borrowedLabel}</p>
      )}
    </div>
  );
}

/**
 * Renders every INTAKE-section field that view mode shows (receivedAt,
 * billingType, customer, End-User, customerRequestedDueDate,
 * internalTargetShipmentDate, plus the three contact fields, which view mode
 * currently displays under FaultServiceSection — see the final report's "UI
 * behavior" note on why edit-section ownership follows the authorization
 * matrix rather than the current display layout) — as an input when
 * `editableFields` grants this role that field, as read-only text otherwise,
 * so context is never lost mid-edit.
 *
 * 사내 목표 출하일/사내 목표 검수 완료일 모두 이 폼이 유일한 정상 편집
 * 지점이다(고장 및 서비스 정보의 편집 폼에는 더 이상 없다) — 둘 다 선택
 * 입력이라 비우면 null로 저장된다.
 *
 * 우선순위(priority) — 인수 정보 priority-editing 체크포인트부터 이 폼이
 * 유일한 정상 편집 지점이다. domain/types.ts의 PRIORITY_CODES/priorityLabels
 * 를 그대로 재사용하며(새 enum을 정의하지 않는다), 일정 필드들(고객 요청
 * 납기일/사내 목표 출하일) 바로 옆에 배치해 "운영 계획 정보"라는 같은
 * 성격임을 드러낸다. 현재는 SUPER_ADMIN/ADMIN만 이 필드를 볼 수 있는 select로
 * 얻는다(SECTION_FIELD_NAMES.INTAKE에는 있지만 AS_ENGINEER_FIELDS/
 * SALES_FIELDS에는 의도적으로 넣지 않았다 — repair-case-edit-
 * authorization.ts 참고) — 다른 역할은 항상 읽기 전용으로 본다.
 *
 * 보고서번호(legacyReportNumber)는 INTAKE 섹션 필드지만 이 폼에는 없다 —
 * 담당 엔지니어와 같은 이유로 상단 요약 카드의 ReportNumberEditCell이 유일한
 * 편집 지점이다. 이 폼은 그 필드를 제출하지 않는다(섹션 권한 매트릭스에는
 * 그대로 남아 있고, 그 카드가 이 섹션으로 제출한다).
 *
 * 고객사/End-User는 A/S 접수 폼(IntakeFormInner.tsx)과 동일한 자유 입력
 * 콤보박스다 — 같은 entity-name-match.ts 매칭/순위 규칙을 그대로 재사용하고
 * (규칙을 여기서 다시 구현하지 않는다), 매칭되지 않는 이름은 "새로 등록"을
 * 명시적으로 눌러야만 새 레코드로 확정된다.
 */
export default function IntakeInfoEditForm({
  resolved,
  editableFields,
  referenceData,
  borrowedRequestedDueDate,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  editableFields: readonly string[];
  referenceData: IntakeReferenceData | null;
  /**
   * 보기 모드의 `고객 요청 납기일`에 **빌려 온 날짜**가 보이고 있을 때 그
   * 날짜다. 이 건에 값이 적혀 있으면 null 이다(고르는 판단은 부모가 이미
   * 끝냈다 — IntakeInfoSection).
   *
   * ⚠️ **이 값은 저장되지 않는다. placeholder 도 아니고 초기값은 더더욱
   * 아니다.** 아래 입력칸은 언제나 이 건에 적힌 값(resolved)으로만 열리고, 이
   * 값은 그 아래 안내 한 줄에만 쓰인다 — 입력칸에 채우면 아무것도 고치지 않고
   * 저장만 눌러도 내자 쪽 날짜가 이 건 자기 값으로 굳고, 그 뒤로는 "일부러
   * 같게 적었다"와 "그냥 안 건드렸다"를 구분할 수 없다(내자 정리 `줄 수정`
   * 폼이 같은 함정을 같은 방식으로 피한다 — DomesticOrderEditForm 의
   * 'placeholder 다. value 가 아니다').
   */
  borrowedRequestedDueDate: string | null;
  onDone: () => void;
}) {
  const canEdit = (field: string) => editableFields.includes(field);

  const [customerName, setCustomerName] = useState(resolved.customerName);
  const [customerId, setCustomerId] = useState(resolved.customerId);
  const [customerCreateNew, setCustomerCreateNew] = useState(false);
  const [endUserName, setEndUserName] = useState(resolved.endUserName ?? "");
  const [endUserId, setEndUserId] = useState<string | null>(resolved.endUserId);
  const [endUserCreateNew, setEndUserCreateNew] = useState(false);
  const [receivedAt, setReceivedAt] = useState(resolved.receivedAt);
  // "선택 안 함"(빈 문자열)은 "제출하지 않음"이다 — 이 셀렉트에는 저장된
  // 값을 다시 null로 되돌리는 옵션이 없다(제품 정보의 종류 재배정과 같은
  // 원칙: 명시적으로 고른 값만 제출한다).
  const [billingType, setBillingType] = useState<BillingType | "">(resolved.billingType ?? "");
  const [customerRequestedDueDate, setCustomerRequestedDueDate] = useState(
    resolved.customerRequestedDueDate ?? ""
  );
  const [internalTargetInspectionCompletionDate, setInternalTargetInspectionCompletionDate] = useState(
    resolved.internalTargetInspectionCompletionDate ?? ""
  );
  const [internalTargetShipmentDate, setInternalTargetShipmentDate] = useState(
    resolved.internalTargetShipmentDate ?? ""
  );
  // NOT NULL 컬럼이라 billingType의 "선택 안 함"(미제출) 옵션이 없다 — 현재
  // 저장된 값으로 항상 프리셀렉트되고, 편집 가능하면 제출 시 항상 값이
  // 함께 전송된다(값을 비워 다시 미정 상태로 되돌리는 개념 자체가 없다).
  const [priority, setPriority] = useState<Priority>(resolved.priority);
  const [contactName, setContactName] = useState(resolved.contactName ?? "");
  const [contactPhone, setContactPhone] = useState(resolved.contactPhone ?? "");
  const [contactEmail, setContactEmail] = useState(resolved.contactEmail ?? "");

  const { submit, isSubmitting, fieldErrors, submitError, isConflict, reloadAfterConflict } =
    useSectionEditSubmit({
      repairCaseId: resolved.id,
      version: resolved.version,
      section: "INTAKE",
      onDone,
    });

  const disabled = isSubmitting || isConflict;

  // Generator billing/workflow sync 체크포인트: GENERATOR 케이스는
  // billing_type이 workflowType(PAID_GENERATOR/WARRANTY_GENERATOR)과 항상
  // 일치해야 하므로, 값이 바뀌면 서버가 종류 재배정과 동일한 안전 게이트를
  // 함께 적용한다(intake_inspection 단계 + 이력 없음). 이 UX 게이트는 그
  // 판단의 미리보기일 뿐이다 — ProductInfoEditForm.tsx의 종류 재배정 게이트와
  // 정확히 같은 원칙으로, currentWorkflowStepKey만 미리 확인하고
  // status_change_histories(STEP_RETURNED 등)까지 재확인하는 서버가 최종
  // 권한자다.
  // 2026-08-18 원칙 변경: 유·무상은 언제든, 어느 단계에서든 바꿀 수 있다.
  // 여기 있던 "매쳐이거나 Generator가 인수점검에 있을 때만" 게이트를
  // 제거했다 — 서버에서 같은 제약을 걷어냈는데(billing-workflow-target.ts,
  // repair-cases.ts) 화면에만 남아 있어, 실제로는 거의 모든 접수 건에서
  // 선택 상자가 아예 렌더되지 않았다. 권한(역할) 검사만 남긴다.
  const canChangeBillingType = canEdit("billingType");

  const customerOptions = useMemo(() => referenceData?.customers ?? [], [referenceData]);
  const allEndUsers = useMemo(() => referenceData?.endUsers ?? [], [referenceData]);
  const availableEndUsers = useMemo(
    () => allEndUsers.filter((e) => e.customerId === customerId),
    [allEndUsers, customerId]
  );
  const customerSuggestions = useMemo(
    () => rankSimilarNames(customerName, customerOptions).slice(0, MAX_SUGGESTIONS),
    [customerName, customerOptions]
  );
  const endUserSuggestions = useMemo(
    () => rankSimilarNames(endUserName, availableEndUsers).slice(0, MAX_SUGGESTIONS),
    [endUserName, availableEndUsers]
  );

  function handleCustomerNameChange(text: string) {
    const match = customerOptions.find((c) => normalizeEntityName(c.name) === normalizeEntityName(text));
    const resolvedCustomerId = match?.id ?? "";
    const customerUnchanged = resolvedCustomerId !== "" && resolvedCustomerId === customerId;
    setCustomerName(text);
    setCustomerId(resolvedCustomerId);
    setCustomerCreateNew(false);
    if (!customerUnchanged) {
      setEndUserId(null);
      setEndUserName("");
      setEndUserCreateNew(false);
    }
  }

  function handleCreateNewCustomer() {
    setCustomerCreateNew(true);
  }

  function handleEndUserNameChange(text: string) {
    if (!text.trim()) {
      setEndUserName("");
      setEndUserId(null);
      setEndUserCreateNew(false);
      return;
    }
    const match = availableEndUsers.find((e) => normalizeEntityName(e.name) === normalizeEntityName(text));
    setEndUserName(text);
    setEndUserId(match?.id ?? null);
    setEndUserCreateNew(false);
  }

  function handleCreateNewEndUser() {
    setEndUserCreateNew(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const fields: Record<string, unknown> = {};
    if (canEdit("customerId")) {
      if (customerCreateNew) {
        fields.newCustomerName = customerName.trim();
      } else {
        fields.customerId = customerId;
      }
    }
    if (canEdit("endUserId")) {
      if (endUserCreateNew) {
        fields.newEndUserName = endUserName.trim();
      } else {
        fields.endUserId = endUserId;
      }
    }
    if (canEdit("receivedAt")) fields.receivedAt = receivedAt;
    if (canChangeBillingType && billingType !== "") fields.billingType = billingType;
    if (canEdit("customerRequestedDueDate")) fields.customerRequestedDueDate = customerRequestedDueDate || null;
    if (canEdit("internalTargetInspectionCompletionDate")) {
      fields.internalTargetInspectionCompletionDate = internalTargetInspectionCompletionDate || null;
    }
    if (canEdit("internalTargetShipmentDate")) {
      fields.internalTargetShipmentDate = internalTargetShipmentDate || null;
    }
    if (canEdit("priority")) fields.priority = priority;
    if (canEdit("contactName")) fields.contactName = contactName || null;
    if (canEdit("contactPhone")) fields.contactPhone = contactPhone || null;
    if (canEdit("contactEmail")) fields.contactEmail = contactEmail || null;
    void submit(fields);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {canEdit("receivedAt") ? (
          <div>
            <label className={editLabelClass}>인수일</label>
            <input
              type="date"
              className={editInputClass}
              value={receivedAt}
              disabled={disabled}
              onChange={(e) => setReceivedAt(e.target.value)}
            />
            {fieldErrors.receivedAt && <p className={editErrorClass}>{fieldErrors.receivedAt}</p>}
          </div>
        ) : (
          <ReadOnlyField label="인수일" value={resolved.receivedAt} />
        )}

        {canChangeBillingType ? (
          <div>
            <label className={editLabelClass}>유상/무상</label>
            <select
              className={editInputClass}
              value={billingType}
              disabled={disabled}
              onChange={(e) => setBillingType(e.target.value as BillingType | "")}
            >
              <option value="">선택 안 함</option>
              {/* 추후결정은 제외한다 — repair-case-update-input.ts가 이 값을
                  거부하기 때문이다(확정된 건을 미확정으로 되돌리면 단계가
                  2개뿐인 추후결정 워크플로로 밀려나 진행 상황을 잃는다).
                  고르면 반드시 실패하는 선택지를 보여주지 않는다. */}
              {BILLING_TYPE_CODES.filter((code) => code !== "PENDING_DECISION").map((code) => (
                <option key={code} value={code}>
                  {billingTypeLabels[code]}
                </option>
              ))}
            </select>
            {fieldErrors.billingType && <p className={editErrorClass}>{fieldErrors.billingType}</p>}
          </div>
        ) : (
          <ReadOnlyField label="유상/무상" value={resolved.paidOrWarranty} />
        )}

        {canEdit("customerId") ? (
          <div>
            <label htmlFor="edit-customerId" className={editLabelClass}>고객사</label>
            <input
              id="edit-customerId"
              list="edit-customerId-suggestions"
              autoComplete="off"
              className={editInputClass}
              value={customerName}
              disabled={disabled}
              onChange={(e) => handleCustomerNameChange(e.target.value)}
              aria-describedby={fieldErrors.customerId ? undefined : "edit-customerId-help"}
            />
            <datalist id="edit-customerId-suggestions">
              {customerSuggestions.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            {fieldErrors.customerId && <p className={editErrorClass}>{fieldErrors.customerId}</p>}
            {!customerId && customerName.trim() && (
              customerCreateNew ? (
                <p id="edit-customerId-help" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 새 고객사 &apos;{customerName.trim()}&apos;로 등록됩니다.{" "}
                  <button type="button" onClick={() => setCustomerCreateNew(false)} className="underline">
                    취소
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  id="edit-customerId-help"
                  onClick={handleCreateNewCustomer}
                  className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  새 고객사로 등록: &apos;{customerName.trim()}&apos;
                </button>
              )
            )}
          </div>
        ) : (
          <ReadOnlyField label="고객사" value={resolved.customerName} />
        )}

        {canEdit("endUserId") ? (
          <div>
            <label htmlFor="edit-endUserId" className={editLabelClass}>End-User</label>
            <input
              id="edit-endUserId"
              list="edit-endUserId-suggestions"
              autoComplete="off"
              className={editInputClass}
              placeholder="선택 안 함"
              value={endUserName}
              disabled={disabled}
              onChange={(e) => handleEndUserNameChange(e.target.value)}
              aria-describedby={fieldErrors.endUserId ? undefined : "edit-endUserId-help"}
            />
            <datalist id="edit-endUserId-suggestions">
              {endUserSuggestions.map((e) => (
                <option key={e.id} value={e.name} />
              ))}
            </datalist>
            {fieldErrors.endUserId && <p className={editErrorClass}>{fieldErrors.endUserId}</p>}
            {!endUserId && endUserName.trim() && (
              endUserCreateNew ? (
                <p id="edit-endUserId-help" className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ 새 End-User &apos;{endUserName.trim()}&apos;로 등록됩니다.{" "}
                  <button type="button" onClick={() => setEndUserCreateNew(false)} className="underline">
                    취소
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  id="edit-endUserId-help"
                  onClick={handleCreateNewEndUser}
                  className="mt-1 text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  새 End-User로 등록: &apos;{endUserName.trim()}&apos;
                </button>
              )
            )}
          </div>
        ) : (
          <ReadOnlyField label="End-User" value={resolved.endUserName ?? "-"} />
        )}

        {/* ⚠️ 이 칸만 보기 모드에서 **빌려 온 날짜**가 보일 수 있다 — 이 건에
            값이 없을 때 연결된 내자 정리의 납기요청일 중 가장 이른 하루가
            대신 보인다(domain/requested-due-date-link.ts). 그래서 편집칸이
            비어 있는 채로 열리는 순간이 생기고, 아무 말이 없으면 "방금 값이
            사라졌다"로 읽힌다. 그것을 설명하는 것이 입력칸 아래 한 줄이다.

            흐린 글씨(placeholder)로 두지 않는 것은 <input type="date"> 가
            placeholder 를 그리지 않기 때문이기도 하지만, 무엇보다 그 자리에
            날짜를 넣으면 저장 한 번에 그 값이 이 건에 굳기 때문이다(위 prop
            주석). 내자 정리 `줄 수정` 폼의 납기요청일 묶음이 같은 이유로 같은
            모양을 쓴다. */}
        {canEdit("customerRequestedDueDate") ? (
          <div>
            <label className={editLabelClass}>고객 요청 납기일</label>
            <input
              type="date"
              className={editInputClass}
              value={customerRequestedDueDate}
              disabled={disabled}
              onChange={(e) => setCustomerRequestedDueDate(e.target.value)}
            />
            {fieldErrors.customerRequestedDueDate && (
              <p className={editErrorClass}>{fieldErrors.customerRequestedDueDate}</p>
            )}
            {borrowedRequestedDueDate !== null && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {DUE_DATE_FROM_DOMESTIC_ORDER_LABEL}: {borrowedRequestedDueDate}
              </p>
            )}
          </div>
        ) : (
          <ReadOnlyField
            label="고객 요청 납기일"
            // 보기 모드와 **같은 날짜**를 보여 준다 — 수정 버튼을 눌렀다고 이
            // 칸만 "-"로 비어 보이면, 고칠 수 없는 사람에게는 값이 사라진
            // 것으로 읽힌다.
            value={resolved.customerRequestedDueDate ?? borrowedRequestedDueDate ?? "-"}
            borrowedLabel={
              borrowedRequestedDueDate !== null ? DUE_DATE_FROM_DOMESTIC_ORDER_LABEL : undefined
            }
          />
        )}

        {canEdit("internalTargetInspectionCompletionDate") ? (
          <div>
            <label className={editLabelClass}>사내 목표 검수 완료일</label>
            <input
              type="date"
              className={editInputClass}
              value={internalTargetInspectionCompletionDate}
              disabled={disabled}
              onChange={(e) => setInternalTargetInspectionCompletionDate(e.target.value)}
            />
            {fieldErrors.internalTargetInspectionCompletionDate && (
              <p className={editErrorClass}>{fieldErrors.internalTargetInspectionCompletionDate}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField
            label="사내 목표 검수 완료일"
            value={resolved.internalTargetInspectionCompletionDate ?? "-"}
          />
        )}

        {canEdit("internalTargetShipmentDate") ? (
          <div>
            <label className={editLabelClass}>사내 목표 출하일</label>
            <input
              type="date"
              className={editInputClass}
              value={internalTargetShipmentDate}
              disabled={disabled}
              onChange={(e) => setInternalTargetShipmentDate(e.target.value)}
            />
            {fieldErrors.internalTargetShipmentDate && (
              <p className={editErrorClass}>{fieldErrors.internalTargetShipmentDate}</p>
            )}
          </div>
        ) : (
          <ReadOnlyField label="사내 목표 출하일" value={resolved.internalTargetShipmentDate ?? "-"} />
        )}

        {canEdit("priority") ? (
          <div>
            <label className={editLabelClass}>우선순위</label>
            <select
              className={editInputClass}
              value={priority}
              disabled={disabled}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITY_CODES.map((code) => (
                <option key={code} value={code}>
                  {priorityLabels[code]}
                </option>
              ))}
            </select>
            {fieldErrors.priority && <p className={editErrorClass}>{fieldErrors.priority}</p>}
          </div>
        ) : (
          <ReadOnlyField label="우선순위" value={priorityLabels[resolved.priority]} />
        )}

        <ReadOnlyField label="실제 출하일" value={resolved.actualShipmentDate ?? "-"} />

        {canEdit("contactName") && (
          <div>
            <label className={editLabelClass}>담당자 성함</label>
            <input
              className={editInputClass}
              value={contactName}
              disabled={disabled}
              onChange={(e) => setContactName(e.target.value)}
            />
            {fieldErrors.contactName && <p className={editErrorClass}>{fieldErrors.contactName}</p>}
          </div>
        )}
        {canEdit("contactPhone") && (
          <div>
            <label className={editLabelClass}>연락처(전화)</label>
            <input
              className={editInputClass}
              value={contactPhone}
              disabled={disabled}
              onChange={(e) => setContactPhone(e.target.value)}
            />
            {fieldErrors.contactPhone && <p className={editErrorClass}>{fieldErrors.contactPhone}</p>}
          </div>
        )}
        {canEdit("contactEmail") && (
          <div>
            <label className={editLabelClass}>연락처(이메일)</label>
            <input
              type="email"
              className={editInputClass}
              value={contactEmail}
              disabled={disabled}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            {fieldErrors.contactEmail && <p className={editErrorClass}>{fieldErrors.contactEmail}</p>}
          </div>
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
