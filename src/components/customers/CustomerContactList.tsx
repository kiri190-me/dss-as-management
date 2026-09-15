"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import type { CustomerContactRow } from "@/lib/db/queries/customers";
import {
  createCustomerContactAction,
  removeCustomerContactAction,
  updateCustomerContactAction,
  type CustomerContactActionResult,
  type CustomerContactFieldsInput,
} from "@/lib/server/actions/customer-contacts";
import {
  CUSTOMER_CONTACT_EMAIL_MAX,
  CUSTOMER_CONTACT_MEMO_MAX,
  CUSTOMER_CONTACT_NAME_MAX,
  CUSTOMER_CONTACT_PHONE_MAX,
  CUSTOMER_CONTACT_TITLE_MAX,
} from "@/lib/validation/customer-contact-input";

/**
 * ============================================================================
 * 고객사 담당자 목록 — /customers/[id] 의 「고객사 담당자」 구역 (2026-09-13)
 * ============================================================================
 * End-User 담당자 목록(EndUserContactList)과 같은 모양이다 — 목록 · 줄마다 수정/삭제 ·
 * 아래 [+ 담당자 추가]. 다른 것은 칸이 다섯이라는 것(이름·직급·전화·이메일·메모)뿐이다.
 *
 * 대표 담당자(위 「고객사 정보」의 세 칸)와 **따로** 있는 목록이다. 이 목록의 줄이 대표
 * 담당자 칸을 바꾸지 않고, 대표 담당자가 이 목록에 저절로 들어오지도 않는다
 * (schema/customers.ts 의 customerContacts 머리 주석).
 *
 * 단추를 감추는 것은 안내다 — canAdd/canEdit/canRemove 는 서버가 정한 참/거짓이고,
 * 실제 차단은 server/actions/customer-contacts.ts 가 다시 한다.
 *
 * ── 좁은 화면 ───────────────────────────────────────────────────────────
 * 입력칸은 좁으면 한 줄에 하나(sm 부터 두 칸), 메모는 늘 한 줄 전체다. 줄 표시는
 * 좁으면 글자 아래로 단추가 내려간다. 이메일은 길면 끊어 줄바꿈한다.
 *
 * ── 충돌 ───────────────────────────────────────────────────────────────
 * 저장이 CONFLICT 로 돌아오면 폼을 얼리고 [최신 정보 다시 불러오기] 하나만 남긴다
 * (EndUserContactList 와 같다). 다만 입력칸은 `disabled` 가 아니라 `readOnly` 로
 * 얼린다 — disabled 칸의 글자는 선택도 복사도 안 되는데, 메모는 길게 적었을 수 있다.
 * ============================================================================
 */

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 read-only:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:read-only:bg-zinc-800";
const labelClass = "mb-0.5 block text-xs text-zinc-500 dark:text-zinc-400";
const primaryButtonClass =
  "rounded-md bg-primary-900 px-2 py-1 text-xs font-medium text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-50 dark:text-zinc-900 dark:hover:bg-primary-200";
const secondaryButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const dangerButtonClass =
  "rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950";
const errorClass = "mt-0.5 text-xs text-red-600 dark:text-red-400";

type Draft = { contactName: string; title: string; phone: string; email: string; memo: string };

type FieldKey = keyof Draft;

const FIELD_KEYS: readonly FieldKey[] = ["contactName", "title", "phone", "email", "memo"];

function draftOf(contact: CustomerContactRow | null): Draft {
  return {
    contactName: contact?.contactName ?? "",
    title: contact?.title ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    memo: contact?.memo ?? "",
  };
}

/** 빈 선택 칸은 null 로 보낸다 — 공백 걷기와 최종 판단은 서버 검증이 한다. */
function toInput(draft: Draft): CustomerContactFieldsInput {
  return {
    contactName: draft.contactName,
    title: draft.title || null,
    phone: draft.phone || null,
    email: draft.email || null,
    memo: draft.memo || null,
  };
}

