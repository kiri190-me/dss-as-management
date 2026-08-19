"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveList } from "@/components/common/responsive-list";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RepairCaseFlowchartManagementRow, RepairCaseFlowchartTrashRow } from "@/lib/db/queries/repair-case-flowcharts";
import type { RepairCaseFlowchartCreateOption } from "@/lib/db/queries/repair-cases";
import {
  createRepairCaseFlowchartAction,
  softDeleteRepairCaseFlowchartAction,
  restoreRepairCaseFlowchartAction,
  permanentlyDeleteRepairCaseFlowchartAction,
} from "@/lib/server/actions/repair-case-flowcharts";
import { getFlowchartRetentionStatus } from "@/lib/domain/repair-case-flowchart-retention";

const STATUS_BADGE: Record<string, string> = {
  사용중: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  휴지통: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

/** isDeleted -> 사용중/휴지통 — derived display state only, never a stored column (see repair-case-flowcharts.ts query's own doc comment). */
function statusLabel(isDeleted: boolean): "사용중" | "휴지통" {
  return isDeleted ? "휴지통" : "사용중";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function repairCaseOptionLabel(option: RepairCaseFlowchartCreateOption): string {
  return `${option.intakeNumber} · ${option.customerName} · ${option.modelName}${option.serialNumber ? ` · ${option.serialNumber}` : ""}`;
}

/**
 * Searchable 인수번호 combobox for the create form's target-case field.
 * Smallest practical implementation for this dataset (~20 active cases,
 * see this checkpoint's own audit) — plain text input + a filtered
 * dropdown list, no external combobox library. Primary/only search key is
 * 인수번호 (substring, case-insensitive), per this checkpoint's brief; each
 * result row still displays 고객사/모델/S/N for context. Selecting an
 * option commits its id via onSelect; typing after a selection clears the
 * committed id (onSelect(null)) so a stale selection can never silently
 * survive an edited query — the user must explicitly re-pick. Options use
 * onMouseDown (not onClick) with preventDefault so the click registers
 * BEFORE the input's onBlur would otherwise remove the list from the DOM.
 */
function RepairCaseComboSelect({
  options,
  selectedId,
  onSelect,
}: {
  options: RepairCaseFlowchartCreateOption[];
  selectedId: string;
  onSelect: (id: string | null) => void;
}) {
  const selected = options.find((o) => o.id === selectedId) ?? null;
  const [query, setQuery] = useState(selected ? repairCaseOptionLabel(selected) : "");
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => {
    const key = query.trim().toLowerCase();
    // Empty query -> every option (still capped implicitly by the list's own max-height/scroll), not an empty result.
    if (!key || (selected && query === repairCaseOptionLabel(selected))) return options;
    return options.filter((o) => o.intakeNumber.toLowerCase().includes(key));
  }, [options, query, selected]);

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          if (selectedId) onSelect(null);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        placeholder="인수번호로 검색"
        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {isOpen && (
        <ul role="listbox" className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-zinc-500 dark:text-zinc-400">일치하는 인수번호가 없습니다.</li>
          ) : (
            filtered.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === selectedId}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(option.id);
                    setQuery(repairCaseOptionLabel(option));
                    setIsOpen(false);
                  }}
                  className="block w-full px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {repairCaseOptionLabel(option)}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Compact inline create form — toggled by "새 Flowchart 추가", same show/hide-toggle-button convention as TechnicalProcedureTemplateListScreen's CreateTechnicalTemplateForm and CaseFlowchartListScreen's own create panel. Reuses the existing createRepairCaseFlowchartAction unchanged (no second storage model, no new mutation). */
function CreateFlowchartForm({ repairCaseOptions, onClose }: { repairCaseOptions: RepairCaseFlowchartCreateOption[]; onClose: () => void }) {
  const router = useRouter();
  const [repairCaseId, setRepairCaseId] = useState("");
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleCreate() {
    if (!repairCaseId) {
      setErrorMessage("대상 접수 건을 검색 후 선택해 주세요.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await createRepairCaseFlowchartAction({ repairCaseId, title });
    if (!result.ok) {
      setIsSubmitting(false);
      setErrorMessage(result.message);
      return;
    }
    router.push(`/repair-cases/${repairCaseId}/diagnosis/${result.id}`);
  }

  if (repairCaseOptions.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950">
        <p className="text-blue-900 dark:text-blue-300">대상으로 선택할 수 있는 접수 건이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950">
      <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300">새 Flowchart 만들기</h3>
      <label className="flex flex-col gap-1">
        대상 접수 건 (인수번호 검색 · 고객사 · 모델 · S/N 표시)
        <RepairCaseComboSelect options={repairCaseOptions} selectedId={repairCaseId} onSelect={(id) => setRepairCaseId(id ?? "")} />
      </label>
      <label className="flex flex-col gap-1">
        Flowchart 제목
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={title.trim().length === 0 || isSubmitting}
          onClick={() => void handleCreate()}
          className="self-start rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "생성 중..." : "생성"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        >
          취소
        </button>
      </div>
      {errorMessage && <p className="text-red-600 dark:text-red-400">{errorMessage}</p>}
    </div>
  );
}

/** Delete confirmation — same native <dialog>/showModal convention as DeleteAttachmentDialog.tsx (centering is fixed globally, see globals.css), but delete_reason stays OPTIONAL here (matches validateFlowchartDeleteReason's existing null-is-fine semantics, unchanged by this checkpoint). Calls the EXISTING softDeleteRepairCaseFlowchartAction — never a new mutation, never a physical delete. */
function DeleteFlowchartDialog({
  target,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  target: RepairCaseFlowchartManagementRow;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delete-flowchart-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="delete-flowchart-dialog-title" className="text-sm font-semibold">
        진단 Flowchart 삭제
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Flowchart: <span className="font-medium text-zinc-900 dark:text-zinc-50">{target.title}</span>
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        인수번호: <span className="font-medium text-zinc-900 dark:text-zinc-50">{target.intakeNumber}</span>
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        소프트 삭제입니다. 휴지통으로 이동하며, 노드/분기/이력은 그대로 보존되고 이후 복원할 수 있습니다.
      </p>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="delete-flowchart-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          삭제 사유 (선택)
        </label>
        <textarea
          id="delete-flowchart-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim() || null)}
          disabled={isSubmitting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "삭제 중..." : "삭제"}
        </button>
      </div>
    </dialog>
  );
}

/** Restore confirmation — same native <dialog>/showModal convention as DeleteFlowchartDialog above (and DeleteAttachmentDialog.tsx; centering is fixed globally, see globals.css). No reason field (unlike delete, restore has no delete_reason-equivalent input) — just the identity confirmation the brief specifies. Calls the EXISTING restoreRepairCaseFlowchartAction — never a new mutation. */
function RestoreFlowchartDialog({
  target,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  target: RepairCaseFlowchartTrashRow;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="restore-flowchart-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="restore-flowchart-dialog-title" className="text-sm font-semibold">
        Flowchart 복원
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        &apos;{target.title}&apos; Flowchart를 복원하시겠습니까?
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        인수번호: <span className="font-medium text-zinc-900 dark:text-zinc-50">{target.intakeNumber}</span>
      </p>

      {errorMessage && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {isSubmitting ? "복원 중..." : "복원"}
        </button>
      </div>
    </dialog>
  );
}

/**
 * Permanent-delete confirmation — same native <dialog>/showModal convention
 * as the other two dialogs above, but danger-styled throughout (red border/
 * heading, red warning callout) since this is the first genuinely
 * irreversible hard-delete action in this app (everything else here is
 * soft-delete-only). No title-typing confirmation (per this checkpoint's
 * approved decisions) — the mandatory reason field is the only extra
 * friction beyond the standard 취소/confirm pair. Calls the EXISTING
 * permanentlyDeleteRepairCaseFlowchartAction — never touches nodes/edges/
 * history directly from the client.
 */
function PermanentlyDeleteFlowchartDialog({
  target,
  now,
  isSubmitting,
  errorMessage,
  onConfirm,
  onCancel,
}: {
  target: RepairCaseFlowchartTrashRow;
  now: Date;
  isSubmitting: boolean;
  errorMessage: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="permanent-delete-flowchart-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!isSubmitting) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-red-300 bg-white p-4 text-zinc-900 backdrop:bg-black/40 dark:border-red-900 dark:bg-zinc-900 dark:text-zinc-50"
    >
      <h2 id="permanent-delete-flowchart-dialog-title" className="text-sm font-semibold text-red-700 dark:text-red-400">
        Flowchart 완전 삭제
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        &apos;{target.title}&apos; Flowchart를 완전히 삭제하시겠습니까?
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        인수번호: <span className="font-medium text-zinc-900 dark:text-zinc-50">{target.intakeNumber}</span>
      </p>
      <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        이 작업은 되돌릴 수 없습니다. 삭제 후에는 복원할 수 없으며, 노드/분기 등 모든 구성 데이터가 함께 삭제됩니다.
      </p>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <div>
          <dt>삭제일</dt>
          <dd className="text-zinc-700 dark:text-zinc-300">{formatDateTime(target.deletedAt)}</dd>
        </div>
        <div>
          <dt>보관 기간</dt>
          <dd className="text-zinc-700 dark:text-zinc-300">{formatRetentionLabel(target.deletedAt, now)}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="permanent-delete-flowchart-reason" className="text-xs text-zinc-500 dark:text-zinc-400">
          영구 삭제 사유 (필수)
        </label>
        <textarea
          id="permanent-delete-flowchart-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {errorMessage && <p className="text-xs text-red-600 dark:text-red-400">{errorMessage}</p>}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason)}
          disabled={isSubmitting || reason.trim().length === 0}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isSubmitting ? "삭제 중..." : "완전 삭제"}
        </button>
      </div>
    </dialog>
  );
}

/** True when `row` matches `query` on any of the fields this checkpoint's brief lists (인수번호/고객사/End-User/모델/S/N/Flowchart 이름) — case-insensitive substring, OR across fields. Empty/whitespace query matches everything. */
function matchesSearch(row: RepairCaseFlowchartManagementRow, query: string): boolean {
  const key = query.trim().toLowerCase();
  if (!key) return true;
  return [row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.title].some((field) => (field ?? "").toLowerCase().includes(key));
}

/** Own local copy for the trash row shape, same convention as matchesSearch (this codebase deliberately keeps small per-shape copies rather than cross-importing a generic matcher — see repair-case-flowchart-input.ts's own doc comment on the same convention). */
function matchesTrashSearch(row: RepairCaseFlowchartTrashRow, query: string): boolean {
  const key = query.trim().toLowerCase();
  if (!key) return true;
  return [row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.title].some((field) => (field ?? "").toLowerCase().includes(key));
}

/** "만료까지 N일" / "만료됨" — reads getFlowchartRetentionStatus (pure, unit-tested) with `now` fixed once per render via the caller so every row in the same paint agrees on "today," never re-evaluated per row. */
function formatRetentionLabel(deletedAt: string, now: Date): string {
  const status = getFlowchartRetentionStatus(deletedAt, now);
  if (status.isExpired) return "만료됨";
  return `만료까지 ${status.daysRemaining}일`;
}

/** Delete control shared by both the table row and the narrow-width card — kept as one function so the two layouts can never drift in what triggers a delete. */
function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      삭제
    </button>
  );
}

/** Restore control shared by the trash table row and its narrow-width card — same one-function-for-both-layouts discipline as DeleteButton. Only opens the confirm dialog (RestoreFlowchartDialog); the actual submit/loading state lives there, matching DeleteButton's own division of labor with DeleteFlowchartDialog. */
function RestoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
    >
      복원
    </button>
  );
}

