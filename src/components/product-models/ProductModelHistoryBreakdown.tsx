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
  faultPartIssuedWarning,
  selectProductModelPeriodFaultParts,
  type FaultPartDetail,
  type FaultPartIssuedLookup,
  type FaultPartRow,
  type IntakeInspectionDetail,
  type ProductModelBreakdownCase,
} from "@/lib/domain/product-model-breakdown";
import {
  lookupFaultPartInventory,
  type FaultPartInventoryIndex,
  type FaultPartInventoryRow,
} from "@/lib/domain/fault-part-inventory";
import {
  inventoryPartCustomerName,
  inventoryPartIdLabels,
  inventoryPartSpec,
  inventoryStockText,
} from "@/lib/domain/inventory-gateway";
import {
  formatFaultSymptomPeriodLabel,
  listFaultSymptomYears,
  selectFaultSymptomPeriodCases,
  FAULT_SYMPTOM_ALL_PERIOD,
  FAULT_SYMPTOM_PERIOD_MONTHS,
  type FaultSymptomPeriod,
} from "@/lib/domain/fault-symptom-breakdown";

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
 * 접수 건도 부품 줄도 서버가 이미 손에 쥐어 준다(page.tsx). 그래야 이 화면의
 * 숫자와 위쪽 `모델 통계`의 숫자가 같은 행 집합에서 나온다.
 *
 * ── 🔴 부품 이름표를 여기서 만들지 않는다 (2026-10-29) ──────────────────
 * [고장 부품] 줄은 **부품 요청 + 사용 부품 + 반출 확인된 부품**을 합친 것이고,
 * 이름표는 서버가 「고객사 품명 (품번)」으로 만들어 내려보낸다. 🔴 그 규칙이 연락서
 * 판독기를 물고 있어 이 파일("use client")에서 부르면 엑셀·zip 읽개가 통째로 브라우저
 * 묶음에 실린다(domain/product-model-fault-parts.ts 머리말).
 *
 * ── 🔴 **못 센 것이 있으면 그 사실을 그린다** (2026-10-29) ───────────────
 * 셋째 입력만 **일부만 받아 오는 일**이 생긴다(수리 건마다 재고 관리에 한 번씩 묻는다).
 * 그때 적은 수를 조용히 보여 주면 「이 모델은 이 부품이 적게 고장난다」는 **틀린 결론**이
 * 나온다. 🔴 문장은 여기서 짓지 않는다 — faultPartIssuedWarning 이 수와 함께 들고 있고,
 * 이 파일은 **그 글자를 눈에 띄는 자리에 놓는 일**만 한다.
 *
 * ── 🔴 **년/월 드롭다운 둘** (2026-10-29 사용자 요청) ───────────────────
 * 「[대시보드]의 [신고 증상별 현황]처럼 년/월을 선택해서 확인」. 그래서 **그 화면의
 * 것을 그대로 쓴다** — 타입(FaultSymptomPeriod) · 연도 목록(listFaultSymptomYears) ·
 * 거르는 자(selectFaultSymptomPeriodCases) · 월 목록(FAULT_SYMPTOM_PERIOD_MONTHS) ·
 * 이름표(formatFaultSymptomPeriodLabel)가 전부 domain/fault-symptom-breakdown.ts 의
 * 것이다. 🔴 이름이 `FaultSymptom…` 이라 대시보드 전용처럼 보이지만 **옮기지 않았다** —
 * 옮기면 대시보드가 함께 바뀌고, 여기에 같은 것을 다시 적으면 한쪽만 고쳐지는 날이 온다.
 *
 * 🔴 **거르는 날짜는 인수일 하나**이고 **네 그래프가 다 걸린다.** 앞의 셋은 접수 건을
 * 먼저 거르고 그 뒤에 매핑하면 되지만(ProductModelBreakdownCase 에 인수일을 싣지 않는
 * 것은 그대로 둔다 — 그래프가 읽지 않는 칸이다), [고장 부품] 줄에는 날짜가 없어
 * **id 집합**으로 따로 건다(domain 의 selectProductModelPeriodFaultParts).
 *
 * 🔵 **새 조회를 하지 않는다**(위 「새 조회를 하지 않는다」와 같은 말이다). 거르기는
 * 전부 이 화면 안의 계산이라 주소에도 남지 않는다 — 대시보드도 같다.
 *
 * 🔴 **주황 띠(못 센 건 안내)만 기간을 안 탄다.** 그것은 「재고 관리에 못 물어봤다」는
 * 말이고, 어느 달을 보든 못 물어본 것은 못 물어본 것이다. 게다가 서버가 내려보내는 것은
 * **수**뿐이라(faultPartIssuedLookup) 어느 건이 빠졌는지 알 수 없어, 기간에 맞춰 줄이면
 * 「이 달은 다 셌다」는 **거짓말**이 된다. 그래서 그대로 둔다.
 *
 * ── 🔴 **조각을 누르면 펼쳐지는 카드가 둘이다** (2026-10-29 사용자 요청) ───
 * [고장 증상]은 그 증상 건들의 **인수점검 결과**를, [고장 부품]은 그 부품의 **재고 관리
 * 줄**(전체 이름 · 재고 · 소유구분)을 펼친다. 🔵 펼치는 틀은 ChartCard 의 `detail` 하나라
 * 두 카드가 같은 자리·같은 모양으로 열린다.
 * 🔴 [고장 부품]은 2026-10-29 전까지 `detail` 을 **안 넘겼고** 조각의 딸린 값도 늘 `null`
 *    이라(`NO_PIE_DETAIL`) **눌러도 하이라이트만 되고 아무것도 안 펼쳐졌다.**
 * 🔴 **재고를 여기서 묻지 않는다.** 서버가 그래프에 뜬 부품의 줄만 골라 내려보내고
 *    (`domain/fault-part-inventory.ts`), 이 화면은 고른 조각의 열쇠로 **찾아 그리기만** 한다 —
 *    「새 조회를 하지 않는다」(위)가 여기에도 그대로 걸린다.
 * 🔵 **기간을 바꾸면 펼친 것이 접힌다**는 기존 동작이 이 카드에도 그대로 든다 —
 *    changeYear · changeMonth 가 네 그래프의 선택을 함께 지운다(아래 setSelection({})).
 *
 * 🔴 **아래 접수 건 목록도 같은 기간에 걸린다** (2026-10-29 사용자 결정). 처음에는 네
 * 그래프만 걸고 목록은 전체를 두었는데, 그러면 「총 3건」 옆에 「목록 보기 (25건)」이
 * 떠서 어느 쪽이 맞는지 알 수 없다. 🔵 그래서 **이 구역의 숫자는 전부 한 기간**이다 —
 * 단추에 적히는 수도 걸러진 수이고(`periodResolved.length`), 목록이 기간 때문에 비면
 * 그 사실을 **그래프 넷과 같은 문장**으로 말한다(emptyCaseMessage 를 그대로 넘긴다 —
 * 한 화면에서 같은 뜻을 두 가지 말로 하면 안 된다).
 * 🔵 **접수 건이 아예 없는 모델**은 그 앞에서 돌려보낸다(아래 `resolved.length === 0`).
 *    그때의 글자는 예전 그대로 「이 모델과 연결된 A/S 접수 건이 없습니다」다 — 기간
 *    때문에 빈 것과 **원래 없는 것**은 다른 말이다.
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