/** 추가와 수정이 함께 쓰는 다섯 칸 폼. 무엇을 부를지는 onSubmit 이 정한다. */
function ContactForm({
  initial,
  submitLabel,
  submittingLabel,
  onSubmit,
  onDone,
  onCancel,
  framed,
}: {
  initial: CustomerContactRow | null;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (input: CustomerContactFieldsInput) => Promise<CustomerContactActionResult>;
  onDone: () => void;
  onCancel: () => void;
  /** 추가 폼은 테두리 상자로, 수정 폼은 줄 안에 그대로 그린다. */
  framed: boolean;
}) {
  const idPrefix = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  function setField(key: FieldKey, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting || isConflict) return;
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);
    try {
      const result = await onSubmit(toInput(draft));
      if (!result.ok) {
        if (result.code === "CONFLICT") setIsConflict(true);
        setFieldErrors(result.fieldErrors ?? {});
        setSubmitError(result.message);
        return;
      }
      onDone();
    } catch {
      setSubmitError("일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasFieldError = FIELD_KEYS.some((key) => fieldErrors[key]);

  function textInput(key: Exclude<FieldKey, "memo">, label: string, maxLength: number, type: "text" | "tel" | "email") {
    const id = `${idPrefix}-${key}`;
    return (
      <div>
        <label htmlFor={id} className={labelClass}>
          {label}
          {key === "contactName" && <span className="text-red-600 dark:text-red-400"> *</span>}
        </label>
        <input
          id={id}
          type={type}
          value={draft[key]}
          maxLength={maxLength}
          disabled={isSubmitting}
          readOnly={isConflict}
          aria-invalid={fieldErrors[key] ? true : undefined}
          onChange={(e) => setField(key, e.target.value)}
          className={inputClass}
          autoFocus={key === "contactName"}
        />
        {fieldErrors[key] && <p className={errorClass}>{fieldErrors[key]}</p>}
      </div>
    );
  }

  const memoId = `${idPrefix}-memo`;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={
        framed
          ? "flex flex-col gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800"
          : "flex w-full flex-col gap-2"
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {textInput("contactName", "담당자명", CUSTOMER_CONTACT_NAME_MAX, "text")}
        {textInput("title", "직급", CUSTOMER_CONTACT_TITLE_MAX, "text")}
        {textInput("phone", "전화", CUSTOMER_CONTACT_PHONE_MAX, "tel")}
        {textInput("email", "이메일", CUSTOMER_CONTACT_EMAIL_MAX, "email")}
        <div className="sm:col-span-2">
          <label htmlFor={memoId} className={labelClass}>
            메모
          </label>
          <textarea
            id={memoId}
            rows={2}
            value={draft.memo}
            maxLength={CUSTOMER_CONTACT_MEMO_MAX}
            disabled={isSubmitting}
            readOnly={isConflict}
            aria-invalid={fieldErrors.memo ? true : undefined}
            onChange={(e) => setField("memo", e.target.value)}
            className={`${inputClass} resize-y`}
          />
          {fieldErrors.memo && <p className={errorClass}>{fieldErrors.memo}</p>}
        </div>
      </div>

      {submitError && !hasFieldError && <p className={errorClass}>{submitError}</p>}

      <div className="flex flex-wrap justify-end gap-1">
        {isConflict ? (
          <button type="button" onClick={onDone} className={secondaryButtonClass}>
            최신 정보 다시 불러오기
          </button>
        ) : (
          <>
            <button type="button" onClick={onCancel} disabled={isSubmitting} className={secondaryButtonClass}>
              취소
            </button>
            <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
              {isSubmitting ? submittingLabel : submitLabel}
            </button>
          </>
        )}
      </div>
    </form>
  );
}

/** 두 번 눌러 지운다 — EndUserContactList 의 RemoveContactButton 과 같다(창을 띄우지 않는다). */
function RemoveContactButton({ contact, onDone }: { contact: CustomerContactRow; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await removeCustomerContactAction({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt });
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
        return;
      }
      onDone();
    } catch {
      setError("일시적으로 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      setConfirming(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={handleConfirm} disabled={isSubmitting} className={dangerButtonClass}>
          {isSubmitting ? "삭제 중..." : "확인"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={isSubmitting} className={secondaryButtonClass}>
          취소
        </button>
      </span>
    );
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button type="button" onClick={() => setConfirming(true)} className={dangerButtonClass}>
        삭제
      </button>
      {error && <p className={errorClass}>{error}</p>}
    </span>
  );
}

function ContactDisplay({ contact }: { contact: CustomerContactRow }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{contact.contactName}</span>
        {contact.title && <span className="text-xs text-zinc-500 dark:text-zinc-400">{contact.title}</span>}
      </div>
      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
        <div className="flex gap-1">
          <dt className="text-zinc-400 dark:text-zinc-500">전화</dt>
          <dd>{contact.phone ?? "-"}</dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt className="shrink-0 text-zinc-400 dark:text-zinc-500">이메일</dt>
          <dd className="break-all">{contact.email ?? "-"}</dd>
        </div>
      </dl>
      {contact.memo && (
        <p className="whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">{contact.memo}</p>
      )}
    </div>
  );
}

/**
 * 한 고객사의 활성 담당자 목록. `contacts` 는 조회 층(listCustomerContactsByCustomerId)이
 * 이미 이 고객사 · 활성 줄 · 이름순으로 걸러 준 것이다.
 */
export default function CustomerContactList({
  customerId,
  contacts,
  canAdd,
  canEdit,
  canRemove,
}: {
  customerId: string;
  contacts: CustomerContactRow[];
  canAdd: boolean;
  canEdit: boolean;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {contacts.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">등록된 담당자가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-col gap-2 rounded-md bg-zinc-50 px-2 py-1.5 text-sm dark:bg-zinc-800/60 sm:flex-row sm:items-start sm:justify-between"
            >
              {editingId === contact.id ? (
                <ContactForm
                  initial={contact}
                  submitLabel="저장"
                  submittingLabel="저장 중..."
                  framed={false}
                  onSubmit={(input) =>
                    updateCustomerContactAction({
                      contactId: contact.id,
                      expectedUpdatedAt: contact.updatedAt,
                      ...input,
                    })
                  }
                  onDone={() => {
                    setEditingId(null);
                    router.refresh();
                    showSavePopup({ message: "담당자 정보를 저장했습니다.", redirectTo: null });
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <ContactDisplay contact={contact} />
                  {(canEdit || canRemove) && (
                    <div className="flex shrink-0 justify-end gap-1">
                      {canEdit && (
                        <button type="button" onClick={() => setEditingId(contact.id)} className={secondaryButtonClass}>
                          수정
                        </button>
                      )}
                      {canRemove && <RemoveContactButton contact={contact} onDone={() => router.refresh()} />}
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd &&
        (showAddForm ? (
          <ContactForm
            initial={null}
            submitLabel="추가"
            submittingLabel="추가 중..."
            framed
            onSubmit={(input) => createCustomerContactAction({ customerId, ...input })}
            onDone={() => {
              setShowAddForm(false);
              router.refresh();
              // 고객사 안에 딸린 것이라 목록으로 넘기지 않는다 — 여럿을 이어 붙인다.
              showSavePopup({ message: "담당자를 추가했습니다.", redirectTo: null });
            }}
            onCancel={() => setShowAddForm(false)}
          />
        ) : (
          <div>
            <button type="button" onClick={() => setShowAddForm(true)} className={secondaryButtonClass}>
              + 담당자 추가
            </button>
          </div>
        ))}
    </div>
  );
}
