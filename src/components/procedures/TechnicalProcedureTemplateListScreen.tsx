"use client";

import { useMemo, useState } from "react";
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
  preventShiftClickTextSelection,
  shiftKeyOf,
  useShiftRangeSelection,
} from "@/lib/hooks/useShiftRangeSelection";
import { setIdsChecked } from "@/lib/domain/range-selection";
import {
  TECHNICAL_PROCEDURE_LIST_FILTER_NONE,
  filterTechnicalProcedureRows,
  filterTechnicalProcedureSeries,
  pruneSelectionToVisible,
  type TechnicalProcedureListFilter,
} from "@/lib/domain/technical-procedure-list-filter";
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
import { groupProcedureTemplatesByCode } from "@/lib/domain/procedure-template-series";
import TechnicalProcedureSeriesList from "./TechnicalProcedureSeriesList";
import TechnicalProcedureListFilterBar, {
  TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT,
} from "./TechnicalProcedureListFilterBar";
import CreateTechnicalTemplateForm from "./editor/CreateTechnicalTemplateForm";

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PUBLISHED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  ARCHIVED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

/**
 * 🔴 2026-11-04(줄기 B ④) — 붙잡는 까닭이 **셋**이 됐다(수행 기록 · 후속 버전 ·
 * 다른 절차의 이어가기). 짧은 글에 셋을 나열하면 체크박스 옆 안내가 길어지므로
 * 「다른 곳에서 쓰이고 있다」로 묶고, 무엇이 붙잡는지는 괄호가 센다.
 * [버전 목록]의 같은 글(domain/procedure-version-deletion.ts)과 **같은 말**이어야
 * 한다 — 두 화면이 같은 상태를 다르게 부르면 같은 절차를 두고 사람이 헷갈린다.
 */
