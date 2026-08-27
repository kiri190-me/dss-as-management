"use client";

import { useMemo, useState, type ReactNode } from "react";
import PieChart from "@/components/common/PieChart";
import ProductModelRepairCaseHistory from "./ProductModelRepairCaseHistory";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";
import { formatPieSliceLabel, type PieSlice } from "@/lib/domain/pie-slices";
import {
  buildBillingBreakdown,
  buildEndUserBreakdown,
  buildFaultPartBreakdown,
  buildSymptomBreakdown,
  type IntakeInspectionDetail,
  type ProductModelBreakdownCase,
  type RequestedPartRow,
} from "@/lib/domain/product-model-breakdown";

/**
 * ============================================================================
 * 제품 모델 상세 · A/S 이력
 * ============================================================================
 * 예전에는 접수 건 목록 하나뿐이었다. 이제 이 구역은 세 가지를 한다.
 *
 *   1. **원형 그래프 네 종을 골라 켠다** — 고장 증상 · 고장 부품 · End-User ·
 *      유/무상. 여러 개를 동시에 켤 수 있고, **고른 차례대로** 아래에 쌓인다.
 *      처음에는 `고장 증상` 하나만 켜져 있다 — 넷 다 꺼두면 화면이 텅 비어
 *      무엇을 해야 하는지 알 수 없다.
 *   2. **접수 건 목록은 기본으로 접혀 있다.** 이 구역에 온 사람이 먼저 보려는
 *      것은 "이 모델이 무엇 때문에 들어오는가"이고, 스물몇 줄짜리 목록이 그
 *      앞을 막고 있으면 그래프까지 굴려 내려가야 한다.
 *   3. 펼친 목록은 **표/카드 전환 단추**를 갖는다 — 그 단추는 새로 만들지 않고
 *      ResponsiveList 의 것을 쓴다(ProductModelRepairCaseHistory 참조).
 *
 * ── 숫자는 여기서 만들지 않는다 ─────────────────────────────────────────
 * 네 그래프의 조각은 전부 product-model-breakdown.ts 가 만든다. 이 파일은 그
 * 결과를 놓고 **무엇을 켰고 무엇을 골랐는지**만 기억한다 — 세는 규칙이 화면에
 * 스며들면 시험할 방법이 브라우저를 띄우는 것밖에 남지 않는다.
 *
 * ── 새 조회를 하지 않는다 ───────────────────────────────────────────────
 * 접수 건도 요청 부품도 서버가 이미 손에 쥐어 준다(page.tsx). 그래야 이 화면의
 * 숫자와 위쪽 `모델 통계`의 숫자가 같은 행 집합에서 나온다.
 * ============================================================================
 */

type ChartId = "SYMPTOM" | "PART" | "END_USER" | "BILLING";

const CHART_LABELS: Record<ChartId, string> = {
  SYMPTOM: "고장 증상",
  PART: "고장 부품",
  END_USER: "End-User",
  BILLING: "유/무상",
};

/** 단추 줄의 차례. 켜는 차례(= 쌓이는 차례)는 사용자가 정한다. */
const CHART_IDS: ChartId[] = ["SYMPTOM", "PART", "END_USER", "BILLING"];

/** 처음 화면. 넷 다 꺼두면 이 구역이 단추 줄만 남는다. */
const INITIAL_OPEN_CHARTS: ChartId[] = ["SYMPTOM"];

