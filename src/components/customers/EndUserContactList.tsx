"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import type { EndUserContactRow } from "@/lib/db/queries/customers";
import {
  createEndUserContactAction,
  removeEndUserContactAction,
  updateEndUserContactAction,
  type EndUserContactActionResult,
  type EndUserContactFieldsInput,
} from "@/lib/server/actions/end-users";
import {
  CUSTOMER_CONTACT_MEMO_MAX,
  CUSTOMER_CONTACT_PHONE_MAX,
  CUSTOMER_CONTACT_TITLE_MAX,
} from "@/lib/validation/customer-contact-input";

/**
 * ============================================================================
 * End-User 담당자 목록 — /customers/[id] 의 「관련 End-User 목록」 안, End-User 한 줄을
 * 펼치면 나온다
 * ============================================================================
 * 칸은 다섯이다 — 이름·직급·전화·이메일·메모(직급·전화·메모는 2026-09-13 사용자 요청).
 * 고객사 담당자 목록(CustomerContactList)과 **같은 모양**이다: 칸 배치 · 빈 값 표시 ·
 * 충돌 처리가 같다. 다른 것은 이메일 칸의 키(contactEmail)와 부르는 서버 액션뿐이다.
 *
 * 단추를 감추는 것은 안내다 — canAdd/canEdit/canRemove 는 서버가 정한 참/거짓이고,
 * 실제 차단은 server/actions/end-users.ts 가 다시 한다.
 *
 * ── 🔴 수정은 다섯 칸을 늘 다 보낸다 ─────────────────────────────────────
 * 서버 검증은 빠진 칸을 null 로 읽는다(validateEndUserContactFields). 그래서 수정 폼이
 * 직급·전화·메모 가운데 하나라도 빠뜨리면 이름만 고친 저장 한 번에 그 칸이 지워진다.
 * 다섯 칸은 한 묶음(Draft → toInput)으로만 다룬다.
 *
 * ── 좁은 화면 ───────────────────────────────────────────────────────────
 * 입력칸은 좁으면 한 줄에 하나(sm 부터 두 칸), 메모는 늘 한 줄 전체다. 줄 표시는
 * 좁으면 글자 아래로 단추가 내려간다. 이메일은 길면 끊어 줄바꿈한다.
 *
 * ── 충돌 ───────────────────────────────────────────────────────────────
 * 저장이 CONFLICT 로 돌아오면 폼을 얼리고 [최신 정보 다시 불러오기] 하나만 남긴다.
 * 입력칸은 `disabled` 가 아니라 `readOnly` 로 얼린다 — disabled 칸의 글자는 선택도
 * 복사도 안 되는데, 메모는 길게 적었을 수 있다.
 *
 * Only active (non-soft-deleted) contacts ever appear here — `contacts` is
 * already pre-filtered to this endUserId and to active-only rows by the query
 * layer (listEndUserContactsByCustomerId). No restore/trash view exists yet —
 * removal is a one-way soft-delete from this list's perspective.
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

type Draft = { contactName: string; title: string; phone: string; contactEmail: string; memo: string };

type FieldKey = keyof Draft;

/** 화면에 놓인 차례 — 이름 · 직급 / 전화 · 이메일 / 메모. */
const FIELD_KEYS: readonly FieldKey[] = ["contactName", "title", "phone", "contactEmail", "memo"];

function draftOf(contact: EndUserContactRow | null): Draft {
  return {
    contactName: contact?.contactName ?? "",
    title: contact?.title ?? "",
    phone: contact?.phone ?? "",
    contactEmail: contact?.contactEmail ?? "",
    memo: contact?.memo ?? "",
  };
}

/** 빈 선택 칸은 null 로 보낸다 — 공백 걷기와 최종 판단은 서버 검증이 한다. */
function toInput(draft: Draft): EndUserContactFieldsInput {
  return {
    contactName: draft.contactName,
    contactEmail: draft.contactEmail || null,
    title: draft.title || null,
    phone: draft.phone || null,
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
  initial: EndUserContactRow | null;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (input: EndUserContactFieldsInput) => Promise<EndUserContactActionResult>;
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

  /**
   * 글자 수 상한은 서버 검증이 쓰는 값을 그대로 건다. 직급·전화는 End-User 검증이
   * CUSTOMER_CONTACT_* 를 그대로 가져다 쓴다(end-user-input.ts). 이름·이메일의 상한은
   * 그 파일 안에만 있어 여기서는 걸지 않는다 — 넘치면 서버가 그 칸에 오류를 돌려준다.
   */
  function textInput(
    key: Exclude<FieldKey, "memo">,
    label: string,
    type: "text" | "tel" | "email",
    maxLength?: number
  ) {
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
        {textInput("contactName", "담당자명", "text")}
        {textInput("title", "직급", "text", CUSTOMER_CONTACT_TITLE_MAX)}
        {textInput("phone", "전화", "tel", CUSTOMER_CONTACT_PHONE_MAX)}
        {textInput("contactEmail", "이메일", "email")}
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

/** Two-click inline confirm (no window.confirm(), no modal) — matches this app's established preference for a proper in-flow confirmation over a native browser dialog, sized to a single low-stakes soft-delete action. */
function RemoveContactButton({ contact, onDone }: { contact: EndUserContactRow; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);
    const result = await removeEndUserContactAction({ contactId: contact.id, expectedUpdatedAt: contact.updatedAt });
    setIsSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setConfirming(false);
      return;
    }
    onDone();
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

/** 한 줄 표시 — CustomerContactList 의 ContactDisplay 와 같은 모양(빈 전화·이메일은 "-", 빈 직급·메모는 생략). */
function ContactDisplay({ contact }: { contact: EndUserContactRow }) {
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
          <dd className="break-all">{contact.contactEmail ?? "-"}</dd>
        </div>
      </dl>
      {contact.memo && (
        <p className="whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">{contact.memo}</p>
      )}
    </div>
  );
}

export default function EndUserContactList({
  endUserId,
  contacts,
  canAdd,
  canEdit,
  canRemove,
}: {
  endUserId: string;
  contacts: EndUserContactRow[];
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
                    updateEndUserContactAction({
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
            onSubmit={(input) => createEndUserContactAction({ endUserId, ...input })}
            onDone={() => {
              setShowAddForm(false);
              router.refresh();
              // End-User 안에 딸린 것이라 목록으로 넘기지 않는다 — 여럿을 이어 붙인다.
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
