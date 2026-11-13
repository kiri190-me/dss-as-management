"use client";

import Link from "next/link";
// 🔵 `useIsBadgeVisible` 는 2026-11-13 에 이 파일에서 빠졌다 — 표 전용 「정상」 조각이
//    사라지면서 이 화면은 설정을 **스스로 묻지 않는다**. 받은 자리를 배지에 넘길 뿐이고
//    판정은 전부 badges.tsx 안의 한 벌이다.
import type { BadgePlaceKey } from "@/lib/domain/badge-visibility";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import type { SortColumn, SortState } from "@/lib/domain/repair-case-filters";
import {
  DueDateNearBadge,
  HoldBadge,
  OverdueBadge,
  PriorityBadge,
  SourceBadge,
  StatusBadge,
  WorkflowOverrideBadge,
} from "./badges";
import RequestedDueDateValue from "./RequestedDueDateValue";
import FinalShipmentApprovedBadge from "@/components/approvals/FinalShipmentApprovedBadge";
import SelectAllCheckbox from "@/components/common/select-all-checkbox";
import { preventShiftClickTextSelection, shiftKeyOf } from "@/lib/hooks/useShiftRangeSelection";

type RepairCaseTableProps = {
  rows: EffectiveRepairCase[];
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
  /**
   * Bulk soft-delete selection (/repair-cases 삭제 모드) — every field below
   * is optional and undefined by default, so every other caller of this
   * shared component (CustomerRepairCaseHistory, ProductModelRepairCaseHistory,
   * MyActiveWorkScreen, etc.) renders byte-for-byte identically to before;
   * only RepairCaseListPage ever passes these. `selectionMode` alone gates
   * whether the checkbox column renders at all. `selectableIds` restricts
   * which rows may actually be checked (DATABASE-sourced rows only — a
   * local/draft row has no server-side repair_cases row to delete).
   */
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  selectableIds?: ReadonlySet<string>;
  /** shiftKey — Shift 를 누른 채 눌렀는가. 범위 고르기는 부모의 useShiftRangeSelection 이 한다. */
  onToggleSelect?: (id: string, shiftKey: boolean) => void;
  /**
   * 체크박스 열 머리글의 전체 선택. 대상은 **지금 이 표에 그려진 행**(= 이
   * 페이지)이고, 그중 고를 수 있는 것만이다 — 보이지 않는 페이지까지 딸려
   * 가면 몇 건을 지우는지 눈으로 셀 수 없게 된다. 세는 일은 rows/selectableIds로
   * 여기서 직접 하고, 실제 선택 변경만 부모에게 맡긴다.
   */
  onToggleSelectAll?: (nextChecked: boolean) => void;
  /**
   * 「납기 임박」인 접수 건의 id 묶음 — 고객 요청 납기일이 오늘부터 7일 안으로
   * 다가온 건이다(2026-10-19). 배지 하나와 날짜 글자색이 이 묶음을 본다.
   *
   * 🔴 **판정은 서버가 한다.** 「오늘」을 화면에서 `new Date()` 로 만들면 서버가
   * 그린 HTML 과 어긋나고(app/(app)/repair-cases/page.tsx 의 longPendingPoCaseIds
   * 가 적어 둔 바로 그 함정), 조건을 여기 적으면 종 알림과 두 말이 된다. 그래서
   * 이 표는 **다 재 둔 id 묶음**만 받는다 — 결재 대기·장기 PO 미발행 묶음과 같은
   * 모양이다.
   *
   * undefined 가 기본이다. 이 표를 함께 쓰는 다른 화면들(고객사·모델 이력 등)은
   * 이 값을 넘기지 않으므로 예전과 한 글자도 다르지 않게 그려진다.
   */
  dueDateNearCaseIds?: ReadonlySet<string>;
  /**
   * 🔴 **[최종 출하 승인 완료]** 배지가 붙는 접수 건의 id 묶음(2026-11-08 사용자
   * 요구 — 「현황판과 상세페이지 헤드, 내자정리의 [완료 처리]버튼의 오른쪽」).
   *
   * 🔴 **판정은 서버가 한다** — 바로 위 `dueDateNearCaseIds` 와 **같은 모양·같은
   * 까닭**이다. 승인 상태는 이 건의 칸이 아니라 다른 표의 최신 결재 행과 이 건의
   * 판 번호로 나오는 파생값이고, 화면에는 그 재료가 아예 없다. 어느 상태에 붙는지도
   * 도메인 하나가 정한다(isFinalShipmentApproved — `STALE` 에는 안 붙는다).
   *
   * 🔴 **줄마다 묻지 않는다**(N+1) — 페이지가 질의 하나로 걷어 와 묶음으로 준다
   * (queries/repair-case-approvals.ts 의 loadRepairCaseFinalShipmentApprovalStates).
   *
   * undefined 가 기본이다. 이 표를 함께 쓰는 다른 화면들(고객사·모델 이력 등)은
   * 이 값을 넘기지 않으므로 예전과 한 글자도 다르지 않게 그려진다.
   */
  finalShipmentApprovedCaseIds?: ReadonlySet<string>;
  /**
   * 🔴 이 표가 **등록부의 어느 자리인가** (2026-11-13 — 배지 표시 설정).
   *
   * `"repairCaseList"`(= 「전체 A/S 현황 — 목록」)를 받으면 아래 배지 아홉이 각자
   * 그 자리의 설정을 보고 스스로 안 그린다. 🔴 **이 표를 함께 쓰는 다른 화면
   * (고객사 상세 · 제품모델 상세의 A/S 이력)은 이 값을 안 넘긴다** — 등록부에 그
   * 자리들이 아예 없고, 자리를 안 주면 판정이 언제나 「보임」이라 예전과 한 글자도
   * 다르지 않게 그려진다. 그래서 자리를 **이 파일에 박지 않고 받는다**: 박으면
   * 전체 A/S 현황에서 「상태」를 끈 날 고객사 상세의 이력까지 함께 비어 버린다.
   *
   * 🔴 **휴대폰 쪽(RepairCaseCardList)도 같은 자리다.** 한쪽에만 넘기면 폰에서만
   * 안 꺼진다 — 두 조각을 세우는 RepairCaseListPage 가 같은 값을 둘 다에 준다.
   */
  badgePlaceKey?: BadgePlaceKey;
};

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

