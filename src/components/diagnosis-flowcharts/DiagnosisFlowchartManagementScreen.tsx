"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// 🔴 고장 개소 메모를 **document.body 에 붙이려고** 쓴다 — 표 껍데기가 스크롤
// 상자라 그 안에서 absolute 로 띄우면 잘린다(FaultTagPills 머리말에 근거).
import { createPortal } from "react-dom";
import { ResponsiveList } from "@/components/common/responsive-list";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showSavePopup } from "@/components/common/SavePopup";
import type { RepairCaseFlowchartManagementRow, RepairCaseFlowchartTrashRow } from "@/lib/db/queries/repair-case-flowcharts";
import type { RepairCaseFlowchartCreateOption } from "@/lib/db/queries/repair-cases";
import {
  createRepairCaseFlowchartAction,
  softDeleteRepairCaseFlowchartAction,
  restoreRepairCaseFlowchartAction,
  permanentlyDeleteRepairCaseFlowchartAction,
} from "@/lib/server/actions/repair-case-flowcharts";
import { getFlowchartRetentionStatus } from "@/lib/domain/repair-case-flowchart-retention";
// 고장 개소 태그를 **견주고 고르는 규칙**은 전부 이 한 모듈에서 온다 — 거르는 쪽
// (matchesSearch)과 보여 주는 쪽(FaultTagPills)이 같은 함수를 봐야 「검색엔 걸렸는데
// 굵게 선 태그가 하나도 없는」 어긋남이 안 생긴다. 다듬는 규칙(`#` 떼기)은 그 모듈이
// 다시 태그를 적어 넣는 자리와 같은 함수를 본다.
import { faultTagMatchesQuery, selectVisibleFaultTags } from "@/lib/domain/repair-case-flowchart-fault-tag-display";

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
    // 만든 뒤에는 그릴 차례라 편집 화면으로 넘어간다 — 저장 팝업을 0.5초 띄운 뒤
    // 팝업이 넘긴다(common/SavePopup.tsx). 넘어갈 때까지 단추는 잠긴 채다.
    showSavePopup({
      message: "진단 Flowchart를 만들었습니다.",
      redirectTo: `/repair-cases/${repairCaseId}/diagnosis/${result.id}`,
    });
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

/**
 * True when `row` matches `query` on any of the fields this checkpoint's brief lists
 * (인수번호/고객사/End-User/모델/S/N/Flowchart 이름) — case-insensitive substring, OR
 * across fields. Empty/whitespace query matches everything.
 *
 * 2026-11-19 — 여기에 **고장 개소**가 더해졌다(사용자 요청: 「이 내용으로 [진단
 * Flowchart 관리]에서 검색을 할 수 있도록 해줘.」).
 *
 * 🔴 **고장 개소는 견주는 방법이 다르다.** 나머지는 칸 하나에 글자 하나지만 태그는
 * **배열**이라 그대로 한 줄에 못 섞는다. 이어 붙여 한 글자로 만드는 길(`join(" ")`)은
 * 일부러 안 썼다 — 붙인 자리에 「…우내 외부…」처럼 **어느 태그에도 없는 글자**가
 * 생겨 엉뚱한 줄이 걸린다. 그래서 태그는 **하나씩** 견준다.
 *
 * 🔴 태그 하나가 걸리는지는 **faultTagMatchesQuery** 가 정한다 — `#` 떼기와 대소문자
 * 처리가 거기 있다(사람은 `#우내` 로 친다). 🔴 **보여 주는 쪽(FaultTagPills)이 같은
 * 함수를 본다**: 거르기와 굵게 표시가 따로 적히면 「검색엔 걸렸는데 굵게 선 태그가
 * 하나도 없는」 줄이 생기고, 그 어긋남은 오류 없이 조용하다.
 * 🔵 반대로 **다른 칸까지 `#` 를 떼지는 않는다.** 다듬은 글은 태그를 견줄 때만 쓰고,
 * 나머지 칸은 친 글자 그대로 본다 — 제목·고객사에 `#` 가 든 줄을 `#` 로 찾는 길까지
 * 막을 까닭이 없다.
 */
