import { addCalendarDays, toKstDateOnly } from "./date-only";

/**
 * ============================================================================
 * 주간보고 금주 목표 — 무엇이 어떻게 적히는지 정하는 곳
 * ============================================================================
 * weekly-report.ts 와 같은 자리의 파일이다: **DB 도 React 도 들어오지 않는
 * 순수 함수만** 둔다. "이 줄이 왜 이렇게 보이는가"는 규칙이지 그리기가 아니라서,
 * 화면 안에 두면 그 규칙을 시험할 방법이 브라우저를 띄우는 것밖에 남지 않는다.
 *
 * 원본 엑셀 상자의 한 줄은 이렇게 생겼다:
 *
 *     [INVENIA] D260706_RFK300FH-AD1_2111171_WT7351: 견적서 발행
 *
 * 콜론 오른쪽만 사람이 치고(weekly_report_goals.goal_text), 왼쪽은 **전부 수리
 * 건에서 읽어 여기서 만든다**(buildGoalPrefix). 저장하지 않는 이유는
 * schema/weekly-report-goals.ts 헤더에 있다.
 *
 * ── 주는 월요일에 시작한다 ──────────────────────────────────────────────
 * 상자 머리말이 `08월24일 주간 목표` 이고 08월24일이 월요일이다. 그래서 한 주를
 * 가리키는 값은 언제나 그 주 월요일의 "YYYY-MM-DD" 하나이고, 같은 주가 여러
 * 값으로 갈리지 않는다.
 *
 * ⚠️ **UTC 자정 함정.** `date` 컬럼에서 온 "YYYY-MM-DD" 를 `new Date()` 로
 * 파싱하면 UTC 자정이 되고, 한국시간 오전 9시가 UTC 0시라 그대로 실제 시각과
 * 견주면 날짜가 하루 어긋난다. 이 저장소가 실제로 겪은 회귀이고
 * (repair-case-overdue.test.ts 가 그 경계를 못 박아 두었다), 그래서 이 파일은
 * 날짜를 끝까지 **문자열로** 다룬다 — 실제 시각에서 달력 날짜를 뽑는 일은
 * date-only.ts 의 toKstDateOnly 한 곳에서만 일어나고, 그 뒤의 셈은 전부
 * addCalendarDays 다.
 * ============================================================================
 */

/** 상자 머리말과 파일 곳곳이 쓰는 말. 화면과 시험이 같은 글자를 쓴다. */
const WEEK_LABEL_SUFFIX = "주간 목표";

/**
 * "YYYY-MM-DD" 하루를 UTC 자정의 **합성 시각**으로 읽는다. 실제 시점이 아니라
 * 요일을 뽑기 위한 자리표이고(date-only.ts 의 parseDateOnlyToUtcMidnight 와
 * 같은 물건), 그래서 뒤이어 부르는 것도 getDay 가 아니라 **getUTCDay** 다 —
 * getDay 는 이 프로세스가 어느 시간대에서 도는지에 따라 답이 달라진다.
 */