function sortIndicator(sort: SortState, column: SortColumn): string {
  if (sort.column !== column) return "";
  return sort.direction === "asc" ? "▲" : "▼";
}

/** Primary sort control in a merged header cell — same visual weight as thBaseClass's own buttons. */
function PrimarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSortChange(column)}
      className="flex items-center gap-1 whitespace-nowrap hover:text-zinc-900 dark:hover:text-zinc-50"
    >
      {label}
      <span className="text-[10px]">{sortIndicator(sort, column)}</span>
    </button>
  );
}

/** Secondary sort control stacked under a PrimarySortButton in the same merged header cell — lighter weight so the header's visual hierarchy matches the body's primary/secondary line pairing. */
function SecondarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sort: SortState;
  onSortChange: (column: SortColumn) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSortChange(column)}
      className="flex items-center gap-1 whitespace-nowrap text-[11px] font-normal text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
    >
      {label}
      <span className="text-[9px]">{sortIndicator(sort, column)}</span>
    </button>
  );
}

/*
 * 🔴 **2026-11-13 — 이 자리에 있던 `StatusRowOverdueBadge` 를 걷어냈다.**
 * 지연이 아닌 건에 파란 알약 「정상」을 세우던 표 전용 조각이었다(공용
 * badges.tsx 의 OverdueBadge 는 같은 상태를 꾸밈 없는 회색 글자로 그렸고, 이
 * 표에서만 이웃 배지들과 모양을 맞춘 것이었다). 사용자 결정으로 「정상」 자체가
 * 사라져 — 「[정상] 배지는 없애 달라」 — 그 조각이 하는 일이 OverdueBadge 와 한
 * 글자도 다르지 않게 됐고, 그래서 표도 공용 배지를 **직접** 부른다.
 * 🔵 자리(placeKey)를 두 번 묻던 문제도 함께 없어졌다: 판정이 공용 배지 안의 한
 * 벌뿐이다.
 */