function matchesSearch(row: RepairCaseFlowchartManagementRow, query: string): boolean {
  const key = query.trim().toLowerCase();
  if (!key) return true;
  if ([row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.title].some((field) => (field ?? "").toLowerCase().includes(key))) {
    return true;
  }
  return row.faultTags.some((tag) => faultTagMatchesQuery(tag, query));
}

/**
 * Own local copy for the trash row shape, same convention as matchesSearch (this codebase
 * deliberately keeps small per-shape copies rather than cross-importing a generic matcher —
 * see repair-case-flowchart-input.ts's own doc comment on the same convention).
 *
 * 🔴 **사본이므로 고치는 자리도 둘이다.** 위를 고치고 여기를 빠뜨리면 「목록에선
 * 찾아지는데 휴지통에선 안 되는」 반쪽이 된다 — 탭을 바꿔 가며 같은 글자를 쳐 보기
 * 전에는 안 보인다. 2026-11-19 에 고장 개소를 더할 때 실제로 가장 빠지기 쉬운 자리로
 * 꼽힌 곳이고, 아래 시험이 **두 몸통이 한 글자도 다르지 않은지**를 지킨다
 * (diagnosis-flowchart-fault-tag-search.test.tsx).
 */
function matchesTrashSearch(row: RepairCaseFlowchartTrashRow, query: string): boolean {
  const key = query.trim().toLowerCase();
  if (!key) return true;
  if ([row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.title].some((field) => (field ?? "").toLowerCase().includes(key))) {
    return true;
  }
  return row.faultTags.some((tag) => faultTagMatchesQuery(tag, query));
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
 * 고장 개소 알약의 글자 — 🔴 **조각 1이 편집기에 적은 것과 같은 것**을 여기에
 * 다시 적는다(CaseFlowchartEditorScreen 의 알약). 이 저장소는 알약 글자를 쓰는
 * 자리마다 적는 방식이라, 공용 부품으로 빼지 않는다.
 *
 * 색이 상태 배지(STATUS_BADGE)와 다른 까닭도 그대로다 — 고장 개소는 **값**이지
 * 상태가 아니다. 상태 배지와 같은 색을 쓰면 「무슨 상태인가」로 읽히고, 상태
 * 배지 색이 바뀌는 날 이 값까지 따라 바뀐 것처럼 보인다.
 */
const FAULT_TAG_PILL_CLASS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap border border-zinc-300 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * **검색에 걸린** 태그의 글자 — 테두리를 진하게, 글자를 굵게. 🔴 색은 그대로
 * 중립 회색이다: 걸렸다는 것을 색으로 말하면 상태 배지처럼 읽히는데, 고장 개소는
 * **값**이지 상태가 아니다(2026-11-19 지시에 그 울타리가 적혀 있다).
 *
 * 왜 표시가 필요한가 — 접혀 있던 태그가 검색 때문에 끌려 나와 서는데, 그중 어느
 * 것이 걸린 것인지 안 보이면 「왜 이 줄이 나왔는지」를 여전히 모른다.
 */
const FAULT_TAG_PILL_MATCHED_CLASS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap border border-zinc-500 bg-zinc-100 text-zinc-900 dark:border-zinc-400 dark:bg-zinc-700 dark:text-zinc-50";

/**
 * 메모의 최대 폭(px). 🔵 글자로 안 적고 수로 쥐는 까닭은, 메모를 띄우기 전에
 * **화면 오른쪽으로 넘치지 않게 왼쪽 자리를 깎아야** 하는데 그 계산에 수가 필요해서다
 * (18rem = 288px).
 */
const FAULT_TAG_MEMO_MAX_WIDTH = 288;

/**
 * 고장 개소 알약 — **그리는 자리가 넷**(사용중 표·카드, 휴지통 표·카드)이라 한
 * 함수로 둔다. 바로 위 DeleteButton·RestoreButton 과 같은 까닭이다: 넷이 따로
 * 적히면 「표에는 보이는데 카드에는 없는」 줄이 생기고, 그 어긋남은 창을 좁혀
 * 보기 전에는 안 보인다.
 *
 * 🔴 **표에 칸을 새로 더하지 않는다**(2026-11-19 결정) — Flowchart 이름 **아래**에
 * 붙인다. 칸을 더하면 표가 넓어져 min-w 를 올려야 하고, 이 서비스의 목록은 실제
 * 넘침을 재서 표↔카드를 고르므로(common/responsive-list.tsx) **좁은 화면에서
 * 카드로 넘어가는 폭이 바뀐다.** 그건 눈으로만 보인다.
 *
 * 🔴 **태그가 없으면 아무것도 안 그린다.** 빈 상자를 두면 줄마다 쓸데없는 틈이
 * 생기고, 표에서는 그 틈만큼 **모든 줄이** 높아진다(태그를 단 줄이 하나도 없어도).
 *
 * ── 숨은 태그는 **떠 있는 메모**로 본다(2026-11-19 눈 확인 뒤 사용자 지시) ──
 * 「+N을 눌렀을 때 표 내용이 넓어지는데 그렇게 하지 말고 **플로팅으로 그 위치에
 * 메모 형태로** 숨겨진 테그들이 표시되도록 해줘.」
 *
 * 처음 판은 그 자리에서 아래로 펼쳤는데, 펼친 줄이 표의 그 칸을 넓혀 **표 전체가
 * 옆으로 밀렸다.** 메모는 레이아웃 흐름에서 빠지므로(position: fixed) 눌러도 표
 * 폭이 한 픽셀도 안 변한다 — 이 변경의 목적이 그것이다.
 *
 * 🔴 **메모를 표 안에 `absolute` 로 띄우면 잘린다.** 표 껍데기에 overflow-x-auto 가
 * 걸려 있고, **한 축이 visible 이 아니면 나머지 축의 visible 도 auto 로 계산되어**
 * 그 래퍼는 세로로도 스크롤 상자다(common/responsive-list.tsx 의 stickyHeader 절에
 * 실측과 함께 적혀 있다 — 저장소의 sticky thead 셋이 그 때문에 안 붙는다). 스크롤
 * 상자는 제 안에서 태어난 absolute 자손을 잘라내므로, 마지막 줄에서 연 메모는
 * 래퍼 아래로 나가는 만큼 안 보인다. 그래서 **portal 로 document.body 에 붙이고**
 * 손잡이의 화면 좌표(getBoundingClientRect)를 재서 fixed 로 띄운다.
 *
 * 🔴 **닫는 길이 둘**이다 — 바깥 누르기와 Escape. 없으면 메모에 갇힌다.
 * 바깥 감지는 `pointerdown` 으로 받고 메모 안쪽은 `click` 으로 받는다(이 저장소의
 * 규칙이다 — 안쪽까지 pointerdown 으로 받으면 바깥 감지가 먼저 돌아 제 손으로 닫는다).
 * 🔵 구르거나 창 크기가 바뀌면 **닫는다.** 띄울 때 잰 좌표가 그대로 남아 있어, 안
 * 닫으면 메모만 엉뚱한 자리에 붙어 따라다닌다.
 *
 * 🔴 손잡이는 `type="button"` 이고 **이벤트 전파를 막는다** — 표 칸 안이라 나중에
 * 줄 클릭 같은 것이 생기면 메모를 여닫는 것만으로 다른 동작이 딸려 돈다. 🔴 메모
 * 안쪽의 click 도 막는다: portal 은 DOM 상으로는 body 밑이지만 **React 이벤트는
 * 부모 컴포넌트까지 거품이 인다** — 안 막으면 메모를 누른 것이 그 줄을 누른 것이 된다.
 *
 * 🔵 메모 안에서 `whitespace-normal`·`text-left` 를 **다시 건다.** 지금은 body 밑이라
 * 물려받을 것이 없지만, 어느 날 `absolute` 로 되돌리는 사람이 생기면 그 순간 표 칸의
 * `whitespace-nowrap`·`text-right` 가 따라 들어와 글이 한 줄로 늘어나거나 오른쪽으로
 * 쏠린다 — 이 저장소에서 실제로 났던 일이고, 그때 단서가 「글자가 한쪽으로 쏠려
 * 있다」 하나뿐이었다. 두 줄이 그 울타리다.
 *
 * 🔵 위쪽 여백(mt-1)을 알약 쪽이 쥔다 — 그려지지 않는 줄(태그 0개)에는 여백도 안
 * 생겨야 하는데, 바깥에서 주면 알약이 없어도 여백만 남는다.
 */
function FaultTagPills({ tags, searchQuery }: { tags: string[]; searchQuery: string }) {
  /** 메모가 떠 있는 자리(화면 좌표). null 이면 닫혀 있다 — 줄마다 따로 갖는다. */
  const [memoAt, setMemoAt] = useState<{ top: number; left: number } | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const memoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!memoAt) return;
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      // 메모 안과 손잡이는 제 핸들러가 받는다 — 여기서 먼저 닫으면 안쪽 click 이
      // 닿을 곳이 없어지고, 손잡이는 열자마자 닫힌다.
      if (memoRef.current?.contains(target)) return;
      if (handleRef.current?.contains(target)) return;
      setMemoAt(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMemoAt(null);
    }
    function closeOnMove() {
      setMemoAt(null);
    }
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    // 🔴 capture 로 듣는다 — 스크롤은 거품이 안 일어서, 표 껍데기처럼 **제 안에서**
    // 구르는 상자의 스크롤은 capture 가 아니면 한 번도 안 들린다.
    window.addEventListener("scroll", closeOnMove, true);
    window.addEventListener("resize", closeOnMove);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnMove, true);
      window.removeEventListener("resize", closeOnMove);
    };
  }, [memoAt]);

  // 🔴 훅 **뒤에** 둔다 — 앞에 두면 태그 없는 줄에서만 훅이 안 불려 규칙이 깨진다.
  if (tags.length === 0) return null;
  const { visible, hidden } = selectVisibleFaultTags(tags, searchQuery);

  function toggleMemo(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (memoAt) {
      setMemoAt(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // 손잡이 **바로 밑**에 띄우되, 오른쪽 끝에 있는 줄에서 화면 밖으로 나가지 않게
    // 왼쪽 자리를 깎는다(양옆 8px 은 남긴다).
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - FAULT_TAG_MEMO_MAX_WIDTH - 8));
    setMemoAt({ top: rect.bottom + 4, left });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span key={tag} className={faultTagMatchesQuery(tag, searchQuery) ? FAULT_TAG_PILL_MATCHED_CLASS : FAULT_TAG_PILL_CLASS}>
          {tag}
        </span>
      ))}
      {hidden.length > 0 && (
        <button
          ref={handleRef}
          type="button"
          aria-expanded={memoAt !== null}
          // 글자가 `+2` 뿐이라 읽는 장치에는 무엇이 더 있는지 안 들린다.
          aria-label={`고장 개소 ${hidden.length}개 더 보기`}
          onClick={toggleMemo}
          className={`${FAULT_TAG_PILL_CLASS} cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700`}
        >
          +{hidden.length}
        </button>
      )}
      {memoAt !== null &&
        createPortal(
          <div
            ref={memoRef}
            role="group"
            aria-label="숨겨진 고장 개소"
            onClick={(event) => event.stopPropagation()}
            style={{ top: memoAt.top, left: memoAt.left, maxWidth: FAULT_TAG_MEMO_MAX_WIDTH }}
            className="fixed z-50 flex flex-wrap gap-1 rounded-md border border-zinc-200 bg-white p-2 text-left whitespace-normal shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {hidden.map((tag) => (
              <span key={tag} className={faultTagMatchesQuery(tag, searchQuery) ? FAULT_TAG_PILL_MATCHED_CLASS : FAULT_TAG_PILL_CLASS}>
                {tag}
              </span>
            ))}
          </div>,
          document.body
        )}
    </div>
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
  searchQuery,
  onRestoreRequested,
  onPermanentDeleteRequested,
}: {
  rows: RepairCaseFlowchartTrashRow[];
  canManage: boolean;
  canPermanentlyDelete: boolean;
  now: Date;
  /** 지금 친 검색어 — 고장 개소 알약이 **걸린 것을 접힌 채로도 보여 주려면** 여기까지 와야 한다(FaultTagPills 머리말). */
  searchQuery: string;
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
          {/* 휴지통 **카드** — 넷 중 하나(FaultTagPills 머리말). 이름 바로 아래다. */}
          <FaultTagPills tags={row.faultTags} searchQuery={searchQuery} />
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
  searchQuery,
  onDeleteRequested,
}: {
  rows: RepairCaseFlowchartManagementRow[];
  canManage: boolean;
  /** 지금 친 검색어 — 휴지통 카드와 같은 까닭으로 여기까지 넘긴다(FaultTagPills 머리말). */
  searchQuery: string;
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
            {/* 사용중 **카드** — 넷 중 하나(FaultTagPills 머리말). 이름 바로 아래다. */}
            <FaultTagPills tags={row.faultTags} searchQuery={searchQuery} />
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
 *
 * 2026-11-19 — **고장 개소 태그로도 찾는다**(사용자 요청). 찾는 일은 그대로
 * 화면에서 돈다 — 조회 둘이 태그를 함께 실어 오고(listRepairCaseFlowchartsForManagement ·
 * listDeletedRepairCaseFlowchartsForManagement), 거르는 것은 matchesSearch /
 * matchesTrashSearch 다. 🔴 **표에 칸을 더하지 않았다** — 태그는 Flowchart 이름
 * 아래에 알약으로 붙는다(FaultTagPills 머리말에 까닭). 그리는 자리는 넷이다:
 * 사용중 표·카드, 휴지통 표·카드.
 *
 * 같은 날 추가 지시로 알약은 **셋까지만 줄에 서고 나머지는 `+N`** 이다. 🔴 검색
 * 중에는 **걸린 태그가 숨은 자리에 있어도 줄에 선다**(상한을 넘겨서라도) — 그래서
 * 지금 친 검색어가 카드 목록 둘에까지 prop 으로 내려간다. 가르는 규칙은 lib/domain
 * 의 selectVisibleFaultTags 가 값으로 정한다.
 *
 * 🔴 눈으로 확인한 뒤 숨은 태그를 보여 주는 방식이 **떠 있는 메모**로 바뀌었다 —
 * 그 자리에서 펼치면 표 칸이 넓어져 표 전체가 옆으로 밀렸기 때문이다. 메모는
 * 흐름에서 빠지므로(portal + fixed) 눌러도 표 폭이 안 변하고, 그래서 「펼치면 표가
 * 넓어지는데 카드로 안 넘어간다」는 걱정도 **함께 사라졌다**(FaultTagPills 머리말).
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
            className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900"
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
          // 🔴 찾을 수 있는 것을 **여기에 다 적는다** — 고장 개소로도 찾아지는데
          // 안 적으면 되는 줄을 아무도 모른다(2026-11-19).
          placeholder="인수번호 · 고객사 · End-User · 모델 · S/N · Flowchart 이름 · 고장 개소 검색"
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
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                        {row.title}
                        {/* 휴지통 **표** — 넷 중 하나(FaultTagPills 머리말). 🔴 칸을 새로
                            더하지 않고 「Flowchart 이름」 칸 **안**, 이름 아래에 넣는다. */}
                        <FaultTagPills tags={row.faultTags} searchQuery={searchQuery} />
                      </td>
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
                searchQuery={searchQuery}
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
                        {/* 사용중 **표** — 넷 중 하나(FaultTagPills 머리말). 🔴 칸을 새로
                            더하지 않고 「Flowchart 이름」 칸 **안**, 이름 아래에 넣는다. */}
                        <FaultTagPills tags={row.faultTags} searchQuery={searchQuery} />
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
            <DiagnosisFlowchartCardList rows={filteredRows} canManage={canManage} searchQuery={searchQuery} onDeleteRequested={requestDelete} />
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
