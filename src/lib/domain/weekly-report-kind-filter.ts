import {
  WEEKLY_REPORT_KINDS,
  WEEKLY_REPORT_STATUSES,
  summarizeWeeklyReportPoIssuance,
  type WeeklyReport,
  type WeeklyReportCounts,
  type WeeklyReportCustomerPair,
  type WeeklyReportKind,
  type WeeklyReportPoIssuance,
  type WeeklyReportBlock,
} from "./weekly-report";

/**
 * ============================================================================
 * 주간보고 — `전체 / RFG 만 / MB 만` 고르개가 무엇을 가리는지 정하는 곳
 * ============================================================================
 * **보여 주는 것만 정한다. 세는 일은 한 글자도 하지 않는다.**
 * 여기 있는 함수는 전부 buildWeeklyReport 가 **이미 센 값**을 골라 내놓는다 —
 * RFG 만 볼 때의 총합도 `report.totalsByKind` 에 이미 들어 있는 그 값이다
 * (weekly-report.ts 의 addToCounts 가 블록 · 종류별 총합 · 전체 총합 셋을 한
 * 번에 올린다). 여기서 접수 건을 다시 세면 같은 화면의 숫자가 고르개에 따라
 * 달라지는 날이 오고, 그때 어느 쪽이 맞는지 말할 수 없다.
 *
 * 🔴 같은 이유로 **RFG/MB 판정(foldWeeklyReportKind)에는 손대지 않는다.** 그 규칙은
 * 대시보드의 원그래프도 함께 쓴다(fault-symptom-breakdown.ts 머리말).
 *
 * ── 이 화면은 통째로 두 칸짜리 문서다 ───────────────────────────────────
 * 고객사 블록 · 종류별 총합 · PO 발행 현황 · 금주 목표 · 납입 예정 건까지
 * **다섯 구역이 모두** 왼쪽 RFG · 오른쪽 MB 로 갈려 있다(각 화면 파일 헤더).
 * 그래서 고르개의 뜻은 하나로 정리된다 — **어느 칸을 볼 것인가.** 한 구역만
 * 남겨 두면 종이에 RFG 집계와 MB 목표가 같이 찍혀, 무엇을 뽑은 종이인지 알 수
 * 없게 된다.
 *
 * ── 고른 값은 주소에 담는다 ─────────────────────────────────────────────
 * `?kind=RFG` 다. 화면 상태(useState)가 아닌 이유는 `?week=` 과 같다
 * (weekly-report/page.tsx 헤더):
 *   - 새로고침해도 유지된다. 이 화면은 매주 같은 자리를 눈으로 찾는 문서다.
 *   - 링크로 건넬 수 있다 — 「RFG 만 보세요」가 주소 하나로 끝난다.
 *   - 🔴 **인쇄가 그대로 된다.** 서버가 고른 칸만 그려 내려보내므로 종이에도
 *     고른 칸만 찍힌다. 고르개 자체는 print:hidden 이라 종이에 나오지 않는다.
 * 이상한 값(`?kind=XXX` · 같은 이름 두 번)은 **전체로 떨어진다** — 아래
 * normalizeWeeklyReportKindFilter 가 그 한 곳이고, 주를 접는 규칙과 같은 자리다.
 *
 * ── 감춘 대수를 말하지 않고 감추지 않는다 ───────────────────────────────
 * 숫자만 조용히 줄면 사람은 「지난주보다 줄었네」로 읽는다. 그래서 이 뷰는 고른
 * 종류의 집계(counts)와 함께 **전체 대수(overallTotal)와 빠진 대수(hiddenTotal)**
 * 를 늘 들고 다닌다. 화면은 그 셋으로 한 줄을 적고, 그 줄은 **인쇄에도 나온다**
 * (WeeklyReportScreen 의 KindFilterBanner).
 * ============================================================================
 */

/** 주소의 칸 이름. 화면 · 링크 · 시험이 같은 글자를 쓴다. */
export const WEEKLY_REPORT_KIND_PARAM = "kind";

/** 주간보고 화면의 주소. 주 이동 링크와 종류 고르개가 같은 값을 쓴다. */
export const WEEKLY_REPORT_PATH = "/dashboard/weekly-report";