/**
 * Compact 9-column table for 전체 A/S 현황: 인수번호, 상태, 고객사, 제품,
 * 신고증상, 유·무상, 담당 엔지니어, 출하일, 상세. Every other field from the original
 * 16-column table (인수일, End-User, 제품 구분, L/N, 우선순위, 납기
 * 지연 여부, 고객 요청 납기일) still renders, folded into a secondary line or
 * badge inside one of these cells rather than getting its own column —
 * see the doc comments on each <td> below. All 7 SortColumn values
 * (intakeNumber, receivedAt, customerName, status, priority,
 * actualShipmentDate, customerRequestedDueDate) remain independently
 * clickable, via a secondary sort button stacked under the relevant primary
 * header where the field itself no longer has its own column.
 *
 * 상태 cell is two lines: 상태 배지 alone on line 1, 우선순위/납기/보류/재정의
 * 배지 cluster on line 2. 🔴 그 묶음의 배지는 **해당하는 건에만** 선다 —
 * 「납기 지연」도 2026-11-13 부터 그 규율이다(지연이 아닌 건에 세우던 파란
 * 「정상」을 사용자 결정으로 걷어냈다 — badges.tsx 의 OverdueBadge 머리말).
 *
 * 제품 cell: line 1 (stronger) is 제품 구분(제품명 역할)/모델, line 2
 * (secondary, smaller/gray) is S/N·L/N.
 *
 * 신고증상 — 제품 바로 오른쪽의 독립 열(2026-10-17 요구). 🔴 정렬 대상이 아니다
 * (SortColumn 에 없다) — 바로 옆 유·무상과 같다. 이 값으로 서버를 세우는 일은
 * 아무도 원하지 않으므로 머리글은 누를 수 없는 글자 하나다. 긴 문장이 들어오는
 * 유일한 칸이라 이 표에서 **whitespace-nowrap 이 아닌 유일한 셀**이다:
 * 폭은 max-w 로 묶고(휴지통 표의 삭제 사유 칸과 같은 방식 —
 * trash/RepairCaseTrashTable.tsx) 두 줄에서 자른다(상세의 신고증상 줄과 같은
 * 방식 — detail/ProductInfoSection.tsx 의 HistoryLine). 🔴 잘린 것이 … 로
 * 보이고, 전체는 title 로 뜬다 — 조용히 잘리면 사람은 그게 전부인 줄 안다.
 * 값이 없으면 이 표의 다른 칸들과 같이 "-" 다(「없음」 같은 말을 짓지 않는다).
 *
 * 유·무상 gets its own column (2026-08-19). It used to be the third slot of
 * 제품's first line, but it is not a property of the product at all —
 * migration 0021 made billing_type a column independent of workflowType, and
 * it is now its own filter on this screen, so a value people filter on and
 * scan down should be a column they can scan down. Null (아직 안 정해짐)
 * renders "-" and is never guessed either way.
 *
 * 출하일 cell shows effectiveActualShipmentDate (실제 출하일), never
 * internalTargetShipmentDate — renders "-" when not yet shipped rather than
 * silently substituting the target date. 고객 요청 납기일 stays as secondary
 * context (still sortable via the header's secondary button).
 * 머리글 「출하일」도 2026-10-19부터 누를 수 있다(SortColumn "actualShipmentDate").
 * 🔴 정렬도 본문과 같은 값으로 선다 — 널을 사내 목표 완료일로 대신 채우지
 * 않는다(repair-case-filters.ts 의 sortRows). 그렇지 않으면 "-"로 그려진 줄이
 * 날짜가 있는 줄 사이에 끼어 선다.
 *
 * No wrapping div here — the table/card switch is owned by ResponsiveList
 * (components/common/responsive-list.tsx), which measures real overflow and
 * therefore has to own the scroll wrapper itself. A wrapper here would
 * absorb the overflow before ResponsiveList could see it, and that screen
 * would then answer "fits" forever.
 */
