"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { mockCustomers, mockRepairCases } from "@/lib/domain/mock-data";
import { toResolvedFromMock, type ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { useEffectiveRepairCasesFromBase } from "@/lib/domain/local/workflow/effective-repair-case";
import {
  applyFilters,
  DEFAULT_FILTERS,
  paginate,
  parseInitialFilters,
  sortRows,
  type Filters,
  type PaginationState,
  type SortColumn,
  type SortState,
} from "@/lib/domain/repair-case-filters";
import DemoReferenceNotice from "@/components/domain/DemoReferenceNotice";
import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseFilters from "./RepairCaseFilters";
import RepairCaseTable from "./RepairCaseTable";
import RepairCaseCardList from "./RepairCaseCardList";
import RepairCaseBulkDeleteBar from "./RepairCaseBulkDeleteBar";
import RepairCaseBulkDeleteDialog from "./RepairCaseBulkDeleteDialog";
import Pagination from "./Pagination";
import { bulkDeleteRepairCasesAction } from "@/lib/server/actions/bulk-delete-repair-cases";
import type { TrashedRepairCase } from "@/lib/db/mappers/repair-case";
import RepairCaseTrashTable from "./trash/RepairCaseTrashTable";
import RepairCaseTrashCardList from "./trash/RepairCaseTrashCardList";
import RepairCaseTrashActionBar from "./trash/RepairCaseTrashActionBar";
import RepairCaseRestoreDialog from "./trash/RepairCaseRestoreDialog";
import { restoreRepairCasesAction } from "@/lib/server/actions/restore-repair-cases";
import RepairCasePermanentDeleteDialog from "./trash/RepairCasePermanentDeleteDialog";
import { permanentlyDeleteRepairCasesAction } from "@/lib/server/actions/permanently-delete-repair-cases";

const DEFAULT_SORT: SortState = { column: "receivedAt", direction: "desc" };
const DEFAULT_PAGINATION: PaginationState = { page: 1, pageSize: 10 };

type RepairCaseListPageProps = {
  /**
   * Non-local base rows fetched server-side (Stage G-2 database mode).
   * Undefined means "use existing Mock behavior" — the two must never be
   * combined, so when this is provided it entirely replaces the Mock base
   * set rather than adding to it (see effective-repair-case.ts).
   */
  serverBaseCases?: ResolvedRepairCase[];
  /**
   * Bulk soft-delete checkpoint — true only for a SUPER_ADMIN/ADMIN session
   * in DATABASE write-source mode (computed by the page, same "UX hint only,
   * never the enforcement boundary" precedent as canRegisterProductModel —
   * bulkDeleteRepairCasesAction re-checks role/write-source independently).
   * Defaults to false so Mock mode and every non-admin role never render
   * the 삭제 모드 button at all.
   */
  canBulkDelete?: boolean;
  /**
   * Repair Case Trash + Restore checkpoint — 휴지통 rows fetched server-side
   * (listDeletedRepairCases()), only ever populated when canRestore is also
   * true (mirrors canBulkDelete/serverBaseCases's own pairing). Undefined
   * (Mock mode, or a non-admin session) means no 휴지통 tab renders at all.
   */
  serverTrashCases?: TrashedRepairCase[];
  /**
   * SUPER_ADMIN/ADMIN + DATABASE write-source only, computed by the page —
   * same "UX hint only, never the enforcement boundary" precedent as
   * canBulkDelete (restoreRepairCasesAction re-checks role/write-source
   * independently). Gates whether the 휴지통 tab renders at all.
   */
  canRestore?: boolean;
  /**
   * Repair Case Permanent Delete checkpoint — SUPER_ADMIN/ADMIN + DATABASE
   * write-source only, computed by the page — same "UX hint only, never
   * the enforcement boundary" precedent as canBulkDelete/canRestore
   * (permanentlyDeleteRepairCasesAction re-checks role/write-source
   * independently). Gates whether 완전 삭제 controls render inside the
   * 휴지통 tab at all.
   */
  canPermanentlyDelete?: boolean;
};

export default function RepairCaseListPage({
  serverBaseCases,
  canBulkDelete = false,
  serverTrashCases,
  canRestore = false,
  canPermanentlyDelete = false,
}: RepairCaseListPageProps) {
  const searchParams = useSearchParams();

  // Only actually used when serverBaseCases is undefined (Mock mode) — kept
  // as a plain, unconditional useMemo (not a conditional hook call) so the
  // hook order below never depends on the serverBaseCases prop.
  const mockBaseCases = useMemo(() => mockRepairCases.map((c) => toResolvedFromMock(c)), []);

  // Bulk soft-delete: successfully deleted ids are removed from the base set
  // client-side (no full page reload) — the server's own listRepairCases()
  // already excludes is_deleted rows, so this just mirrors that filter
  // locally for the rows this page already has in hand.
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // Trash + Restore: a row restored from 휴지통 is appended here (client-side,
  // no full reload) so it reappears in 사용중 immediately — TrashedRepairCase
  // structurally satisfies ResolvedRepairCase (it's a superset), so this is a
  // plain merge, never a re-fetch.
  const [restoredCases, setRestoredCases] = useState<TrashedRepairCase[]>([]);
  const baseCases = useMemo(() => {
    const source = serverBaseCases ?? mockBaseCases;
    const active = deletedIds.size === 0 ? source : source.filter((c) => !deletedIds.has(c.id));
    return restoredCases.length === 0 ? active : [...active, ...restoredCases];
  }, [serverBaseCases, mockBaseCases, deletedIds, restoredCases]);

  const { cases: rows, isHydrated } = useEffectiveRepairCasesFromBase(baseCases);

  // Trash tab state — only ever populated/rendered when canRestore is true.
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [trashCases, setTrashCases] = useState<TrashedRepairCase[]>(() => serverTrashCases ?? []);
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());
  const [restoreTargetIds, setRestoreTargetIds] = useState<string[]>([]);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreSubmitError, setRestoreSubmitError] = useState<string | null>(null);
  const [restoreItemErrors, setRestoreItemErrors] = useState<Record<string, string>>({});

  // Permanent delete — same shape as the restore state above, plus a
  // mandatory reason field (restore has none; soft-delete's is optional).
  const [permanentDeleteTargetIds, setPermanentDeleteTargetIds] = useState<string[]>([]);
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] = useState(false);
  const [permanentDeleteReason, setPermanentDeleteReason] = useState("");
  const [isPermanentDeleting, setIsPermanentDeleting] = useState(false);
  const [permanentDeleteSubmitError, setPermanentDeleteSubmitError] = useState<string | null>(null);
  const [permanentDeleteItemErrors, setPermanentDeleteItemErrors] = useState<Record<string, string>>({});

  const [filters, setFilters] = useState<Filters>(() =>
    parseInitialFilters(searchParams)
  );
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);

  /**
   * 페이지 이동 후 목록 상단으로 되돌리는 앵커다. 이 화면의 페이지네이션은
   * 라우팅이 아니라 순수 useState 변경이라(아래 Pagination의 onPageChange),
   * 화면 전환이 없으니 브라우저도 라우터도 스크롤을 건드리지 않는다. 그래서
   * 폰에서 화면 맨 아래 "다음"을 누르면 새 페이지의 끝부분을 보고 있게 된다.
   *
   * 스크롤 주체가 window가 아니라 AppShell의 <main>(overflow-y-auto)이므로
   * window.scrollTo는 아무 효과가 없다 — 스크롤 컨테이너를 직접 찾지 않아도
   * 되도록 앵커 엘리먼트의 scrollIntoView를 쓴다.
   */
  const listTopRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // block: "nearest" — 보이지 않을 때만 최소한으로 스크롤하는 옵션이다.
    // 모바일에서는 목록 상단이 화면 위쪽 밖이라 상단이 맨 위에 오도록
    // 올라가고, 데스크톱처럼 이미 목록 상단이 보이는 상태에서는 아무 일도
    // 일어나지 않는다. 뷰포트 폭 분기를 코드에 박지 않고도 "모바일에서만
    // 실질적으로 동작"이 되는 이유이며, 같은 성질 덕분에 필터 변경으로
    // page가 1로 리셋될 때(사용자는 필터 패널이 있는 상단에 있다)도
    // 화면이 튀지 않는다.
    listTopRef.current?.scrollIntoView({ block: "nearest" });
  }, [pagination.page, pagination.pageSize]);

  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSubmitError, setDeleteSubmitError] = useState<string | null>(null);
  const [deleteItemErrors, setDeleteItemErrors] = useState<Record<string, string>>({});

  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const sortedRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pagination.pageSize));
  const currentPage = Math.min(pagination.page, totalPages);
  const pagedRows = useMemo(
    () => paginate(sortedRows, { ...pagination, page: currentPage }),
    [sortedRows, pagination, currentPage]
  );

  function updateFilters(partial: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...partial }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  function handleSortChange(column: SortColumn) {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" }
    );
  }

  function handleReset() {
    setFilters(DEFAULT_FILTERS);
    setPagination((prev) => ({ ...prev, page: 1 }));
  }

  // Selectable across the full filtered set (not just the current page) so
  // a selection made before paginating/filtering isn't silently lost —
  // DATABASE-sourced rows only, since a local/draft row has no server-side
  // repair_cases row for bulkDeleteRepairCasesAction to touch.
  const selectableIds = useMemo(
    () => new Set(sortedRows.filter((r) => r.source === "DATABASE").map((r) => r.id)),
    [sortedRows]
  );
  const versionById = useMemo(() => new Map(sortedRows.map((r) => [r.id, r.version])), [sortedRows]);
  const intakeNumberById = useMemo(() => new Map(sortedRows.map((r) => [r.id, r.intakeNumber])), [sortedRows]);

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleEnterDeleteMode() {
    setIsDeleteMode(true);
  }

  function handleCancelDeleteMode() {
    setIsDeleteMode(false);
    setSelectedIds(new Set());
    setDeleteItemErrors({});
    setDeleteSubmitError(null);
  }

  function handleRequestDelete() {
    if (selectedIds.size === 0) return;
    setDeleteSubmitError(null);
    setIsConfirmOpen(true);
  }

  function handleCloseConfirm() {
    if (isDeleting) return;
    setIsConfirmOpen(false);
  }

  async function handleConfirmDelete() {
    setIsDeleting(true);
    setDeleteSubmitError(null);
    try {
      const items = [...selectedIds]
        .filter((id) => versionById.has(id))
        .map((id) => ({ id, expectedVersion: versionById.get(id)! }));

      const result = await bulkDeleteRepairCasesAction({ items, reason: deleteReason.trim() || null });
      if (!result.ok) {
        setDeleteSubmitError(result.message);
        return;
      }

      const succeededIds: string[] = [];
      const failedErrors: Record<string, string> = {};
      for (const itemResult of result.results) {
        if (itemResult.ok) {
          succeededIds.push(itemResult.id);
        } else {
          failedErrors[itemResult.id] = itemResult.message ?? "삭제하지 못했습니다.";
        }
      }

      if (succeededIds.length > 0) {
        setDeletedIds((prev) => new Set([...prev, ...succeededIds]));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.delete(id);
          return next;
        });
      }
      setDeleteItemErrors(failedErrors);
      setDeleteReason("");
      setIsConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }

  const selectedIntakeNumbers = [...selectedIds].map((id) => intakeNumberById.get(id) ?? id);
  const deleteItemErrorEntries = Object.entries(deleteItemErrors).map(([id, message]) => ({
    id,
    intakeNumber: intakeNumberById.get(id) ?? id,
    message,
  }));

  // ---- Trash + Restore ----

  const trashVersionById = useMemo(() => new Map(trashCases.map((c) => [c.id, c.version])), [trashCases]);
  const trashIntakeNumberById = useMemo(
    () => new Map(trashCases.map((c) => [c.id, c.intakeNumber])),
    [trashCases]
  );

  function handleToggleTrashSelect(id: string) {
    setTrashSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleClearTrashSelection() {
    setTrashSelectedIds(new Set());
  }

  function handleRequestRestoreOne(id: string) {
    setRestoreSubmitError(null);
    setRestoreTargetIds([id]);
    setIsRestoreConfirmOpen(true);
  }

  function handleRequestRestoreSelected() {
    if (trashSelectedIds.size === 0) return;
    setRestoreSubmitError(null);
    setRestoreTargetIds([...trashSelectedIds]);
    setIsRestoreConfirmOpen(true);
  }

  function handleCloseRestoreConfirm() {
    if (isRestoring) return;
    setIsRestoreConfirmOpen(false);
  }

  async function handleConfirmRestore() {
    setIsRestoring(true);
    setRestoreSubmitError(null);
    try {
      const items = restoreTargetIds
        .filter((id) => trashVersionById.has(id))
        .map((id) => ({ id, expectedVersion: trashVersionById.get(id)! }));

      const result = await restoreRepairCasesAction({ items });
      if (!result.ok) {
        setRestoreSubmitError(result.message);
        return;
      }

      const succeededIds: string[] = [];
      const failedErrors: Record<string, string> = {};
      for (const itemResult of result.results) {
        if (itemResult.ok) {
          succeededIds.push(itemResult.id);
        } else {
          failedErrors[itemResult.id] = itemResult.message ?? "복원하지 못했습니다.";
        }
      }

      if (succeededIds.length > 0) {
        const succeededSet = new Set(succeededIds);
        setRestoredCases((prev) => [...prev, ...trashCases.filter((c) => succeededSet.has(c.id))]);
        setTrashCases((prev) => prev.filter((c) => !succeededSet.has(c.id)));
        setTrashSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.delete(id);
          return next;
        });
      }
      setRestoreItemErrors(failedErrors);
      setIsRestoreConfirmOpen(false);
    } finally {
      setIsRestoring(false);
    }
  }

  const restoreTargetIntakeNumbers = restoreTargetIds.map((id) => trashIntakeNumberById.get(id) ?? id);
  const restoreItemErrorEntries = Object.entries(restoreItemErrors).map(([id, message]) => ({
    id,
    intakeNumber: trashIntakeNumberById.get(id) ?? id,
    message,
  }));

  // ---- Permanent delete ----

  function handleRequestPermanentDeleteOne(id: string) {
    setPermanentDeleteSubmitError(null);
    setPermanentDeleteReason("");
    setPermanentDeleteTargetIds([id]);
    setIsPermanentDeleteConfirmOpen(true);
  }

  function handleRequestPermanentDeleteSelected() {
    if (trashSelectedIds.size === 0) return;
    setPermanentDeleteSubmitError(null);
    setPermanentDeleteReason("");
    setPermanentDeleteTargetIds([...trashSelectedIds]);
    setIsPermanentDeleteConfirmOpen(true);
  }

  function handleClosePermanentDeleteConfirm() {
    if (isPermanentDeleting) return;
    setIsPermanentDeleteConfirmOpen(false);
  }

  async function handleConfirmPermanentDelete() {
    setIsPermanentDeleting(true);
    setPermanentDeleteSubmitError(null);
    try {
      const items = permanentDeleteTargetIds
        .filter((id) => trashVersionById.has(id))
        .map((id) => ({ id, expectedVersion: trashVersionById.get(id)! }));

      const result = await permanentlyDeleteRepairCasesAction({ items, reason: permanentDeleteReason });
      if (!result.ok) {
        setPermanentDeleteSubmitError(result.message);
        return;
      }

      const succeededIds: string[] = [];
      const failedErrors: Record<string, string> = {};
      for (const itemResult of result.results) {
        if (itemResult.ok) {
          succeededIds.push(itemResult.id);
        } else {
          failedErrors[itemResult.id] = itemResult.message ?? "영구 삭제하지 못했습니다.";
        }
      }

      if (succeededIds.length > 0) {
        const succeededSet = new Set(succeededIds);
        // Unlike restore, a permanently deleted row is gone for good — it's
        // only ever removed from trashCases here, never merged back into
        // the active baseCases list.
        setTrashCases((prev) => prev.filter((c) => !succeededSet.has(c.id)));
        setTrashSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.delete(id);
          return next;
        });
      }
      setPermanentDeleteItemErrors(failedErrors);
      setPermanentDeleteReason("");
      setIsPermanentDeleteConfirmOpen(false);
    } finally {
      setIsPermanentDeleting(false);
    }
  }

  const permanentDeleteTargetIntakeNumbers = permanentDeleteTargetIds.map((id) => trashIntakeNumberById.get(id) ?? id);
  const permanentDeleteItemErrorEntries = Object.entries(permanentDeleteItemErrors).map(([id, message]) => ({
    id,
    intakeNumber: trashIntakeNumberById.get(id) ?? id,
    message,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          전체 A/S 현황
        </h1>
        <div className="flex items-center gap-3">
          {activeTab === "active" && (
            <RepairCaseBulkDeleteBar
              canBulkDelete={canBulkDelete}
              isDeleteMode={isDeleteMode}
              selectedCount={selectedIds.size}
              onEnterDeleteMode={handleEnterDeleteMode}
              onCancel={handleCancelDeleteMode}
              onRequestDelete={handleRequestDelete}
            />
          )}
          <DemoReferenceNotice />
        </div>
      </div>

      {/* Repair Case Trash + Restore checkpoint — the 휴지통 tab (and this
          entire tab strip) only renders for canRestore=true sessions; every
          other role/mode continues to see exactly the unchanged 사용중-only
          screen below, with no tab strip at all. */}
      {canRestore && (
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === "active"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            사용중 ({baseCases.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("trash")}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              activeTab === "trash"
                ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            휴지통 ({trashCases.length})
          </button>
        </div>
      )}

      {activeTab === "trash" ? (
        <>
          {restoreItemErrorEntries.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            >
              <p className="font-medium">다음 접수 건은 복원하지 못했습니다 (선택 상태가 유지됩니다):</p>
              <ul className="mt-1 list-inside list-disc">
                {restoreItemErrorEntries.map((entry) => (
                  <li key={entry.id}>
                    {entry.intakeNumber}: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {permanentDeleteItemErrorEntries.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            >
              <p className="font-medium">다음 접수 건은 영구 삭제하지 못했습니다 (선택 상태가 유지됩니다):</p>
              <ul className="mt-1 list-inside list-disc">
                {permanentDeleteItemErrorEntries.map((entry) => (
                  <li key={entry.id}>
                    {entry.intakeNumber}: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <RepairCaseTrashActionBar
            selectedCount={trashSelectedIds.size}
            onClearSelection={handleClearTrashSelection}
            onRequestRestore={handleRequestRestoreSelected}
            canPermanentlyDelete={canPermanentlyDelete}
            onRequestPermanentDelete={handleRequestPermanentDeleteSelected}
          />

          {trashCases.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              휴지통이 비어 있습니다.
            </div>
          ) : (
            <>
              <RepairCaseTrashTable
                rows={trashCases}
                selectedIds={trashSelectedIds}
                onToggleSelect={handleToggleTrashSelect}
                onRestoreOne={handleRequestRestoreOne}
                canPermanentlyDelete={canPermanentlyDelete}
                onPermanentlyDeleteOne={handleRequestPermanentDeleteOne}
              />
              <RepairCaseTrashCardList
                rows={trashCases}
                selectedIds={trashSelectedIds}
                onToggleSelect={handleToggleTrashSelect}
                onRestoreOne={handleRequestRestoreOne}
                canPermanentlyDelete={canPermanentlyDelete}
                onPermanentlyDeleteOne={handleRequestPermanentDeleteOne}
              />
            </>
          )}
        </>
      ) : (
        <>
          {deleteItemErrorEntries.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
            >
              <p className="font-medium">다음 접수 건은 삭제하지 못했습니다 (선택 상태가 유지됩니다):</p>
              <ul className="mt-1 list-inside list-disc">
                {deleteItemErrorEntries.map((entry) => (
                  <li key={entry.id}>
                    {entry.intakeNumber}: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <RepairCaseFilters
            filters={filters}
            customers={mockCustomers}
            onQueryChange={(value) => updateFilters({ query: value })}
            onStatusChange={(value) => updateFilters({ status: value })}
            onWorkflowTypeChange={(value) => updateFilters({ workflowType: value })}
            onCustomerChange={(value) => updateFilters({ customerId: value })}
            onPriorityChange={(value) => updateFilters({ priority: value })}
            onOverdueOnlyChange={(value) => updateFilters({ overdueOnly: value })}
            onReset={handleReset}
          />

          {!isHydrated ? (
            <LoadingNotice />
          ) : (
            <>
              {/* ref: 페이지 이동 후 되돌아올 "목록 상단" 지점 (listTopRef 주석 참조).
                  표/카드 목록 바로 위의 이 줄을 앵커로 잡아, 스크롤 후 첫 행이
                  건수 안내 바로 아래에 오도록 한다. */}
              <p ref={listTopRef} aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
                조건에 맞는 A/S 접수 건 {sortedRows.length}건
              </p>

              {sortedRows.length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  조건에 맞는 A/S 접수 건이 없습니다.
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      필터 초기화
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <RepairCaseTable
                    rows={pagedRows}
                    sort={sort}
                    onSortChange={handleSortChange}
                    selectionMode={isDeleteMode}
                    selectedIds={selectedIds}
                    selectableIds={selectableIds}
                    onToggleSelect={handleToggleSelect}
                  />
                  <RepairCaseCardList
                    rows={pagedRows}
                    selectionMode={isDeleteMode}
                    selectedIds={selectedIds}
                    selectableIds={selectableIds}
                    onToggleSelect={handleToggleSelect}
                  />
                  <Pagination
                    page={currentPage}
                    pageSize={pagination.pageSize}
                    totalCount={sortedRows.length}
                    onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
                    onPageSizeChange={(pageSize) => setPagination({ page: 1, pageSize })}
                  />
                </>
              )}
            </>
          )}

          <RepairCaseBulkDeleteDialog
            isOpen={isConfirmOpen}
            intakeNumbers={selectedIntakeNumbers}
            reason={deleteReason}
            isSubmitting={isDeleting}
            submitError={deleteSubmitError}
            onReasonChange={setDeleteReason}
            onConfirm={handleConfirmDelete}
            onCancel={handleCloseConfirm}
          />
        </>
      )}

      <RepairCaseRestoreDialog
        isOpen={isRestoreConfirmOpen}
        intakeNumbers={restoreTargetIntakeNumbers}
        isSubmitting={isRestoring}
        submitError={restoreSubmitError}
        onConfirm={handleConfirmRestore}
        onCancel={handleCloseRestoreConfirm}
      />

      <RepairCasePermanentDeleteDialog
        isOpen={isPermanentDeleteConfirmOpen}
        intakeNumbers={permanentDeleteTargetIntakeNumbers}
        reason={permanentDeleteReason}
        isSubmitting={isPermanentDeleting}
        submitError={permanentDeleteSubmitError}
        onReasonChange={setPermanentDeleteReason}
        onConfirm={handleConfirmPermanentDelete}
        onCancel={handleClosePermanentDeleteConfirm}
      />
    </div>
  );
}
