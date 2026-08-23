"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PartCreateDialog from "./PartCreateDialog";
import InventoryTabs from "./InventoryTabs";
import type { PartListRow } from "@/lib/db/queries/inventory";
import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";
import type { InventoryCapabilities } from "@/lib/auth/inventory-capabilities";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import SelectAllCheckbox from "@/components/common/select-all-checkbox";
import MasterDataTrashRetentionBadge from "@/components/common/master-data-trash-retention-badge";
import {
  MasterDataDeleteDialog,
  MasterDataPermanentDeleteDialog,
  MasterDataRestoreDialog,
  MasterDataSelectionBar,
} from "@/components/common/master-data-trash-dialogs";
import { useMasterDataTrash, type MasterDataTrashTarget } from "@/lib/hooks/useMasterDataTrash";
import {
  deletePartsAction,
  permanentlyDeletePartsAction,
  restorePartsAction,
  type PartTrashItem,
} from "@/lib/server/actions/inventory-trash";
import type { DeletedPartRow } from "@/lib/db/queries/inventory";

/* 역할 규칙의 로컬 사본이 여기 있었다. 서버가 설정까지 반영해 해석한 결과를
   capabilities로 내려보내므로 더는 필요 없다 — 사본이 남아 있으면 관리자가
   열어 준 권한이 버튼에는 반영되지 않는다. */

type OwnerAvailability = Record<string, Partial<Record<StockOwner, number>>>;

/**
 * Excel-like 부품 재고 list — client-side search/filter over the full
 * server-fetched list (the real workbook audit found a small real catalog,
 * so a single round-trip + in-memory filter keeps this simple and instant,
 * matching the requested "Excel-like table" feel more directly than
 * per-keystroke server queries would).
 *
 * ── 보기 방식이 둘인 이유 ───────────────────────────────────────────────
 * 표에서는 소유 구분 네 칸이 마지막 열 하나에 작은 배지로 우겨넣어져 있어서,
 * "교산 재고가 몇 개인가"를 보려면 눈을 가늘게 떠야 했다. 카드에서는 각 구분에
 * 자기 자리를 준다.
 *
 * 그래도 표를 남긴 것은, 부품이 수백 개로 늘면 카드가 세로로 길어져 훑기가
 * 어려워지기 때문이다. 둘 중 무엇이 맞는지는 그날 무엇을 찾느냐에 달렸다.
 */
