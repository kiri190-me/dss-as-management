"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import LoadingNotice from "@/components/domain/LoadingNotice";
import RepairCaseFilters from "./RepairCaseFilters";
import RepairCaseTable from "./RepairCaseTable";
import { ResponsiveList } from "@/components/common/responsive-list";
import RepairCaseCardList from "./RepairCaseCardList";
import RepairCaseBulkDeleteBar from "./RepairCaseBulkDeleteBar";
import RepairCaseBulkDeleteDialog from "./RepairCaseBulkDeleteDialog";
import Pagination from "./Pagination";
import { bulkDeleteRepairCasesAction } from "@/lib/server/actions/bulk-delete-repair-cases";
import type { TrashedRepairCase } from "@/lib/db/mappers/repair-case";
import RepairCaseTrashTable from "./trash/RepairCaseTrashTable";
import RepairCaseTrashCardList from "./trash/RepairCaseTrashCardList";
import RepairCaseTrashActionBar from "./trash/RepairCaseTrashActionBar";
import SelectAllCheckbox from "@/components/common/select-all-checkbox";
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
  /**
   * 로그인한 사용자에게 결재 요청이 들어와 있는 접수 건 id — 서버가 계산해
   * 내려준다(queries/repair-case-approvals-pending.ts). "내게 온 결재 요청"은
   * 행에 저장된 값이 아니라 워크플로 전이의 승인 요건 + 아직 결정되지 않은
   * 결재 요청 기록 + 그 사용자의 결재 권한으로 나오는 파생값이라, 화면이
   * 스스로 판정할 수 없다.
   *
   * undefined(mock 모드, 또는 결재 권한이 없는 세션)이면 "내게 온 결재 요청"
   * 조건 자체를 그리지 않는다.
   */
  myPendingApprovalCaseIds?: string[];
  /**
   * 지금 **장기 PO 미발행**인 접수 건 id — 서버가 계산해 내려준다
   * (queries/long-pending-po.ts). 견적일·발주일은 접수 건이 아니라 그 건에
   * 붙은 내자 줄(여럿일 수 있다)에 있고, "오늘"도 한국 날짜로 서버가 정해야
   * 한다 — 화면이 new Date()로 만들면 서버가 그린 것과 달라져 hydration이
   * 어긋난다. 그래서 화면이 스스로 판정할 수 없다.
   *
   * undefined(mock 모드)이면 "장기 PO 미발행" 조건 자체를 그리지 않는다.
   */
  longPendingPoCaseIds?: string[];
};