/** Permanent-delete control shared by the trash table row and its narrow-width card — SUPER_ADMIN/ADMIN only (a narrower, separate gate from canManage/복원), danger-styled to read as more consequential than 복원 next to it. Only opens PermanentlyDeleteFlowchartDialog; submit/loading state lives there. */
function PermanentDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-red-400 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
    >
      완전 삭제
    </button>
  );
}

/**
 * Card counterpart of the trash table, same overflow-triggered-only
 * rendering convention as DiagnosisFlowchartCardList. `now` is threaded
 * through from the parent (one Date per render) so every row's retention
 * label agrees on "today." `onRestoreRequested`/`onPermanentDeleteRequested`
 * just open their respective dialogs — cards and table share the same
 * dialog/submit state and can never independently diverge on which row is
 * mid-action. `canPermanentlyDelete` is a separate, narrower flag than
 * `canManage` (SUPER_ADMIN/ADMIN only, vs. canManage's SUPER_ADMIN/ADMIN/
 * AS_ENGINEER) — an AS_ENGINEER sees 복원 but never 완전 삭제.
 */
function DiagnosisFlowchartTrashCardList({
  rows,
  canManage,
  canPermanentlyDelete,
  now,
  onRestoreRequested,
  onPermanentDeleteRequested,
}: {
  rows: RepairCaseFlowchartTrashRow[];
  canManage: boolean;
  canPermanentlyDelete: boolean;
  now: Date;
  onRestoreRequested: (row: RepairCaseFlowchartTrashRow) => void;
  onPermanentDeleteRequested: (row: RepairCaseFlowchartTrashRow) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between gap-2">
            <Link href={`/repair-cases/${row.repairCaseId}`} className="font-mono text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">
              {row.intakeNumber}
            </Link>
            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">휴지통</span>
          </div>
          <p className="font-medium text-zinc-900 dark:text-zinc-50">{row.title}</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객사</dt>
              <dd>{row.customerName}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">모델 / S/N</dt>
              <dd>
                {row.modelName} / {row.serialNumber ?? "-"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제일</dt>
              <dd>{formatDateTime(row.deletedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500 dark:text-zinc-500">보관 기간</dt>
              <dd>{formatRetentionLabel(row.deletedAt, now)}</dd>
            </div>
          </dl>
          {canManage && (
            <div className="flex gap-2">
              <RestoreButton onClick={() => onRestoreRequested(row)} />
              {canPermanentlyDelete && <PermanentDeleteButton onClick={() => onPermanentDeleteRequested(row)} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Overflow-triggered alternative to the <table> — rendered by the parent
 * only when the real table would overflow its container
 * (ResponsiveList — 서비스의 모든 목록이 쓰는 공용 기준이고, 그 안에서
 * useTableFitsWithoutOverflow로 실제 넘침을 잰다), never via a fixed `md:`
 * breakpoint — a fixed breakpoint can't track this table's real required
 * width, which changes with the 관리 column's presence.
 * Two distinct links per card, same rule as the table: 인수번호 -> case
 * detail, Flowchart 이름 -> the editor — the card itself is never one big
 * clickable link.
 */
function DiagnosisFlowchartCardList({
  rows,
  canManage,
  onDeleteRequested,
}: {
  rows: RepairCaseFlowchartManagementRow[];
  canManage: boolean;
  onDeleteRequested: (row: RepairCaseFlowchartManagementRow) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const status = statusLabel(row.isDeleted);
        return (
          <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/repair-cases/${row.repairCaseId}`} className="font-mono text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400">
                {row.intakeNumber}
              </Link>
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}>{status}</span>
            </div>
            <Link href={`/repair-cases/${row.repairCaseId}/diagnosis/${row.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">
              {row.title}
            </Link>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객사</dt>
                <dd>{row.customerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-500">End-User</dt>
                <dd>{row.endUserName ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-500">모델 / S/N</dt>
                <dd>
                  {row.modelName} / {row.serialNumber ?? "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-zinc-500 dark:text-zinc-500">최근 수정일</dt>
                <dd>{formatDateTime(row.updatedAt)}</dd>
              </div>
            </dl>
            {canManage && !row.isDeleted && (
              <div>
                <DeleteButton onClick={() => onDeleteRequested(row)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Central, cross-case list of existing Case Diagnosis Flowcharts
 * (Checkpoint 2), extended in Checkpoint 3A with create/delete for
 * SUPER_ADMIN/ADMIN/AS_ENGINEER (`canManage`, computed server-side by
 * canManageRepairCaseFlowchartsGlobally — SALES/INVENTORY_MANAGER never see
 * these controls), and in this checkpoint with client-side search + an
 * overflow-triggered card layout (useTableFitsWithoutOverflow — switches
 * to cards exactly when the table would need a horizontal scrollbar,
 * never at a fixed viewport breakpoint). Two distinct links per row, never a clickable
 * <tr>/card: 인수번호 -> the existing repair-case detail page
 * (/repair-cases/{repairCaseId}), Flowchart 이름 -> the existing per-case
 * diagnosis editor (/repair-cases/{repairCaseId}/diagnosis/{id}). This
 * screen owns no editor/case-detail logic and no second storage model of
 * its own — create/delete both call the pre-existing 5C-6B mutations
 * (createRepairCaseFlowchartAction / softDeleteRepairCaseFlowchartAction)
 * unchanged.
 *
 * Checkpoint 3B adds the 사용중/휴지통 tabs. 휴지통 shows only `trashRows`
 * (already `isDeleted = true`-filtered server-side by
 * listDeletedRepairCaseFlowchartsForManagement — this screen never
 * re-filters that dimension itself) with 삭제일 + a 15-day retention label
 * (getFlowchartRetentionStatus, fixed `now` per render so every row agrees
 * on "today"). All 5 viewing roles can see the trash tab; only `canManage`
 * roles get the restore button, same server-re-verified authorization
 * boundary as create/delete. Restore uses RestoreFlowchartDialog — the same
 * native <dialog>/showModal in-app confirmation pattern as
 * DeleteFlowchartDialog, not a browser-native window.confirm.
 *
 * This checkpoint adds manual permanent delete (완전 삭제): SUPER_ADMIN/
 * ADMIN only (`canPermanentlyDelete`, a separate and narrower server-
 * derived hint than `canManage` — AS_ENGINEER gets canManage=true but
 * canPermanentlyDelete=false, so they see 복원 but never 완전 삭제).
 * PermanentlyDeleteFlowchartDialog is danger-styled and requires a
 * mandatory reason (no title-typing confirmation). Only ever reachable
 * from 휴지통 on an already-soft-deleted row — permanentlyDeleteRepairCaseFlowchartAction
 * independently re-verifies role + soft-deleted state + expectedUpdatedAt
 * regardless of this screen's own gating. Automatic 15-day purge is not
 * implemented — 만료됨 stays a display-only label.
 *
 * Search is client-side over the already-loaded `rows`/`trashRows` (small
 * dataset, same as this checkpoint's own audit for the create-selector) —
 * no new query, no server round-trip per keystroke.
 */
export default function DiagnosisFlowchartManagementScreen({
  rows,
  trashRows,
  repairCaseOptions,
  canManage,
  canPermanentlyDelete,
}: {
  rows: RepairCaseFlowchartManagementRow[];
  trashRows: RepairCaseFlowchartTrashRow[];
  repairCaseOptions: RepairCaseFlowchartCreateOption[];
  canManage: boolean;
  canPermanentlyDelete: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"active" | "trash">("active");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<RepairCaseFlowchartManagementRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RepairCaseFlowchartTrashRow | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<RepairCaseFlowchartTrashRow | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  // Fixed once per mount — a trash view left open across a real day
  // boundary re-fetches on router.refresh() anyway (every restore call
  // triggers one), so this never needs to tick on its own.
  const [now] = useState(() => new Date());

  const filteredRows = useMemo(() => rows.filter((row) => matchesSearch(row, searchQuery)), [rows, searchQuery]);
  const filteredTrashRows = useMemo(() => trashRows.filter((row) => matchesTrashSearch(row, searchQuery)), [trashRows, searchQuery]);

  function requestDelete(row: RepairCaseFlowchartManagementRow) {
    setDeleteError(null);
    setDeleteTarget(row);
  }

  async function handleConfirmDelete(reason: string | null) {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await softDeleteRepairCaseFlowchartAction({
      repairCaseId: deleteTarget.repairCaseId,
      flowchartId: deleteTarget.id,
      deleteReason: reason,
      expectedUpdatedAt: deleteTarget.updatedAt,
    });
    setIsDeleting(false);
    if (!result.ok) {
      setDeleteError(result.message);
      return;
    }
    setDeleteTarget(null);
    router.refresh();
  }

  function requestRestore(row: RepairCaseFlowchartTrashRow) {
    setRestoreError(null);
    setRestoreTarget(row);
  }

  async function handleConfirmRestore() {
    if (!restoreTarget) return;
    setIsRestoring(true);
    setRestoreError(null);
    const result = await restoreRepairCaseFlowchartAction({
      repairCaseId: restoreTarget.repairCaseId,
      flowchartId: restoreTarget.id,
      expectedUpdatedAt: restoreTarget.updatedAt,
    });
    setIsRestoring(false);
    if (!result.ok) {
      setRestoreError(result.message);
      return;
    }
    setRestoreTarget(null);
    router.refresh();
  }

  function requestPermanentDelete(row: RepairCaseFlowchartTrashRow) {
    setPurgeError(null);
    setPurgeTarget(row);
  }

  async function handleConfirmPermanentDelete(reason: string) {
    if (!purgeTarget) return;
    setIsPurging(true);
    setPurgeError(null);
    const result = await permanentlyDeleteRepairCaseFlowchartAction({
      repairCaseId: purgeTarget.repairCaseId,
      flowchartId: purgeTarget.id,
      deleteReason: reason,
      expectedUpdatedAt: purgeTarget.updatedAt,
    });
    setIsPurging(false);
    if (!result.ok) {
      setPurgeError(result.message);
      return;
    }
    setPurgeTarget(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">진단 Flowchart 관리</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            접수 건별 진단 Flowchart를 한 곳에서 확인합니다. 인수번호를 클릭하면 A/S 건 상세 페이지로, Flowchart 이름을 클릭하면 편집 화면으로 이동합니다.
          </p>
        </div>
        {canManage && view === "active" && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
          >
            새 Flowchart 추가
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setView("active")}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
            view === "active"
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          사용중 ({rows.length})
        </button>
        <button
          type="button"
          onClick={() => setView("trash")}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
            view === "trash"
              ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          휴지통 ({trashRows.length})
        </button>
      </div>

      {canManage && view === "active" && showCreateForm && <CreateFlowchartForm repairCaseOptions={repairCaseOptions} onClose={() => setShowCreateForm(false)} />}

      <label className="flex flex-col gap-1 text-xs">
        <span className="sr-only">검색</span>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="인수번호 · 고객사 · End-User · 모델 · S/N · Flowchart 이름 검색"
          className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      {view === "trash" ? (
        filteredTrashRows.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            {trashRows.length === 0 ? "휴지통이 비어 있습니다." : "검색 조건에 맞는 항목이 없습니다."}
          </p>
        ) : (
          <ResponsiveList
            listId="diagnosis-flowchart-trash"
            measureKey={[filteredTrashRows.length, canManage, canPermanentlyDelete]}
            table={
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-3 py-2 font-medium">인수번호</th>
                    <th className="px-3 py-2 font-medium">고객사</th>
                    <th className="px-3 py-2 font-medium">모델</th>
                    <th className="px-3 py-2 font-medium">S/N</th>
                    <th className="px-3 py-2 font-medium">Flowchart 이름</th>
                    <th className="px-3 py-2 font-medium">삭제일</th>
                    <th className="px-3 py-2 font-medium">보관 기간</th>
                    {canManage && <th className="px-3 py-2 font-medium">관리</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTrashRows.map((row) => (
                    <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/repair-cases/${row.repairCaseId}`} className="text-blue-700 hover:underline dark:text-blue-400">
                          {row.intakeNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.customerName}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.modelName}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.serialNumber ?? "-"}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.title}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">{formatDateTime(row.deletedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">{formatRetentionLabel(row.deletedAt, now)}</td>
                      {canManage && (
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <RestoreButton onClick={() => requestRestore(row)} />
                            {canPermanentlyDelete && <PermanentDeleteButton onClick={() => requestPermanentDelete(row)} />}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            }
            cards={
              <DiagnosisFlowchartTrashCardList
                rows={filteredTrashRows}
                canManage={canManage}
                canPermanentlyDelete={canPermanentlyDelete}
                now={now}
                onRestoreRequested={requestRestore}
                onPermanentDeleteRequested={requestPermanentDelete}
              />
            }
          />
        )
      ) : filteredRows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          {rows.length === 0 ? "표시할 진단 Flowchart가 없습니다." : "검색 조건에 맞는 진단 Flowchart가 없습니다."}
        </p>
      ) : (
        <ResponsiveList
          listId="diagnosis-flowcharts"
          measureKey={[filteredRows.length, canManage]}
          table={
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">인수번호</th>
                  <th className="px-3 py-2 font-medium">고객사</th>
                  <th className="px-3 py-2 font-medium">End-User</th>
                  <th className="px-3 py-2 font-medium">모델</th>
                  <th className="px-3 py-2 font-medium">S/N</th>
                  <th className="px-3 py-2 font-medium">Flowchart 이름</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">최근 수정일</th>
                  {canManage && <th className="px-3 py-2 font-medium">관리</th>}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const status = statusLabel(row.isDeleted);
                  return (
                    <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link href={`/repair-cases/${row.repairCaseId}`} className="text-blue-700 hover:underline dark:text-blue-400">
                          {row.intakeNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.customerName}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.endUserName ?? "-"}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.modelName}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.serialNumber ?? "-"}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/repair-cases/${row.repairCaseId}/diagnosis/${row.id}`}
                          className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}>{status}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">{formatDateTime(row.updatedAt)}</td>
                      {canManage && (
                        <td className="px-3 py-2">{!row.isDeleted && <DeleteButton onClick={() => requestDelete(row)} />}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          }
          cards={
            <DiagnosisFlowchartCardList rows={filteredRows} canManage={canManage} onDeleteRequested={requestDelete} />
          }
        />
      )}

      {deleteTarget && (
        <DeleteFlowchartDialog
          target={deleteTarget}
          isSubmitting={isDeleting}
          errorMessage={deleteError}
          onConfirm={(reason) => void handleConfirmDelete(reason)}
          onCancel={() => {
            if (!isDeleting) setDeleteTarget(null);
          }}
        />
      )}

      {restoreTarget && (
        <RestoreFlowchartDialog
          target={restoreTarget}
          isSubmitting={isRestoring}
          errorMessage={restoreError}
          onConfirm={() => void handleConfirmRestore()}
          onCancel={() => {
            if (!isRestoring) setRestoreTarget(null);
          }}
        />
      )}

      {purgeTarget && (
        <PermanentlyDeleteFlowchartDialog
          target={purgeTarget}
          now={now}
          isSubmitting={isPurging}
          errorMessage={purgeError}
          onConfirm={(reason) => void handleConfirmPermanentDelete(reason)}
          onCancel={() => {
            if (!isPurging) setPurgeTarget(null);
          }}
        />
      )}
    </div>
  );
}