/**
 * 고르는 칸 두 개가 같은 모양이어야 한 벌로 읽힌다. 🔴 대시보드 [신고 증상별 현황]의
 * SELECT_CLASS 와 **같은 글자**다 — 같은 기능을 베낀 자리라 생김새까지 같아야 "그것과
 * 같은 것"으로 읽힌다. 글자를 공유하지 않는 까닭은 그쪽이 내보내지 않는 상수이고,
 * 꾸밈 하나 때문에 남의 화면 파일을 고칠 수는 없기 때문이다.
 */
const PERIOD_SELECT_CLASS =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export default function ProductModelHistoryBreakdown({
  resolved,
  faultParts,
  faultPartIssuedLookup,
  faultPartInventory,
}: {
  resolved: ResolvedRepairCase[];
  faultParts: FaultPartRow[];
  /** 🔴 반출 확인된 부품을 **다 세었는가**. 서버가 센 값이다(위 머리말). */
  faultPartIssuedLookup: FaultPartIssuedLookup;
  /**
   * 🔴 [고장 부품] 조각을 눌렀을 때 펼칠 **재고 관리 줄** (2026-10-29 사용자 요청).
   * 서버가 그래프에 뜬 열쇠만 골라 담아 준다 — 이 파일은 고른 조각의 열쇠로 찾아 그리기만
   * 한다(`domain/fault-part-inventory.ts` 의 `lookupFaultPartInventory` 가 갈래를 가른다).
   */
  faultPartInventory: FaultPartInventoryIndex;
}) {
  // 배열이다(Set 이 아니다) — **고른 차례**가 곧 쌓이는 차례라서, 그 차례 자체가
  // 기억해야 할 값이다.
  const [openCharts, setOpenCharts] = useState<ChartId[]>(INITIAL_OPEN_CHARTS);
  const [isListOpen, setIsListOpen] = useState(false);
  // 그래프마다 따로 기억한다 — 한쪽에서 고른 조각이 다른 원의 선택을 지우면 안 된다.
  const [selection, setSelection] = useState<Partial<Record<ChartId, string | null>>>({});
  // 처음에는 **전체 기간**이다. 기간을 고르기 전 화면은 예전 그대로여야 한다.
  const [period, setPeriod] = useState<FaultSymptomPeriod>(FAULT_SYMPTOM_ALL_PERIOD);

  // 연도 목록은 걸린 기간과 무관하게 **원본** 배열에서 뽑는다. 걸러진 배열에서 뽑으면
  // 2025년을 고르는 순간 목록에 2025년만 남아 다른 해로 돌아갈 수 없다(대시보드와 같다).
  const years = useMemo(() => listFaultSymptomYears(resolved), [resolved]);

  // 🔴 **거르고 나서 매핑한다.** ProductModelBreakdownCase 에는 인수일이 없고, 없는
  //    것이 맞다 — 그래프가 읽지 않는 칸이다. 그래서 날짜가 아직 붙어 있는 이 자리에서
  //    먼저 거른다.
  const periodResolved = useMemo(
    () => selectFaultSymptomPeriodCases(resolved, period),
    [resolved, period]
  );

  const cases: ProductModelBreakdownCase[] = useMemo(
    () =>
      periodResolved.map((row) => ({
        id: row.id,
        reportedSymptom: row.reportedSymptom,
        intakeInspectionResult: row.intakeInspectionResult,
        endUserName: row.endUserName,
        billingType: row.billingType,
      })),
    [periodResolved]
  );

  // 🔴 [고장 부품] 줄에는 날짜가 없어 **id 집합**으로 건다 — 넷째 그래프가 앞의 셋과
  //    같은 잣대(인수일)로 걸리는 유일한 길이다(그 함수의 머리말).
  const periodFaultParts = useMemo(
    () => selectProductModelPeriodFaultParts(faultParts, period, cases),
    [faultParts, period, cases]
  );

  const symptom = useMemo(() => buildSymptomBreakdown(cases), [cases]);
  const endUser = useMemo(() => buildEndUserBreakdown(cases), [cases]);
  const billing = useMemo(() => buildBillingBreakdown(cases), [cases]);
  const faultPart = useMemo(() => buildFaultPartBreakdown(periodFaultParts), [periodFaultParts]);
  // 🔴 다 셌으면 null 이고, 그때는 아무것도 안 그린다 — 늘 떠 있는 안내는 아무도 안 읽는다.
  // 🔴 **기간을 타지 않는다**(파일 머리말). 서버가 내려보낸 것은 수뿐이라 어느 건이
  //    빠졌는지 알 수 없고, 기간에 맞춰 줄이면 「이 달은 다 셌다」는 거짓말이 된다.
  const faultPartWarning = faultPartIssuedWarning(faultPartIssuedLookup);

  const periodLabel = formatFaultSymptomPeriodLabel(period);
  const isPeriodFiltered = period.year !== null;
  // 기간 때문에 0건인 것과, 원래 그 모델에 건이 없는 것은 다른 말이다.
  const emptyCaseMessage = isPeriodFiltered
    ? `${periodLabel}에 인수된 접수 건이 없습니다.`
    : "접수 건이 없습니다.";
  const emptyPartMessage = isPeriodFiltered
    ? `${periodLabel}에 인수된 건의 부품 기록이 없습니다.`
    : "부품 기록이 없습니다.";

  if (resolved.length === 0) {
    // 단추 줄도 그리지 않는다 — 켤 그래프도 펼칠 목록도 없다. 기간 고르는 칸도 마찬가지다
    // (고를 연도가 한 해도 없다).
    // 🔴 **여기만 원본 배열이고, 빈 글자도 안 넘긴다.** 이 갈래는 「고른 기간에 없다」가
    //    아니라 「이 모델에 아예 없다」라서, 목록의 예전 글자가 그대로 맞는 말이다.
    return <ProductModelRepairCaseHistory resolved={resolved} />;
  }

  const toggleChart = (id: ChartId) => {
    setOpenCharts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectSlice = (id: ChartId, key: string) => {
    // 같은 조각을 다시 누르면 접힌다.
    setSelection((prev) => ({ ...prev, [id]: prev[id] === key ? null : key }));
  };

  // 기간을 바꾸면 펼쳐 둔 조각을 **네 그래프 모두** 접는다 — 다른 기간에서 고른 조각이
  // 그대로 펼쳐져 있으면 제목과 내용이 어긋난 채 남는다(대시보드와 같은 까닭).
  const changeYear = (raw: string) => {
    // 연도를 바꾸면 월은 언제나 '전체'로 되돌아간다. 2025년 3월을 보다 2024년으로
    // 옮겼을 때 3월이 남아 있으면, 사람은 자기가 무엇을 보고 있는지 놓친다.
    setPeriod(raw === "" ? FAULT_SYMPTOM_ALL_PERIOD : { year: Number(raw), month: null });
    setSelection({});
  };
  const changeMonth = (raw: string) => {
    // 연도가 전체면 월만 정해진 기간은 만들 수 없다(타입이 막는다). 칸도 잠겨 있어
    // 여기까지 오지 않지만, 들어오더라도 아무 일이 없도록 그대로 돌려준다.
    setPeriod((prev) =>
      prev.year === null ? prev : { year: prev.year, month: raw === "" ? null : Number(raw) }
    );
    setSelection({});
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 기간 고르는 줄 — 대시보드 [신고 증상별 현황]과 같은 모양이고, 쓰는 함수도 같은
          것이다(파일 머리말). 그래프 고르는 단추 줄보다 **위**에 둔다: 기간이 네 그래프에
          모두 걸리므로, 한 그래프에 딸린 설정으로 보이면 안 된다. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">기간</span>
          <select
            value={period.year ?? ""}
            onChange={(e) => changeYear(e.target.value)}
            aria-label="A/S 이력 연도"
            className={PERIOD_SELECT_CLASS}
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
            aria-label="A/S 이력 월"
            title={isPeriodFiltered ? undefined : "연도를 먼저 고르면 월을 고를 수 있습니다."}
            className={PERIOD_SELECT_CLASS}
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
          {/* 그래프만 바뀌고 아무 말이 없으면 무엇이 걸려 있는지 알 수 없다. */}
          <span className="ml-auto text-sm text-zinc-600 dark:text-zinc-400">
            {periodLabel} · 접수 {periodResolved.length}건
          </span>
        </div>
        {/* 🔵 기간을 걸었을 때만 적는다. 말해야 하는 것은 **무슨 날짜로** 걸렀는가다 —
            접수일도 출하일도 아닌 **인수일**이고, 그 사실은 화면 어디에도 안 적혀 있다.
            🔴 「무엇이 걸리는가」도 함께 적는다: 이 구역은 그래프 넷과 아래 목록까지
            **전부** 한 기간이다(2026-10-29 사용자 결정, 파일 머리말). */}
        {isPeriodFiltered ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            기간은 인수일 기준이라 {periodLabel}에 인수된 건만 셉니다. 네 그래프와 아래 접수
            건 목록이 모두 이 기간에 걸립니다.
          </p>
        ) : null}
      </div>

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
                  ? "border-primary-900 bg-primary-900 text-zinc-50 dark:border-primary-100 dark:bg-primary-100 dark:text-zinc-900"
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
          {/* 🔴 **열면 보일 수**를 적는다(`periodResolved`). 단추의 수와 펼친 목록의 수가
              다르면 둘 중 어느 것을 믿어야 할지 알 수 없다 — 그래프의 「총 N건」과도 같은
              수다. 🔵 기간을 안 걸었을 때는 걸러진 수가 곧 전체라 글자가 예전 그대로다. */}
          {isListOpen
            ? "접수 건 목록 숨기기"
            : `접수 건 목록 보기 (${periodResolved.length}건)`}
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
                emptyMessage={emptyCaseMessage}
                slices={symptom.slices}
                // 🔴 낭독기에는 **걸린 기간이 원과 함께 읽혀야** 한다. 기간 고르는 칸은
                // 저 위에 따로 있어서, 원만 읽고 지나가면 어느 기간의 수인지 알 수 없다
                // (대시보드의 같은 그래프도 ariaLabel 에 기간을 싣는다).
                ariaLabel={`고장 증상별 건수 비율, ${periodLabel} 총 ${symptom.total}건`}
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
                meta={`부품 ${faultPart.total}개 · 부품 기록이 있는 ${faultPart.caseWithPartRecordCount}건`}
                // 🔴 **어디까지 센 수인지 적는다**(2026-10-29). 이 그래프는 부품 요청만
                // 세던 때가 있었고, 지금은 연락서에서 읽은 사용 부품과 재고 관리에서
                // 반출 확인된 부품까지 함께 센다 — 그 사실이 안 적혀 있으면 같은 모델의
                // 수가 어느 날 갑자기 늘어난 것으로만 보인다.
                // 🔴 **자가 둘이라는 것도 적는다.** 부품 요청은 「요청한 의도」(대기·보류
                // 포함, 취소·반려만 뺌)를 세고 반출은 「실제로 나간 줄」만 센다 —
                // 사용자가 알고 고른 가름이라 화면도 그대로 말한다
                // (domain/product-model-breakdown.ts 머리말의 「한 원 안에 자가 둘이다」).
                // 🔵 **조각을 누르면 무엇이 나오는지 적는다** (2026-10-29). [고장 증상] 카드가
                // 같은 자리에 같은 말을 적고 있다 — 적지 않으면 누를 수 있다는 것을 모른다.
                note="부품 요청 · 수리 건에 적힌 사용 부품 · 재고 관리에서 반출 확인된 부품을 함께 셉니다. 한 건에 여러 부품이 있을 수 있어 접수 건수와 합이 다릅니다. 부품 요청은 취소·반려된 것을 빼고 세고, 반출 부품은 실제로 나간 줄만 셉니다. 조각을 누르면 그 부품의 재고 관리 정보가 펼쳐집니다."
                warning={faultPartWarning}
                emptyMessage={emptyPartMessage}
                countUnit="개"
                slices={faultPart.slices}
                ariaLabel={`고장 부품별 요청 비율, ${periodLabel} 부품 ${faultPart.total}개`}
                selectedKey={selectedKey}
                onSelectSlice={onSelectSlice}
                // 🔴 **기간을 바꾸면 저절로 접힌다** — 위 changeYear·changeMonth 가 네 그래프의
                //    고른 조각을 함께 지운다(setSelection({})). 이 카드만 따로 다루지 않는다.
                detail={(slice) => (
                  <FaultPartInventoryPanel slice={slice} inventory={faultPartInventory} />
                )}
              />
            );
          }

          if (id === "END_USER") {
            return (
              <ChartCard
                key={id}
                title={CHART_LABELS.END_USER}
                meta={`총 ${endUser.total}건`}
                emptyMessage={emptyCaseMessage}
                slices={endUser.slices}
                ariaLabel={`End-User 별 건수 비율, ${periodLabel} 총 ${endUser.total}건`}
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
              emptyMessage={emptyCaseMessage}
              slices={billing.slices}
              ariaLabel={`유/무상 별 건수 비율, ${periodLabel} 총 ${billing.total}건`}
              selectedKey={selectedKey}
              onSelectSlice={onSelectSlice}
            />
          );
        })}
      </div>

      {/* 🔴 **걸러진 배열**을 넘긴다(2026-10-29 사용자 결정). 비었을 때 할 말도 함께
          넘긴다 — 그 목록은 기간이 무엇인지 모르고, 제 기본 글자(「이 모델과 연결된 A/S
          접수 건이 없습니다」)는 **기간 때문에 빈 날에는 거짓말**이 된다.
          🔵 기간을 안 걸었으면 `undefined` 라 예전 글자 그대로다. 그 글자를 여기서 다시
          적지 않는 까닭도 같다 — 두 벌로 적으면 한쪽만 고쳐진다.
          🔵 그래프 넷이 쓰는 `emptyCaseMessage` 를 **그대로** 쓴다. 같은 기간이 비어서
          나오는 말이라 문장이 갈리면 한 화면이 두 가지 말을 한다. */}
      {isListOpen ? (
        <ProductModelRepairCaseHistory
          resolved={periodResolved}
          emptyMessage={isPeriodFiltered ? emptyCaseMessage : undefined}
        />
      ) : null}
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
  warning,
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
  /**
   * 🔴 **이 그래프의 수가 실제보다 적다**는 말. `note`(늘 떠 있는 설명)와 **다른 것**이라
   * 자리도 꾸밈도 가른다 — 설명 줄에 붙이면 늘 보던 회색 글이라 아무도 안 읽는다.
   * 🔵 없으면 `null` 이고 아무것도 안 그린다.
   */
  warning?: string | null;
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

      {/* 🔴 **원보다 위, 그리고 조각이 하나도 없을 때도 그린다.** 셋째 입력을 통째로 못
          받아 온 모델은 「부품 기록이 없습니다」만 뜨는데, 그 글이 바로 이 안내가 막으려는
          거짓말이다 — 빈 갈래 안에 넣으면 정작 필요한 자리에서 안 뜬다.
          🔵 색 말고도 갈린다: 테두리 + 바탕 + 굵은 글씨, 그리고 문장 자체가 「받아오지
          못했습니다」·「세지 않았습니다」라고 말한다(반출 신청 배지와 같은 결). */}
      {warning ? (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {warning}
        </p>
      ) : null}

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

