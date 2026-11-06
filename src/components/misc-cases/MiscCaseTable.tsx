"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { domesticOrderDetailHrefs } from "@/lib/domain/domestic-order-detail-tabs";
import type { MiscCaseSortColumn, MiscCaseSortState } from "@/lib/domain/misc-case-list";
import { MISC_CASE_FIELDS, type MiscCaseRow } from "./misc-case-fields";

/**
 * ============================================================================
 * 「기타건 현황」의 표 (2026-11-06)
 * ============================================================================
 * 생김새는 전체 A/S 현황의 표에서 가져왔다(components/repair-cases/RepairCaseTable.tsx) —
 * 머리글 클래스 한 벌, **머리글 칸 하나에 주/보조 정렬 단추 둘**, 줄마다 위를 맞춘
 * 두 줄짜리 셀, 맨 끝의 [상세] 칸. 같은 서비스의 현황 화면 둘이 서로 다른 모양의
 * 표를 달고 있으면 같은 자리에서 다른 눈높이를 요구한다.
 *
 * ── 🔴 베끼지 **않은** 것 ───────────────────────────────────────────────
 *  · **체크박스 열 · 삭제 모드** — 이 화면에는 쓰기가 하나도 없다. 지우는 일은
 *    내자 정리의 휴지통이 하고(관리 권한), 여기서 같은 일을 또 하면 같은 줄을 지우는
 *    길이 둘이 된다.
 *  · **상태 · 우선순위 · 담당 엔지니어 · 납기 배지** — 전부 **수리 건의 값**이고
 *    기타건에는 그 건이 없다. 베끼면 모든 줄에서 비어 있는 열이 넷 생긴다.
 *  · **sticky 머리글** — 저쪽 표는 `<thead className="sticky top-0">` 이지만, 그것이
 *    실제로 듣는 것은 ResponsiveList 의 `stickyHeader` 를 켠 목록뿐이고(그 파일의
 *    '열 제목을 붙여 두는 목록만 켠다'), 켜려면 부르는 쪽이 확정 높이를 가진 세로
 *    flex 상자여야 한다. 이 화면은 그 상자가 아니다 — 안 켠 채 `sticky` 만 적어 두면
 *    아무 일도 하지 않는 클래스가 남는다.
 *
 * ── 🔴 열은 일곱 + [상세] ───────────────────────────────────────────────
 * 칸의 이름표와 값은 **한 벌에서** 온다(misc-case-fields.tsx) — 카드와 갈라지지
 * 않게 하는 장치다. 이 파일이 정하는 것은 **그 칸들을 어떻게 묶어 보여 줄지**뿐이다:
 * 전체 A/S 현황처럼 **주 값 + 보조 값**을 한 칸에 포개 폭을 아낀다.
 *
 *   ① 품명(링크) + 상태        ② 공급처
 *   ③ 발행번호 + 발행일자      ④ 발주서번호 + 발주발행일
 *   ⑤ PJT                      ⑥ 현황
 *   ⑦ 금액(VAT별도) + 입금완료 ⑧ 납품일        ⑨ 상세
 *
 * ── 🔴 줄의 차례를 여기서 정하지 않는다 ────────────────────────────────
 * 머리글을 누르면 부르는 쪽에 알리기만 한다(onSortChange). 다음 차례가 무엇인지는
 * 도메인 하나가 정한다(domain/misc-case-list.ts 의 nextMiscCaseSort) — 화면에 적으면
 * 그 규칙을 브라우저 없이 시험할 수 없다.
 *
 * ⚠️ **표 껍데기(`<div>`)를 두지 않는다.** 표/카드 전환은 ResponsiveList 가 실제
 * 넘침을 재서 정하는데, 여기서 스크롤 래퍼로 감싸면 그 넘침이 안쪽에서 흡수돼
 * 바깥은 영원히 "들어간다"고 답한다(그 파일의 '표 껍데기는 여기가 소유한다').
 * ============================================================================
 */

type MiscCaseTableProps = {
  rows: readonly MiscCaseRow[];
  sort: MiscCaseSortState;
  onSortChange: (column: MiscCaseSortColumn) => void;
};

const thBaseClass =
  "border-b border-zinc-200 bg-white px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";

function sortIndicator(sort: MiscCaseSortState, column: MiscCaseSortColumn): string {
  if (sort.column !== column) return "";
  return sort.direction === "asc" ? "▲" : "▼";
}

/** 한 칸에 포갠 둘 중 **위**. 전체 A/S 현황의 PrimarySortButton 과 같은 무게다. */
function PrimarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: MiscCaseSortColumn;
  label: string;
  sort: MiscCaseSortState;
  onSortChange: (column: MiscCaseSortColumn) => void;
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

