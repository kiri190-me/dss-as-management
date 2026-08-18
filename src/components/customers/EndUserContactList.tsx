"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { EndUserContactRow } from "@/lib/db/queries/customers";
import {
  createEndUserContactAction,
  removeEndUserContactAction,
  updateEndUserContactAction,
} from "@/lib/server/actions/end-users";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const dangerButtonClass =
  "rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950";
const errorClass = "text-xs text-red-600 dark:text-red-400";

function ContactAddForm({
  endUserId,
  onDone,
  onCancel,
}: {
  endUserId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);
    const result = await createEndUserContactAction({
      endUserId,
      contactName,
      contactEmail: contactEmail || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors ?? {});
      setSubmitError(result.message);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={contactName}
          disabled={isSubmitting}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="담당자명"
          className={inputClass}
          autoFocus
        />
        <input
          type="email"
          value={contactEmail}
          disabled={isSubmitting}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="이메일 (선택)"
          className={inputClass}
        />
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? "추가 중..." : "추가"}
        </button>
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={secondaryButtonClass}>
          취소
        </button>
      </div>
      {fieldErrors.contactName && <p className={errorClass}>{fieldErrors.contactName}</p>}
      {fieldErrors.contactEmail && <p className={errorClass}>{fieldErrors.contactEmail}</p>}
      {submitError && !fieldErrors.contactName && !fieldErrors.contactEmail && (
        <p className={errorClass}>{submitError}</p>
      )}
    </form>
  );
}

function ContactEditForm({
  contact,
  onDone,
  onCancel,
}: {
  contact: EndUserContactRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [contactName, setContactName] = useState(contact.contactName);
  const [contactEmail, setContactEmail] = useState(contact.contactEmail ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});
    setSubmitError(null);
    const result = await updateEndUserContactAction({
      contactId: contact.id,
      expectedUpdatedAt: contact.updatedAt,
      contactName,
      contactEmail: contactEmail || null,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        setIsConflict(true);
        setSubmitError(result.message);
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setSubmitError(result.message);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={contactName}
          disabled={isSubmitting || isConflict}
          onChange={(e) => setContactName(e.target.value)}
          className={inputClass}
          autoFocus
        />
        <input
          type="email"
          value={contactEmail}
          disabled={isSubmitting || isConflict}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="이메일 (선택)"
          className={inputClass}
        />
        {isConflict ? (
          <button type="button" onClick={onDone} className={secondaryButtonClass}>
            최신 정보 다시 불러오기
          </button>
        ) : (
          <>
            <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
              {isSubmitting ? "저장 중..." : "저장"}
            </button>
            <button type="button" onClick={onCancel} disabled={isSubmitting} className={secondaryButtonClass}>
              취소
            </button>
          </>
        )}
      </div>
      {fieldErrors.contactName && <p className={errorClass}>{fieldErrors.contactName}</p>}
      {fieldErrors.contactEmail && <p className={errorClass}>{fieldErrors.contactEmail}</p>}
      {submitError && !fieldErrors.contactName && !fieldErrors.contactEmail && (
        <p className={errorClass}>{submitError}</p>
      )}
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

/**
 * Contacts for one End-User (End-User + multi-contact management
 * checkpoint). Only active (non-soft-deleted) contacts ever appear here —
 * `contacts` is already pre-filtered to this endUserId and to active-only
 * rows by the query layer (listEndUserContactsByCustomerId). No restore/
 * trash view exists yet — removal is a one-way soft-delete from this list's
 * perspective.
 */
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
              className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2 py-1.5 text-sm dark:bg-zinc-800/60"
            >
              {editingId === contact.id ? (
                <ContactEditForm
                  contact={contact}
                  onDone={() => {
                    setEditingId(null);
                    router.refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{contact.contactName}</span>
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">{contact.contactEmail ?? "-"}</span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setEditingId(contact.id)}
                        className={secondaryButtonClass}
                      >
                        수정
                      </button>
                    )}
                    {canRemove && <RemoveContactButton contact={contact} onDone={() => router.refresh()} />}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAdd &&
        (showAddForm ? (
          <ContactAddForm
            endUserId={endUserId}
            onDone={() => {
              setShowAddForm(false);
              router.refresh();
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
