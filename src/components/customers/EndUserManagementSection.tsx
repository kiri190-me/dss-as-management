"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { CustomerEndUserRow, EndUserContactRow } from "@/lib/db/queries/customers";
import { createEndUserAction, renameEndUserAction } from "@/lib/server/actions/end-users";
import EndUserContactList from "./EndUserContactList";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const primaryButtonClass =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200";
const secondaryButtonClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
const errorClass = "text-xs text-red-600 dark:text-red-400";

function CreateEndUserForm({
  customerId,
  onDone,
  onCancel,
}: {
  customerId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    const result = await createEndUserAction({ customerId, name });
    setIsSubmitting(false);
    if (!result.ok) {
      setFieldError(result.fieldErrors?.name ?? null);
      setSubmitError(result.message);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <input
          value={name}
          disabled={isSubmitting}
          onChange={(e) => setName(e.target.value)}
          placeholder="End-User명"
          className={inputClass}
          autoFocus
        />
        <button type="submit" disabled={isSubmitting} className={primaryButtonClass}>
          {isSubmitting ? "추가 중..." : "추가"}
        </button>
        <button type="button" onClick={onCancel} disabled={isSubmitting} className={secondaryButtonClass}>
          취소
        </button>
      </div>
      {fieldError && <p className={errorClass}>{fieldError}</p>}
      {submitError && !fieldError && <p className={errorClass}>{submitError}</p>}
    </form>
  );
}

function RenameEndUserForm({
  endUser,
  onDone,
  onCancel,
}: {
  endUser: CustomerEndUserRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(endUser.name);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    const result = await renameEndUserAction({
      endUserId: endUser.id,
      expectedUpdatedAt: endUser.updatedAt,
      name,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      if (result.code === "CONFLICT") {
        setIsConflict(true);
        setSubmitError(result.message);
        return;
      }
      setFieldError(result.fieldErrors?.name ?? null);
      setSubmitError(result.message);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={name}
          disabled={isSubmitting || isConflict}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          autoFocus
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
      {fieldError && <p className={errorClass}>{fieldError}</p>}
      {submitError && !fieldError && <p className={errorClass}>{submitError}</p>}
    </form>
  );
}

/**
 * 관련 End-User 목록 section content (End-User + multi-contact management
 * checkpoint) — one accordion per End-User: click the row to expand/collapse
 * its contacts (EndUserContactList), rename inline (SUPER_ADMIN/ADMIN only),
 * add a new End-User inline (SUPER_ADMIN/ADMIN/AS_ENGINEER/SALES). No
 * separate detail route — everything stays inside /customers/[id], per the
 * approved "keep UI compact" instruction. Every capability flag is a
 * server-derived UX hint only (computed once in page.tsx from
 * customer-authorization.ts) — every action re-verifies the same rule
 * independently regardless of what's rendered here.
 */
export default function EndUserManagementSection({
  customerId,
  endUsers,
  contacts,
  canCreateEndUser,
  canRenameEndUser,
  canAddContact,
  canEditContact,
  canRemoveContact,
}: {
  customerId: string;
  endUsers: CustomerEndUserRow[];
  contacts: EndUserContactRow[];
  canCreateEndUser: boolean;
  canRenameEndUser: boolean;
  canAddContact: boolean;
  canEditContact: boolean;
  canRemoveContact: boolean;
}) {
  const router = useRouter();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {canCreateEndUser &&
        (showCreateForm ? (
          <CreateEndUserForm
            customerId={customerId}
            onDone={() => {
              setShowCreateForm(false);
              router.refresh();
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        ) : (
          <div>
            <button type="button" onClick={() => setShowCreateForm(true)} className={secondaryButtonClass}>
              + End-User 추가
            </button>
          </div>
        ))}

      {endUsers.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">등록된 End-User가 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {endUsers.map((endUser) => {
            const isExpanded = expandedIds.has(endUser.id);
            const endUserContacts = contacts.filter((c) => c.endUserId === endUser.id);
            return (
              <li key={endUser.id} className="rounded-md border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(endUser.id)}
                    aria-expanded={isExpanded}
                    className="flex flex-1 items-center gap-2 text-left text-sm font-medium text-zinc-900 dark:text-zinc-50"
                  >
                    <span
                      className={`text-zinc-400 transition-transform dark:text-zinc-500 ${isExpanded ? "rotate-90" : ""}`}
                      aria-hidden="true"
                    >
                      ▸
                    </span>
                    {endUser.name}
                    <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      담당자 {endUserContacts.length}명
                    </span>
                  </button>
                  {canRenameEndUser && renamingId !== endUser.id && (
                    <button
                      type="button"
                      onClick={() => setRenamingId(endUser.id)}
                      className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      이름 변경
                    </button>
                  )}
                </div>

                {renamingId === endUser.id && (
                  <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                    <RenameEndUserForm
                      endUser={endUser}
                      onDone={() => {
                        setRenamingId(null);
                        router.refresh();
                      }}
                      onCancel={() => setRenamingId(null)}
                    />
                  </div>
                )}

                {isExpanded && (
                  <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                    <EndUserContactList
                      endUserId={endUser.id}
                      contacts={endUserContacts}
                      canAdd={canAddContact}
                      canEdit={canEditContact}
                      canRemove={canRemoveContact}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
