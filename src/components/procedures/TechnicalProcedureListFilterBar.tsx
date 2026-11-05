"use client";

import {
  PROCEDURE_EQUIPMENT_TYPE_CODES,
  procedureEquipmentTypeLabels,
} from "@/lib/domain/procedure-template-types";
import {
  PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL,
  TECHNICAL_PROCEDURE_LIST_FILTER_NONE,
  isTechnicalProcedureListFilterActive,
  parseProcedureEquipmentTypeFilter,
  type TechnicalProcedureListFilter,
} from "@/lib/domain/technical-procedure-list-filter";

/**
 * ============================================================================
 * [기술 작업 절차] 목록의 거르개 줄 — 이름 검색 · 설비 유형 (2026-11-05)
 * ============================================================================
 * 🔴 **값을 제 안에 쥐지 않는다.** 받은 값을 그리고 바뀐 값을 올려 보낼 뿐이다 —
 * 거르개가 바뀔 때 **고르기를 푸는 일**은 부르는 쪽이 한다. 그 일을 여기서 하면
 * 삭제 사고를 막는 규칙이 화면 조각 안에 숨어, 다른 목록이 이 조각을 가져다 쓰는
 * 날 조용히 빠진다(까닭은 domain/technical-procedure-list-filter.ts 머리말).
 *
 * 🔴 **이름표를 손으로 다시 적지 않는다.** 설비 유형의 글자는
 * `procedureEquipmentTypeLabels` 한 벌뿐이다 — 표 칸 · 카드 · 만들기 창이 이미
 * 그 표를 쓰고 있어서, 여기만 손으로 적으면 이름이 바뀌는 날 거르개 하나만
 * 옛 글자로 남는다.
 *
 * ── 🔴 세는 수가 무엇인지 ───────────────────────────────────────────────
 * 탭 이름의 수(`사용중 (N)`)는 **거르개와 무관한 전체**다 — 거르개를 따라
 * 움직이면 "몇 개가 숨겨졌는지"를 알 길이 없어진다. 지금 보이는 수는 여기서
 * `전체 N개 중 M개` 로 말한다. 두 수가 같은 것을 센다고 읽히면 안 되므로 **단위
 * 낱말을 함께 적는다**: 평소 목록은 계열당 한 줄이라 「절차」, 삭제 모드는 묶음을
 * 풀어 판마다 한 줄이라 「판」이다(부르는 쪽이 unitLabel 로 넘긴다).
 * ============================================================================
 */

/** 🔴 거른 결과가 0건일 때 — 목록을 그냥 비워 두지 않는다("다 사라졌다"로 읽힌다). */
export const TECHNICAL_PROCEDURE_FILTER_EMPTY_TEXT =
  "조건에 맞는 기술 절차가 없습니다 — 이름을 지우거나 설비 유형을 [전체]로 바꿔 보세요.";

const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500";
const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
const labelClass = "text-xs text-zinc-500 dark:text-zinc-400";

export default function TechnicalProcedureListFilterBar({
  filter,
  onFilterChange,
  totalCount,
  visibleCount,
  unitLabel,
}: {
  filter: TechnicalProcedureListFilter;
  /** 🔴 거르개가 바뀌었다 — 부르는 쪽이 여기서 고르기도 함께 추린다. */
  onFilterChange: (next: TechnicalProcedureListFilter) => void;
  /** 거르기 전의 줄 수. */
  totalCount: number;
  /** 거른 뒤 지금 화면에 서는 줄 수. */
  visibleCount: number;
  /** 그 줄이 무엇인지 — 평소 목록은 "절차", 삭제 모드는 "판". */
  unitLabel: string;
}) {
  const isActive = isTechnicalProcedureListFilterActive(filter);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <label htmlFor="technical-procedure-name-query" className={labelClass}>
            이름 검색
          </label>
          <input
            id="technical-procedure-name-query"
            type="search"
            value={filter.nameQuery}
            onChange={(event) => onFilterChange({ ...filter, nameQuery: event.target.value })}
            placeholder="절차 이름의 일부"
            className={inputClass}
          />
        </div>

        <div className="flex w-44 flex-col gap-1">
          <label htmlFor="technical-procedure-equipment-type" className={labelClass}>
            설비 유형
          </label>
          <select
            id="technical-procedure-equipment-type"
            value={filter.equipmentType}
            onChange={(event) =>
              onFilterChange({ ...filter, equipmentType: parseProcedureEquipmentTypeFilter(event.target.value) })
            }
            className={selectClass}
          >
            <option value={PROCEDURE_EQUIPMENT_TYPE_FILTER_ALL}>전체</option>
            {PROCEDURE_EQUIPMENT_TYPE_CODES.map((code) => (
              <option key={code} value={code}>
                {procedureEquipmentTypeLabels[code]}
              </option>
            ))}
          </select>
        </div>

        {/* 🔴 거르는 중일 때만 선다. 거르개를 켜 둔 것을 잊고 "다 사라졌다"고
            읽는 사람에게, 되돌리는 길이 한 번 누르기여야 한다. */}
        {isActive && (
          <button
            type="button"
            onClick={() => onFilterChange(TECHNICAL_PROCEDURE_LIST_FILTER_NONE)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            거르기 지우기
          </button>
        )}
      </div>

      <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
        {isActive
          ? `${unitLabel} ${totalCount}개 중 ${visibleCount}개`
          : `${unitLabel} ${totalCount}개`}
      </p>
    </div>
  );
}
