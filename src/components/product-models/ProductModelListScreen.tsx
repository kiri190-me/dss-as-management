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
  deleteProductModelsAction,
  permanentlyDeleteProductModelsAction,
  restoreProductModelsAction,
} from "@/lib/server/actions/product-model-trash";
import Link from "next/link";
import type { DeletedProductModelRow, ProductModelListRow } from "@/lib/db/queries/product-models";

const KIND_LABELS: Record<string, string> = {
  GENERATOR: "Generator",
  MATCHER: "Matcher",
  TOTAL_CONTROLLER: "Total Controller (T/C)",
};

function kindLabel(kind: string | null): string {
  return kind ? (KIND_LABELS[kind] ?? kind) : "미지정";
}

/**
 * 이 모델에 붙은 고객사를 한 줄로. 하나도 없으면 `-` — 다른 칸들과 같은 규칙이다.
 * (같은 함수가 ProductModelDetailScreen 에도 있다. kindLabel 처럼 한 줄짜리라
 * 두 화면이 각자 들고 있는 것이 이 저장소의 모양이다.)
 */
function customerNames(list: readonly { name: string }[]): string {
  return list.length === 0 ? "-" : list.map((c) => c.name).join(", ");
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * /product-models list — 실제 product_models 마스터 테이블(마이그레이션
 * 0030)에서 온다. 모든 집계는 product_model_id 연결을 따르고, 검색은 예전
 * 그대로 modelName의 대소문자 구분 부분 문자열 일치다(정규화 검색은 이
 * 화면의 승인된 범위가 아니다).
 *
 * 표/카드 전환은 ResponsiveList가 정한다.
 *
 * ── 삭제 (관리자 이상) ──────────────────────────────────────────────────
 * 고객사 관리와 **같은 규칙, 같은 부품**이다: 휴지통 → 15일 → 자동 완전삭제,
 * 같은 확인 창(master-data-trash-dialogs.tsx), 같은 보존 배지, 같은 훅.
 * 이 화면만의 차이는 두 가지다.
 *
 *  1. **접수 건이 걸린 모델은 고를 수 없다.** 여기서 세는 접수 건은 "이
 *     모델로 등록된 장비에 걸린 접수 건"이다 — 모델은 접수 건을 직접
 *     참조하지 않고 장비를 통해 이어져 있다. 서버도 같은 기준으로 다시
 *     막는다(product-models-trash.ts).
 *  2. **등록 장비가 모델을 따라간다.** 고객사에서 End-User가 딸려 가는 것과
 *     같은 결정이다. 확인 창에서 그 사실을 먼저 말한다.
 */
export default function ProductModelListScreen({
  rows,
  trashRows = [],
  canDelete = false,
}: {
  rows: ProductModelListRow[];
  /** 휴지통 행. canDelete인 세션에서만 서버가 채워 넘긴다. */
  trashRows?: DeletedProductModelRow[];
  canDelete?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());

  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter((row) => row.modelName.includes(query));
  }, [query, rows]);

  function leaveDeleteMode() {
    setIsDeleteMode(false);
    setSelectedIds(new Set());
  }

  const trash = useMasterDataTrash({
    onDelete: deleteProductModelsAction,
    onRestore: restoreProductModelsAction,
    onPermanentDelete: permanentlyDeleteProductModelsAction,
    onAllSucceeded: () => {
      leaveDeleteMode();
      setTrashSelectedIds(new Set());
    },
  });

  function isDeletable(row: ProductModelListRow): boolean {
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
  // 대상이다 — 접수 건이 걸린 모델은 여기서도 빠진다.
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
      .filter((row): row is ProductModelListRow => row !== undefined)
      .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt, name: row.modelName }));
  }

  function targetsFromTrash(ids: Iterable<string>): MasterDataTrashTarget[] {
    const byId = new Map(trashRows.map((row) => [row.id, row]));
    return [...ids]
      .map((id) => byId.get(id))
      .filter((row): row is DeletedProductModelRow => row !== undefined)
      .map((row) => ({ id: row.id, expectedUpdatedAt: row.updatedAt, name: row.modelName }));
  }

  const selectedCount = selectedIds.size;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">제품 모델 관리</h1>
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
            <span className="sr-only">모델명 검색</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="모델명 검색"
              className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <p aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">
            조건에 맞는 모델 {filteredRows.length}건
          </p>

          {/* 고객사 화면과 같은 이유로 선택 여부와 무관하게 계속 보인다 —
              나가는 문이 사라지면 안 된다. */}
          {isDeleteMode && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950">
                <span className="text-sm font-medium text-red-800 dark:text-red-300">
                  삭제 모드 — {selectedCount}개 선택됨
                </span>
                {/* 카드 보기에는 표 머리글이 없으므로 전체 선택이 여기에도
                    있어야 한다(고객사 화면과 같은 이유). */}
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
                A/S 접수 건이 연결된 모델은 선택할 수 없습니다. 삭제해도 15일 동안은 휴지통에서 복원할 수 있습니다.
              </p>
            </div>
          )}

          {filteredRows.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {rows.length === 0 ? "등록된 제품 모델이 없습니다." : "검색 조건에 맞는 모델이 없습니다."}
            </div>
          ) : (
            <ResponsiveList
              listId="product-models"
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
                            ariaLabel="제품 모델 전체 선택"
                          />
                        </th>
                      )}
                      <th className="px-3 py-2">모델명</th>
                      <th className="px-3 py-2">제품 종류</th>
                      <th className="px-3 py-2">고객사</th>
                      <th className="px-3 py-2">등록 장비 수</th>
                      <th className="px-3 py-2">A/S 접수 건수</th>
                      <th className="px-3 py-2">최근 입고일</th>
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
                              aria-label={`${row.modelName} 선택`}
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
                          {row.modelName}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{kindLabel(row.kind)}</td>
                        {/* 🔴 이 칸만 whitespace-nowrap 이 없다. 고객사는 한
                            모델에 여럿 붙고(실측 최대 4곳) 이름도 짧지 않아,
                            다른 칸처럼 한 줄로 묶으면 이 한 칸이 표 전체를 옆으로
                            늘린다. 이 목록은 ResponsiveList 로 감싸여 있어 표가
                            넘치면 카드로 바뀌므로, 그대로 두면 화면이 넓어도 늘
                            카드로 떨어진다 — 그것도 고장이다.
                            그래서 줄바꿈을 허용하고 폭 상한을 둔다. 상한을 <td>
                            가 아니라 안쪽 블록에 거는 것은 table-layout:auto 에서
                            브라우저가 셀의 max-width 를 지키지 않기 때문이다. */}
                        <td className="px-3 py-2">
                          <span className="block max-w-[14rem] break-words">
                            {customerNames(row.customers)}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.unitCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{row.repairCaseCount}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(row.lastReceivedAt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link
                            href={`/product-models/${row.id}`}
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
                          <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.modelName}</span>
                        </span>
                        <ProductModelCardFields row={row} />
                      </label>
                    ) : (
                      <Link
                        key={row.id}
                        href={`/product-models/${row.id}`}
                        className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                      >
                        <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.modelName}</span>
                        <ProductModelCardFields row={row} />
                      </Link>
                    )
                  )}
                </div>
              }
            />
          )}
        </>
      ) : (
        <ProductModelTrashTab
          rows={trashRows}
          selectedIds={trashSelectedIds}
          selectedCount={trashSelectedIds.size}
          onToggleSelected={toggleTrashSelected}
          // 휴지통은 검색도 페이지 나눔도 없으므로 '보이는 것'이 곧 전부다.
          onToggleSelectAll={(nextChecked) =>
            setTrashSelectedIds(nextChecked ? new Set(trashRows.map((row) => row.id)) : new Set())
          }
          onClearSelection={() => setTrashSelectedIds(new Set())}
          onRequestRestore={(ids) => trash.open("RESTORE", targetsFromTrash(ids))}
          onRequestPermanentDelete={(ids) => trash.open("PERMANENT_DELETE", targetsFromTrash(ids))}
        />
      )}

      <MasterDataDeleteDialog
        isOpen={trash.kind === "DELETE"}
        entityLabel="제품 모델"
        names={trash.names}
        cascadeNote={<>해당 모델로 등록된 장비도 함께 휴지통으로 갑니다. 복원하면 같이 돌아옵니다.</>}
        reason={trash.reason}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onReasonChange={trash.setReason}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataRestoreDialog
        isOpen={trash.kind === "RESTORE"}
        entityLabel="제품 모델"
        names={trash.names}
        cascadeNote={<>함께 삭제됐던 등록 장비도 같이 돌아옵니다.</>}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataPermanentDeleteDialog
        isOpen={trash.kind === "PERMANENT_DELETE"}
        entityLabel="제품 모델"
        names={trash.names}
        cascadeNote={<>모델과 함께 그 모델로 등록된 장비가 데이터베이스에서 완전히 제거됩니다.</>}
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
function ProductModelCardFields({ row }: { row: ProductModelListRow }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">제품 종류</dt>
        <dd>{kindLabel(row.kind)}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">고객사</dt>
        {/* 카드는 폭이 정해져 있어 늘어날 데가 없다 — 줄바꿈만 허용하면 된다. */}
        <dd className="break-words">{customerNames(row.customers)}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">등록 장비 수</dt>
        <dd>{row.unitCount}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">A/S 접수 건수</dt>
        <dd>{row.repairCaseCount}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500 dark:text-zinc-500">최근 입고일</dt>
        <dd>{formatDate(row.lastReceivedAt)}</dd>
      </div>
    </dl>
  );
}

/** 휴지통 탭. 고객사 휴지통과 같은 구성 — 여기에는 드나드는 '모드'가 없다. */
function ProductModelTrashTab({
  rows,
  selectedIds,
  selectedCount,
  onToggleSelected,
  onToggleSelectAll,
  onClearSelection,
  onRequestRestore,
  onRequestPermanentDelete,
}: {
  rows: DeletedProductModelRow[];
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
        listId="product-models-trash"
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
                <th className="px-3 py-2">모델명</th>
                <th className="px-3 py-2">제품 종류</th>
                <th className="px-3 py-2">등록 장비 수</th>
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
                      aria-label={`${row.modelName} 선택`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap text-zinc-900 dark:text-zinc-50">
                    {row.modelName}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{kindLabel(row.kind)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.unitCount}</td>
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
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.modelName}</span>
                  <span className="ml-auto">
                    <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />
                  </span>
                </label>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">제품 종류</dt>
                    <dd>{kindLabel(row.kind)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">등록 장비 수</dt>
                    <dd>{row.unitCount}</dd>
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