/** 한 칸에 포갠 둘 중 **아래**. 본문의 보조 줄과 같은 무게로 가볍게 그린다. */
function SecondarySortButton({
  column,
  label,
  sort,
  onSortChange,
}: {
  column: MiscCaseSortColumn;
  label: string;
  sort: MiscCaseSortState;
  onSortChange: (column: MiscCaseSortColumn) => void;
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

/** 보조 줄 — 본문에서 둘째 값에 쓰는 작은 회색 글자. */
function SecondaryLine({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs whitespace-nowrap text-zinc-500 dark:text-zinc-400">{children}</span>
  );
}

export default function MiscCaseTable({ rows, sort, onSortChange }: MiscCaseTableProps) {
  return (
    <table className="w-full min-w-[980px] border-collapse text-sm">
      <thead>
        <tr>
          <th scope="col" className={thBaseClass}>
            {/* 품명(주, 링크) + 상태(보조, 정렬 대상 아님 — 값이 둘뿐이라 세워도
                뜻이 없다) */}
            <div className="flex flex-col gap-0.5">
              <PrimarySortButton
                column="modelName"
                label={MISC_CASE_FIELDS.modelName.label}
                sort={sort}
                onSortChange={onSortChange}
              />
              <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                {MISC_CASE_FIELDS.status.label}
              </span>
            </div>
          </th>
          <th scope="col" className={thBaseClass}>
            <PrimarySortButton
              column="customerName"
              label={MISC_CASE_FIELDS.customerName.label}
              sort={sort}
              onSortChange={onSortChange}
            />
          </th>
          <th scope="col" className={thBaseClass}>
            {/* 발행번호(주) + 발행일자(보조) — 둘 다 누를 수 있다. 처음 그리는
                차례가 발행일자 내림차순이라(MISC_CASE_DEFAULT_SORT) 보조 쪽에
                ▼ 가 켜진 채로 열린다. */}
            <div className="flex flex-col gap-0.5">
              <PrimarySortButton
                column="quoteNumber"
                label={MISC_CASE_FIELDS.quoteNumber.label}
                sort={sort}
                onSortChange={onSortChange}
              />
              <SecondarySortButton
                column="quoteIssuedDate"
                label={MISC_CASE_FIELDS.quoteIssuedDate.label}
                sort={sort}
                onSortChange={onSortChange}
              />
            </div>
          </th>
          <th scope="col" className={thBaseClass}>
            {/* 발주서번호(주, 정렬 대상 아님) + 발주발행일(보조, 누를 수 있다) */}
            <div className="flex flex-col gap-0.5">
              <span className="whitespace-nowrap">{MISC_CASE_FIELDS.purchaseOrderNumber.label}</span>
              <SecondarySortButton
                column="orderIssuedDate"
                label={MISC_CASE_FIELDS.orderIssuedDate.label}
                sort={sort}
                onSortChange={onSortChange}
              />
            </div>
          </th>
          <th scope="col" className={thBaseClass}>
            {MISC_CASE_FIELDS.projectName.label}
          </th>
          <th scope="col" className={thBaseClass}>
            {MISC_CASE_FIELDS.progressNote.label}
          </th>
          <th scope="col" className={thBaseClass}>
            {/* 금액(주) + 입금완료 여부(보조) */}
            <div className="flex flex-col gap-0.5">
              <span className="whitespace-nowrap">{MISC_CASE_FIELDS.amount.label}</span>
              <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                {MISC_CASE_FIELDS.paymentCompleted.label}
              </span>
            </div>
          </th>
          <th scope="col" className={thBaseClass} title={MISC_CASE_FIELDS.deliveredDate.hint}>
            {MISC_CASE_FIELDS.deliveredDate.label}
          </th>
          <th scope="col" className={thBaseClass}>
            상세
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
          >
            <td className="px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium break-words">{MISC_CASE_FIELDS.modelName.of(row)}</span>
                <SecondaryLine>{MISC_CASE_FIELDS.status.of(row)}</SecondaryLine>
              </div>
            </td>
            <td className="px-3 py-2 break-words">{MISC_CASE_FIELDS.customerName.of(row)}</td>
            <td className="px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="break-words">{MISC_CASE_FIELDS.quoteNumber.of(row)}</span>
                <SecondaryLine>{MISC_CASE_FIELDS.quoteIssuedDate.of(row)}</SecondaryLine>
              </div>
            </td>
            <td className="px-3 py-2">
              <div className="flex flex-col gap-0.5">
                <span className="break-words">{MISC_CASE_FIELDS.purchaseOrderNumber.of(row)}</span>
                <SecondaryLine>{MISC_CASE_FIELDS.orderIssuedDate.of(row)}</SecondaryLine>
              </div>
            </td>
            <td className="px-3 py-2 break-words">{MISC_CASE_FIELDS.projectName.of(row)}</td>
            {/* 🔴 이 표에서 **whitespace-nowrap 이 아닌 유일한 자리**다 — 사람이 긴
                문장을 적는 칸이라 폭을 묶고 두 줄에서 자른다. 잘린 것은 … 로 보이고
                전체는 title 로 뜬다(전체 A/S 현황의 신고증상 칸과 같은 방식).
                조용히 잘리면 사람은 그게 전부인 줄 안다. */}
            <td className="max-w-[220px] px-3 py-2">
              <span className="line-clamp-2" title={row.progressNote ?? undefined}>
                {MISC_CASE_FIELDS.progressNote.of(row)}
              </span>
            </td>
            <td className="px-3 py-2">
              <div className="flex flex-col gap-0.5">
                {/* 금액은 자릿수를 세로로 훑어 읽는 값이라 오른쪽 정렬 + tabular-nums 다
                    (내자 정리의 금액 칸과 같은 규칙). */}
                <span className="block text-right tabular-nums">{MISC_CASE_FIELDS.amount.of(row)}</span>
                <span className="block text-right text-xs text-zinc-500 dark:text-zinc-400">
                  {MISC_CASE_FIELDS.paymentCompleted.of(row)}
                </span>
              </div>
            </td>
            <td className="px-3 py-2 whitespace-nowrap">{MISC_CASE_FIELDS.deliveredDate.of(row)}</td>
            <td className="px-3 py-2 whitespace-nowrap">
              <Link
                href={domesticOrderDetailHrefs(row.id).root}
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