/**
 * ============================================================================
 * 고른 **고장 부품** 조각 하나를 펼친 자리 — 그 부품의 재고 관리 줄 (2026-10-29)
 * ============================================================================
 * 사용자 요청: 「고장 부품을 누르면 그 아랫부분에 **그 부품의 전체 이름과 현재 재고 등을
 * 구체적으로** 확인할 수 있도록 해줘.」 같은 날 결정 — 🔴 **소유구분을 나눠서 줄마다
 * 보인다. 합치지 않는다**(까닭은 `domain/fault-part-inventory.ts` 머리말).
 *
 * 🔵 위 [고장 증상] 펼침(IntakeInspectionDetailPanel)과 **같은 상자·같은 제목 모양**이다.
 *    한 화면에서 같은 동작(조각 누르기)의 결과가 서로 다르게 생기면 다른 기능으로 읽힌다.
 *
 * 🔴 **여기서 글자를 짓지 않는다.** 「없습니다 / 못 물어봤습니다 / 품번이 없습니다」를 가르는
 *    일도 그 문장도 전부 도메인이 쥐고 있고(`lookupFaultPartInventory`), 재고 수에 「불러온
 *    때 기준」을 붙이는 일도 도메인 한 곳이다(`inventoryStockText`). 이 파일이 하는 일은
 *    **받은 글자를 눈에 띄는 자리에 놓는 것**뿐이다 — 그래야 수리 건 상세의 [부품 요청]
 *    칸과 같은 말을 한다.
 *
 * 🔴 **export 한 까닭** — 이 카드는 처음에 꺼져 있어(INITIAL_OPEN_CHARTS) 시험 환경에서
 *    열 수가 없다(눌러 볼 도구가 없다 — product-model-fault-part-warning.test.tsx 머리말).
 *    펼친 자리를 **따로 그려 보려고** 내보낸다. 🔵 다른 화면이 쓰라고 내보낸 것이 아니다.
 * ============================================================================
 */