const UNDELETABLE_REASON =
  "다른 곳에서 쓰이고 있어 삭제할 수 없습니다 (수행 기록 · 후속 버전 · 다른 절차의 이어가기)";

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
 *  2. **다른 곳에서 쓰이고 있으면 고를 수 없다**(수행 기록 · 후속 버전 ·
 *     다른 절차의 이어가기). 서버도 같은 기준으로
 *     다시 막지만(mutations/procedure-templates.ts), 고를 수 있게 해 놓고
 *     나중에 거절하면 "왜 안 되는지"를 한 번 더 눌러 봐야 알게 된다.
 *
 * ── 🔴 계열당 한 줄 — 그런데 삭제 모드에서는 판 단위로 되돌린다 ─────────
 * 2026-11-04 사용자 신고: "같은 이름의 절차들이 버전만 다르게 있으면 오히려
 * 버전 관리가 어려워진다." 그래서 평소 목록은 code 줄기당 한 줄이다
 * (TechnicalProcedureSeriesList).
 *
 * 삭제는 그렇게 접을 수 없다. 삭제의 단위는 **행 하나(= 판 하나)**이고,
 * 지울 수 있는지도 판마다 다르다 — 수행 기록이 있는 판은 막히고 같은 줄기의
 * 다른 판은 열린다. 접어 놓고 체크박스를 하나 두면 "이 줄기를 지운다"가 무슨
 * 뜻인지 사람도 서버도 다르게 읽는다(전부? 대표만? 지울 수 있는 것만?).
 *
 * 그래서 [삭제 모드]에 들어가면 **묶음을 푼다.** 같은 화면에서 모든 판이 한 줄씩
 * 다시 서고, 고르는 손(체크박스·Shift 범위)·막히는 조건·확인 창·휴지통은 전과
 * 한 글자도 다르지 않다. 휴지통 탭도 원래부터 판 단위다(code · v1 로 적는다).
 *
 * ── 🔴 2026-11-05 — 이름 검색 · 설비 유형 거르기가 생겼다 ───────────────
 * 규칙 자체는 순수 함수 한 곳에 있다(domain/technical-procedure-list-filter.ts,
 * 값으로 재는 쪽은 unit 목록의 같은 이름 시험). 이 화면이 하는 일은 셋이다.
 *
 *  1. **거르는 자리가 둘이다.** 평소 목록은 계열 줄을 거르고(visibleSeries),
 *     삭제 모드는 판 줄을 거른다(visibleTemplates). 묶음을 푸는 자리가 다르기
 *     때문이고, 어느 쪽이든 **그 줄에 적힌 이름**으로 걸린다. 🔴 접기 자체는
 *     거르기 **전**의 templates 로 한다 — 거른 뒤에 접으면 검색어에 따라 계열의
 *     대표가 바뀌어, 같은 줄을 눌렀는데 다른 판이 열린다.
 *
 *  2. 🔴 **고를 수 있는 것은 지금 보이는 것뿐이다.** 거르기가 생기기 전에는
 *     "보이는 것 = templates 전부"라 이 구분이 없었다. 이제는 전체 선택도 Shift
 *     범위도 **거른 뒤 목록**을 쓴다(고객사·제품 모델 목록과 같은 모양:
 *     selectableVisibleIds / selectableVisibleIdSet). 안 그러면 사람이 보지도
 *     못한 판이 [선택 삭제]에 딸려 간다.
 *
 *  3. 🔴 **거르개를 바꾸면 화면에서 사라진 것의 고르기를 푼다**(changeFilter).
 *     이 화면은 같은 이름의 판이 여러 줄 서는 유일한 자리라, 확인 창의 이름
 *     목록만으로는 어느 판이 딸려 왔는지 가릴 수 없다. 🔵 이웃 두 화면(고객사 ·
 *     제품 모델)은 반대로 검색어 밖의 선택을 남겨 둔다 — 그 차이의 까닭은
 *     domain/technical-procedure-list-filter.ts 의 pruneSelectionToVisible 머리말.
 *
 * 🔵 휴지통 탭에는 거르개를 달지 않았다. 거기도 고르기·삭제(완전 삭제)가 있어
 * 같은 위험이 있으므로, 한꺼번에 하지 않고 따로 본다.
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
  /** 다른 곳에서 쓰이고 있어 지금 지울 수 없는 절차(수행 기록 · 후속 버전 · 다른 절차의 이어가기). */
  undeletableIds?: string[];
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "trash">("active");
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<TechnicalProcedureListFilter>(TECHNICAL_PROCEDURE_LIST_FILTER_NONE);

  const undeletable = useMemo(() => new Set(undeletableIds), [undeletableIds]);

  /**
   * 평소 목록이 그리는 것 — code 줄기당 하나.
   *
   * 🔴 권한 거르기는 이미 끝나 있다. templates 는 서버가
   * listTechnicalProcedureTemplates(mayEditDraft) 로 읽어 넘긴 것이라, 초안을
   * 볼 수 없는 역할에게는 초안 행이 애초에 들어 있지 않다. 그래서 접는 함수도
   * 이 화면도 권한을 다시 보지 않는다 — 보는 곳이 둘이 되면 어긋난다.
   */
  const series = useMemo(() => groupProcedureTemplatesByCode(templates), [templates]);

  /**
   * 거른 뒤 **지금 화면에 서는** 줄. 평소 목록은 계열 줄, 삭제 모드는 판 줄이다
   * (머리말 1번). 둘 다 "그 줄에 적힌 이름"으로 걸린다.
   */
  const visibleSeries = useMemo(() => filterTechnicalProcedureSeries(series, filter), [series, filter]);
  const visibleTemplates = useMemo(() => filterTechnicalProcedureRows(templates, filter), [templates, filter]);

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

  /**
   * 🔴 **지금 화면에 보이는** 판 중에서 고를 수 있는 것. 거르기가 생기기 전에는
   * templates 전부였다 — 그대로 두면 거른 뒤에도 "안 보이는 것이 고를 수 있는
   * 것"으로 남아, [전체 선택]이 사람이 보지도 못한 판을 담는다.
   * 다른 곳에서 쓰이고 있어 막힌 절차는 여기서도 빠진다(체크박스의 disabled 와
   * 같은 기준이다). 이름은 고객사·제품 모델 목록과 같은 것을 쓴다 — 세 화면이
   * 같은 모양이어야 한 곳이 어긋났을 때 눈에 띈다.
   */
  const selectableVisibleIds = useMemo(
    () => visibleTemplates.filter((t) => !undeletable.has(t.id)).map((t) => t.id),
    [visibleTemplates, undeletable]
  );
  const selectableVisibleIdSet = useMemo(() => new Set(selectableVisibleIds), [selectableVisibleIds]);
  const selectedSelectableCount = selectableVisibleIds.filter((id) => selectedIds.has(id)).length;

  /**
   * 한 건 누르기와 Shift 로 사이를 한꺼번에 고르기(useShiftRangeSelection).
   *
   * 🔴 2026-11-05 에 이 목록에 **이름 검색과 설비 유형 거르개가 생겼다.** 그
   * 전에는 "검색·페이지가 없어 범위의 순서는 templates 그대로"였는데, 이제는
   * 아니다 — 범위의 순서는 **거른 뒤 화면에 그려진 차례**(visibleTemplates)이고,
   * 거기 없는 판은 범위에 들어올 수 없다. 수행 기록·후속 버전이 있어 막힌 절차를
   * 범위 안에서도 건너뛰는 것은 전과 같다.
   *
   * 🔵 기준점(anchor)은 따로 비우지 않는다. 거르개를 바꿔 기준점이 가려지면
   * planRangeToggle 이 이미 **보통 누르기**로 되돌린다("기준점이 지금 목록에
   * 없다" 가지, domain/range-selection.ts) — 가려진 자리를 기준으로 범위가
   * 잡히는 일은 생기지 않는다.
   *
   * 휴지통에는 거르개가 없으므로 휴지통 목록 순서 그대로다.
   */
  const rangeSelection = useShiftRangeSelection({
    orderedIds: visibleTemplates.map((t) => t.id),
    isSelectable: (id) => selectableVisibleIdSet.has(id),
    selectedIds,
    setSelectedIds,
  });
  const trashRangeSelection = useShiftRangeSelection({
    orderedIds: trashTemplates.map((t) => t.id),
    selectedIds: trashSelectedIds,
    setSelectedIds: setTrashSelectedIds,
  });

  function toggleSelected(id: string, shiftKey: boolean) {
    rangeSelection.toggle(id, shiftKey);
  }

  /**
   * 🔴 **보이는 것만** 담고, 풀 때도 보이는 것만 푼다
   * (common/select-all-checkbox.tsx 머리말의 두 규칙 그대로). 아래 changeFilter
   * 가 가려진 선택을 이미 추려 두므로 지금은 "전부 비우기"와 결과가 같지만,
   * 규칙을 글자로 적어 둔다 — 추리기를 손대는 날 여기가 함께 어긋나면 안 된다.
   */
  function toggleSelectAll(nextChecked: boolean) {
    setSelectedIds((previous) => setIdsChecked(previous, selectableVisibleIds, nextChecked));
  }

  /**
   * 🔴 거르개가 바뀌었다 — **화면에서 사라지는 판의 고르기를 그 자리에서 푼다.**
   * 효과(useEffect)로 미루지 않는 까닭: 선택이 한 번이라도 "화면에 없는데 골라진"
   * 상태로 존재하면, 그 사이에 [선택 삭제]를 누른 사람에게 보지도 못한 판이
   * 딸려 간다. 거르개가 바뀌는 길은 이 함수 하나뿐이라(이름 칸 · 설비 유형 ·
   * [거르기 지우기] 셋 다 여기를 지난다) 빠지는 길이 생기지 않는다.
   */
  function changeFilter(next: TechnicalProcedureListFilter) {
    setFilter(next);
    const visibleIds = filterTechnicalProcedureRows(templates, next).map((t) => t.id);
    setSelectedIds((previous) => pruneSelectionToVisible(previous, visibleIds));
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
              className="rounded-md bg-primary-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-800 dark:bg-primary-50 dark:text-zinc-900"
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
            {/* 세는 것은 **줄기**다. 판 수는 각 줄의 [판 수] 칸과 상세의 [버전
                목록]이 말한다.
                🔴 2026-11-05 — 전에는 "화면에 실제로 서는 줄 수와 같아야 한다"고
                적혀 있었다. 거르개가 생긴 지금은 **일부러 다르다**: 이 수는
                거르개와 무관한 사용중 전체이고, 따라 움직이면 몇 개가 숨겨졌는지
                알 길이 없어진다. 지금 보이는 수는 거르개 줄이 말한다
                (TechnicalProcedureListFilterBar 의 "N개 중 M개"). */}
            사용중 ({series.length})
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
          onToggleSelected={trashRangeSelection.toggle}
          onToggleSelectAll={(nextChecked) =>
            setTrashSelectedIds(nextChecked ? new Set(trashTemplates.map((t) => t.id)) : new Set())
          }
          onClearSelection={() => setTrashSelectedIds(new Set())}
          onRequestRestore={(ids) => trash.open("RESTORE", targetsFrom(ids, trashTemplates))}
          onRequestPermanentDelete={(ids) => trash.open("PERMANENT_DELETE", targetsFrom(ids, trashTemplates))}
        />
      ) : (
        <>
          {/* 🔴 거르개는 삭제 모드 바보다 **위**다. 삭제 모드에서도 계속 보여야
              하고(거르고 나서 고르는 것이 이 기능의 쓸모다), 그러면서 "무엇이
              지워지는가"를 말하는 붉은 바가 거르개에 밀려 아래로 내려가면 안
              된다. 세는 단위가 가지마다 다른 까닭은 거르개 조각의 머리말에. */}
          <TechnicalProcedureListFilterBar
            filter={filter}
            onFilterChange={changeFilter}
            totalCount={isDeleteMode ? templates.length : series.length}
            visibleCount={isDeleteMode ? visibleTemplates.length : visibleSeries.length}
            unitLabel={isDeleteMode ? "판" : "절차"}
          />

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
              {/* 🔴 두 글 모두 **거른 뒤의 수**로 말한다. 거르개가 켜져 있는데
                  "{templates.length}판 모두 …" 라고 적으면 거짓이 된다 — 가려진
                  판은 세어 본 적이 없다. "지금 보이는" 이 그 뜻이다.
                  🔴 보이는 판이 **0판일 때는 둘 다 안 그린다.** "보이는 0판 모두
                  수행 기록이 있습니다" 는 거짓이고(0판은 세어 본 적이 없다),
                  까닭은 바로 아래 빈 목록 글이 이미 말한다. */}
              {visibleTemplates.length === 0 ? null : selectableVisibleIds.length === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  지금 목록에는 삭제할 수 있는 절차가 없습니다 — 보이는 {visibleTemplates.length}판 모두 접수 건에서
                  수행된 기록이 있거나 후속 버전이 이어받았습니다. 수행 기록은 실제 수리 작업의 기록이라 지우지
                  않습니다.
                </p>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  삭제는 <strong className="font-medium text-zinc-700 dark:text-zinc-200">판(버전) 단위</strong>라
                  계열 묶음을 풀고 모든 판을 한 줄씩 보여 줍니다. 지금 보이는 {visibleTemplates.length}판 중{" "}
                  <strong className="font-medium text-zinc-700 dark:text-zinc-200">
                    {selectableVisibleIds.length}판
                  </strong>
                  을 삭제할 수 있습니다. 흐리게 표시된 판은 다른 곳에서 쓰이고 있어 선택할 수 없습니다(수행 기록 ·
                  후속 버전 · 다른 절차의 이어가기). 삭제해도 15일 동안은 휴지통에서 복원할 수 있습니다.
                </p>
              )}
            </div>
          )}

          {/* 🔴 비어 있는 까닭 둘을 **다른 말로** 말한다. "없습니다"와 "조건에
              맞는 것이 없습니다"는 뜻이 다르다 — 거르개를 켜 둔 것을 잊은 사람이
              앞의 글을 읽으면 절차가 통째로 사라진 줄 안다. */}
          {templates.length === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              표시할 기술 절차가 없습니다.
            </p>
          ) : (isDeleteMode ? visibleTemplates.length : visibleSeries.length) === 0 ? (
            <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT}
            </p>
          ) : isDeleteMode ? (
            // 🔴 삭제 모드 — 묶음을 푼 **판 단위** 목록. 머리말의 "삭제는 그렇게
            // 접을 수 없다" 항목이 까닭이고, 이 가지 안의 손잡이는 묶기 전과
            // 한 글자도 다르지 않다.
            <ResponsiveList
              listId="technical-procedures"
              measureKey={[visibleTemplates.length, isDeleteMode]}
              table={
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th className="w-10 px-3 py-2">
                        <SelectAllCheckbox
                          selectableCount={selectableVisibleIds.length}
                          selectedCount={selectedSelectableCount}
                          onChange={toggleSelectAll}
                          ariaLabel="절차 전체 선택"
                        />
                      </th>
                      <th className="px-3 py-2 font-medium">이름</th>
                      <th className="px-3 py-2 font-medium">설비 유형</th>
                      <th className="px-3 py-2 font-medium">버전</th>
                      <th className="px-3 py-2 font-medium">상태</th>
                      <th className="px-3 py-2 font-medium">노드 / 분기 수</th>
                      <th className="px-3 py-2 font-medium">생성 / 게시일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 🔴 표와 카드가 **같은 visibleTemplates** 를 그린다.
                        ResponsiveList 가 폭을 재서 둘 중 하나를 고르므로, 한쪽만
                        거르면 창 크기에 따라 거르개가 듣다 안 듣다 한다. */}
                    {visibleTemplates.map((t) => {
                      const blocked = undeletable.has(t.id);
                      return (
                        <tr
                          key={t.id}
                          className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${
                            blocked ? "opacity-50" : ""
                          }`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(t.id)}
                              disabled={blocked}
                              onChange={(event) => toggleSelected(t.id, shiftKeyOf(event))}
                              onMouseDown={preventShiftClickTextSelection}
                              aria-label={blocked ? `${t.name} — ${UNDELETABLE_REASON}` : `${t.name} 선택`}
                              title={blocked ? UNDELETABLE_REASON : undefined}
                              className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              href={`/procedures/${t.id}`}
                              className="font-medium text-blue-700 hover:underline dark:text-blue-400"
                            >
                              {t.name}
                            </Link>
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
                  {visibleTemplates.map((t) => {
                    const blocked = undeletable.has(t.id);
                    // 삭제 모드에서는 카드가 링크가 아니다 — 고르려고 누른
                    // 손가락이 상세 화면으로 넘어가 버리면 안 된다.
                    return (
                      <li key={t.id}>
                        <label
                          className={`flex h-full cursor-pointer flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${
                            blocked ? "cursor-not-allowed opacity-50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                          }`}
                          title={blocked ? UNDELETABLE_REASON : undefined}
                          onMouseDown={preventShiftClickTextSelection}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(t.id)}
                              disabled={blocked}
                              onChange={(event) => toggleSelected(t.id, shiftKeyOf(event))}
                              aria-label={blocked ? `${t.name} — ${UNDELETABLE_REASON}` : `${t.name} 선택`}
                              className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                            <span className="font-semibold text-zinc-900 dark:text-zinc-50">{t.name}</span>
                            <span
                              className={`ml-auto inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status]}`}
                            >
                              {procedureTemplateStatusLabels[t.status]} v{t.version}
                            </span>
                          </span>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                            <div className="col-span-2">
                              <dt className="text-xs text-zinc-500 dark:text-zinc-500">판</dt>
                              {/* 🔴 판 번호를 배지와 여기 둘 다 적는다 — 같은
                                  이름의 판이 여러 장 나란히 서는 유일한 자리라,
                                  무엇을 고르고 있는지 가릴 것이 판 번호뿐이다
                                  (휴지통 카드도 같은 모양으로 적는다).
                                  🔵 2026-11-05 에 앞에 붙던 코드를 걷고 항목 이름도
                                  「코드」에서 「판」으로 바꿨다 — 남은 값이 판 번호
                                  하나인데 이름이 「코드」면 그 번호를 코드로 읽는다.
                                  카드 제목이 절차 이름이라 계열은 거기서 갈린다. */}
                              <dd className="font-mono break-all">v{t.version}</dd>
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
          ) : (
            <TechnicalProcedureSeriesList series={visibleSeries} />
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
  /** shiftKey — Shift 를 누른 채 눌렀는가. 범위 고르기는 부모의 useShiftRangeSelection 이 한다. */
  onToggleSelected: (id: string, shiftKey: boolean) => void;
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
                      onChange={(event) => onToggleSelected(row.id, shiftKeyOf(event))}
                      onMouseDown={preventShiftClickTextSelection}
                      aria-label={`${row.name} 선택`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.name}</span>
                    {/* 🔵 2026-11-05 — 앞에 붙던 코드를 걷었다. 판 번호는 남긴다 —
                        휴지통은 판 단위라 같은 이름이 여러 줄 설 수 있고, 그때
                        어느 판을 되살리는지 가릴 것이 이 번호뿐이다. */}
                    <div className="font-mono text-[10px] text-zinc-400 dark:text-zinc-600">v{row.version}</div>
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
                <label className="flex items-center gap-2" onMouseDown={preventShiftClickTextSelection}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={(event) => onToggleSelected(row.id, shiftKeyOf(event))}
                    className="h-4 w-4"
                  />
                  <span className="font-semibold text-zinc-900 dark:text-zinc-50">{row.name}</span>
                  <span className="ml-auto">
                    <MasterDataTrashRetentionBadge deletedAt={row.deletedAt} />
                  </span>
                </label>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="col-span-2">
                    {/* 🔵 2026-11-05 — 코드를 걷고 항목 이름도 「판」으로 바꿨다
                        (삭제 모드 카드와 같은 모양). */}
                    <dt className="text-xs text-zinc-500 dark:text-zinc-500">판</dt>
                    <dd className="font-mono break-all">v{row.version}</dd>
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