/**
 * 고르개의 세 가지. `ALL` 이 기본이고, 나머지 둘은 WeeklyReportKind 그대로다 —
 * 종류 이름을 여기 다시 적지 않는다(적으면 종류가 늘 때 한쪽만 고쳐진다).
 */
export const WEEKLY_REPORT_KIND_FILTERS = ["ALL", ...WEEKLY_REPORT_KINDS] as const;
export type WeeklyReportKindFilter = (typeof WEEKLY_REPORT_KIND_FILTERS)[number];

/**
 * 고르개 단추에 적는 말. Record 로 적은 것은 일부러다 — 값이 하나 늘면 이 표가
 * 컴파일되지 않아, 이름 없는 단추가 화면에 나가는 일이 없다.
 */
export const weeklyReportKindFilterLabels: Record<WeeklyReportKindFilter, string> = {
  ALL: "전체",
  RFG: "RFG 만",
  MB: "MB 만",
};

/**
 * 주소의 `?kind=` 한 값 → 고르개.
 *
 * **모르는 값은 지어내지 않고 전체로 떨어뜨린다.** 대소문자도 접지 않는다
 * (`?kind=rfg` 는 전체다) — 링크로 건네는 값이라 한 가지 모양만 남기는 편이
 * 「이 주소가 무엇을 보여 주는가」를 흔들지 않는다.
 *
 * 같은 이름이 두 번 오면(`?kind=RFG&kind=MB`) 배열이 온다. 그때는 고르지 않고
 * 통째로 버린다 — 어느 쪽을 고르든 근거가 없다(page.tsx 의 `?week=` 과 같은 규칙).
 */
export function normalizeWeeklyReportKindFilter(
  value: string | string[] | null | undefined
): WeeklyReportKindFilter {
  if (typeof value !== "string") return "ALL";
  return (WEEKLY_REPORT_KIND_FILTERS as readonly string[]).includes(value)
    ? (value as WeeklyReportKindFilter)
    : "ALL";
}

/**
 * 화면에 그릴 종류. 전체면 둘 다, 아니면 고른 하나다.
 *
 * 차례는 WEEKLY_REPORT_KINDS 그대로라 전체일 때 **왼쪽이 늘 RFG** 다.
 */
export function visibleWeeklyReportKinds(
  filter: WeeklyReportKindFilter
): readonly WeeklyReportKind[] {
  return filter === "ALL" ? WEEKLY_REPORT_KINDS : [filter];
}

/**
 * 그 주소를 만든다. 주와 종류가 **한 주소에 함께** 실린다 — 주를 넘겨도 고른
 * 종류가 유지되고, 종류를 바꿔도 보던 주가 유지된다. 둘 중 하나만 담으면 주를
 * 넘긴 순간 조용히 전체로 돌아간다.
 *
 * 전체일 때는 `kind` 를 아예 적지 않는다 — 기본값을 주소에 적어 두면 「이 링크는
 * 무언가 걸러진 화면」이라는 잘못된 신호가 된다.
 */
export function weeklyReportHref({
  weekStart,
  kind,
}: {
  weekStart: string;
  kind: WeeklyReportKindFilter;
}): string {
  const query = new URLSearchParams({ week: weekStart });
  if (kind !== "ALL") query.set(WEEKLY_REPORT_KIND_PARAM, kind);
  return `${WEEKLY_REPORT_PATH}?${query.toString()}`;
}

/** 한 고객사 줄에서 그 종류의 블록. 짝짓기는 두 칸을 늘 채워 준다(도메인 헤더). */
export function weeklyReportPairBlock(
  pair: WeeklyReportCustomerPair,
  kind: WeeklyReportKind
): WeeklyReportBlock {
  return kind === "RFG" ? pair.rfg : pair.mb;
}

/** 종류별 총합에 그 종류가 없을 때의 값. 실제로는 오지 않는 자리다(아래 주석). */
function zeroCounts(): WeeklyReportCounts {
  const byStatus = {} as Record<(typeof WEEKLY_REPORT_STATUSES)[number], number>;
  for (const status of WEEKLY_REPORT_STATUSES) byStatus[status] = 0;
  return { byStatus, poIssued: 0, unclassified: 0, total: 0 };
}

