import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import {
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL,
  REPAIR_CASE_DUE_DATE_LINK_NOTE,
  resolveRepairCaseRequestedDueDate,
} from "@/lib/domain/requested-due-date-link";
import IntakeInfoEditForm from "./edit/IntakeInfoEditForm";
import { detailEditButtonClass } from "./edit-button-class";
import { DUE_DATE_NEAR_TEXT_CLASS } from "@/components/repair-cases/due-date-near";

/**
 * ⚠️ `고객 요청 납기일` 한 칸만 값이 두 곳에서 올 수 있다 — 이 건에 적힌 값이
 * 먼저고, 비어 있으면 연결된 내자 정리의 납기요청일 중 가장 이른 하루를 빌려
 * 온다(domain/requested-due-date-link.ts). 빌려 온 값에는 아래 한 줄
 * (`내자 납기요청일`)이 붙는다: 표시 없이 날짜만 그리면 "이 건에 적어 둔 값"으로
 * 읽히고, 나중에 내자 쪽이 바뀌면 아무도 안 건드렸는데 값이 달라진 것으로 보인다.
 *
 * 그래서 Field 가 `borrowedLabel` 을 받는다. 값 옆에 붙이지 않고 **아래 줄**에
 * 두는 것은 이 칸들이 2열 격자라 폭이 좁아서다 — 옆에 붙이면 날짜와 표시가
 * 한 줄에 안 들어가 어차피 접힌다.
 */
function Field({
  label,
  value,
  borrowedLabel,
  hint,
  emphasized = false,
}: {
  label: string;
  value: string;
  /** 빌려 온 값일 때만 적는다. 없으면 이 줄 자체가 없다. */
  borrowedLabel?: string;
  /** 이름표에 마우스를 올렸을 때 뜨는 설명. 규칙이 있는 칸에만 붙는다. */
  hint?: string;
  /**
   * 값을 **굵은 붉은색**으로 — 지금 켜지는 칸은 「고객 요청 납기일」 하나뿐이고,
   * 그 건이 납기 임박일 때만이다(2026-10-19 사용자 요구). 🔴 기본은 거짓이고,
   * 거짓일 때 나오는 HTML 은 예전과 한 글자도 다르지 않다 — 이 조각은 이 구역의
   * 모든 칸이 함께 쓰므로 평소 모양이 바뀌면 열 칸이 한꺼번에 바뀐다.
   */
  emphasized?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400" title={hint}>
        {label}
      </dt>
      <dd
        className={
          emphasized
            ? `text-sm ${DUE_DATE_NEAR_TEXT_CLASS}`
            : "text-sm text-zinc-900 dark:text-zinc-50"
        }
      >
        {value}
      </dd>
      {borrowedLabel && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{borrowedLabel}</p>
      )}
    </div>
  );
}

export default function IntakeInfoSection({
  resolved,
  editableFields,
  editingSection,
  referenceData,
  domesticOrderDueDates,
  isDueDateNear,
  onStartEdit,
  onDone,
}: {
  resolved: EffectiveRepairCase;
  /** null when the current user cannot edit any field in this section — hides the Edit button entirely. */
  editableFields: readonly string[] | null;
  editingSection: RepairCaseEditSection | null;
  referenceData: IntakeReferenceData | null;
  /**
   * 이 건에 연결된 내자 정리 줄들의 납기요청일 전부. 없는 것이 정상이다 —
   * 고르는 일은 화면이 아니라 도메인이 한다(위 Field 주석).
   */
  domesticOrderDueDates: readonly string[];
  /**
   * 이 건이 「납기 임박」인가 — 그러면 아래 「고객 요청 납기일」 **한 칸만** 굵은
   * 붉은색이 된다(2026-10-19 사용자 요구).
   *
   * 🔴 여기서 재지 않고 받는 까닭은 머리 카드의 같은 배지와 같다 — "오늘"을
   * 화면에서 만들면 서버가 그린 것과 어긋나고(hydration), 조건을 적으면 종 알림과
   * 두 말이 된다. 서버가 종과 같은 함수로 재 온다([id]/page.tsx).
   */
  isDueDateNear: boolean;
  onStartEdit: () => void;
  onDone: () => void;
}) {
  const isEditing = editingSection === "INTAKE";
  const canShowEditButton = editableFields !== null && editingSection === null;

  // 보기 모드와 편집 폼이 **같은 판단을 한 번만** 한다. 두 곳에서 각각 부르면
  // 언젠가 한쪽만 고쳐져, 같은 칸이 수정 버튼을 누르기 전과 후에 다른 날짜로
  // 보인다.
  const requestedDueDate = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: resolved.customerRequestedDueDate,
    domesticOrderDueDates,
  });

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">인수 정보</h2>
        {canShowEditButton && (
          <button
            type="button"
            onClick={onStartEdit}
            className={detailEditButtonClass}
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
            // ⚠️ 빌려 온 날짜일 때만 넘긴다. 이 건에 적힌 값이 있으면 null 이라,
            // 폼이 그 값을 입력칸에 채워 넣을 자리 자체가 없다 — 채우면 아무것도
            // 고치지 않고 저장만 눌러도 내자 쪽 날짜가 이 건 자기 값으로 굳는다.
            borrowedRequestedDueDate={
              requestedDueDate.borrowed ? requestedDueDate.dueDate : null
            }
            onDone={onDone}
          />
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="인수일" value={resolved.receivedAt} />
          <Field label="유상/무상" value={resolved.paidOrWarranty} />
          <Field label="고객사" value={resolved.customerName} />
          <Field label="End-User" value={resolved.endUserName ?? "-"} />
          {/* 이 칸만 값이 두 곳에서 올 수 있다 — 위 Field 주석. */}
          <Field
            label="고객 요청 납기일"
            value={requestedDueDate.dueDate ?? "-"}
            borrowedLabel={
              requestedDueDate.borrowed ? DUE_DATE_FROM_DOMESTIC_ORDER_LABEL : undefined
            }
            hint={REPAIR_CASE_DUE_DATE_LINK_NOTE}
            // 🔴 이 한 칸에서만 켠다 — 「납기 임박」은 이 날짜에 대한 말이다.
            // 빌려 왔다는 표시(아래 줄)는 함께 붉어지지 않는다: 그것은 경보가
            // 아니라 어디서 온 값인가를 말하는 표시다.
            emphasized={isDueDateNear}
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
