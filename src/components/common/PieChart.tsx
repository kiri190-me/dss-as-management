"use client";

import type { PieChartSlice } from "@/lib/domain/pie-slices";

/**
 * 원 하나를 SVG 로 직접 그린다.
 *
 * 차트 라이브러리를 들이지 않는 이유는 이 시스템이 나중에 사내 NAS 에서
 * **인터넷 없이** 도는 것을 전제로 하기 때문이다 — 밖에서 받아 오는 것을 늘리지
 * 않는다. 원 하나에 필요한 것은 원호 path 뿐이라 그럴 값어치도 없다.
 *
 * 누를 수 있는 것은 **범례 줄(<button>)** 이다. 조각(<path>)도 같은 동작을 하지만
 * 그쪽은 마우스 편의일 뿐이고, 키보드로 다다를 수 있는 길은 범례가 맡는다.
 * 그래서 <svg> 는 role="img" + aria-label 로 통째로 하나의 그림이고, 조각 하나하나에
 * 숨은 글자(sr-only)를 붙이지 않는다 — 이 저장소는 position:absolute 인 sr-only 가
 * 부모의 자르기를 빠져나가 페이지를 아래로 굴리는 고장을 이미 세 번 겪었다.
 *
 * ── 왜 common 에 있나 ────────────────────────────────────────────────────
 * 처음에는 대시보드 안(FaultSymptomPieChart)에 있었지만 이제 두 화면이 쓴다 —
 * 대시보드의 신고 증상 RFG · MB 두 장과 제품 모델 상세의 네 장. 한쪽 화면 폴더에
 * 두면 다른 화면이 남의 기능 폴더로 손을 뻗어야 하고, 그것은 이 저장소가 피해 온
 * 모양이다(ProductModelRepairCaseHistory 의 주석에 같은 판단이 적혀 있다).
 * 그래서 조각을 그리는 일만 여기로 옮기고, **무엇을 세는가**는 도메인이
 * (pie-slices.ts) 그대로 갖는다.
 *
 * ── 이름표는 밖에서 받는다 ──────────────────────────────────────────────
 * `기타(12종)`처럼 조각 이름에 덧붙는 말이 그래프마다 다를 수 있어 formatLabel 을
 * 부르는 쪽이 넘긴다. 여기서 정해 버리면 그 순간 이 컴포넌트가 특정 도메인의
 * 것이 된다.
 */

const CENTER = 50;
const RADIUS = 46;

/** 조각 하나의 색. path 에 쓰는 fill 과 범례의 네모에 쓰는 bg 를 짝으로 둔다. */
type SliceColor = { fill: string; swatch: string };

/**
 * 실제 값 조각의 색 — 색상환을 고르게 도는 여덟 가지.
 *
 * 밝은 화면은 -500, 어두운 화면은 -400 이다. 어두운 배경 위에서는 같은 -500 이
 * 가라앉아 옆 조각과 구별되지 않는다. 이웃한 두 색(로즈/핑크, 에메랄드/틸)은
 * 차례가 멀어 원에서 맞닿지 않는다.
 *
 * Tailwind v4 는 소스에 **글자 그대로 적힌** 클래스만 만들어 내므로, 이 배열은
 * 조립한 문자열이 아니라 통짜 문자열이어야 한다.
 */
const VALUE_COLORS: SliceColor[] = [
  { fill: "fill-sky-500 dark:fill-sky-400", swatch: "bg-sky-500 dark:bg-sky-400" },
  { fill: "fill-amber-500 dark:fill-amber-400", swatch: "bg-amber-500 dark:bg-amber-400" },
  { fill: "fill-emerald-500 dark:fill-emerald-400", swatch: "bg-emerald-500 dark:bg-emerald-400" },
  { fill: "fill-rose-500 dark:fill-rose-400", swatch: "bg-rose-500 dark:bg-rose-400" },
  { fill: "fill-violet-500 dark:fill-violet-400", swatch: "bg-violet-500 dark:bg-violet-400" },
  { fill: "fill-lime-500 dark:fill-lime-400", swatch: "bg-lime-500 dark:bg-lime-400" },
  { fill: "fill-teal-500 dark:fill-teal-400", swatch: "bg-teal-500 dark:bg-teal-400" },
  { fill: "fill-pink-500 dark:fill-pink-400", swatch: "bg-pink-500 dark:bg-pink-400" },
];

/**
 * 미입력과 기타는 **무채색**이다. 그 둘은 값이 아니라 "센 방식"에 대한 칸이라,
 * 색이 있는 조각들과 나란한 무게로 보이면 안 된다.
 */
const UNSPECIFIED_COLOR: SliceColor = {
  fill: "fill-zinc-400 dark:fill-zinc-500",
  swatch: "bg-zinc-400 dark:bg-zinc-500",
};
const OTHER_COLOR: SliceColor = {
  fill: "fill-zinc-300 dark:fill-zinc-600",
  swatch: "bg-zinc-300 dark:bg-zinc-600",
};

/**
 * 색은 조각의 **성격**과 **차례**로 정한다. 라벨 글자로 고르면 `기타`라고 적힌
 * 진짜 값이 들어왔을 때 무채색이 되어 접힌 조각으로 읽힌다.
 *
 * 값 조각은 여덟 가지를 넘지 않지만(도메인이 상위 8개만 남긴다) 나머지 연산을
 * 두는 것은 그 상한이 바뀌어도 색이 없는 조각이 생기지 않게 하기 위해서다.
 */
