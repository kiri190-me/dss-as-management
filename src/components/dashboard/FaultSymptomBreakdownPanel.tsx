"use client";

import { useMemo, useState } from "react";
import PieChart from "@/components/common/PieChart";
import {
  buildFaultSymptomBreakdowns,
  formatFaultSymptomPeriodLabel,
  formatFaultSymptomSliceLabel,
  listFaultSymptomYears,
  selectFaultSymptomPeriodCases,
  FAULT_SYMPTOM_ALL_PERIOD,
  FAULT_SYMPTOM_PERIOD_MONTHS,
  type FaultSymptomKindBreakdown,
  type FaultSymptomPeriod,
  type FaultSymptomSlice,
} from "@/lib/domain/fault-symptom-breakdown";
import type { EffectiveRepairCase } from "@/lib/domain/local/workflow/effective-repair-case";
import {
  weeklyReportKindDescriptions,
  WEEKLY_REPORT_KINDS,
  type WeeklyReportKind,
} from "@/lib/domain/weekly-report";

/**
 * 신고 증상별 현황 — RFG · MB 원 두 개.
 *
 * 숫자는 전부 buildFaultSymptomBreakdowns 가 만든다. 이 파일은 그 결과를 놓고
 * 무엇을 골랐는지만 기억한다 — 세는 규칙이 화면에 스며들면 시험할 방법이
 * 브라우저를 띄우는 것밖에 남지 않는다.
 *
 * **새 조회를 하지 않는다.** 대시보드가 이미 손에 쥔 cases 배열을 그대로 받는다.
 * 그것이 전체 A/S 현황과 같은 행 집합이고, 그것이 두 화면의 숫자가 어긋나지 않는
 * 이유다. 연도·월로 좁혀 볼 때도 마찬가지다 — 새로 조회하지 않고 그 배열을
 * selectFaultSymptomPeriodCases 로 거르기만 한다.
 */

/** 종류마다 따로 기억한다 — 한쪽에서 고른 것이 다른 쪽 원의 선택을 지우면 안 된다. */
type SelectionByKind = Record<WeeklyReportKind, string | null>;

const NO_SELECTION: SelectionByKind = { RFG: null, MB: null };

/** 고르는 칸 두 개가 같은 모양이어야 한 벌로 읽힌다. 저장소의 다른 select 와 같은 결. */
const SELECT_CLASS =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

type FaultSymptomBreakdownPanelProps = {
  cases: EffectiveRepairCase[];
};

export default function FaultSymptomBreakdownPanel({ cases }: FaultSymptomBreakdownPanelProps) {
  const [period, setPeriod] = useState<FaultSymptomPeriod>(FAULT_SYMPTOM_ALL_PERIOD);
  const [selection, setSelection] = useState<SelectionByKind>(NO_SELECTION);

  // 연도 목록은 걸린 기간과 무관하게 **원본** 배열에서 뽑는다. 걸러진 배열에서
  // 뽑으면 2025년을 고르는 순간 목록에 2025년만 남아 다른 해로 돌아갈 수 없다.
  const years = useMemo(() => listFaultSymptomYears(cases), [cases]);
  const periodCases = useMemo(() => selectFaultSymptomPeriodCases(cases, period), [cases, period]);
  const breakdowns = useMemo(() => buildFaultSymptomBreakdowns(periodCases), [periodCases]);

  const periodLabel = formatFaultSymptomPeriodLabel(period);
  const isPeriodFiltered = period.year !== null;

  const toggle = (kind: WeeklyReportKind, key: string) => {
    // 같은 조각을 다시 누르면 접힌다.
    setSelection((prev) => ({ ...prev, [kind]: prev[kind] === key ? null : key }));
  };

  // 기간을 바꾸면 펼쳐 둔 조각을 접는다 — 다른 기간에서 고른 조각이 그대로
  // 펼쳐져 있으면 제목과 내용이 어긋난 채 남는다.
  const changeYear = (raw: string) => {
    // 연도를 바꾸면 월은 언제나 '전체'로 되돌아간다. 2025년 3월을 보다 2024년으로
    // 옮겼을 때 3월이 남아 있으면, 사람은 자기가 무엇을 보고 있는지 놓친다.
    setPeriod(raw === "" ? FAULT_SYMPTOM_ALL_PERIOD : { year: Number(raw), month: null });
    setSelection(NO_SELECTION);
  };
  const changeMonth = (raw: string) => {
    // 연도가 전체면 월만 정해진 기간은 만들 수 없다(타입이 막는다). 칸도 잠겨 있어
    // 여기까지 오지 않지만, 들어오더라도 아무 일이 없도록 그대로 돌려준다.
    setPeriod((prev) =>
      prev.year === null ? prev : { year: prev.year, month: raw === "" ? null : Number(raw) }
    );
    setSelection(NO_SELECTION);
  };

  const byKind = new Map(breakdowns.map((breakdown) => [breakdown.kind, breakdown]));

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">신고 증상별 현황</h2>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select
            value={period.year ?? ""}
            onChange={(e) => changeYear(e.target.value)}
            aria-label="신고 증상별 현황 연도"
            className={SELECT_CLASS}
          >
            <option value="">전체</option>
            {/* 접수 건이 있는 해만 나온다 — 자료에 없는 해는 골라 봐야 언제나 0건이다. */}
            {years.map((year) => (
              <option key={year} value={year}>
                {year}년
              </option>
            ))}
          </select>
          <select
            value={period.month ?? ""}
            onChange={(e) => changeMonth(e.target.value)}
            disabled={!isPeriodFiltered}
            aria-label="신고 증상별 현황 월"
            title={isPeriodFiltered ? undefined : "연도를 먼저 고르면 월을 고를 수 있습니다."}
            className={SELECT_CLASS}
          >
            <option value="">전체</option>
            {/* 1~12월을 전부 보여 준다. 있는 달만 보여 주면 '그 달에 0건'과
                '고를 수조차 없음'이 구별되지 않는다. */}
            {FAULT_SYMPTOM_PERIOD_MONTHS.map((month) => (
              <option key={month} value={month}>
                {month}월
              </option>
            ))}
          </select>
          {/* 회색으로 잠가 두기만 하면 왜 못 고르는지 알 수 없다. 이유를 글로 적는다. */}
          {isPeriodFiltered ? null : (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              연도를 먼저 고르면 월을 고를 수 있습니다.
            </span>
          )}
        </div>
      </div>

      {/* 그래프만 바뀌고 아무 말이 없으면 무엇이 걸려 있는지 알 수 없다. */}
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {periodLabel} · 접수 {periodCases.length}건
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {WEEKLY_REPORT_KINDS.map((kind) => {
          const breakdown = byKind.get(kind);
          if (!breakdown) return null;
          return (
            <FaultSymptomKindCard
              key={kind}
              breakdown={breakdown}
              periodLabel={periodLabel}
              isPeriodFiltered={isPeriodFiltered}
              selectedKey={selection[kind]}
              onSelectSlice={(sliceKey) => toggle(kind, sliceKey)}
            />
          );
        })}
      </div>
    </section>
  );
}

