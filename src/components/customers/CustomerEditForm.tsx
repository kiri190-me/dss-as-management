"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CustomerDetail } from "@/lib/db/queries/customers";
import { updateCustomerAction } from "@/lib/server/actions/update-customer";
import EditSectionActions, {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import type { SectionEditConflictError } from "@/components/repair-cases/detail/edit/useSectionEditSubmit";
import { CUSTOMER_DRAFT_LABELS, buildDraftText } from "@/lib/domain/edit-draft-text";
import { CustomerRowColorPicker } from "./CustomerRowColorField";

/**
 * Customer master edit (SUPER_ADMIN/ADMIN only — canEditCustomers already
 * gates whether this component is ever rendered at all, in
 * CustomerDetailScreen). Single section, always-full submission (no
 * per-field role gating like the repair-case section forms) — reuses
 * EditSectionActions/editInputClass etc. for visual consistency with the
 * repair-case detail edit forms without duplicating that markup.
 *
 * On success, calls router.refresh() (re-fetches the server-rendered detail
 * page, including the new updatedAt) and onDone() — same division of labor
 * as useSectionEditSubmit, just inlined here since this screen has only one
 * form and doesn't need a shared hook extracted for a single caller.
 *
 * ── 충돌하면 얼리되, 적어 둔 글은 잃지 않는다 ───────────────────────────
 * 저장이 CONFLICT 로 돌아오면 이 폼은 얼고 `최신 정보 다시 불러오기` 하나만
 * 남는다(EditSectionActions). 그것을 누르면 폼이 언마운트되어 방금 손으로 친 글이
 * 통째로 사라지므로, **얼리기 직전에** 저장하려던 값에서 자유 입력만 뽑아 붙잡아
 * 둔다(buildDraftText + CUSTOMER_DRAFT_LABELS).
 *
 * ⚠️ 충돌하면 입력칸이 전부 `disabled` 가 되는데, **disabled 입력칸의 글자는
 * 브라우저에서 선택도 복사도 되지 않는다.** 눈에 보여도 챙길 방법이 없다는 뜻이라
 * 상자가 유일한 길이다(그 상자는 읽기 전용 `<textarea>` 다).
 *
 * 무엇을 담고 무엇을 빼는지는 화면이 아니라 domain/edit-draft-text.ts 가 정한다 —
 * 행 색은 팔레트에서 고르는 값이라 그 맵에 없다. 얼리는 규칙 자체는 하나도 바뀌지
 * 않았다.
 */
export default function CustomerEditForm({
  customer,
  onDone,
}: {
  customer: CustomerDetail;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(customer.name);
  const [contactName, setContactName] = useState(customer.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(customer.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(customer.contactPhone ?? "");
  /**
   * 팔레트 키다(색 코드가 아니다). null 은 "안 고름"이고 폼 안에서는 빈
   * 문자열로 다룬다 — 라디오의 value 는 문자열뿐이라서다. 저장할 때 다시
   * null 로 돌아간다.
   */
  const [rowColor, setRowColor] = useState(customer.rowColor ?? "");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  /**
   * 평상시 오류는 지금까지처럼 문장 하나다. 충돌일 때만 그 문장에 **방금 적어 둔
   * 글**을 얹어 보낸다 — 그 모양을 EditSectionActions 가 이미 알고 있어서, 여기서
   * 넓히는 것만으로 상자가 화면까지 닿는다(그 파일의 ConflictDraftBox).
   */
  const [submitError, setSubmitError] = useState<string | SectionEditConflictError | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  const disabled = isSubmitting || isConflict;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    // 충돌했을 때 이 값에서 자유 입력만 뽑아 붙잡는다(아래 CONFLICT 분기).
    // 서버로 가는 것은 지금까지와 똑같은 이 묶음 그대로다 — rowColor 도 그대로
    // 실려 나가고, 상자에만 안 들어간다.
    const fields = {
      name,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      rowColor: rowColor || null,
    };
    try {
      const result = await updateCustomerAction({
        customerId: customer.id,
        expectedUpdatedAt: customer.updatedAt,
        fields,
      });

      if (!result.ok) {
        if (result.code === "CONFLICT") {
          // 얼리기 **전에** 붙잡는다 — 곧 폼이 사라진다(파일 헤더).
          setIsConflict(true);
          setSubmitError({
            message: result.message,
            draftText: buildDraftText(fields, CUSTOMER_DRAFT_LABELS),
          });
          return;
        }
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }

      router.refresh();
      onDone();
    } finally {
      setIsSubmitting(false);
    }
  }

  function reloadAfterConflict() {
    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div>
          <label className={editLabelClass}>고객사명</label>
          <input
            className={editInputClass}
            value={name}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
          {fieldErrors.name && <p className={editErrorClass}>{fieldErrors.name}</p>}
        </div>

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

        {/* 색 고르개는 칸이 열한 개라 한 칸 폭에 들어가지 않는다 — 두 칸을
            가로질러 아래에 둔다. */}
        <div className="sm:col-span-2">
          <CustomerRowColorPicker value={rowColor} disabled={disabled} onChange={setRowColor} />
          {fieldErrors.rowColor && <p className={editErrorClass}>{fieldErrors.rowColor}</p>}
        </div>
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
