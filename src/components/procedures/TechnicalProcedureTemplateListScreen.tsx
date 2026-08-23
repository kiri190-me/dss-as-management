"use client";

import { useMemo, useState } from "react";
import { LIST_CARD_GRID, ResponsiveList } from "@/components/common/responsive-list";
import { ListCard } from "@/components/common/list-card";
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
  deleteProcedureTemplatesAction,
  permanentlyDeleteProcedureTemplatesAction,
  restoreProcedureTemplatesAction,
  type ProcedureTemplateTrashItem,
} from "@/lib/server/actions/procedure-template-trash";
import Link from "next/link";
import { procedureEquipmentTypeLabels, procedureTemplateStatusLabels } from "@/lib/domain/procedure-template-types";
import type {
  DeletedProcedureTemplateRow,
  TechnicalProcedureTemplateListRow,
} from "@/lib/db/queries/procedure-templates";
import CreateTechnicalTemplateForm from "./editor/CreateTechnicalTemplateForm";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

const UNDELETABLE_REASON = "수행 기록이나 후속 버전이 있어 삭제할 수 없습니다";

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "medium" });
}

/**
 * Phase 5C-5B — the TECHNICAL_TASK library, deliberately a separate screen
 * from ProcedureTemplateListScreen (which lists every category together,
 * unchanged) rather than a category filter bolted onto it: this list's
 * permission model (ADMIN/SUPER_ADMIN manage, AS_ENGINEER published-only,
 * SALES/INVENTORY_MANAGER no access) and its own create-DRAFT entry point
 * are specific to this category and must never affect the existing
 * FULL_SERVICE/REFERENCE list's behavior.
 *
 * ── 삭제 (관리자 이상) ──────────────────────────────────────────────────
 * 휴지통 → 15일 → 자동 완전삭제. 고객사·제품 모델·재고와 같은 부품
 * (master-data-trash-dialogs.tsx, useMasterDataTrash)을 그대로 쓴다.
 * 이 화면만의 차이는 두 가지다.
 *
 *  1. **보관과 다른 일이다.** 보관은 발행된 절차를 "이제 안 씀"으로 내리는
 *     것이고, 삭제는 쓰인 적 없는 절차를 치우는 것이다. 둘은 대상이 겹치지
 *     않으므로 이 화면에는 두 조작이 함께 있을 수 있다.
 *  2. **수행 기록이나 후속 버전이 있으면 고를 수 없다.** 서버도 같은 기준으로
 *     다시 막지만(mutations/procedure-templates.ts), 고를 수 있게 해 놓고
 *     나중에 거절하면 "왜 안 되는지"를 한 번 더 눌러 봐야 알게 된다.
 */
