import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import type { RepairCaseEditSection } from "@/lib/validation/repair-case-update-input";
import {
  DUE_DATE_FROM_DOMESTIC_ORDER_LABEL,
  REPAIR_CASE_DUE_DATE_LINK_NOTE,
  resolveRepairCaseRequestedDueDate,
} from "@/lib/domain/requested-due-date-link";
import {
  DUE_DATE_INVERSION_NOTE,
  DUE_DATE_INVERSION_NOTE_CLASS,
  DUE_DATE_INVERSION_REASON_NOTE,
} from "@/lib/domain/due-date-inversion";
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
  note,
  noteTitle,
}: {
  label: string;
  value: string;
  /** 빌려 온 값일 때만 적는다. 없으면 이 줄 자체가 없다. */
  borrowedLabel?: string;
  /** 이름표에 마우스를 올렸을 때 뜨는 설명. 규칙이 있는 칸에만 붙는다. */
  hint?: string;
  /**
   * 값을 **굵은 붉은색**으로 — 지금 켜지는 칸은 「고객 요청 납기일」 하나뿐이고,
   * 그 건이 **납기 임박이거나 납기 역전**일 때다(2026-10-19 · 2026-10-29 사용자
   * 요구). 🔴 기본은 거짓이고, 거짓일 때 나오는 HTML 은 예전과 한 글자도 다르지
   * 않다 — 이 조각은 이 구역의 모든 칸이 함께 쓰므로 평소 모양이 바뀌면 열 칸이
   * 한꺼번에 바뀐다.
   *
   * 🔴 **두 사실이 색 하나를 나눠 쓴다.** 둘은 한 건에서 동시에 켜질 수 있는데,
   * 색을 둘로 두면 겹치는 날 어느 색을 칠할지 정할 수 없다. 그래서 갈라 보이는
   * 일은 색이 아니라 **말**이 맡는다 — 임박은 머리 카드의 배지가, 역전은 아래
   * `note` 가 말한다(2026-10-29 사용자 결정: 겹치면 둘 다 보인다).
   */
  emphasized?: boolean;
  /**
   * 값 아래에 붙는 **경보 한 줄**. 지금 쓰는 칸은 「고객 요청 납기일」 하나뿐이고,
   * 납기 역전일 때의 「납기 요청일 협의가 필요합니다.」다(2026-10-29).
   *
   * 🔴 값 **옆**이 아니라 아래인 것은 borrowedLabel 과 같은 까닭이다 — 이 칸들은
   * 2열 격자라 폭이 좁아서, 옆에 붙이면 날짜와 메모가 한 줄에 안 들어가 어차피
   * 접힌다.
   *
   * 🔴 **다른 뜻의 메모를 이 자리에 넣지 마라.** 입는 옷이 역전 경보의 것(붉은색
   * DUE_DATE_INVERSION_NOTE_CLASS)이라, 안내문을 여기 넣으면 아무 오류 없이
   * 경보처럼 보인다. 다른 종류가 필요해지면 옷도 함께 받도록 고칠 것.
   */
  note?: string;
  /** 그 경보 줄에 마우스를 올렸을 때 뜨는 까닭. `note` 가 있을 때만 쓴다. */
  noteTitle?: string;
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
      {/* 🔵 **테두리 있는 상자**다(2026-10-30 사용자 요청). 날짜 바로 아래라 글자만
          두면 날짜의 일부로 읽힌다 — 이것은 값이 아니라 **그 값이 어디서 왔는가**다.
          🔴 아래 경보 상자와 **색이 다르다**: 여기는 출처라 회색이고, 경보는 붉다.
          같은 색으로 두면 출처 표시까지 「고쳐야 할 것」으로 보인다. */}
      {borrowedLabel && (
        <p className="mt-1 mr-1 inline-block whitespace-nowrap rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
          {borrowedLabel}
        </p>
      )}
      {/* 🔵 빌려 왔다는 표시보다 **뒤**다. 그 표시는 바로 위 날짜가 어디서 온
          값인지를 말하므로 날짜에 붙어 있어야 하고, 경보는 그 둘을 읽은 다음에
          오는 말이다. 뒤에만 더하므로 역전이 아닐 때 나오는 HTML 도 예전 그대로다. */}
      {note && (
        <p className={DUE_DATE_INVERSION_NOTE_CLASS} title={noteTitle}>
          {note}
        </p>
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
  isDueDateInverted,
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
  /**
   * 이 건이 「납기 역전」인가 — **사내 목표 출하일이 고객 요청 납기일보다 늦다**
   * (2026-10-29 사용자 요구). 그러면 아래 「고객 요청 납기일」 칸이 굵은 붉은색이
   * 되고, 그 아래에 「납기 요청일 협의가 필요합니다.」가 한 줄 붙는다.
   * 🔴 **이미 나간 건에는 거짓으로 온다**(2026-10-30 사용자 결정) — 할 일이 없는
   * 말이라서다. 「납기 임박」이 빠지는 자리와 같고, 거르는 함수도 같은 하나다.
   *
   * 🔴 **위 isDueDateNear 와 다른 사실이고, 둘이 함께 참일 수 있다.** 겹치면 둘 다
   * 보인다(사용자 결정) — 고칠 자리가 다른 두 가지 일이라, 하나만 보이면 나머지를
   * 모르고 지나간다. 색은 둘이 함께 쓰고, 갈라 보이는 일은 머리 카드의 「납기 임박」
   * 배지와 이 아래 메모가 나눠 맡는다.
   *
   * 🔴 여기서 재지 않고 받는 까닭은 위와 **다르다** — 역전은 「오늘」을 보지 않으므로
   * hydration 함정이 없다. 그래도 서버가 재는 것은, 판정이 빌려 온 날짜까지 보고
   * (고객 요청 납기일이 비면 연결된 내자의 가장 이른 하루) 그 규칙을 화면마다 다시
   * 엮으면 네 화면이 서로 다른 날짜로 재게 되기 때문이다(domain/due-date-inversion.ts).
   */
  isDueDateInverted: boolean;
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
            // 🔴 이 한 칸에서만 켠다 — 「납기 임박」도 「납기 역전」도 이 날짜에
            // 대한 말이다. 빌려 왔다는 표시(날짜 바로 아래 줄)는 함께 붉어지지
            // 않는다: 그것은 경보가 아니라 어디서 온 값인가를 말하는 표시다.
            //
            // 🔴 **둘 중 하나만 참이어도 붉다.** 색이 하나뿐이라 둘을 갈라 보이지
            // 못하므로, 겹칠 때를 위해 메모와 배지가 따로 말한다(사용자 결정
            // 2026-10-29 — 고칠 자리가 다른 두 가지 일이라 둘 다 보여야 한다).
            emphasized={isDueDateNear || isDueDateInverted}
            note={isDueDateInverted ? DUE_DATE_INVERSION_NOTE : undefined}
            noteTitle={DUE_DATE_INVERSION_REASON_NOTE}
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