export function FaultPartInventoryPanel({
  slice,
  inventory,
}: {
  slice: PieSlice<FaultPartDetail>;
  inventory: FaultPartInventoryIndex;
}) {
  // 🔴 값·미입력 조각은 부품 하나, **기타 조각만 접힌 종류 수만큼**이다(FaultPartDetail
  //    머리말). 여럿일 때만 부품마다 제목을 단다 — 하나뿐인데 제목을 달면 바로 위 제목과
  //    같은 글자가 두 줄로 겹친다.
  const parts = slice.detail.parts;
  const isFolded = parts.length > 1;

  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-800/40">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {formatPieSliceLabel(slice)} — {slice.count}개
      </h4>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        재고 관리의 부품 정보 · 소유구분이 다르면 다른 부품이라 줄을 나눠 적습니다
      </p>

      <ul className="mt-2 space-y-3">
        {parts.map((entry) => (
          <li key={entry.displayName}>
            {isFolded ? (
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {entry.displayName} · {entry.count}개
              </p>
            ) : null}
            <FaultPartInventoryLines matchKey={entry.matchKey} inventory={inventory} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 부품 하나의 재고 관리 줄들 — 또는 **왜 줄이 없는지**.
 *
 * 🔴 빈 자리를 그리지 않는다. 줄이 없을 때 아무것도 안 그리면 「재고가 0개」로 읽히고,
 *    그것이 이 조각이 막으려는 거짓말이다(도메인 머리말). 갈래를 가르는 자도 할 말도
 *    `lookupFaultPartInventory` 한 곳에 있다.
 */
function FaultPartInventoryLines({
  matchKey,
  inventory,
}: {
  matchKey: string;
  inventory: FaultPartInventoryIndex;
}) {
  const found = lookupFaultPartInventory(inventory, matchKey);

  if (found.status === "notice") {
    // 🔵 회색 안내가 아니라 테두리 있는 상자다 — 「못 찾았다」는 **읽어야 하는** 말이고,
    //    늘 보던 회색 글이면 눈이 건너뛴다(주황 띠와 같은 결, 색은 한 단계 약하게).
    return (
      <p className="mt-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {found.notice}
      </p>
    );
  }

  return (
    <ul className="mt-1 space-y-2">
      {found.rows.map((row) => (
        <li
          key={row.no}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <FaultPartInventoryLine row={row} />
        </li>
      ))}
    </ul>
  );
}

/**
 * 재고 관리 줄 **하나**.
 *
 * ── 🔴 머리에 **소유구분과 재고**를 둔다 ────────────────────────────────
 * 사용자가 보낸 실물이 그 모양이다(`KYOSAN 수량 1` · `DSS 수량 153`). 줄이 둘인 까닭이
 * 소유라, 그것이 맨 앞에 없으면 같은 부품이 왜 두 번 적혀 있는지 알 수 없다.
 * 🔴 **재고 수에 「불러온 때 기준」이 붙어 있다** — 화면을 열 때 받아 온 값이라 지금 수가
 *    아니다. 그 꼬리말을 떼지 마라(`inventoryStockText` 머리말).
 * 🔵 **부품 번호(No.)도 적는다.** 재고 관리에서 그 줄을 그대로 찾는 값이고, 반출 신청도
 *    번호로 건다.
 *
 * ── 🔴 **값이 있는 칸만 그린다** ────────────────────────────────────────
 * 이 자료는 엑셀에서 넘어와 빈칸 대신 `-` 가 적힌 줄이 많다. 「교산 품번 없음 · 도번 없음」이
 * 줄줄이 적히면 정작 있는 값이 묻힌다 — 재는 자는 도메인 쪽 한 곳이다
 * (`inventoryPartIdLabels` · `inventoryPartSpec` · `inventoryPartCustomerName`, 셋 다 `-` 를
 * 없는 값으로 센다). 수리 건 상세의 [부품 요청] 칸이 같은 자를 쓴다.
 */
function FaultPartInventoryLine({ row }: { row: FaultPartInventoryRow }) {
  const customerName = inventoryPartCustomerName(row);
  const spec = inventoryPartSpec(row);
  const idLabels = inventoryPartIdLabels(row);

  return (
    <>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-zinc-900 dark:text-zinc-50">
        <span className="font-semibold">{row.ownerLabel}</span>
        <span className="tabular-nums">{inventoryStockText(row)}</span>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">No. {row.no}</span>
      </p>
      {/* 🔵 사용자가 먼저 말한 「전체 이름」이 이 줄이다 — 비어 있는 부품이 훨씬 많아
          (재고 관리 319줄 중 27줄에만 적혀 있다, used-part-display.ts 머리말) 없으면 접는다.
          🔴 우리 품명으로 때우지 않는다 — 그 둘은 다른 칸이고 다음 줄에 그대로 적힌다. */}
      {customerName !== "" ? (
        <p className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">{customerName}</p>
      ) : null}
      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
        {row.name}
        {spec !== "" ? ` · ${spec}` : ""}
      </p>
      {idLabels.length > 0 ? (
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {idLabels.map((item) => `${item.label} ${item.value}`).join(" · ")}
        </p>
      ) : null}
      {/* 🔵 같은 품명인 부품 묶음이 16개 있어 비고가 가르는 단서다(재고 관리 API.md 2절). */}
      {row.noteFirstLine !== "" ? (
        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{row.noteFirstLine}</p>
      ) : null}
    </>
  );
}