export default function InventoryListScreen({
  parts,
  ownerAvailabilityByPartId,
  categories,
  itemTypes,
  capabilities,
  trashParts = [],
}: {
  parts: PartListRow[];
  /** 소유구분별 재고 수량 checkpoint — grouped (part, owner) sum of part_stock_balances.current_quantity, same aggregate totalQuantity already uses. A missing (partId, owner) entry means 0, never "unknown". */
  ownerAvailabilityByPartId: OwnerAvailability;
  categories: string[];
  itemTypes: string[];
  capabilities: InventoryCapabilities;
  /** 휴지통 행. capabilities.lifecycle인 세션에서만 서버가 채워 넘긴다. */
  trashParts?: DeletedPartRow[];
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return parts.filter((p) => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!term) return true;
      return (
        p.partName.toLowerCase().includes(term) ||
        (p.partSpec ?? "").toLowerCase().includes(term) ||
        (p.drawingNo ?? "").toLowerCase().includes(term) ||
        (p.kyosanPartNo ?? "").toLowerCase().includes(term)
      );
    });
  }, [parts, search, categoryFilter]);

  const canCreate = capabilities.parts;
  const canDelete = capabilities.lifecycle;

  function leaveDeleteMode() {
    setIsDeleteMode(false);
    setSelectedIds(new Set());
  }

  const trash = useMasterDataTrash<PartTrashItem>({
    onDelete: deletePartsAction,
    onRestore: restorePartsAction,
    onPermanentDelete: permanentlyDeletePartsAction,
    onAllSucceeded: () => {
      leaveDeleteMode();
      setTrashSelectedIds(new Set());
    },
  });

  // 입출고 이력·부품 요청이 걸린 부품은 지울 수 없다 — 서버도 같은 기준으로
  // 다시 막지만(inventory.ts의 softDeletePart), 고를 수 있게 해 놓고 나중에
  // 거절하는 것은 "왜 안 되는지"를 한 번 더 눌러 봐야 알게 만드는 일이다.
  const selectableVisibleIds = useMemo(
    () => filtered.filter((p) => !p.hasLedgerHistory).map((p) => p.id),
    [filtered]
  );
  const selectedVisibleCount = selectableVisibleIds.filter((id) => selectedIds.has(id)).length;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible(nextChecked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      // 해제는 보이는 것만 푼다 — 검색·분류 밖에서 골라 둔 것은 건드리지 않는다.
      for (const id of selectableVisibleIds) {
        if (nextChecked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function targetsFromActive(ids: Iterable<string>): MasterDataTrashTarget<PartTrashItem>[] {
    const byId = new Map(parts.map((p) => [p.id, p]));
    return [...ids]
      .map((id) => byId.get(id))
      .filter((p): p is PartListRow => p !== undefined)
      .map((p) => ({ id: p.id, expectedVersion: p.version, name: p.partName }));
  }

  function targetsFromTrash(ids: Iterable<string>): MasterDataTrashTarget<PartTrashItem>[] {
    const byId = new Map(trashParts.map((p) => [p.id, p]));
    return [...ids]
      .map((id) => byId.get(id))
      .filter((p): p is DeletedPartRow => p !== undefined)
      .map((p) => ({ id: p.id, expectedVersion: p.version, name: p.partName }));
  }

  return (
    <div className="flex flex-col gap-4">
      {capabilities.requestProcessing && <InventoryTabs active="LIST" />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">재고 관리</h1>
        <div className="flex items-center gap-2">
          {canDelete && activeTab === "active" && !isDeleteMode && (
            <button
              type="button"
              onClick={() => setIsDeleteMode(true)}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              삭제 모드
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              새 부품 등록
            </button>
          )}
        </div>
      </div>

      {/* 사용중 / 휴지통 — 삭제 권한이 있는 세션에만 그려진다. 위쪽
          InventoryTabs(재고 목록 / 부품 요청 관리)는 재고 영역 안의 다른 화면으로
          가는 길이고, 이 줄은 같은 화면 안에서 무엇을 보는지를 가른다. */}
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
            사용중 ({parts.length})
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
            휴지통 ({trashParts.length})
          </button>
        </div>
      )}

      {activeTab === "trash" ? (
        <>
          <PartTrashTab
            rows={trashParts}
            selectedIds={trashSelectedIds}
            onToggleSelected={(id) =>
              setTrashSelectedIds((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            // 휴지통은 검색도 페이지 나눔도 없으므로 '보이는 것'이 곧 전부다.
            onToggleSelectAll={(nextChecked) =>
              setTrashSelectedIds(nextChecked ? new Set(trashParts.map((p) => p.id)) : new Set())
            }
            onClearSelection={() => setTrashSelectedIds(new Set())}
            onRequestRestore={(ids) => trash.open("RESTORE", targetsFromTrash(ids))}
            onRequestPermanentDelete={(ids) => trash.open("PERMANENT_DELETE", targetsFromTrash(ids))}
          />

          <TrashDialogs trash={trash} />
        </>
      ) : (
      <>
      {/* 삭제 모드 바는 아무것도 고르지 않았을 때도 계속 보인다 — 나가는
          문(취소)이 선택 여부에 따라 사라지면 안 된다. */}
      {isDeleteMode && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950">
            <span className="text-sm font-medium text-red-800 dark:text-red-300">
              삭제 모드 — {selectedIds.size}개 선택됨
            </span>
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
                disabled={selectedIds.size === 0}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                선택 삭제
              </button>
            </div>
          </div>
          {/* ── 왜 고를 수 없는지를 먼저 말한다 ─────────────────────────────
              이 시스템의 부품은 입고를 거쳐 등록되고, 입고는 곧 입출고 이력이다.
              그래서 실데이터에서는 대부분(개발 DB 확인 시 63개 전부)이 삭제
              대상이 아니다. 이유가 체크박스 tooltip에만 있으면 그 화면은
              "고장난 화면"으로 읽힌다 — 눌리지 않는 것과 눌러도 소용없는 것을
              사람이 구분할 방법이 없기 때문이다. 그래서 숫자로 먼저 말한다. */}
          {selectableVisibleIds.length === 0 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              지금 목록에는 삭제할 수 있는 부품이 없습니다 — {filtered.length}개 모두 입출고 이력이나 부품 요청이
              걸려 있습니다. 재고 이력은 회계 기록이라 지우지 않으므로, 이력이 한 번이라도 남은 부품은 삭제할 수
              없습니다. 아직 입고하지 않은 새 부품만 삭제할 수 있습니다.
            </p>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {filtered.length}개 중 <strong className="font-medium text-zinc-700 dark:text-zinc-200">
                {selectableVisibleIds.length}개
              </strong>
              를 삭제할 수 있습니다. 흐리게 표시된 부품은 입출고 이력·부품 요청이 있어 선택할 수 없습니다. 삭제해도
              15일 동안은 휴지통에서 복원할 수 있습니다.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="품명 / 품명2 / 도번 / 교산 품번 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-72 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="">전체 분류</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 px-3 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          검색 결과가 없습니다.
        </p>
      ) : (
        <ResponsiveList
          listId="inventory-parts"
          measureKey={[filtered.length, isDeleteMode]}
          meta={
            <span className="mr-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {filtered.length}건
            </span>
          }
          table={
            <PartTable
              parts={filtered}
              ownerAvailabilityByPartId={ownerAvailabilityByPartId}
              selectionMode={isDeleteMode}
              selectedIds={selectedIds}
              selectableCount={selectableVisibleIds.length}
              selectedVisibleCount={selectedVisibleCount}
              onToggleSelect={toggleSelected}
              onToggleSelectAll={toggleSelectAllVisible}
            />
          }
          cards={
            <ul className={LIST_CARD_GRID}>
              {filtered.map((part) => (
                <PartCard
                  key={part.id}
                  part={part}
                  availability={ownerAvailabilityByPartId[part.id]}
                  selectionMode={isDeleteMode}
                  isSelected={selectedIds.has(part.id)}
                  onToggleSelect={toggleSelected}
                />
              ))}
            </ul>
          }
        />
      )}

      <TrashDialogs trash={trash} />
      </>
      )}

      <PartCreateDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} categorySuggestions={categories} itemTypeSuggestions={itemTypes} />
    </div>
  );
}

/**
 * 삭제·복원·완전삭제 확인 창 묶음. 사용중 탭과 휴지통 탭이 같은 훅 상태를
 * 쓰므로 창도 하나의 묶음으로 둔다 — 탭마다 따로 두면 열려 있는 창이 탭
 * 전환으로 사라지는 길이 생긴다.
 */
function TrashDialogs({ trash }: { trash: ReturnType<typeof useMasterDataTrash<PartTrashItem>> }) {
  return (
    <>
      <MasterDataDeleteDialog
        isOpen={trash.kind === "DELETE"}
        entityLabel="부품"
        names={trash.names}
        cascadeNote={<>입출고 이력이나 부품 요청이 걸린 부품은 삭제할 수 없습니다 — 선택되지 않습니다.</>}
        reason={trash.reason}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onReasonChange={trash.setReason}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataRestoreDialog
        isOpen={trash.kind === "RESTORE"}
        entityLabel="부품"
        names={trash.names}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataPermanentDeleteDialog
        isOpen={trash.kind === "PERMANENT_DELETE"}
        entityLabel="부품"
        names={trash.names}
        cascadeNote={<>부품 마스터가 데이터베이스에서 완전히 제거됩니다. 입출고 이력이 있는 부품은 여기까지 오지 않습니다.</>}
        reason={trash.reason}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onReasonChange={trash.setReason}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />
    </>
  );
}

/** 휴지통 탭. 고객사·제품 모델 휴지통과 같은 구성 — 드나드는 '모드'가 없다. */
function PartTrashTab({
  rows,
  selectedIds,
  onToggleSelected,
  onToggleSelectAll,
  onClearSelection,
  onRequestRestore,
  onRequestPermanentDelete,
}: {
  rows: DeletedPartRow[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleSelectAll: (nextChecked: boolean) => void;
  onClearSelection: () => void;
  onRequestRestore: (ids: string[]) => void;
  onRequestPermanentDelete: (ids: string[]) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 px-3 py-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        휴지통이 비어 있습니다.
      </p>
    );
  }

  const selectedCount = rows.filter((row) => selectedIds.has(row.id)).length;

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
        listId="inventory-parts-trash"
        measureKey={[rows.length]}
        table={
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <SelectAllCheckbox
                    selectableCount={rows.length}
                    selectedCount={selectedCount}
                    onChange={onToggleSelectAll}
                    ariaLabel="휴지통 전체 선택"
                  />
                </th>
                <th scope="col" className="px-3 py-2">품명</th>
                <th scope="col" className="px-3 py-2">품명2</th>
                <th scope="col" className="px-3 py-2">교산 품번</th>
                <th scope="col" className="px-3 py-2">삭제일</th>
                <th scope="col" className="px-3 py-2">삭제자</th>
                <th scope="col" className="px-3 py-2">삭제 사유</th>
                <th scope="col" className="px-3 py-2">보존</th>
                <th scope="col" className="px-3 py-2">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => onToggleSelected(row.id)}
                      aria-label={`${row.partName} 선택`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">{row.partName}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{row.partSpec ?? "-"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{row.kyosanPartNo ?? "-"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{formatTrashDate(row.deletedAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{row.deletedByUserName ?? "-"}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{row.deleteReason ?? "-"}</td>
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
                    className="h-4 w-4"
                  />
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.partName}</span>
                  <span className="ml-auto">
                    <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />
                  </span>
                </label>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">품명2</dt>
                    <dd>{row.partSpec ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">교산 품번</dt>
                    <dd>{row.kyosanPartNo ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제일</dt>
                    <dd>{formatTrashDate(row.deletedAt)}</dd>
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

function formatTrashDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 부품 한 장. 표의 여섯 열이 그대로 들어가되, 수량이 말에 묻히지 않게 아래로 내려온다. */
function PartCard({
  part,
  availability,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  part: PartListRow;
  availability: Partial<Record<StockOwner, number>> | undefined;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const isEmpty = part.totalQuantity === 0;
  // 이력이 걸린 부품은 지울 수 없다 — 고를 수도 없어야 한다(표와 같은 기준).
  const isDeletable = !part.hasLedgerHistory;

  return (
    <li
      className={`flex flex-col rounded-lg border border-zinc-200 bg-white focus-within:ring-2 focus-within:ring-blue-500 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 ${
        // 표의 행과 같은 규칙 — 삭제 모드에서만, 고를 수 없는 것만 흐려진다.
        selectionMode && !isDeletable ? "opacity-50" : ""
      }`}
    >
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          {/* 삭제 모드에서도 품명은 링크로 둔다 — 카드 전체가 아니라 이름만
              링크라, 고르려고 누른 손가락이 상세로 넘어갈 일이 없다. */}
          <span className="flex items-center gap-2">
            {selectionMode && (
              <input
                type="checkbox"
                checked={isSelected}
                disabled={!isDeletable}
                onChange={() => onToggleSelect?.(part.id)}
                aria-label={
                  isDeletable
                    ? `${part.partName} 선택`
                    : `${part.partName} — 입출고 이력·부품 요청이 있어 삭제할 수 없습니다`
                }
                title={isDeletable ? undefined : "입출고 이력·부품 요청이 있어 삭제할 수 없습니다"}
                className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
              />
            )}
            <Link
              href={`/inventory/${part.id}`}
              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
            >
              {part.partName}
            </Link>
          </span>
          {part.category && (
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {part.category}
            </span>
          )}
        </div>

        {part.partSpec && (
          <p className="text-xs text-zinc-600 dark:text-zinc-300">{part.partSpec}</p>
        )}

        <dl className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <div className="flex gap-1">
            <dt>교산</dt>
            <dd className="tabular-nums text-zinc-600 dark:text-zinc-300">{part.kyosanPartNo ?? "-"}</dd>
          </div>
          <div className="flex gap-1">
            <dt>도번</dt>
            <dd className="tabular-nums text-zinc-600 dark:text-zinc-300">{part.drawingNo ?? "-"}</dd>
          </div>
        </dl>
      </div>

      {/* 수량 구역 — 이 화면을 고친 이유가 여기다. */}
      <div className="mt-auto border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">총 재고</span>
          <span
            className={`text-xl font-semibold tabular-nums ${
              isEmpty ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-900 dark:text-zinc-50"
            }`}
          >
            {part.totalQuantity}
          </span>
        </div>

        <dl className="mt-2 grid grid-cols-2 gap-1">
          {STOCK_OWNER_CODES.map((owner) => {
            const quantity = availability?.[owner] ?? 0;
            const isZero = quantity === 0;
            return (
              <div
                key={owner}
                className={`flex items-baseline justify-between rounded px-2 py-1 ${
                  isZero ? "bg-zinc-50 dark:bg-zinc-900" : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                <dt
                  className={`text-[11px] ${
                    isZero ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {stockOwnerLabels[owner]}
                </dt>
                {/* 0을 흐리게 두는 것이 핵심이다 — 재고가 있는 구분만 눈에 들어온다. */}
                <dd
                  className={`text-sm tabular-nums ${
                    isZero
                      ? "text-zinc-400 dark:text-zinc-600"
                      : "font-medium text-zinc-900 dark:text-zinc-50"
                  }`}
                >
                  {quantity}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </li>
  );
}

/**
 * 부품이 많을 때 훑는 용도.
 *
 * ── 소유 구분에 열을 하나씩 준다 ────────────────────────────────────────
 * 전에는 네 구분이 마지막 열 하나에 작은 배지로 들어가 있었다. 그러면 "교산
 * 재고가 있는 부품만 보자"처럼 한 구분을 세로로 훑는 일이 불가능하다 — 값이
 * 줄마다 다른 가로 위치에 있기 때문이다. 표에서 그 일을 할 수 있게 하는 것은
 * 열뿐이라, 구분마다 열을 준다.
 *
 * 머리글을 두 줄로 묶어 네 열이 한 덩어리임을 보인다. 그 덕에 화면 아래 있던
 * 범례도 없앴다 — 열 이름이 곧 범례다.
 */
function PartTable({
  parts,
  ownerAvailabilityByPartId,
  selectionMode = false,
  selectedIds,
  selectableCount = 0,
  selectedVisibleCount = 0,
  onToggleSelect,
  onToggleSelectAll,
}: {
  parts: PartListRow[];
  ownerAvailabilityByPartId: OwnerAvailability;
  /**
   * 삭제 모드 선택 — 전부 선택 사항이라 이 표를 쓰는 다른 화면은 예전과
   * 똑같이 그려진다(RepairCaseTable이 같은 방식을 쓴다). 머리글이 두 줄로
   * 묶여 있어 체크박스 열은 rowSpan={2}여야 한다.
   */
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  selectableCount?: number;
  selectedVisibleCount?: number;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: (nextChecked: boolean) => void;
}) {
  return (
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {selectionMode && (
              <th scope="col" rowSpan={2} className="w-10 px-3 py-2 align-bottom">
                {onToggleSelectAll ? (
                  <SelectAllCheckbox
                    selectableCount={selectableCount}
                    selectedCount={selectedVisibleCount}
                    onChange={onToggleSelectAll}
                    ariaLabel="부품 전체 선택"
                  />
                ) : (
                  <span className="sr-only">선택</span>
                )}
              </th>
            )}
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">품명</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">품명2</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">교산 품번</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">도번</th>
            <th scope="col" rowSpan={2} className="px-3 py-2 align-bottom">분류</th>
            <th
              scope="colgroup"
              colSpan={STOCK_OWNER_CODES.length}
              className="border-l border-zinc-200 px-3 pt-2 pb-0.5 text-center dark:border-zinc-800"
            >
              소유 구분
            </th>
            <th
              scope="col"
              rowSpan={2}
              className="border-l border-zinc-200 px-3 py-2 text-right align-bottom dark:border-zinc-800"
            >
              총 재고
            </th>
          </tr>
          <tr>
            {STOCK_OWNER_CODES.map((owner, index) => (
              <th
                key={owner}
                scope="col"
                className={`px-3 pb-2 text-right font-normal ${
                  index === 0 ? "border-l border-zinc-200 dark:border-zinc-800" : ""
                }`}
              >
                {stockOwnerLabels[owner]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr
              key={p.id}
              className={`border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 ${
                // 삭제 모드에서만 흐려진다 — 평소에는 모든 부품이 똑같이
                // 정상이고, 이력 유무는 그때 볼 정보가 아니다.
                selectionMode && p.hasLedgerHistory ? "opacity-50" : ""
              }`}
            >
              {selectionMode && (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds?.has(p.id) ?? false}
                    disabled={p.hasLedgerHistory}
                    onChange={() => onToggleSelect?.(p.id)}
                    // 이유를 이름에 넣어 둔다 — 화면을 보지 않는 사람에게는
                    // tooltip이 존재하지 않는 것과 같다.
                    aria-label={
                      p.hasLedgerHistory
                        ? `${p.partName} — 입출고 이력·부품 요청이 있어 삭제할 수 없습니다`
                        : `${p.partName} 선택`
                    }
                    title={p.hasLedgerHistory ? "입출고 이력·부품 요청이 있어 삭제할 수 없습니다" : undefined}
                    className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </td>
              )}
              <td className="px-3 py-2">
                <Link href={`/inventory/${p.id}`} className="text-blue-700 hover:underline dark:text-blue-400">
                  {p.partName}
                </Link>
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.partSpec ?? "-"}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.kyosanPartNo ?? "-"}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.drawingNo ?? "-"}</td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{p.category ?? "-"}</td>

              {STOCK_OWNER_CODES.map((owner, index) => {
                const quantity = ownerAvailabilityByPartId[p.id]?.[owner] ?? 0;
                // 0을 흐리게 두는 것은 카드와 같은 이유다 — 재고가 있는 칸만
                // 눈에 들어와야 열을 세로로 훑는 것이 빨라진다.
                return (
                  <td
                    key={owner}
                    className={`px-3 py-2 text-right tabular-nums ${
                      index === 0 ? "border-l border-zinc-200 dark:border-zinc-800" : ""
                    } ${
                      quantity === 0
                        ? "text-zinc-300 dark:text-zinc-600"
                        : "text-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {quantity}
                  </td>
                );
              })}

              <td
                className={`border-l border-zinc-200 px-3 py-2 text-right font-semibold tabular-nums dark:border-zinc-800 ${
                  p.totalQuantity === 0
                    ? "text-zinc-400 dark:text-zinc-500"
                    : "text-zinc-900 dark:text-zinc-50"
                }`}
              >
                {p.totalQuantity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
  );
}
