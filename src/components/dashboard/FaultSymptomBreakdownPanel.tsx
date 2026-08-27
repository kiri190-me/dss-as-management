"use client";

import { useMemo, useState } from "react";
import FaultSymptomPieChart from "@/components/dashboard/FaultSymptomPieChart";
import {
  buildFaultSymptomBreakdowns,
  formatFaultSymptomSliceLabel,
  type FaultSymptomKindBreakdown,
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
 * 이유다.
 */

/** 종류마다 따로 기억한다 — 한쪽에서 고른 것이 다른 쪽 원의 선택을 지우면 안 된다. */
type SelectionByKind = Record<WeeklyReportKind, string | null>;

const NO_SELECTION: SelectionByKind = { RFG: null, MB: null };

type FaultSymptomBreakdownPanelProps = {
  cases: EffectiveRepairCase[];
};

export default function FaultSymptomBreakdownPanel({ cases }: FaultSymptomBreakdownPanelProps) {
  const breakdowns = useMemo(() => buildFaultSymptomBreakdowns(cases), [cases]);
  const [selection, setSelection] = useState<SelectionByKind>(NO_SELECTION);

  const toggle = (kind: WeeklyReportKind, key: string) => {
    // 같은 조각을 다시 누르면 접힌다.
    setSelection((prev) => ({ ...prev, [kind]: prev[kind] === key ? null : key }));
  };

  const byKind = new Map(breakdowns.map((breakdown) => [breakdown.kind, breakdown]));

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">신고 증상별 현황</h2>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {WEEKLY_REPORT_KINDS.map((kind) => {
          const breakdown = byKind.get(kind);
          if (!breakdown) return null;
          return (
            <FaultSymptomKindCard
              key={kind}
              breakdown={breakdown}
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
  selectedKey,
  onSelectSlice,
}: {
  breakdown: FaultSymptomKindBreakdown;
  selectedKey: string | null;
  onSelectSlice: (sliceKey: string) => void;
}) {
  const { kind, total, slices } = breakdown;
  // 설명 글자는 주간보고가 정해 둔 것을 그대로 쓴다 — 손으로 적으면 두 화면이 갈라진다.
  const description = weeklyReportKindDescriptions[kind];
  const selected = slices.find((slice) => slice.key === selectedKey) ?? null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{kind}</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">({description})</span>
        <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">총 {total}건</span>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">해당 건이 없습니다.</p>
      ) : (
        <>
          <div className="mt-4">
            <FaultSymptomPieChart
              slices={slices}
              ariaLabel={`${kind}(${description}) 신고 증상별 건수 비율, 총 ${total}건`}
              selectedKey={selectedKey}
              onSelectSlice={onSelectSlice}
            />
          </div>
          {/* 이 한 줄이 없으면 사람이 대시보드의 '현재 입고 수'와 견주다 어긋난
              이유를 찾지 못한다. 이 그래프는 거른 것이 없다. */}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            출하 완료된 건까지 모두 포함한 숫자입니다. 조각을 누르면 그 증상으로 접수된 건들의
            인수점검 결과가 펼쳐집니다.
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
