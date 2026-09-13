"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createCustomerAction } from "@/lib/server/actions/create-customer";
import {
  editErrorClass,
  editInputClass,
  editLabelClass,
} from "@/components/repair-cases/detail/edit/EditSectionActions";
import { CUSTOMER_CONTACT_MEMO_MAX, CUSTOMER_CONTACT_TITLE_MAX } from "@/lib/validation/customer-contact-input";
import { CustomerRowColorPicker } from "./CustomerRowColorField";

/**
 * ============================================================================
 * [고객사 추가] 창 — 고객사 관리 목록에서 연다 (2026-09-13)
 * ============================================================================
 * 칸은 수정 폼(CustomerEditForm)과 같은 일곱 개다 — 이름(필수)·대표 담당자 성함·
 * 직급·전화·이메일·메모·목록 배경색. 서버 검증도 같은 함수를 쓰므로(validateCustomerUpdateFields)
 * 오류가 돌아오는 칸 이름도 같다. 수정 폼 자체를 고쳐 두 쓰임을 겸하게 하지 않은
 * 이유: 그쪽은 충돌(CONFLICT) 처리와 적어 둔 글 보존이 붙어 있는데, 새로 만드는
 * 쪽에는 충돌이 없다.
 *
 * 창은 이 앱의 다른 등록 창(PartCreateDialog)과 같은 네이티브 <dialog> 다.
 * 가운데 놓기와 좁은 화면의 여백은 globals.css 가 모든 창에 한꺼번에 준다.
 * **부모가 열 때마다 새로 그린다** — 그래서 입력칸을 비우는 코드가 따로 없다.
 *
 * 성공하면 그 고객사의 상세 화면으로 간다. End-User·담당자는 거기서 붙인다.
 * 이동하는 동안 [추가]는 계속 잠가 둔다 — 풀면 두 번 누른 손가락이 같은 이름을
 * 한 번 더 보내고, 그건 "이미 존재하는 고객사명입니다"로 돌아와 방금 성공한
 * 일을 실패처럼 보이게 만든다.
 * ============================================================================
 */
export default function CustomerCreateForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  /** 대표 담당자의 직급·메모(2026-09-13). 빈 값은 보낼 때 null 로 바꾼다. */
  const [contactTitle, setContactTitle] = useState("");
  const [contactMemo, setContactMemo] = useState("");
  /**
   * 팔레트 키 또는 직접 고른 색 코드(소문자 #rrggbb). 없음은 빈 문자열이고, 보낼 때
   * null 로 바꾼다(CustomerEditForm 과 같다).
   */
  const [rowColor, setRowColor] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || !name.trim()) return;
    setIsSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    let navigating = false;
    try {
      const result = await createCustomerAction({
        fields: {
          name,
          contactName: contactName || null,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
          contactTitle: contactTitle || null,
          contactMemo: contactMemo || null,
          rowColor: rowColor || null,
        },
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }
      navigating = true;
      router.push(`/customers/${result.id}`);
    } catch {
      setSubmitError("일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (!navigating) setIsSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="customer-create-dialog-title"
      onCancel={(event) => {
        // Esc — 보내는 중에는 닫지 않는다. 닫아도 요청은 이미 떠났다.
        event.preventDefault();
        if (!isSubmitting) onClose();
      }}
      className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <form onSubmit={handleSubmit} noValidate>
        <h2 id="customer-create-dialog-title" className="text-sm font-semibold">
          고객사 추가
        </h2>

        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="customer-create-name" className={editLabelClass}>
              고객사명 <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <input
              id="customer-create-name"
              className={editInputClass}
              value={name}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.name ? true : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {fieldErrors.name && <p className={editErrorClass}>{fieldErrors.name}</p>}
          </div>

          <div>
            <label htmlFor="customer-create-contact-name" className={editLabelClass}>
              대표 담당자 성함
            </label>
            <input
              id="customer-create-contact-name"
              className={editInputClass}
              value={contactName}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.contactName ? true : undefined}
              onChange={(e) => setContactName(e.target.value)}
            />
            {fieldErrors.contactName && <p className={editErrorClass}>{fieldErrors.contactName}</p>}
          </div>

          <div>
            <label htmlFor="customer-create-contact-title" className={editLabelClass}>
              대표 담당자 직급
            </label>
            <input
              id="customer-create-contact-title"
              className={editInputClass}
              value={contactTitle}
              maxLength={CUSTOMER_CONTACT_TITLE_MAX}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.contactTitle ? true : undefined}
              onChange={(e) => setContactTitle(e.target.value)}
            />
            {fieldErrors.contactTitle && <p className={editErrorClass}>{fieldErrors.contactTitle}</p>}
          </div>

          <div>
            <label htmlFor="customer-create-contact-phone" className={editLabelClass}>
              대표 연락처(전화)
            </label>
            <input
              id="customer-create-contact-phone"
              type="tel"
              className={editInputClass}
              value={contactPhone}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.contactPhone ? true : undefined}
              onChange={(e) => setContactPhone(e.target.value)}
            />
            {fieldErrors.contactPhone && <p className={editErrorClass}>{fieldErrors.contactPhone}</p>}
          </div>

          <div>
            <label htmlFor="customer-create-contact-email" className={editLabelClass}>
              대표 연락처(이메일)
            </label>
            <input
              id="customer-create-contact-email"
              type="email"
              className={editInputClass}
              value={contactEmail}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.contactEmail ? true : undefined}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            {fieldErrors.contactEmail && <p className={editErrorClass}>{fieldErrors.contactEmail}</p>}
          </div>

          {/* 메모는 여러 줄로 적는 칸이라 두 칸을 가로지른다(수정 폼과 같다). */}
          <div className="sm:col-span-2">
            <label htmlFor="customer-create-contact-memo" className={editLabelClass}>
              대표 담당자 메모
            </label>
            <textarea
              id="customer-create-contact-memo"
              rows={3}
              className={`${editInputClass} resize-y`}
              value={contactMemo}
              maxLength={CUSTOMER_CONTACT_MEMO_MAX}
              disabled={isSubmitting}
              aria-invalid={fieldErrors.contactMemo ? true : undefined}
              onChange={(e) => setContactMemo(e.target.value)}
            />
            {fieldErrors.contactMemo && <p className={editErrorClass}>{fieldErrors.contactMemo}</p>}
          </div>

          {/* 색 고르개는 칸이 열한 개라 두 칸을 가로지른다(수정 폼과 같다). */}
          <div className="sm:col-span-2">
            <CustomerRowColorPicker value={rowColor} disabled={isSubmitting} onChange={setRowColor} />
            {fieldErrors.rowColor && <p className={editErrorClass}>{fieldErrors.rowColor}</p>}
          </div>
        </div>

        {submitError && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
          >
            {submitError}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !name.trim()}
            className="rounded-md bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200"
          >
            {isSubmitting ? "추가하는 중..." : "추가"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