function FaultSymptomKindCard({
  breakdown,
  periodLabel,
  isPeriodFiltered,
  selectedKey,
  onSelectSlice,
}: {
  breakdown: FaultSymptomKindBreakdown;
  periodLabel: string;
  isPeriodFiltered: boolean;
  selectedKey: string | null;
  onSelectSlice: (sliceKey: string) => void;
}) {
  const { kind, total, slices } = breakdown;
  // 설명 글자는 주간보고가 정해 둔 것을 그대로 쓴다 — 손으로 적으면 두 화면이 갈라진다.
  const description = weeklyReportKindDescriptions[kind];
  const selected = slices.find((slice) => slice.key === selectedKey) ?? null;
  // 기간 때문에 0건인 것과, 원래 그 종류 건이 없는 것은 다른 말이다.
  const emptyMessage = isPeriodFiltered
    ? `${periodLabel}에 접수된 ${kind} 건이 없습니다.`
    : "해당 건이 없습니다.";
  // 기간을 걸어도 '출하 완료 건까지 포함한다'는 여전히 맞는 말이라 지우지 않고,
  // 무엇을 기준으로 걸렀는지(출하일이 아니라 인수일)만 덧붙인다.
  const periodNote = isPeriodFiltered
    ? ` 기간은 인수일 기준이라 ${periodLabel}에 인수된 건만 셉니다.`
    : "";

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{kind}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">({description})</span>
        <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">총 {total}건</span>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>
      ) : (
        <>
          <div className="mt-4">
            <PieChart
              slices={slices}
              ariaLabel={`${kind}(${description}) 신고 증상별 건수 비율, ${periodLabel} 총 ${total}건`}
              formatLabel={formatFaultSymptomSliceLabel}
              selectedKey={selectedKey}
              onSelectSlice={onSelectSlice}
            />
          </div>
          {/* 이 한 줄이 없으면 사람이 대시보드의 '현재 입고 수'와 견주다 어긋난
              이유를 찾지 못한다. 이 그래프는 상태로 거르는 것이 없다. */}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            출하 완료된 건까지 모두 포함한 숫자입니다.{periodNote} 조각을 누르면 그 증상으로 접수된
            건들의 인수점검 결과가 펼쳐집니다.
          </p>
          {selected ? <SelectedSliceDetail slice={selected} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * 고른 조각 하나를 펼친 자리.
 *
 * 묶음이 하나도 없는 경우는 그리지 않는다 — 건수 0 인 조각은 애초에 만들어지지
 * 않고, 건이 있으면 그 건은 반드시 어느 결과 묶음이거나 '인수점검 전'이라
 * 둘 다 비는 일이 없다.
 */
function SelectedSliceDetail({ slice }: { slice: FaultSymptomSlice }) {
  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {formatFaultSymptomSliceLabel(slice)} — {slice.count}건
      </h4>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">인수점검 결과</p>

      <ul className="mt-2 space-y-1">
        {slice.intakeInspectionResults.map((group) => (
          <li
            key={group.result}
            className="flex items-start justify-between gap-3 border-b border-zinc-200 py-1 last:border-b-0 dark:border-zinc-700/60"
          >
            {/* 인수점검 결과는 자유 입력이라 여러 줄이 들어 있을 수 있다. */}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
              {group.result}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
              {group.count}건
            </span>
          </li>
        ))}
        {slice.intakeInspectionPendingCount > 0 ? (
          <li className="pt-1 text-sm text-zinc-500 dark:text-zinc-400">
            인수점검 전 {slice.intakeInspectionPendingCount}건
          </li>
        ) : null}
      </ul>
    </div>
  );
}