export default function RepairCaseListPage({
  serverBaseCases,
  canBulkDelete = false,
  serverTrashCases,
  canRestore = false,
  canPermanentlyDelete = false,
  myPendingApprovalCaseIds,
  longPendingPoCaseIds,
}: RepairCaseListPageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

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
    if (restoredCases.length === 0) return active;
    // 서버 목록에 이미 들어온 건은 여기서 다시 붙이지 않는다 — 복원 직후에는
    // 화면에만 있던 이 사본이 유일한 근거지만, router.refresh()로 새 목록이
    // 오면 같은 행이 양쪽에 있게 되어 목록에 두 번 보인다.
    const known = new Set(active.map((c) => c.id));
    return [...active, ...restoredCases.filter((c) => !known.has(c.id))];
  }, [serverBaseCases, mockBaseCases, deletedIds, restoredCases]);

  const { cases: rows, isHydrated } = useEffectiveRepairCasesFromBase(baseCases);

  // Trash tab state — only ever populated/rendered when canRestore is true.
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  /**
   * 휴지통 목록은 **서버 목록에서 파생**한다 — 사본을 따로 들고 있지 않는다.
   *
   * 예전에는 useState로 한 번 복사해 두고 화면에서만 고쳤다. 그래서 삭제한
   * 건이 이 사본에 들어오지 못했고, **휴지통(N)이 새로고침 전까지 올라가지
   * 않았다**. 지운 건이 어디로 갔는지(삭제 시각·삭제자·새 version)는 서버만
   * 아는 값이라 화면이 지어낼 수도 없다.
   *
   * 그래서 방향을 뒤집었다. 조작이 성공하면 router.refresh()로 서버 목록을
   * 다시 받고, 화면은 그 목록에서 "방금 여기서 처리한 것"만 덜어 낸다.
   * 덜어 낸 id는 새 목록에는 애초에 없으므로 그대로 두어도 무해하다 —
   * 되돌려 놓을 시점을 따로 관리하지 않아도 저절로 아물게 하려는 것이다.
   */
  const [resolvedTrashIds, setResolvedTrashIds] = useState<Set<string>>(new Set());
  const trashCases = useMemo(() => {
    const source = serverTrashCases ?? [];
    return resolvedTrashIds.size === 0 ? source : source.filter((c) => !resolvedTrashIds.has(c.id));
  }, [serverTrashCases, resolvedTrashIds]);
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

  // 서버가 내게 온 결재 요청 집합을 내려준 세션에서만 이 조건을 쓸 수 있다. 근거가
  // 없는데 딥링크(?myApproval=1)만 들어오면 조건을 켜지 않는다 — 켜면 목록이
  // 통째로 비어 고장처럼 보인다.
  const canFilterMyPendingApproval = myPendingApprovalCaseIds !== undefined;
  const myPendingApprovalIdSet = useMemo(
    () => (myPendingApprovalCaseIds ? new Set(myPendingApprovalCaseIds) : undefined),
    [myPendingApprovalCaseIds]
  );

  // 장기 PO 미발행도 같은 모양이다 — 근거(서버가 내려준 묶음)가 있는 세션에서만
  // 쓸 수 있고, 근거 없이 딥링크(?longPendingPo=1)만 들어오면 켜지 않는다.
  const canFilterLongPendingPo = longPendingPoCaseIds !== undefined;
  const longPendingPoIdSet = useMemo(
    () => (longPendingPoCaseIds ? new Set(longPendingPoCaseIds) : undefined),
    [longPendingPoCaseIds]
  );

  const [filters, setFilters] = useState<Filters>(() => {
    const parsed = parseInitialFilters(searchParams);
    return {
      ...parsed,
      myPendingApprovalOnly: canFilterMyPendingApproval ? parsed.myPendingApprovalOnly : false,
      longPendingPoOnly: canFilterLongPendingPo ? parsed.longPendingPoOnly : false,
    };
  });
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

  const filteredRows = useMemo(
    () => applyFilters(rows, filters, myPendingApprovalIdSet, longPendingPoIdSet),
    [rows, filters, myPendingApprovalIdSet, longPendingPoIdSet]
  );
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

  /**
   * 전체 선택의 대상은 **지금 이 페이지에 그려진, 고를 수 있는 행**이다.
   * 필터에 걸린 전부(sortedRows)가 아니라 pagedRows인 이유는, 눈에 보이지
   * 않는 행까지 한 번에 담기면 확인 창에 뜨는 건수와 화면에서 센 건수가
   * 달라지기 때문이다. 해제도 같은 범위만 푼다 — 다른 페이지에서 골라 둔
   * 것은 그대로 남고, 그것을 한꺼번에 비우는 일은 '취소'가 따로 한다.
   */
  const selectablePagedIds = useMemo(
    () => pagedRows.filter((row) => selectableIds.has(row.id)).map((row) => row.id),
    [pagedRows, selectableIds]
  );

  function handleToggleSelectAllOnPage(nextChecked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of selectablePagedIds) {
        if (nextChecked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function handleToggleSelectAllTrash(nextChecked: boolean) {
    // 휴지통은 페이지를 나누지 않으므로 '보이는 것'이 곧 전부다.
    setTrashSelectedIds(nextChecked ? new Set(trashCases.map((row) => row.id)) : new Set());
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
        // 사용중 목록에서 빼는 것만으로는 휴지통이 늘어나지 않는다 — 지운 건이
        // 어디로 갔는지는 서버만 안다(삭제 시각·삭제자·새 version). 위 sync
        // effect가 새 목록으로 갈아 끼운다.
        router.refresh();
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
        setResolvedTrashIds((prev) => new Set([...prev, ...succeededIds]));
        setTrashSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.delete(id);
          return next;
        });
        // 복원한 건의 새 version은 서버만 안다 — 다시 삭제하려 할 때 예전
        // version으로 물으면 CONFLICT가 난다.
        router.refresh();
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
        // Unlike restore, a permanently deleted row is gone for good — it's
        // only ever taken out of the 휴지통 list here, never merged back into
        // the active baseCases list.
        setResolvedTrashIds((prev) => new Set([...prev, ...succeededIds]));
        setTrashSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.delete(id);
          return next;
        });
        router.refresh();
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
              selectablePageCount={selectablePagedIds.length}
              selectedPageCount={selectablePagedIds.filter((id) => selectedIds.has(id)).length}
              onToggleSelectAllOnPage={handleToggleSelectAllOnPage}
              onEnterDeleteMode={handleEnterDeleteMode}
              onCancel={handleCancelDeleteMode}
              onRequestDelete={handleRequestDelete}
            />
          )}
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

          {/* 선택 바는 0건일 때 사라지므로, 카드 보기에서도 늘 닿을 수 있는
              전체 선택은 여기(항상 보이는 줄)에 둔다. 표 머리글에도 같은
              체크박스가 있지만 표/카드 중 무엇이 보이는지는 ResponsiveList가
              안에서 정하므로 한쪽만으로는 카드에서 닿지 않는다. */}
          {trashCases.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <SelectAllCheckbox
                selectableCount={trashCases.length}
                selectedCount={trashCases.filter((row) => trashSelectedIds.has(row.id)).length}
                onChange={handleToggleSelectAllTrash}
                label="전체 선택"
              />
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
            <ResponsiveList
              listId="repair-case-trash"
              table={
                <RepairCaseTrashTable
                  rows={trashCases}
                  selectedIds={trashSelectedIds}
                  onToggleSelect={handleToggleTrashSelect}
                  onToggleSelectAll={handleToggleSelectAllTrash}
                  onRestoreOne={handleRequestRestoreOne}
                  canPermanentlyDelete={canPermanentlyDelete}
                  onPermanentlyDeleteOne={handleRequestPermanentDeleteOne}
                />
              }
              cards={
                <RepairCaseTrashCardList
                  rows={trashCases}
                  selectedIds={trashSelectedIds}
                  onToggleSelect={handleToggleTrashSelect}
                  onRestoreOne={handleRequestRestoreOne}
                  canPermanentlyDelete={canPermanentlyDelete}
                  onPermanentlyDeleteOne={handleRequestPermanentDeleteOne}
                />
              }
            />
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
            onProductCategoryChange={(value) => updateFilters({ productCategory: value })}
            onBillingTypeChange={(value) => updateFilters({ billingType: value })}
            onCustomerChange={(value) => updateFilters({ customerId: value })}
            onPriorityChange={(value) => updateFilters({ priority: value })}
            onOverdueOnlyChange={(value) => updateFilters({ overdueOnly: value })}
            canFilterMyPendingApproval={canFilterMyPendingApproval}
            onMyPendingApprovalOnlyChange={(value) => updateFilters({ myPendingApprovalOnly: value })}
            canFilterLongPendingPo={canFilterLongPendingPo}
            onLongPendingPoOnlyChange={(value) => updateFilters({ longPendingPoOnly: value })}
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
                  <ResponsiveList
                    listId="repair-cases"
                    table={
                      <RepairCaseTable
                        rows={pagedRows}
                        sort={sort}
                        onSortChange={handleSortChange}
                        selectionMode={isDeleteMode}
                        selectedIds={selectedIds}
                        selectableIds={selectableIds}
                        onToggleSelect={handleToggleSelect}
                        onToggleSelectAll={handleToggleSelectAllOnPage}
                      />
                    }
                    cards={
                      <RepairCaseCardList
                        rows={pagedRows}
                        selectionMode={isDeleteMode}
                        selectedIds={selectedIds}
                        selectableIds={selectableIds}
                        onToggleSelect={handleToggleSelect}
                      />
                    }
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
