"use client";

import { useMemo, useState } from "react";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import MasterDataTrashRetentionBadge from "@/components/common/master-data-trash-retention-badge";
import {
  MasterDataDeleteDialog,
  MasterDataPermanentDeleteDialog,
  MasterDataRestoreDialog,
  MasterDataSelectionBar,
} from "@/components/common/master-data-trash-dialogs";
import SelectAllCheckbox from "@/components/common/select-all-checkbox";
import { useMasterDataTrash, type MasterDataTrashTarget } from "@/lib/hooks/useMasterDataTrash";
import {
  deleteCustomersAction,
  permanentlyDeleteCustomersAction,
  restoreCustomersAction,
} from "@/lib/server/actions/customer-trash";
import Link from "next/link";
import type { CustomerListRow, DeletedCustomerRow } from "@/lib/db/queries/customers";
import { rankSimilarNames } from "@/lib/domain/entity-name-match";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * /customers list. Search reuses rankSimilarNames (entity-name-match.ts) —
 * the exact same normalized substring/prefix ranking the intake form's
 * customer combobox already uses, so "고객사 검색" behaves the way users
 * already expect from A/S 접수/편집's own customer field, not a second,
 * different matching rule.
 *
 * 표/카드 전환은 ResponsiveList가 정한다(폭을 실제로 재서 결정하고, 한 번
 * 고르면 그 선택이 이긴다).
 *
 * ── 삭제 (관리자 이상) ──────────────────────────────────────────────────
 * 휴지통 → 15일 → 자동 완전삭제. 접수 건 휴지통과 같은 3단계이고, 확인 창과
 * 보존 배지도 같은 부품을 쓴다(master-data-trash-dialogs.tsx). 이 화면이
 * 따로 갖는 것은 두 가지다:
 *
 *  1. **접수 건이 걸린 고객사는 고를 수조차 없다.** 체크박스가 비활성이고
 *     이유가 tooltip에 붙는다. 서버도 같은 규칙으로 다시 막지만
 *     (customers-trash.ts), 고를 수 있게 해 놓고 나중에 거절하는 것은
 *     "왜 안 되는지"를 한 번 더 눌러 봐야 알게 만드는 일이다.
 *     목록의 접수 건수는 **활성 접수 건만** 센다 — 휴지통에 있는 접수 건
 *     때문에 0으로 보이는 행이 서버에서 거절될 수는 있고, 그때는 창에 그
 *     이유가 그대로 나온다.
 *  2. **End-User는 고객사를 따라간다.** 삭제·복원·완전삭제 모두 아래
 *     End-User와 담당자를 함께 옮긴다. 그 사실을 확인 창에서 먼저 말한다.
 *
 * canDelete가 false면 탭도, 삭제 모드 버튼도, 체크박스도 없다 — 이 화면은
 * 그 전과 완전히 같아진다. 물론 그것이 경계는 아니다: 서버 액션이 세션과
 * 권한을 독립적으로 다시 본다.
 */