export default function RepairCaseTable({
  rows,
  sort,
  onSortChange,
  selectionMode,
  selectedIds,
  selectableIds,
  onToggleSelect,
  onToggleSelectAll,
  dueDateNearCaseIds,
  finalShipmentApprovedCaseIds,
  badgePlaceKey,
}: RepairCaseTableProps) {
  const selectableVisible = selectionMode ? rows.filter((row) => selectableIds?.has(row.id) ?? false) : [];
  const selectedVisibleCount = selectableVisible.filter((row) => selectedIds?.has(row.id) ?? false).length;

  return (
      <table className="w-full min-w-[1040px] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr>
            {selectionMode && (
              <th scope="col" className={`${thBaseClass} w-10`}>
                {onToggleSelectAll ? (
                  <SelectAllCheckbox
                    selectableCount={selectableVisible.length}
                    selectedCount={selectedVisibleCount}
                    onChange={onToggleSelectAll}
                    ariaLabel="이 페이지 전체 선택"
                  />
                ) : (
                  <span className="sr-only">선택</span>
                )}
              </th>
            )}
            <th scope="col" className={thBaseClass}>
              {/* 인수번호 (primary) + 인수일 (secondary, still sortable) */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton column="intakeNumber" label="인수번호" sort={sort} onSortChange={onSortChange} />
                <SecondarySortButton column="receivedAt" label="인수일" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 상태 (primary, badge on line 1 in the body) + 우선순위 (secondary, still sortable); 납기 지연/보류/재정의 배지는 정렬 대상이 아니므로 헤더 없이 본문 배지로만 표시 */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton column="status" label="상태" sort={sort} onSortChange={onSortChange} />
                <SecondarySortButton column="priority" label="우선순위" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 고객사 (primary, sortable) + End-User (secondary, not sortable) */}
              <PrimarySortButton column="customerName" label="고객사" sort={sort} onSortChange={onSortChange} />
            </th>
            <th scope="col" className={thBaseClass}>
              {/* 제품명(=제품 구분)/모델 (primary) + S/N·L/N (secondary) — none of these were sortable before */}
              제품
            </th>
            {/* 신고증상 — 제품 바로 다음 자리. 정렬 대상은 아니다(SortColumn에 없다) — 파일 머리말. */}
            <th scope="col" className={thBaseClass}>신고증상</th>
            {/* 유·무상 — 제품 셀에서 빼낸 독립 열. 정렬 대상은 아니다(SortColumn에 없다). */}
            <th scope="col" className={thBaseClass}>유·무상</th>
            <th scope="col" className={thBaseClass}>담당 엔지니어</th>
            <th scope="col" className={thBaseClass}>
              {/* 실제 출하일(effectiveActualShipmentDate, primary — never substitutes 사내 목표 완료일 when null, in the body *and* in the sort) + 고객 요청 납기일 (secondary, still sortable) */}
              <div className="flex flex-col gap-0.5">
                <PrimarySortButton column="actualShipmentDate" label="출하일" sort={sort} onSortChange={onSortChange} />
                <SecondarySortButton column="customerRequestedDueDate" label="고객 요청 납기일" sort={sort} onSortChange={onSortChange} />
              </div>
            </th>
            <th scope="col" className={thBaseClass}>상세</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-zinc-100 last:border-0 align-top hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
            >
              {selectionMode && (
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`${row.intakeNumber} 선택`}
                    checked={selectedIds?.has(row.id) ?? false}
                    disabled={!(selectableIds?.has(row.id) ?? false)}
                    onChange={(event) => onToggleSelect?.(row.id, shiftKeyOf(event))}
                    onMouseDown={preventShiftClickTextSelection}
                    className="h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </td>
              )}
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/repair-cases/${row.id}`}
                      className="font-medium whitespace-nowrap text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                    >
                      {row.intakeNumber}
                    </Link>
                    <SourceBadge source={row.source} placeKey={badgePlaceKey} />
                  </div>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{row.receivedAt}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">보고서번호 {row.legacyReportNumber ?? "—"}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={row.effectiveStatus} placeKey={badgePlaceKey} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <PriorityBadge priority={row.priority} placeKey={badgePlaceKey} />
                    <OverdueBadge
                      isOverdue={row.effectiveIsOverdue}
                      placeKey={badgePlaceKey}
                    />
                    {/* 「납기 지연」 바로 뒤다 — 둘은 다른 판정이지만(지연은 사내
                        목표 완료일, 임박은 고객 요청 납기일) 사람이 같은 물음으로
                        읽는 자리라 나란히 선다. 색은 일부러 갈랐다(badges.tsx). */}
                    <DueDateNearBadge
                      isDueDateNear={dueDateNearCaseIds?.has(row.id) ?? false}
                      placeKey={badgePlaceKey}
                    />
                    <HoldBadge
                      isOnHold={row.holdState?.isOnHold ?? false}
                      placeKey={badgePlaceKey}
                    />
                    <WorkflowOverrideBadge
                      hasOverride={row.hasWorkflowOverride}
                      placeKey={badgePlaceKey}
                    />
                    {/* 🔴 「[최종 출하 승인 완료]」 — 배지 묶음의 **맨 뒤**다
                        (2026-11-08). 앞의 넷은 「이 건이 지금 어떤 상태인가」를
                        말하고, 이것은 그 위에 얹히는 **결재 사실** 하나다. 묶음이
                        wrap 이라 좁아지면 아래로 접힌다 — 칼럼이 옆으로 늘지
                        않는다. 상세 머리 카드도 같은 자리에 같은 차례로 둔다. */}
                    <FinalShipmentApprovedBadge
                      approved={finalShipmentApprovedCaseIds?.has(row.id) ?? false}
                      placeKey={badgePlaceKey}
                    />
                  </div>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">{row.customerName}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{row.endUserName ?? "-"}</span>
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="whitespace-nowrap">
                    {row.productCategory} / {row.modelName}
                  </span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    S/N {row.serialNumber} / L/N {row.lotNumber}
                  </span>
                </div>
              </td>
              {/* 신고증상 — 폭을 묶고 두 줄에서 자른다. 잘린 것은 …, 전체는 title(파일 머리말). */}
              <td className="max-w-[220px] px-3 py-2">
                <span className="line-clamp-2" title={row.reportedSymptom ?? undefined}>
                  {row.reportedSymptom ?? "-"}
                </span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{row.paidOrWarranty}</td>
              <td className="px-3 py-2 whitespace-nowrap">{row.engineerName ?? "미배정"}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium whitespace-nowrap">{row.effectiveActualShipmentDate ?? "-"}</span>
                  <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">
                    고객요청{" "}
                    {/* 🔴 자리를 넘겨도 **날짜는 안 사라진다** — 끄는 것은 꼬리표
                        「(내자)」 하나뿐이다(RequestedDueDateValue 머리말). */}
                    <RequestedDueDateValue
                      customerRequestedDueDate={row.customerRequestedDueDate}
                      domesticOrderDueDates={row.domesticOrderDueDates}
                      isDueDateNear={dueDateNearCaseIds?.has(row.id) ?? false}
                      placeKey={badgePlaceKey}
                    />
                  </span>
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link
                  href={`/repair-cases/${row.id}`}
                  className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
                >
                  상세
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
  );
}