export default function TechnicalProcedureTemplateListScreen({
  templates,
  canCreate,
  canDelete = false,
  trashTemplates = [],
  undeletableIds = [],
}: {
  templates: TechnicalProcedureTemplateListRow[];
  canCreate: boolean;
  /** 삭제·복원 권한. 없으면 탭도 삭제 모드도 그려지지 않는다. */
  canDelete?: boolean;
  /** 휴지통 행. canDelete인 세션에서만 서버가 채워 넘긴다. */
  trashTemplates?: DeletedProcedureTemplateRow[];
  /** 수행 기록·후속 버전이 있어 지금 지울 수 없는 절차. */
  undeletableIds?: string[];
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());

  const undeletable = useMemo(() => new Set(undeletableIds), [undeletableIds]);

  function leaveDeleteMode() {
    setIsDeleteMode(false);
    setSelectedIds(new Set());
  }

  const trash = useMasterDataTrash<ProcedureTemplateTrashItem>({
    onDelete: deleteProcedureTemplatesAction,
    onRestore: restoreProcedureTemplatesAction,
    onPermanentDelete: permanentlyDeleteProcedureTemplatesAction,
    onAllSucceeded: () => {
      leaveDeleteMode();
      setTrashSelectedIds(new Set());
    },
  });

  const selectableIds = useMemo(
    () => templates.filter((t) => !undeletable.has(t.id)).map((t) => t.id),
    [templates, undeletable]
  );
  const selectedSelectableCount = selectableIds.filter((id) => selectedIds.has(id)).length;

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(nextChecked: boolean) {
    setSelectedIds(nextChecked ? new Set(selectableIds) : new Set());
  }

  function targetsFrom(
    ids: Iterable<string>,
    source: { id: string; name: string }[]
  ): MasterDataTrashTarget<ProcedureTemplateTrashItem>[] {
    const byId = new Map(source.map((row) => [row.id, row]));
    return [...ids]
      .map((id) => byId.get(id))
      .filter((row): row is { id: string; name: string } => row !== undefined)
      .map((row) => ({ id: row.id, name: row.name }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">기술 작업 절차</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            증상/작업 단위의 개별 기술 절차입니다. 종합 수리 절차(기술 절차 템플릿)와는 별개의 목록입니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && activeTab === "active" && !isDeleteMode && (
            <button
              type="button"
              onClick={() => setIsDeleteMode(true)}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            >
              삭제 모드
            </button>
          )}
          {canCreate && !showCreateForm && (
            <button
              type="button"
              onClick={() => setShowCreateForm(true)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
            >
              새 기술 절차 만들기
            </button>
          )}
        </div>
      </div>

      {canCreate && showCreateForm && <CreateTechnicalTemplateForm onClose={() => setShowCreateForm(false)} />}

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
            사용중 ({templates.length})
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
            휴지통 ({trashTemplates.length})
          </button>
        </div>
      )}

      {activeTab === "trash" ? (
        <ProcedureTrashTab
          rows={trashTemplates}
          selectedIds={trashSelectedIds}
          onToggleSelected={(id) =>
            setTrashSelectedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleSelectAll={(nextChecked) =>
            setTrashSelectedIds(nextChecked ? new Set(trashTemplates.map((t) => t.id)) : new Set())
          }
          onClearSelection={() => setTrashSelectedIds(new Set())}
          onRequestRestore={(ids) => trash.open("RESTORE", targetsFrom(ids, trashTemplates))}
          onRequestPermanentDelete={(ids) => trash.open("PERMANENT_DELETE", targetsFrom(ids, trashTemplates))}
        />
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
                  selectableCount={selectableIds.length}
                  selectedCount={selectedSelectableCount}
                  onChange={toggleSelectAll}
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
                    onClick={() => trash.open("DELETE", targetsFrom(selectedIds, templates))}
                    disabled={selectedIds.size === 0}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    선택 삭제
                  </button>
                </div>
              </div>
              {selectableIds.length === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  지금 목록에는 삭제할 수 있는 절차가 없습니다 — {templates.length}개 모두 접수 건에서 수행된 기록이
                  있거나 후속 버전이 이어받았습니다. 수행 기록은 실제 수리 작업의 기록이라 지우지 않습니다.
                </p>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {templates.length}개 중{" "}
                  <strong className="font-medium text-zinc-700 dark:text-zinc-200">{selectableIds.length}개</strong>를
                  삭제할 수 있습니다. 흐리게 표시된 절차는 수행 기록·후속 버전이 있어 선택할 수 없습니다. 삭제해도 15일
                  동안은 휴지통에서 복원할 수 있습니다.
                </p>
              )}
            </div>
          )}

          {templates.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              표시할 기술 절차가 없습니다.
            </p>
          ) : (
            <ResponsiveList
              listId="technical-procedures"
              measureKey={[templates.length, isDeleteMode]}
              table={
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      {isDeleteMode && (
                        <th className="w-10 px-3 py-2">
                          <SelectAllCheckbox
                            selectableCount={selectableIds.length}
                            selectedCount={selectedSelectableCount}
                            onChange={toggleSelectAll}
                            ariaLabel="절차 전체 선택"
                          />
                        </th>
                      )}
                      <th className="px-3 py-2 font-medium">이름</th>
                      <th className="px-3 py-2 font-medium">설비 유형</th>
                      <th className="px-3 py-2 font-medium">버전</th>
                      <th className="px-3 py-2 font-medium">상태</th>
                      <th className="px-3 py-2 font-medium">노드 / 분기 수</th>
                      <th className="px-3 py-2 font-medium">생성 / 게시일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((t) => {
                      const blocked = undeletable.has(t.id);
                      return (
                        <tr
                          key={t.id}
                          className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                            isDeleteMode && blocked ? "opacity-50" : ""
                          }`}
                        >
                          {isDeleteMode && (
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(t.id)}
                                disabled={blocked}
                                onChange={() => toggleSelected(t.id)}
                                aria-label={blocked ? `${t.name} — ${UNDELETABLE_REASON}` : `${t.name} 선택`}
                                title={blocked ? UNDELETABLE_REASON : undefined}
                                className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                              />
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <Link
                              href={`/procedures/${t.id}`}
                              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                            >
                              {t.name}
                            </Link>
                            <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">{t.code}</div>
                          </td>
                          <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                            {procedureEquipmentTypeLabels[t.equipmentType]}
                          </td>
                          <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">v{t.version}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}
                            >
                              {procedureTemplateStatusLabels[t.status]}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                            {t.nodeCount} / {t.edgeCount}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-500">
                            {formatDate(t.createdAt)} / {formatDate(t.publishedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              }
              cards={
                <ul className={LIST_CARD_GRID}>
                  {templates.map((t) => {
                    const blocked = undeletable.has(t.id);
                    if (!isDeleteMode) {
                      return (
                        <ListCard
                          key={t.id}
                          href={`/procedures/${t.id}`}
                          title={t.name}
                          badge={
                            <span
                              className={`inline-flex shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}
                            >
                              {procedureTemplateStatusLabels[t.status]}
                            </span>
                          }
                          fields={[
                            { label: "코드", value: <span className="font-mono">{t.code}</span> },
                            { label: "설비", value: procedureEquipmentTypeLabels[t.equipmentType] },
                            { label: "버전", value: `v${t.version}` },
                            {
                              label: "노드/분기",
                              value: (
                                <span className="tabular-nums">
                                  {t.nodeCount} / {t.edgeCount}
                                </span>
                              ),
                            },
                            { label: "생성", value: formatDate(t.createdAt) },
                            { label: "게시", value: formatDate(t.publishedAt) },
                          ]}
                        />
                      );
                    }
                    // 삭제 모드에서는 카드가 링크가 아니다 — 고르려고 누른
                    // 손가락이 상세 화면으로 넘어가 버리면 안 된다.
                    return (
                      <li key={t.id}>
                        <label
                          className={`flex h-full cursor-pointer flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${
                            blocked ? "cursor-not-allowed opacity-50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                          }`}
                          title={blocked ? UNDELETABLE_REASON : undefined}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(t.id)}
                              disabled={blocked}
                              onChange={() => toggleSelected(t.id)}
                              aria-label={blocked ? `${t.name} — ${UNDELETABLE_REASON}` : `${t.name} 선택`}
                              className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{t.name}</span>
                            <span
                              className={`ml-auto inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}
                            >
                              {procedureTemplateStatusLabels[t.status]}
                            </span>
                          </span>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                            <div className="col-span-2">
                              <dt className="text-xs text-zinc-500 dark:text-zinc-500">코드</dt>
                              <dd className="font-mono break-all">{t.code}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-zinc-500 dark:text-zinc-500">설비</dt>
                              <dd>{procedureEquipmentTypeLabels[t.equipmentType]}</dd>
                            </div>
                            <div>
                              <dt className="text-xs text-zinc-500 dark:text-zinc-500">노드/분기</dt>
                              <dd className="tabular-nums">
                                {t.nodeCount} / {t.edgeCount}
                              </dd>
                            </div>
                          </dl>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              }
            />
          )}
        </>
      )}

      <MasterDataDeleteDialog
        isOpen={trash.kind === "DELETE"}
        entityLabel="기술 절차"
        names={trash.names}
        cascadeNote={
          <>노드·분기·체크리스트·참고자료·검증 기록이 절차와 함께 휴지통으로 갑니다. 복원하면 같이 돌아옵니다.</>
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
        entityLabel="기술 절차"
        names={trash.names}
        cascadeNote={<>절차와 그 안의 내용이 삭제 전 상태 그대로 돌아옵니다.</>}
        isSubmitting={trash.isSubmitting}
        submitError={trash.submitError}
        onConfirm={trash.submit}
        onCancel={trash.close}
      />

      <MasterDataPermanentDeleteDialog
        isOpen={trash.kind === "PERMANENT_DELETE"}
        entityLabel="기술 절차"
        names={trash.names}
        cascadeNote={
          <>절차와 함께 노드·분기·체크리스트·참고자료·검증 기록·편집 이력이 데이터베이스에서 완전히 제거됩니다.</>
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

/** 휴지통 탭. 다른 마스터 화면의 휴지통과 같은 구성 — 드나드는 '모드'가 없다. */
function ProcedureTrashTab({
  rows,
  selectedIds,
  onToggleSelected,
  onToggleSelectAll,
  onClearSelection,
  onRequestRestore,
  onRequestPermanentDelete,
}: {
  rows: DeletedProcedureTemplateRow[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleSelectAll: (nextChecked: boolean) => void;
  onClearSelection: () => void;
  onRequestRestore: (ids: string[]) => void;
  onRequestPermanentDelete: (ids: string[]) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
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
        listId="technical-procedures-trash"
        measureKey={[rows.length]}
        table={
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="w-10 px-3 py-2">
                  <SelectAllCheckbox
                    selectableCount={rows.length}
                    selectedCount={selectedCount}
                    onChange={onToggleSelectAll}
                    ariaLabel="휴지통 전체 선택"
                  />
                </th>
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">삭제 당시 상태</th>
                <th className="px-3 py-2 font-medium">노드 수</th>
                <th className="px-3 py-2 font-medium">삭제일</th>
                <th className="px-3 py-2 font-medium">삭제자</th>
                <th className="px-3 py-2 font-medium">삭제 사유</th>
                <th className="px-3 py-2 font-medium">보존</th>
                <th className="px-3 py-2 font-medium">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => onToggleSelected(row.id)}
                      aria-label={`${row.name} 선택`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.name}</span>
                    <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">
                      {row.code} · v{row.version}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}>
                      {procedureTemplateStatusLabels[row.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">{row.nodeCount}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {formatDate(row.deletedAt)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {row.deletedByUserName ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.deleteReason ?? "-"}</td>
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
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.name}</span>
                  <span className="ml-auto">
                    <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />
                  </span>
                </label>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="col-span-2">
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">코드</dt>
                    <dd className="font-mono break-all">
                      {row.code} · v{row.version}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">삭제 당시 상태</dt>
                    <dd>{procedureTemplateStatusLabels[row.status]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">노드 수</dt>
                    <dd className="tabular-nums">{row.nodeCount}</dd>
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