export default function ProductModelHistoryBreakdown({
  resolved,
  requestedParts,
}: {
  resolved: ResolvedRepairCase[];
  requestedParts: RequestedPartRow[];
}) {
  // 배열이다(Set 이 아니다) — **고른 차례**가 곧 쌓이는 차례라서, 그 차례 자체가
  // 기억해야 할 값이다.
  const [openCharts, setOpenCharts] = useState<ChartId[]>(INITIAL_OPEN_CHARTS);
  const [isListOpen, setIsListOpen] = useState(false);
  // 그래프마다 따로 기억한다 — 한쪽에서 고른 조각이 다른 원의 선택을 지우면 안 된다.
  const [selection, setSelection] = useState<Partial<Record<ChartId, string | null>>>({});

  const cases: ProductModelBreakdownCase[] = useMemo(
    () =>
      resolved.map((row) => ({
        id: row.id,
        reportedSymptom: row.reportedSymptom,
        intakeInspectionResult: row.intakeInspectionResult,
        endUserName: row.endUserName,
        billingType: row.billingType,
      })),
    [resolved]
  );

  const symptom = useMemo(() => buildSymptomBreakdown(cases), [cases]);
  const endUser = useMemo(() => buildEndUserBreakdown(cases), [cases]);
  const billing = useMemo(() => buildBillingBreakdown(cases), [cases]);
  const faultPart = useMemo(() => buildFaultPartBreakdown(requestedParts), [requestedParts]);

  if (resolved.length === 0) {
    // 단추 줄도 그리지 않는다 — 켤 그래프도 펼칠 목록도 없다.
    return <ProductModelRepairCaseHistory resolved={resolved} />;
  }

  const toggleChart = (id: ChartId) => {
    setOpenCharts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectSlice = (id: ChartId, key: string) => {
    // 같은 조각을 다시 누르면 접힌다.
    setSelection((prev) => ({ ...prev, [id]: prev[id] === key ? null : key }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">그래프</span>
        {CHART_IDS.map((id) => {
          const isOpen = openCharts.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isOpen}
              onClick={() => toggleChart(id)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                isOpen
                  ? "border-zinc-900 bg-zinc-900 text-zinc-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {CHART_LABELS[id]}
            </button>
          );
        })}

        <button
          type="button"
          aria-expanded={isListOpen}
          onClick={() => setIsListOpen((prev) => !prev)}
          className="ml-auto rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {isListOpen ? "접수 건 목록 숨기기" : `접수 건 목록 보기 (${resolved.length}건)`}
        </button>
      </div>

      {/* 켠 그래프가 하나도 없으면 이 자리가 통째로 빈다 — 단추 줄이 남아 있으므로
          무엇을 눌러야 하는지는 보인다(그때는 empty:hidden 이 이 상자를 통째로
          지워서, 단추 줄과 접수 건 목록 사이에 빈 칸이 두 번 들어가지 않는다).

          폭 규칙은 대시보드의 같은 그래프(FaultSymptomBreakdownPanel)에서 그대로
          가져왔다 — grid-cols-1 / lg:grid-cols-2, 카드에 폭 상한 없음. 두 화면이
          같은 원형 그래프를 서로 다른 크기로 보여 주면 같은 것을 보고 있다는
          느낌이 깨진다. 여기서 전환점이나 상한을 따로 정하지 않는 까닭이다. */}
      <div className="grid grid-cols-1 gap-4 empty:hidden lg:grid-cols-2">
        {openCharts.map((id) => {
          const selectedKey = selection[id] ?? null;
          const onSelectSlice = (key: string) => selectSlice(id, key);

          if (id === "SYMPTOM") {
            return (
              <ChartCard
                key={id}
                title={CHART_LABELS.SYMPTOM}
                meta={`총 ${symptom.total}건`}
                note="조각을 누르면 그 증상으로 접수된 건들의 인수점검 결과가 펼쳐집니다."
                emptyMessage="접수 건이 없습니다."
                slices={symptom.slices}
                ariaLabel={`고장 증상별 건수 비율, 총 ${symptom.total}건`}
                selectedKey={selectedKey}
                onSelectSlice={onSelectSlice}
                detail={(slice) => <IntakeInspectionDetailPanel slice={slice} />}
              />
            );
          }

          if (id === "PART") {
            return (
              <ChartCard
                key={id}
                title={CHART_LABELS.PART}
                // 이 두 숫자를 나란히 적지 않으면 "10건인데 왜 부품이 12개지"에서
                // 사람이 그래프 전체를 안 믿게 된다.
                meta={`부품 ${faultPart.total}개 · 요청 기록이 있는 ${faultPart.caseWithRequestCount}건`}
                note="한 건에 여러 부품이 있을 수 있어 접수 건수와 합이 다릅니다. 취소·반려된 요청은 세지 않습니다."
                emptyMessage="부품 요청 기록이 없습니다."
                countUnit="개"
                slices={faultPart.slices}
                ariaLabel={`고장 부품별 요청 비율, 부품 ${faultPart.total}개`}
                selectedKey={selectedKey}
                onSelectSlice={onSelectSlice}
              />
            );
          }

          if (id === "END_USER") {
            return (
              <ChartCard
                key={id}
                title={CHART_LABELS.END_USER}
                meta={`총 ${endUser.total}건`}
                emptyMessage="접수 건이 없습니다."
                slices={endUser.slices}
                ariaLabel={`End-User 별 건수 비율, 총 ${endUser.total}건`}
                selectedKey={selectedKey}
                onSelectSlice={onSelectSlice}
              />
            );
          }

          return (
            <ChartCard
              key={id}
              title={CHART_LABELS.BILLING}
              meta={`총 ${billing.total}건`}
              emptyMessage="접수 건이 없습니다."
              slices={billing.slices}
              ariaLabel={`유/무상 별 건수 비율, 총 ${billing.total}건`}
              selectedKey={selectedKey}
              onSelectSlice={onSelectSlice}
            />
          );
        })}
      </div>

      {isListOpen ? <ProductModelRepairCaseHistory resolved={resolved} /> : null}
    </div>
  );
}

/**
 * 그래프 한 장 — 제목 + 총계 + 원 + 범례(+ 고른 조각을 펼친 자리).
 *
 * `detail` 을 넘기지 않은 그래프는 조각을 눌러도 펼칠 것이 없다. 그래도 누르는
 * 것을 막지는 않는다 — 원과 범례에서 **고른 표시**가 되는 것만으로도 조각 하나를
 * 짚어 두고 옆 사람에게 말할 수 있다.
 */
function ChartCard<TDetail>({
  title,
  meta,
  note,
  emptyMessage,
  countUnit,
  slices,
  ariaLabel,
  selectedKey,
  onSelectSlice,
  detail,
}: {
  title: string;
  meta: string;
  note?: string;
  emptyMessage: string;
  countUnit?: string;
  slices: PieSlice<TDetail>[];
  ariaLabel: string;
  selectedKey: string | null;
  onSelectSlice: (key: string) => void;
  detail?: (slice: PieSlice<TDetail>) => ReactNode;
}) {
  const selected = slices.find((slice) => slice.key === selectedKey) ?? null;

  return (
    // 폭 상한(max-w-*)을 두지 않는다 — 대시보드의 같은 그래프 카드에도 없다.
    // 폭은 이 카드를 담은 격자 한 칸이 정한다(위 openCharts 격자 참조).
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
        <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">{meta}</span>
      </div>

      {slices.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>
      ) : (
        <>
          <div className="mt-4">
            <PieChart
              slices={slices}
              ariaLabel={ariaLabel}
              formatLabel={formatPieSliceLabel}
              countUnit={countUnit}
              selectedKey={selectedKey}
              onSelectSlice={onSelectSlice}
            />
          </div>
          {note ? (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>
          ) : null}
          {selected && detail ? detail(selected) : null}
        </>
      )}
    </div>
  );
}

/**
 * 고른 고장 증상 조각 하나를 펼친 자리 — 그 증상 건들의 인수점검 결과.
 *
 * 대시보드의 같은 자리(FaultSymptomBreakdownPanel)와 같은 모양이다. 묶음이 하나도
 * 없는 경우는 생기지 않는다 — 건수 0 인 조각은 애초에 만들어지지 않고, 건이 있으면
 * 그 건은 반드시 어느 결과 묶음이거나 '인수점검 전'이다.
 */
function IntakeInspectionDetailPanel({ slice }: { slice: PieSlice<IntakeInspectionDetail> }) {
  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {formatPieSliceLabel(slice)} — {slice.count}건
      </h4>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">인수점검 결과</p>

      <ul className="mt-2 space-y-1">
        {slice.detail.intakeInspectionResults.map((group) => (
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
        {slice.detail.intakeInspectionPendingCount > 0 ? (
          <li className="pt-1 text-sm text-zinc-500 dark:text-zinc-400">
            인수점검 전 {slice.detail.intakeInspectionPendingCount}건
          </li>
        ) : null}
      </ul>
    </div>
  );
}