function utcWeekday(dateOnly: string): number {
  const [year, month, day] = dateOnly.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * 이 날이 속한 주의 **월요일**. 입력도 결과도 "YYYY-MM-DD" 다.
 *
 * 일요일(getUTCDay = 0)은 **그 앞의 월요일**로 간다 — 한 주는 월요일에 시작해
 * 일요일에 끝난다. 이 한 줄이 틀리면 일요일에 적은 목표만 다음 주 상자로
 * 새어 들어가고, 그 증상은 일주일에 하루만 나타나서 아무도 재현하지 못한다.
 *
 * 달·해 넘김은 addCalendarDays 가 진짜 날짜 셈으로 처리한다(그 함수 주석) —
 * 월·일을 따로 빼서 계산하지 않는다.
 */
export function mondayOfDateOnly(dateOnly: string): string {
  // 0(일) → 6일 전, 1(월) → 그날, 2(화) → 1일 전 …
  const offset = (utcWeekday(dateOnly) + 6) % 7;
  return addCalendarDays(dateOnly, -offset);
}

/**
 * 지금이 속한 주의 월요일 — **한국 기준**이다.
 *
 * 실제 시각에서 달력 날짜를 뽑는 일은 toKstDateOnly 한 번뿐이고, 그 뒤는 전부
 * 문자열 셈이다(파일 헤더의 'UTC 자정 함정'). 한국시간 월요일 오전 0시 30분은
 * UTC 로 아직 일요일이라, UTC 로 요일을 보는 구현이면 그 시각에 지난주가
 * 나온다.
 */
export function weekStartOfKst(instant: Date = new Date()): string {
  return mondayOfDateOnly(toKstDateOnly(instant));
}

/**
 * 상자 머리말. 원본 엑셀에 적혀 있던 말 그대로다 — `08월24일 주간 목표`.
 *
 * 연도를 넣지 않는 것도 원본 그대로다. 이 상자는 그 주에 인쇄해 나가는
 * 종이라 연도가 붙을 자리가 없었고, 화면에서 어느 해인지는 주 고르기가 답한다.
 */
export function weekLabel(weekStart: string): string {
  const month = weekStart.slice(5, 7);
  const day = weekStart.slice(8, 10);
  return `${month}월${day}일 ${WEEK_LABEL_SUFFIX}`;
}

/** 목표 줄 앞부분을 만드는 데 쓰이는 수리 건 조각. 전체 행 타입을 끌어오지 않는다. */
export type WeeklyReportGoalPrefixSource = {
  customerName: string | null;
  intakeNumber: string | null;
  modelName: string | null;
  /** L/N. */
  lotNumber: string | null;
  /** S/N. */
  serialNumber: string | null;
};

/**
 * 비어 있음의 표준형은 하나다 — null·undefined·빈 문자열·**공백만 적힌 값**이
 * 전부 "없음"이다. 내자 정리의 resolveDomesticOrderValue 가 같은 규칙을 쓰고
 * (domain/domestic-order-list.ts), 이유도 같다: 공백 한 칸이 적힌 값을 값으로
 * 치면 화면에 보이지 않는 무언가가 자리를 차지한다.
 */
function present(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 목표 줄의 앞부분 — `[INVENIA] D260706_RFK300FH-AD1_2111171_WT7351`.
 *
 * ── 없는 조각은 건너뛴다 ────────────────────────────────────────────────
 * L/N 이나 S/N 이 비어 있는 건이 실제로 있다. 자리를 지켜 이어 붙이면
 * `D260706_RFK300FH-AD1__WT7351` 처럼 **빈 자리**가 생기고, 그것을 본 사람은
 * 값이 지워진 줄로 읽는다. 그래서 있는 조각만 `_` 로 잇는다.
 *
 * 고객사도 마찬가지다 — 없으면 `[] ` 라는 빈 괄호를 만들지 않고 통째로 뺀다.
 * 다섯이 전부 비면 빈 문자열이고, 그때 화면은 앞부분 없이 목표 문장만 그린다.
 */
export function buildGoalPrefix(source: WeeklyReportGoalPrefixSource): string {
  const customerName = present(source.customerName);
  const rest = [source.intakeNumber, source.modelName, source.lotNumber, source.serialNumber]
    .map(present)
    .filter((piece): piece is string => piece !== null)
    .join("_");

  if (customerName === null) return rest;
  if (rest === "") return `[${customerName}]`;
  return `[${customerName}] ${rest}`;
}

/**
 * 상자에 실제로 인쇄되는 한 줄 — `앞부분: 목표`.
 *
 * 앞부분이 하나도 없는 건(연결된 수리 건의 다섯 값이 전부 비어 있는, 있어서는
 * 안 되지만 막을 수도 없는 경우)에는 콜론을 붙이지 않는다. `: 견적서 발행` 은
 * 무언가 빠진 줄로 보이지만, `견적서 발행` 은 그냥 짧은 줄이다.
 */
export function formatGoalLine(prefix: string, goalText: string): string {
  return prefix === "" ? goalText : `${prefix}: ${goalText}`;
}

/** 정렬이 보는 한 줄. 조회가 내려보내는 행에서 이 둘만 쓴다. */
export type WeeklyReportGoalOrdering = {
  displayOrder: number | null;
  createdAt: Date;
};

/**
 * 상자 안의 차례 — `display_order` 오름차순, 같으면 `created_at`(적은 차례).
 *
 * **차례를 정하지 않은 줄(NULL)은 뒤로 간다.** Postgres 의 `order by ... asc`
 * 가 NULL 을 뒤에 두는 것과 같게 맞춘 것이라, SQL 로 읽어 온 순서와 이 함수를
 * 거친 순서가 어긋나지 않는다. 어긋나면 "새로고침할 때마다 줄 순서가 달라지는"
 * 화면이 된다.
 *
 * 원본 배열을 건드리지 않는다 — 부르는 쪽이 조회 결과를 그대로 다시 쓸 수
 * 있어야 한다.
 */
export function sortWeeklyReportGoals<T extends WeeklyReportGoalOrdering>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) {
      if (a.displayOrder === null) return 1;
      if (b.displayOrder === null) return -1;
      return a.displayOrder - b.displayOrder;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}
