"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PieChart from "@/components/common/PieChart";
import { repairCasesReportedSymptomHref } from "@/lib/domain/reported-symptom-param";
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
 * 펼친 자리에 그리는 줄 하나. 결과 묶음과 '인수점검 전'을 같은 모양으로 만들어
 * 한 <ul> 에 이어 붙인다 — 둘이 **같은 분모**로 센 비율이라(도메인 파일의
 * FaultSymptomIntakeInspectionResult 머리말) 다른 모양으로 그리면 다 더해 100%
 * 라는 사실이 눈에 보이지 않는다.
 */
type SliceDetailRow = {
  key: string;
  /** '인수점검 전' 줄이면 null — 화면이 다른 글자를 적는다. */
  result: string | null;
  count: number;
  percentage: number;
};

function toDetailRows(slice: FaultSymptomSlice): SliceDetailRow[] {
  const rows: SliceDetailRow[] = slice.intakeInspectionResults.map((group) => ({
    // 결과 원문을 그대로 key 로 쓰지 않는다 — '인수점검 전'이라고 **적힌 진짜
    // 결과**가 들어오면 아래 줄과 겹친다. 조각 key 가 성격을 앞에 붙이는 것과
    // 같은 까닭이다.
    key: `RESULT:${group.result}`,
    result: group.result,
    count: group.count,
    percentage: group.percentage,
  }));
  if (slice.intakeInspectionPendingCount > 0) {
    rows.push({
      key: "PENDING",
      result: null,
      count: slice.intakeInspectionPendingCount,
      percentage: slice.intakeInspectionPendingPercentage,
    });
  }
  return rows;
}

/** 링크일 때와 아닐 때가 **같은 칸 나눔**이어야 숫자 열이 흔들리지 않는다. */
const DETAIL_ROW_CLASS = "flex w-full items-start justify-between gap-3 py-1 text-left";

function SliceDetailRowBody({ row }: { row: SliceDetailRow }) {
  return (
    <>
      {/* 인수점검 결과는 자유 입력이라 여러 줄이 들어 있을 수 있다. */}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-200">
        {row.result ?? "인수점검 전"}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
        {row.count}건
      </span>
      <span className="w-14 shrink-0 text-right text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
        {row.percentage}%
      </span>
    </>
  );
}

/**
 * 고른 조각 하나를 펼친 자리.
 *
 * 묶음이 하나도 없는 경우는 그리지 않는다 — 건수 0 인 조각은 애초에 만들어지지
 * 않고, 건이 있으면 그 건은 반드시 어느 결과 묶음이거나 '인수점검 전'이라
 * 둘 다 비는 일이 없다.
 *
 * ── 🔴 어느 줄을 눌러도 같은 목록이다 ───────────────────────────────────
 * 사용자 결정(2026-09-30)이다. 인수점검 결과로는 **더 좁히지 않는다** — 그래서
 * 주소도 조각 하나에 **하나뿐**이고, 줄마다 만들지 않는다. 코드 모양이 그 결정을
 * 그대로 담고 있어야 다음 사람이 "결과별로도 걸어 주자"로 되돌리지 않는다.
 * 그 사실은 누르기 **전에** 글로 알린다(아래 안내 문구) — 안 그러면 눌러 보고
 * "왜 점검 결과가 안 걸렸지" 한다.
 *
 * ── 누를 수 없는 조각이 있다 ────────────────────────────────────────────
 * `미입력`은 증상이 비어 있는 건들이고 `기타`는 여러 증상을 접은 것이라, 신고
 * 증상 **하나**로 걸 수가 없다. 자유 입력이라 주소에 실을 수 없는 증상도 있다
 * (reported-symptom-param.ts). 그때는 링크를 만들지 않고 까닭을 한 줄 적는다 —
 * 눌러도 아무 일이 없는 링크를 두는 것보다 낫다.
 */
function SelectedSliceDetail({ slice }: { slice: FaultSymptomSlice }) {
  const isSymptomSlice = slice.sliceKind === "SYMPTOM";
  const href = isSymptomSlice ? repairCasesReportedSymptomHref(slice.label) : null;
  const rows = toDetailRows(slice);

  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {formatFaultSymptomSliceLabel(slice)} — {slice.count}건
      </h4>
      {/* 🔴 분모를 밝힌다. '인수점검 전'이 따로 나오고 있어서, 무엇을 100%로
          본 값인지 적지 않으면 숫자가 안 맞는 것처럼 보인다. */}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        인수점검 결과 · 비율은 인수점검 전을 포함한 이 증상 {slice.count}건을 100%로 본 값입니다.
        소수 첫째 자리에서 반올림하므로 다 더해 100%가 되지 않을 수 있습니다.
      </p>
      {/* 누르기 전에 어디로 가는지 알려 준다 — 누른 뒤에 알면 늦다. */}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {href
          ? `아래 어느 줄을 눌러도 신고 증상이 '${slice.label}'인 수리 건 전체를 봅니다 — 인수점검 결과로는 더 좁히지 않습니다.`
          : isSymptomSlice
            ? "이 증상은 글자가 너무 길거나 줄바꿈이 섞여 있어 목록 주소에 실을 수 없습니다. 아래 줄은 눌러도 목록으로 가지 않습니다."
            : "이 조각은 신고 증상 하나로 좁힐 수 없어, 아래 줄은 눌러도 목록으로 가지 않습니다."}
      </p>

      <ul className="mt-2 space-y-1">
        {rows.map((row) => (
          <li
            key={row.key}
            className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-700/60"
          >
            {href ? (
              // 🔴 누르는 자리는 링크여야 한다. <li> 에 onClick 만 달면 키보드로
              //    닿지 못하고 낭독기도 누를 것이 있다는 사실을 말하지 못한다.
              <Link
                href={href}
                // relative 를 떼지 말 것 — 안의 sr-only 는 절대 배치라, 기준이 되는
                // 조상이 없으면 그 span 이 화면 바닥에 자리를 주장해 세로 스크롤바가
                // 둘이 된다(주간보고의 인수번호 링크에서 실제로 겪은 일).
                className={`${DETAIL_ROW_CLASS} relative -mx-1 rounded px-1 hover:bg-zinc-100 dark:hover:bg-zinc-700/40`}
              >
                <SliceDetailRowBody row={row} />
                <span className="sr-only">이 신고 증상의 수리 건 목록으로 이동</span>
              </Link>
            ) : (
              <div className={DETAIL_ROW_CLASS}>
                <SliceDetailRowBody row={row} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