export default function CustomerListScreen({
  rows,
  trashRows = [],
  canDelete = false,
}: {
  rows: CustomerListRow[];
  /** 휴지통 행. canDelete인 세션에서만 서버가 채워 넘긴다. */
  trashRows?: DeletedCustomerRow[];
  canDelete?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(() => rankSimilarNames(query, rows), [query, rows]);

  function leaveDeleteMode() {
    setIsDeleteMode(false);
    setSelectedIds(new Set());
  }

  const trash = useMasterDataTrash({
    onDelete: deleteCustomersAction,
    onRestore: restoreCustomersAction,
    onPermanentDelete: permanentlyDeleteCustomersAction,
    onAllSucceeded: () => {
      leaveDeleteMode();
      setTrashSelectedIds(new Set());
    },
  });

  // 접수 건이 걸린 고객사는 지울 수 없다 — FK가 막고, 서버가 막고, 여기서는
  // 고르지 못하게 한다(파일 상단 주석 1번).
  function isDeletable(row: CustomerListRow): boolean {
    return row.repairCaseCount === 0;
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTrashSelected(id: string) {
    setTrashSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 지금 화면에 보이는(검색으로 걸러진) 행 중 고를 수 있는 것만이 전체 선택의
  // 대상이다 — 접수 건이 걸린 고객사는 여기서도 빠진다.
  const selectableVisibleIds = useMemo(
    () => filteredRows.filter((row) => row.repairCaseCount === 0).map((row) => row.id),
    [filteredRows]
  );
  const selectedVisibleCount = selectableVisibleIds.filter((id) => selectedIds.has(id)).length;

  function toggleSelectAllVisible(nextChecked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      // 해제는 보이는 것만 푼다 — 검색어 밖에서 골라 둔 것은 건드리지 않는다.
      for (const id of selectableVisibleIds) {
        if (nextChecked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function targetsFromActive(ids: Iterable<string>): MasterDataTrashTarget[] {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return [...ids]
      .map((id) => byId.get(id))
      .filter((row): row is CustomerListRow => row !== undefined)
      .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt, name: row.name }));
  }

  function targetsFromTrash(ids: Iterable<string>): MasterDataTrashTarget[] {
    const byId = new Map(trashRows.map((row) => [row.id, row]));
    return [...ids]
      .map((id) => byId.get(id))
      .filter((row): row is DeletedCustomerRow => row !== undefined)
      .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt, name: row.name }));
  }

  const selectedCount = selectedIds.size;
  const trashSelectedCount = trashSelectedIds.size;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">고객사 관리</h1>
        {canDelete && activeTab === "active" && !isDeleteMode && (
          <button
            type="button"
            onClick={() => setIsDeleteMode(true)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            삭제 모드
          </button>
        )}
      </div>

      {/* 탭 자체가 삭제 권한이 있는 세션에만 그려진다 — 볼 수 없는 휴지통의
          존재를 알릴 이유가 없다. */}
      {canDelete && (
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab("active")}
            className={
              activeTab === "active"
                ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }
          >
            사용중 ({rows.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("trash");
              leaveDeleteMode();
            }}
            className={
              activeTab === "trash"
                ? "-mb-px border-b-2 border-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                : "-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }
          >
            휴지통 ({trashRows.length})
          </button>
        </div>
      )}

      {activeTab === "active" ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            <span className="sr-only">고객사 검색</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="고객사명 검색"
              className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
            조건에 맞는 고객사 {filteredRows.length}건
          </p>

          {/* 삭제 모드 바는 아무것도 고르지 않았을 때도 계속 보인다 —
              나가는 문(취소)이 선택 여부에 따라 사라지면 안 된다. 휴지통 탭의
              선택 바(MasterDataSelectionBar)가 0건에서 사라지는 것과 다른 이유다:
              그쪽에는 나가야 할 모드 자체가 없다. */}
          {isDeleteMode && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950">
                <span className="text-sm font-medium text-red-800 dark:text-red-300">
                  삭제 모드 — {selectedCount}개 선택됨
                </span>
                {/* 카드 보기에는 표 머리글이 없으므로 전체 선택이 여기에도
                    있어야 한다. 표/카드 중 무엇이 보이는지는 ResponsiveList가
                    안에서 정하므로 화면 쪽에서는 알 수 없다. */}
                <SelectAllCheckbox
                  selectableCount={selectableVisibleIds.length}
                  selectedCount={selectedVisibleCount}
                  onChange={toggleSelectAllVisible}
                  label="전체 선택"
                />
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={leaveDeleteMode}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => trash.open("DELETE", targetsFromActive(selectedIds))}
                    disabled={selectedCount === 0}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    선택 삭제
                  </button>
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                A/S 접수 건이 연결된 고객사는 선택할 수 없습니다. 삭제해도 15일 동안은 휴지통에서 복원할 수 있습니다.
              </p>
            </div>
          )}

          {filteredRows.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {rows.length === 0 ? "등록된 고객사가 없습니다." : "검색 조건에 맞는 고객사가 없습니다."}
            </div>
          ) : (
            <ResponsiveList
              listId="customers"
              measureKey={[filteredRows.length, isDeleteMode]}
              table={
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-white text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                      {isDeleteMode && (
                        <th className="w-10 px-3 py-2">
                          <SelectAllCheckbox
                            selectableCount={selectableVisibleIds.length}
                            selectedCount={selectedVisibleCount}
                            onChange={toggleSelectAllVisible}
                            ariaLabel="고객사 전체 선택"
                          />
                        </th>
                      )}
                      <th className="px-3 py-2">고객사명</th>
                      <th className="px-3 py-2">End-User 수</th>
                      <th className="px-3 py-2">A/S 접수 건수</th>
                      <th className="px-3 py-2">등록일</th>
                      <th className="px-3 py-2">상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                      >
                        {isDeleteMode && (
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(row.id)}
                              disabled={!isDeletable(row)}
                              onChange={() => toggleSelected(row.id)}
                              aria-label={`${row.name} 선택`}
                              title={
                                isDeletable(row)
                                  ? undefined
                                  : `연결된 A/S 접수 건이 ${row.repairCaseCount}건 있어 삭제할 수 없습니다`
                              }
                              className="disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 font-medium whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                          {row.name}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.endUserCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.repairCaseCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.createdAt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link
                            href={`/customers/${row.id}`}
                            className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                          >
                            상세
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
              cards={
                <div className={LIST_CARD_GRID}>
                  {filteredRows.map((row) =>
                    isDeleteMode ? (
                      // 삭제 모드에서는 카드가 링크가 아니다 — 고르려고 누른
                      // 손가락이 상세 화면으로 넘어가 버리면 안 된다.
                      <label
                        key={row.id}
                        className={`flex flex-col gap-2 rounded-lg border p-4 ${
                          isDeletable(row)
                            ? "cursor-pointer border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                            : "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                        title={
                          isDeletable(row)
                            ? undefined
                            : `연결된 A/S 접수 건이 ${row.repairCaseCount}건 있어 삭제할 수 없습니다`
                        }
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            disabled={!isDeletable(row)}
                            onChange={() => toggleSelected(row.id)}
                            className="disabled:cursor-not-allowed"
                          />
                          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.name}</span>
                        </span>
                        <CustomerCardFields row={row} />
                      </label>
                    ) : (
                      <Link
                        key={row.id}
                        href={`/customers/${row.id}`}
                        className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                      >
                        <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.name}</span>
                        <CustomerCardFields row={row} />
                      </Link>
                    )
                  )}
                </div>
              }
            />
          )}
        </>
      ) : (
        <CustomerTrashTab
          rows={trashRows}
          selectedIds={trashSelectedIds}
          onToggleSelected={toggleTrashSelected}
          // 휴지통은 검색도 페이지 나눔도 없으므로 '보이는 것'이 곧 전부다.
          onToggleSelectAll={(nextChecked) =>
            setTrashSelectedIds(nextChecked ? new Set(trashRows.map((row) => row.id)) : new Set())
          }
          onClearSelection={() => setTrashSelectedIds(new Set())}
          onRequestRestore={(ids) => trash.open("RESTORE", targetsFromTrash(ids))}
          onRequestPermanentDelete={(ids) => trash.open("PERMANENT_DELETE", targetsFromTrash(ids))}
          selectedCount={trashSelectedCount}
        />
      )}

      <MasterDataDeleteDialog
        isOpen={trash.kind === "DELETE"}
        entityLabel="고객사"
        names={trash.names}
        cascadeNote={
          <>
            해당 고객사에 등록된 End-User와 담당자 정보도 함께 휴지통으로 갑니다. 복원하면 같이 돌아옵니다.
          </>
        }
        reason={trash.reason}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onReasonChange={trash.setReason}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataRestoreDialog
        isOpen={trash.kind === "RESTORE"}
        entityLabel="고객사"
        names={trash.names}
        cascadeNote={<>함께 삭제됐던 End-User와 담당자 정보도 같이 돌아옵니다.</>}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataPermanentDeleteDialog
        isOpen={trash.kind === "PERMANENT_DELETE"}
        entityLabel="고객사"
        names={trash.names}
        cascadeNote={
          <>고객사와 함께 그 아래 End-User·담당자 정보가 데이터베이스에서 완전히 제거됩니다.</>
        }
        reason={trash.reason}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onReasonChange={trash.setReason}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />
    </div>
  );
}

/** 카드 본문. 링크 카드와 삭제 모드 카드가 같은 내용을 보여 주도록 한 곳에 둔다. */
function CustomerCardFields({ row }: { row: CustomerListRow }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">End-User 수</dt>
        <dd>{row.endUserCount}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">A/S 접수 건수</dt>
        <dd>{row.repairCaseCount}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">등록일</dt>
        <dd>{formatDate(row.createdAt)}</dd>
      </div>
    </dl>
  );
}

/**
 * 휴지통 탭. 체크박스가 늘 보인다 — 여기에는 들어오고 나가는 '모드'가
 * 없고, 할 수 있는 일이 복원과 완전 삭제뿐이다(접수 건 휴지통과 같은 판단).
 */
function CustomerTrashTab({
  rows,
  selectedIds,
  selectedCount,
  onToggleSelected,
  onToggleSelectAll,
  onClearSelection,
  onRequestRestore,
  onRequestPermanentDelete,
}: {
  rows: DeletedCustomerRow[];
  selectedIds: Set<string>;
  selectedCount: number;
  onToggleSelected: (id: string) => void;
  onToggleSelectAll: (nextChecked: boolean) => void;
  onClearSelection: () => void;
  onRequestRestore: (ids: string[]) => void;
  onRequestPermanentDelete: (ids: string[]) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        휴지통이 비어 있습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 선택 바는 0건일 때 사라지므로, 카드 보기에서도 늘 닿을 수 있는
          전체 선택은 여기(항상 보이는 줄)에 둔다. */}
      <div className="flex flex-wrap items-center gap-3">
        <SelectAllCheckbox
          selectableCount={rows.length}
          selectedCount={selectedCount}
          onChange={onToggleSelectAll}
          label="전체 선택"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          삭제한 지 15일이 지나면 자동으로 완전히 삭제됩니다. 그 전에는 언제든 복원할 수 있습니다.
        </p>
      </div>

      <MasterDataSelectionBar selectedCount={selectedCount} tone="info" onClearSelection={onClearSelection}>
        <button
          type="button"
          onClick={() => onRequestRestore([...selectedIds])}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          선택 복원
        </button>
        <button
          type="button"
          onClick={() => onRequestPermanentDelete([...selectedIds])}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          선택 완전 삭제
        </button>
      </MasterDataSelectionBar>

      <ResponsiveList
        listId="customers-trash"
        measureKey={[rows.length]}
        table={
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-white text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <th className="w-10 px-3 py-2">
                  <SelectAllCheckbox
                    selectableCount={rows.length}
                    selectedCount={selectedCount}
                    onChange={onToggleSelectAll}
                    ariaLabel="휴지통 전체 선택"
                  />
                </th>
                <th className="px-3 py-2">고객사명</th>
                <th className="px-3 py-2">End-User 수</th>
                <th className="px-3 py-2">삭제일</th>
                <th className="px-3 py-2">삭제자</th>
                <th className="px-3 py-2">삭제 사유</th>
                <th className="px-3 py-2">보존</th>
                <th className="px-3 py-2">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => onToggleSelected(row.id)}
                      aria-label={`${row.name} 선택`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                    {row.name}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.endUserCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.deletedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.deletedByUserName ?? "-"}</td>
                  <td className="px-3 py-2">{row.deleteReason ?? "-"}</td>
                  <td className="px-3 py-2">
                    <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onRequestRestore([row.id])}
                        className="text-sm text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
                      >
                        복원
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestPermanentDelete([row.id])}
                        className="text-sm text-red-700 underline-offset-2 hover:underline dark:text-red-400"
                      >
                        완전 삭제
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
        cards={
          <div className={LIST_CARD_GRID}>
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => onToggleSelected(row.id)}
                  />
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.name}</span>
                  <span className="ml-auto">
                    <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />
                  </span>
                </label>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">End-User 수</dt>
                    <dd>{row.endUserCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제일</dt>
                    <dd>{formatDate(row.deletedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제자</dt>
                    <dd>{row.deletedByUserName ?? "-"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제 사유</dt>
                    <dd className="break-all">{row.deleteReason ?? "-"}</dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onRequestRestore([row.id])}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    복원
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestPermanentDelete([row.id])}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    완전 삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        }
      />
    </div>
  );
}