/**
 * 고른 값 하나로 화면이 읽을 것을 전부 내놓는다.
 *
 * 🔴 **여기서 세지 않는다**(파일 헤더). counts 는 전체면 report.total 그대로,
 * 한 종류면 report.totalsByKind 의 그 줄 그대로다 — 둘 다 buildWeeklyReport 가
 * 이미 센 값이라, 「RFG 만인데 합계에 MB 가 섞인다」가 성립할 자리가 없다.
 */
export type WeeklyReportKindView = {
  /** 고른 값 그대로. 화면이 고르개의 어느 단추를 눌린 모양으로 그릴지 정한다. */
  filter: WeeklyReportKindFilter;
  /** 걸러져 있는가. `filter !== "ALL"` 과 같은 뜻이고, 화면이 자주 묻는 값이라 둔다. */
  isFiltered: boolean;
  /** 그릴 종류 — 전체면 둘, 아니면 하나. */
  kinds: readonly WeeklyReportKind[];
  /**
   * 감춘 종류 — 전체면 빈 배열이다. 화면이 「무엇이 빠졌는지」를 이름으로 적기
   * 위해 둔다. 화면에서 `WEEKLY_REPORT_KINDS` 를 다시 걸러 구하면 「두 가지뿐」
   * 이라는 앎이 두 곳에 생긴다.
   */
  hiddenKinds: readonly WeeklyReportKind[];
  /**
   * 🔴 **화면에 남은 숫자가 무엇의 합인가.** 머리말의 대수 · 분류 안 됨 경고 ·
   * 6칸 합 확인이 전부 이 값 하나를 읽는다. 고른 종류만의 집계다.
   */
  counts: WeeklyReportCounts;
  /** 보고서 전체(두 종류 합) 대수. 감춘 것이 있다는 말을 하기 위해 남긴다. */
  overallTotal: number;
  /** 이 화면에서 빠진 대수. 전체면 0 이다. */
  hiddenTotal: number;
  /** 그릴 총합 블록 — `RFG 총합` · `MB 총합` 중 보이는 것만. */
  totalsByKind: readonly { kind: WeeklyReportKind; counts: WeeklyReportCounts }[];
  /** 그릴 PO 발행 현황 — 보이는 종류만. 숫자는 블록의 PO 발행 완료 칸 그대로다. */
  poIssuance: readonly WeeklyReportPoIssuance[];
};

export function buildWeeklyReportKindView(
  report: WeeklyReport,
  filter: WeeklyReportKindFilter
): WeeklyReportKindView {
  const kinds = visibleWeeklyReportKinds(filter);
  const totalsByKind = report.totalsByKind.filter((entry) => kinds.includes(entry.kind));

  // 전체면 보고서의 전체 총합을 그대로 쓴다. 두 종류의 합을 여기서 더하지
  // 않는 이유: 분류 안 된 건까지 포함해 **이미 한 번 센 값**이 있는데 다시
  // 더하면 두 값이 갈릴 자리가 생긴다.
  //
  // 한 종류면 그 종류의 총합 줄 그대로다. totalsByKind 는 WEEKLY_REPORT_KINDS
  // 로 만들어져 두 줄이 늘 있으므로(buildWeeklyReport) zeroCounts 자리에는
  // 오지 않는다 — 없는 줄을 만났을 때 0 을 그리는 편이 터지는 것보다 낫다.
  const counts = filter === "ALL" ? report.total : (totalsByKind[0]?.counts ?? zeroCounts());

  return {
    filter,
    isFiltered: filter !== "ALL",
    kinds,
    hiddenKinds: WEEKLY_REPORT_KINDS.filter((kind) => !kinds.includes(kind)),
    counts,
    overallTotal: report.total.total,
    hiddenTotal: report.total.total - counts.total,
    totalsByKind,
    // PO 발행 현황도 종류로 갈려 있다 — 도메인이 내놓은 두 줄에서 보이는 것만
    // 고른다. 고객사별 숫자를 여기서 다시 세지 않는다(그 함수 헤더).
    poIssuance: summarizeWeeklyReportPoIssuance(report.blocks).filter((issuance) =>
      kinds.includes(issuance.kind)
    ),
  };
}