function colorOf(slice: PieChartSlice, valueIndex: number): SliceColor {
  if (slice.sliceKind === "UNSPECIFIED") return UNSPECIFIED_COLOR;
  if (slice.sliceKind === "OTHER") return OTHER_COLOR;
  return VALUE_COLORS[valueIndex % VALUE_COLORS.length];
}

/** 값 조각인가 — 무채색 두 글자가 아니면 전부 값이다(PieChartSlice.sliceKind 주석). */
function isValueSlice(slice: PieChartSlice): boolean {
  return slice.sliceKind !== "UNSPECIFIED" && slice.sliceKind !== "OTHER";
}

/** 12시 방향이 0도. 시계 방향으로 돈다. */
function polarPoint(angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + RADIUS * Math.cos(rad), y: CENTER + RADIUS * Math.sin(rad) };
}

function arcPath(startAngle: number, sweepAngle: number): string {
  const start = polarPoint(startAngle);
  const end = polarPoint(startAngle + sweepAngle);
  const largeArc = sweepAngle > 180 ? 1 : 0;
  return [
    `M ${CENTER} ${CENTER}`,
    `L ${start.x.toFixed(3)} ${start.y.toFixed(3)}`,
    `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`,
    "Z",
  ].join(" ");
}

type PieChartProps<TSlice extends PieChartSlice> = {
  slices: readonly TSlice[];
  /** <svg> 전체를 한 장의 그림으로 읽어 줄 말. */
  ariaLabel: string;
  /** 범례에 적는 이름 — `기타(12종)` 같은 덧말은 그래프마다 다르다. */
  formatLabel: (slice: TSlice) => string;
  /**
   * 범례의 건수 뒤에 붙는 단위. 기본은 `건`이다.
   *
   * 고장 부품 그래프만 `개`를 쓴다 — 거기서 한 조각은 접수 건이 아니라 **요청된
   * 부품 줄**이라서, `건`이라고 적으면 그 위에 적힌 접수 건수와 더해 읽게 된다.
   */
  countUnit?: string;
  selectedKey: string | null;
  onSelectSlice: (key: string) => void;
};

export default function PieChart<TSlice extends PieChartSlice>({
  slices,
  ariaLabel,
  formatLabel,
  countUnit = "건",
  selectedKey,
  onSelectSlice,
}: PieChartProps<TSlice>) {
  // 색은 '값 조각만의 차례'로 고른다 — 미입력·기타가 끼어도 색이 건너뛰지
  // 않도록 앞에 놓인 값 조각의 수를 센다. 조각은 많아야 열 개라 이 셈의
  // 비용은 없는 것과 같고, 그리는 동안 바뀌는 변수를 두지 않는 편이 안전하다.
  const drawn = slices.map((slice, index) => ({
    slice,
    color: colorOf(slice, slices.slice(0, index).filter(isValueSlice).length),
  }));

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full max-w-[200px] shrink-0"
      >
        {drawn.map(({ slice, color }) => {
          const isSelected = slice.key === selectedKey;
          // 조각이 하나뿐이면 원호의 시작점과 끝점이 같은 자리로 떨어져 아무것도
          // 그려지지 않는다. 그때는 원을 그대로 그린다.
          const isFullCircle = slice.sweepAngle >= 359.999;
          const common = {
            className: `${color.fill} cursor-pointer transition-opacity ${
              selectedKey !== null && !isSelected ? "opacity-50" : "opacity-100"
            }`,
            // 조각 사이를 카드 바탕색으로 가늘게 갈라 둔다. 고른 조각은 진한
            // 테두리로 바꿔 어느 것을 눌렀는지 원 위에서도 보이게 한다.
            strokeWidth: isSelected ? 2 : 0.6,
            onClick: () => onSelectSlice(slice.key),
          };
          const strokeClass = isSelected
            ? "stroke-zinc-900 dark:stroke-zinc-50"
            : "stroke-white dark:stroke-zinc-900";

          return isFullCircle ? (
            <circle
              key={slice.key}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              {...common}
              className={`${common.className} ${strokeClass}`}
            />
          ) : (
            <path
              key={slice.key}
              d={arcPath(slice.startAngle, slice.sweepAngle)}
              {...common}
              className={`${common.className} ${strokeClass}`}
            />
          );
        })}
      </svg>

      {/* 조각이 얇으면 원 위에 글씨를 얹을 수 없다. 이름·건수·비율은 전부 여기서 말한다. */}
      <ul className="w-full min-w-0 space-y-1">
        {drawn.map(({ slice, color }) => {
          const isSelected = slice.key === selectedKey;
          return (
            <li key={slice.key}>
              <button
                type="button"
                onClick={() => onSelectSlice(slice.key)}
                aria-pressed={isSelected}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${
                  isSelected
                    ? "bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                }`}
              >
                <span className={`size-3 shrink-0 rounded-sm ${color.swatch}`} />
                <span className="min-w-0 flex-1 truncate">{formatLabel(slice)}</span>
                <span className="shrink-0 tabular-nums">
                  {slice.count}
                  {countUnit}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                  {slice.percentage}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
