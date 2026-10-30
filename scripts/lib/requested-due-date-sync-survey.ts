import { foldBlankToNull } from "../../src/lib/domain/domestic-order-list";
import { isNotEarlierThan } from "../../src/lib/domain/local/validation";
import { pickEarliestDueDate } from "../../src/lib/domain/weekly-report-delivery";

/**
 * ============================================================================
 * 내자 `납기요청일` ↔ 수리 건 `고객 요청 납기일` — **묶기 전에 몇 건이 어긋나 있나**
 * ============================================================================
 * DB 도 화면도 모르는 순수 함수다. 받은 자료를 세기만 하고, 실제로 읽어 오는 일은
 * `scripts/check-requested-due-date-sync.ts` 가 한다 — `scripts/lib/part-name-overlap.ts`
 * 와 같은 나눔이고, 같은 이유다(세는 규칙은 값으로 시험할 수 있어야 한다).
 *
 * ── 🔴 왜 세어야 하는가 ─────────────────────────────────────────────────
 * 2026-10-30 사용자 요구는 **어느 쪽에서 고치든 같은 날짜를 보게** 하는 것이다. 그런데
 * 이 저장소는 그 둘을 **일부러 따로 두었다** — `src/lib/domain/requested-due-date-link.ts`
 * 머리말: 내자의 납기요청일은 「발주서에 적힌 날짜」이고 수리 건의 고객 요청 납기일은
 * 「고객이 접수 때 말한 날짜」라, 같아야 할 이유가 없다고 못 박아 두었다. 지금은 한쪽이
 * 비었을 때만 상대 값을 **빌려 그릴 뿐**이고 어느 칸에도 옮겨 적지 않는다.
 *
 * 🔴 **묶는 순간, 지금 다르게 적혀 있는 건들은 한쪽 값으로 덮인다. 덮인 값은 돌아오지
 *    않는다.** 그래서 묶기 전에 그 수를 본다. 단위 시험으로는 영영 안 나오는 수다 —
 *    운영 자료를 봐야만 나온다.
 *
 * ── 🔴 범위: **수리 건에 붙은 내자 줄만** ───────────────────────────────
 * 수리 건과 무관한 줄(별도 건)은 분할 납품 때문에 날짜를 **여럿 계속 받아야 하고**,
 * 동기화와 아무 상관이 없다(2026-10-30 사용자 결정). 그 거르기는 이 파일이 하지
 * 않는다 — 부르는 쪽의 SQL 이 `repair_cases` 와 **inner join** 해서 가져온 것만 들어온다.
 * 여기서 한 번 더 거르면 거르는 자가 두 벌이 되고, 그중 하나만 고쳐지는 날이 온다.
 *
 * ── 🔴 「다르다」의 정의 ────────────────────────────────────────────────
 * **양쪽에 다 적혔는데** 내자 쪽 날짜 묶음이 `{수리 건 날짜}` 하나와 같지 않으면 다름이다.
 *
 *   - **한쪽만 적힌 건은 다름이 아니다.** 그것은 ④(빌려 그리는 중)이고, 묶어도 덮이는
 *     값이 없다 — 오히려 묶으면 편해지는 쪽이다. 이 경계를 흐리면 ③ 이 부풀고, 사람이
 *     「덮일 건이 이만큼이나 된다」고 잘못 읽는다.
 *   - 내자 쪽 날짜가 **여럿이면 그 자체로 다름**이다(`{A, B}` ≠ `{A}`). 하나로 접은
 *     뒤 견주면 분할 납품 줄이 「같다」로 세어져, 묶을 때 사라질 날짜가 셈에서 빠진다.
 *   - 같은 날짜가 두 번 적힌 것은 **한 가지**로 본다(중복 제거). 날짜가 같으면 보이는
 *     값이 같고, 여기서 재는 것은 「보이는 날짜가 어긋나 있나」다. 🔵 다만 **행은 따로
 *     센다**(`multiDueDateLines` ↔ `multiDistinctDueDateLines`) — 묶을 때 사라지는 것은
 *     날짜 가짓수가 아니라 행이고, 행에는 비고가 달려 있다.
 *
 * ── 🔴 비어 있음은 화면과 **같은 자**로 접는다 ──────────────────────────
 * `foldBlankToNull` 은 화면이 쓰는 바로 그 함수다(`resolveRepairCaseRequestedDueDate`).
 * 🔵 `customer_requested_due_date` 도 `due_date` 도 DB 에서는 `date` 칸이라 **공백만 적힌
 * 값은 애초에 들어올 수 없다.** 그래도 다른 자를 쓰지 않는 까닭은, 셈과 화면이 갈라지면
 * 「화면은 빌려 그리고 있는데 셈은 적혀 있다고 보는」 건이 생기기 때문이다. 지금은 두
 * 자의 답이 같고, 갈라질 길을 만들지 않는다.
 *
 * ── 🔴 방향 꼬리표는 **가장 이른 하루**로 붙인다 ────────────────────────
 * 「내자가 더 늦다」와 「수리 건이 더 늦다」는 뜻이 다르다 — 앞은 발주를 미룬 것이고 뒤는
 * 고객이 당긴 것일 수 있다. 어느 쪽이 늦은지는 내자 날짜 묶음을 하나로 접어야 말할 수
 * 있고, 접는 자는 여기서 새로 정하지 않는다: 화면이 빌려 올 때 쓰는 `pickEarliestDueDate`
 * (주간보고 `입고 요청일` 과 같은 자) 그대로다.
 *
 * ⚠️ **내자 날짜가 여럿이면 그 꼬리표는 묶음 전체를 말하지 못한다.** 내자 `{01-10, 03-01}`
 *    에 수리 건 `02-01` 이면 가장 이른 하루 기준으로는 「수리 건이 더 늦다」지만, 내자에는
 *    그보다 늦은 날짜도 있다. 숨기지 않으려고 `differWithMultipleDomesticDates` 를 **함께**
 *    돌려준다 — 부르는 쪽이 방향만 찍지 말고 이 수도 같이 찍어야 한다.
 *
 * ── 🔴 ⑦ 「내자 → 수리 건」이 **거절당하는 건** ─────────────────────────
 * 수리 건의 `고객 요청 납기일` 에는 **인수일보다 이를 수 없다**는 잣대가 걸려 있다
 * (`mutations/repair-cases.ts` 847-857 — 어기면 `VALIDATION_ERROR` 로 저장이 통째로
 * 거절된다). 내자 `납기요청일` 에는 **그런 잣대가 없다**(`validation/domestic-order-input.ts`
 * 의 normalizeDueDates 는 상한 20개만 본다). 🔴 그래서 **지금 적혀 있는 값만으로도**
 * 내자 → 수리 건 방향은 막힐 수 있다.
 *
 * 🔴 **그 잣대를 베껴 적지 않는다.** 그 mutation 이 부르는 `isNotEarlierThan` 을 **그대로
 * 부른다**(`domain/local/validation.ts`). 베껴 적으면 「세기엔 괜찮은데 실제로는 막히는」
 * 건이 생기고, 그 어긋남은 묶고 나서야 드러난다. 저쪽이 잣대를 바꾸면 이 수도 **함께**
 * 바뀌어야 하고, 같은 함수를 부르는 한 그렇게 된다.
 *
 * 🔵 **같은 날은 거절이 아니다** — 그 함수가 `a >= b` 이고 mutation 은 그것이 거짓일 때만
 * 거절한다. 그러므로 ⑦ 은 **엄격히 이른** 날짜뿐이다. 이 경계가 `>` ↔ `>=` 로 뒤집히면
 * 인수일 당일에 납기를 잡은 건이 통째로 ⑦ 에 들어온다.
 *
 * 🔵 「하나라도 이르다」와 「가장 이른 하루가 이르다」는 **같은 말**이다(가장 이른 하루가
 * 곧 최솟값이다). 그래서 `pickEarliestDueDate` 로 미는 설계에서는 이 수가 곧 막히는 수다.
 * 다른 날짜를 미는 설계로 간다면 그때는 `allDatesEarlierThanReceivedAt`(어느 날짜를 골라도
 * 막히는 건)이 하한이 된다 — 그래서 둘을 **함께** 센다.
 *
 * ⚠️ 인수일을 **못 읽은 건은 ⑦ 로도 아닌 것으로도 세지 않는다**(`receivedAtUnknown`).
 * `received_at` 은 NOT NULL 이라 그럴 일이 없지만, 0 으로 찍으면 「막히는 건이 없다」로
 * 읽힌다 — 「못 쟀다」와 「없다」를 가르는 이 저장소의 규율이다.
 *
 * ── 🔴 **읽기만 한다** ──────────────────────────────────────────────────
 * 이 파일에는 고칠 값을 내놓는 함수가 하나도 없다. 「묶으면 어느 값이 이기나」를 여기서
 * 정하지 않는 것도 일부러다 — 재는 도구에 그 답을 미리 적어 두면, 다음 조각이 그것을
 * 설계 결정으로 물려받는다. 그 결정은 이 수를 보고 사람이 한다.
 * ============================================================================
 */

/** 내자 줄에 달린 납기요청일 한 행. `hasNote` 는 비고가 **적혀 있나**만 말한다(글자는 안 읽는다). */
export type SurveyDueDateRow = {
  dueDate: string;
  hasNote: boolean;
};

/** 수리 건에 붙은 내자 줄 하나(살아 있는 줄만 들어온다 — 파일 머리말의 '범위'). */
export type SurveyDomesticLine = {
  dueDates: readonly SurveyDueDateRow[];
};

/** 수리 건 하나와 그 건에 붙은 내자 줄 전부. */
export type SurveyCase = {
  intakeNumber: string;
  customerRequestedDueDate: string | null;
  /** 인수일. ⑦ 의 잣대다 — DB 에서 NOT NULL 이지만 못 읽은 경우를 지어내지 않는다(머리말). */
  receivedAt: string;
  lines: readonly SurveyDomesticLine[];
};

/**
 * 그 건이 어느 칸에 들어가는가. 다섯은 **서로 겹치지 않고 빠짐도 없다** — 부르는 쪽이
 * 다섯의 합과 전체 건수를 맞대어 검산할 수 있어야 한다(한쪽만 고쳐진 셈을 잡는 길이다).
 */
export type CaseBucket =
  /** 양쪽 다 적혔고 다르다. ← 묶으면 덮인다 */
  | "differ"
  /** 수리 건에만 적혔다 — 붙은 내자 줄들은 지금 그 값을 빌려 그리고 있다 */
  | "case-only"
  /** 내자에만 적혔다 — 수리 건 화면이 지금 그 값을 빌려 그리고 있다 */
  | "domestic-only"
  /** 양쪽 다 적혔고 같다(내자 쪽 날짜가 그 하루뿐이다) */
  | "same"
  /** 양쪽 다 비었다 */
  | "neither";

/** ③ 안에서 어느 쪽이 더 늦은가. ⚠️ **가장 이른 하루** 기준이다(파일 머리말). */
export type DiffDirection =
  /** 내자의 가장 이른 하루가 수리 건 날짜보다 **늦다** */
  | "domestic-later"
  /** 수리 건 날짜가 내자의 가장 이른 하루보다 **늦다** */
  | "case-later"
  /** 가장 이른 하루는 같은데 내자에 날짜가 **더 있다** */
  | "same-earliest-plus-more";

export type CaseVerdict = {
  bucket: CaseBucket;
  /** `bucket` 이 `"differ"` 일 때만 값이 있다. */
  direction: DiffDirection | null;
  /** 접은 뒤의 수리 건 날짜. */
  caseDueDate: string | null;
  /** 그 건에 붙은 내자 줄들의 날짜를 통틀어 모아 **중복을 제거하고 날짜순**으로 놓은 것. */
  domesticDueDates: string[];
  /** 그 건에 붙은 살아 있는 내자 줄 수. */
  lineCount: number;
  /** 날짜 행이 **둘 이상**인 줄 수(같은 날짜가 두 번이어도 센다). */
  multiDueDateLines: number;
  /** **서로 다른 날짜**가 둘 이상인 줄 수. 위와의 차이가 곧 「날짜는 같고 행만 여럿」이다. */
  multiDistinctDueDateLines: number;
  /** 날짜 행이 하나도 없는 줄 수. */
  linesWithoutDueDate: number;
  /** 날짜가 없어서 **지금 수리 건 날짜를 빌려 그리고 있는** 줄 수(수리 건에 날짜가 있을 때만). */
  linesBorrowingFromCase: number;
  /** 수리 건에 날짜가 있는데 그 줄의 날짜가 그 하루와 다른 줄 수 — **묶으면 덮일 줄**. */
  linesDifferingFromCase: number;
  /** 비고가 적힌 날짜 행 수 — 묶어서 날짜를 하나로 만들면 **함께 사라질 자리**다. */
  notedDueDateRows: number;
  /** 접은 뒤의 인수일. null 이면 **못 읽은 것**이고, 그때 아래 둘은 거짓이다(머리말). */
  receivedAt: string | null;
  /**
   * ⑦ — 내자 날짜 가운데 **인수일보다 이른 것이 하나라도** 있나. 있으면 그 날짜를 수리
   * 건으로 밀 때 `mutations/repair-cases.ts` 가 거절한다. 🔵 가장 이른 하루가 곧 최솟값
   * 이므로 「가장 이른 하루로 민다」는 설계에서는 이것이 곧 막히는 건이다.
   */
  blockedByReceivedAt: boolean;
  /** 내자 날짜가 **전부** 인수일보다 이른가 — 어느 날짜를 골라 밀어도 막히는 건이다. */
  allDatesEarlierThanReceivedAt: boolean;
  /** 인수일보다 이른 내자 날짜의 가짓수(중복 제거 뒤). */
  datesEarlierThanReceivedAt: number;
};

/** 보고에 찍는 한 건. 🔴 접수번호와 날짜까지만이다 — 고객사·L/N·S/N 은 들어오지 않는다. */
export type SurveySample = {
  intakeNumber: string;
  caseDueDate: string | null;
  domesticDueDates: string[];
  /** ⑦ 의 본보기에 인수일이 함께 찍혀야 사람이 「정말 이른가」를 눈으로 볼 수 있다. */
  receivedAt: string | null;
};

export type Survey = {
  /** 센 수리 건 수(= 다섯 칸의 합). */
  cases: number;
  /** 그 건들에 붙은 살아 있는 내자 줄 수. */
  lines: number;
  /** 내자 줄에 달린 날짜 행 수(중복 제거 전). */
  dueDateRows: number;
  buckets: Record<CaseBucket, number>;
  /** ③ 의 방향별 수. 합은 `buckets.differ` 와 같다. */
  directions: Record<DiffDirection, number>;
  /** ③ 가운데 내자 날짜가 **여럿**인 건 — 방향 꼬리표가 묶음 전체를 말하지 못하는 건이다. */
  differWithMultipleDomesticDates: number;
  /** ① 내자 줄이 둘 이상인 건 수와, 그 건들에 붙은 줄 수의 합. */
  multiLineCases: number;
  multiLineLines: number;
  /** ② 날짜 행이 둘 이상인 줄 수 / 서로 다른 날짜가 둘 이상인 줄 수 / 그런 줄을 가진 건 수. */
  multiDueDateLines: number;
  multiDistinctDueDateLines: number;
  multiDueDateCases: number;
  /** 지금 수리 건 날짜를 빌려 그리고 있는 내자 줄 수. */
  linesBorrowingFromCase: number;
  /** 묶으면 덮일 내자 줄 수(수리 건에 날짜가 있고 그 줄 날짜가 그와 다른 줄). */
  linesDifferingFromCase: number;
  /** 비고가 적힌 날짜 행 수. */
  notedDueDateRows: number;
  /** ⑦ 내자 날짜가 인수일보다 이른 건 — 「내자 → 수리 건」이 **거절당하는 건**이다. */
  blockedByReceivedAt: number;
  /** 그중 내자 날짜가 **전부** 이른 건 — 어느 날짜를 골라도 막힌다(막히는 수의 하한). */
  blockedAllDates: number;
  /**
   * ⑦ 을 칸별로 가른 것. 🔴 `differ` 쪽이 **가장 까다로운 건**이다(덮을 값도 있고 거절도
   * 당한다). `domestic-only` 쪽은 지금 잘 보이던 건이 묶는 순간 오류를 내는 자리다.
   *
   * ⚠️ `same` 쪽이 0 이 아니면 그것은 **이미 저장된 고객 요청 납기일 자체가 지금 잣대를
   * 어기고 있다**는 뜻이다(두 값이 같은데 그 값이 인수일보다 이르다). 옛 자료이거나
   * 이식으로 들어온 값이고, 그 건은 날짜를 건드리는 저장이 이미 전부 거절당한다.
   */
  blockedByBucket: Record<CaseBucket, number>;
  /** 🔴 인수일을 못 읽어 ⑦ 을 **재지 못한** 건. 0 이 아니면 위 수는 적게 세어진 것이다. */
  receivedAtUnknown: number;
  samples: {
    multiLine: SurveySample[];
    multiDueDate: SurveySample[];
    differ: SurveySample[];
    blocked: SurveySample[];
  };
};

/** 날짜 문자열을 중복 없이 날짜순으로. "YYYY-MM-DD" 는 사전순 = 날짜순이다(pickEarliestDueDate 머리말). */
function sortedUnique(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}

/**
 * 그 수리 건 하나를 판정한다 — 파일 머리말의 「다르다」 정의가 전부 여기 있다.
 *
 * 🔵 부르는 쪽이 건마다 이것을 부르고, `summarizeRequestedDueDateSync` 가 그 답을 센다.
 * 판정과 셈을 한 함수에 섞지 않는 것은 **경계를 값으로 시험**할 수 있게 하기 위해서다.
 */
export function classifyRequestedDueDates(input: SurveyCase): CaseVerdict {
  const caseDueDate = foldBlankToNull(input.customerRequestedDueDate);

  const allDates: string[] = [];
  let multiDueDateLines = 0;
  let multiDistinctDueDateLines = 0;
  let linesWithoutDueDate = 0;
  let linesBorrowingFromCase = 0;
  let linesDifferingFromCase = 0;
  let notedDueDateRows = 0;

  for (const line of input.lines) {
    const rows: SurveyDueDateRow[] = [];
    for (const row of line.dueDates) {
      const dueDate = foldBlankToNull(row.dueDate);
      // 날짜가 비어 있는 행은 「납기일이 비어 있다」가 아니라 **행이 아니다**(그 표는
      // due_date 가 NOT NULL 이다). 비고만 남은 행도 마찬가지로 세지 않는다.
      if (dueDate === null) continue;
      rows.push({ dueDate, hasNote: row.hasNote });
      if (row.hasNote) notedDueDateRows += 1;
    }

    const distinct = sortedUnique(rows.map((row) => row.dueDate));
    allDates.push(...distinct);

    if (rows.length >= 2) multiDueDateLines += 1;
    if (distinct.length >= 2) multiDistinctDueDateLines += 1;
    if (rows.length === 0) {
      linesWithoutDueDate += 1;
      // 빌려 그리는 것은 **빌려 올 값이 있을 때뿐**이다. 양쪽 다 비면 그 칸은 "-" 다.
      if (caseDueDate !== null) linesBorrowingFromCase += 1;
      continue;
    }
    if (caseDueDate !== null && !(distinct.length === 1 && distinct[0] === caseDueDate)) {
      linesDifferingFromCase += 1;
    }
  }

  const domesticDueDates = sortedUnique(allDates);

  // ⑦ — 🔴 잣대를 베껴 적지 않고 저쪽이 부르는 그 함수를 그대로 부른다(파일 머리말).
  //    `mutations/repair-cases.ts` 849줄은 `!isNotEarlierThan(due, receivedAt)` 일 때
  //    거절하므로, **같은 날은 거절이 아니다.** 여기도 그 식을 그대로 뒤집어 쓴다.
  const receivedAt = foldBlankToNull(input.receivedAt);
  const datesEarlierThanReceivedAt =
    receivedAt === null
      ? 0
      : domesticDueDates.filter((dueDate) => !isNotEarlierThan(dueDate, receivedAt)).length;

  const base = {
    caseDueDate,
    domesticDueDates,
    receivedAt,
    datesEarlierThanReceivedAt,
    blockedByReceivedAt: datesEarlierThanReceivedAt > 0,
    allDatesEarlierThanReceivedAt:
      domesticDueDates.length > 0 && datesEarlierThanReceivedAt === domesticDueDates.length,
    lineCount: input.lines.length,
    multiDueDateLines,
    multiDistinctDueDateLines,
    linesWithoutDueDate,
    linesBorrowingFromCase,
    linesDifferingFromCase,
    notedDueDateRows,
  };

  // 🔴 한쪽만 적힌 건을 먼저 갈라낸다 — 이 둘이 ③ 으로 새면 「덮일 건」이 부풀고,
  //    그 수를 보고 묶을지 말지를 정하게 된다(파일 머리말).
  if (caseDueDate === null) {
    return {
      ...base,
      bucket: domesticDueDates.length > 0 ? "domestic-only" : "neither",
      direction: null,
    };
  }
  if (domesticDueDates.length === 0) {
    return { ...base, bucket: "case-only", direction: null };
  }

  if (domesticDueDates.length === 1 && domesticDueDates[0] === caseDueDate) {
    return { ...base, bucket: "same", direction: null };
  }

  const earliest = pickEarliestDueDate(domesticDueDates);
  // 바로 위에서 날짜가 하나 이상임을 확인했으므로 null 일 수 없지만, 타입을 좁히려면
  // 확인해야 한다. 혹시 그 길이 열리더라도 방향을 지어내지 않는다.
  const direction: DiffDirection =
    earliest === null || earliest === caseDueDate
      ? "same-earliest-plus-more"
      : earliest > caseDueDate
        ? "domestic-later"
        : "case-later";

  return { ...base, bucket: "differ", direction };
}

function toSample(input: SurveyCase, verdict: CaseVerdict): SurveySample {
  return {
    intakeNumber: input.intakeNumber,
    caseDueDate: verdict.caseDueDate,
    domesticDueDates: verdict.domesticDueDates,
    receivedAt: verdict.receivedAt,
  };
}

/**
 * 건들을 통째로 세어 보고에 쓸 수를 만든다.
 *
 * 본보기는 **들어온 차례 그대로** 앞에서부터 `sampleLimit` 개만 담는다 — 부르는 쪽이
 * 접수번호순으로 읽어 오므로 돌릴 때마다 같은 건이 찍힌다.
 */
export function summarizeRequestedDueDateSync(
  cases: readonly SurveyCase[],
  sampleLimit = 20
): Survey {
  const survey: Survey = {
    cases: cases.length,
    lines: 0,
    dueDateRows: 0,
    buckets: { differ: 0, "case-only": 0, "domestic-only": 0, same: 0, neither: 0 },
    directions: { "domestic-later": 0, "case-later": 0, "same-earliest-plus-more": 0 },
    differWithMultipleDomesticDates: 0,
    multiLineCases: 0,
    multiLineLines: 0,
    multiDueDateLines: 0,
    multiDistinctDueDateLines: 0,
    multiDueDateCases: 0,
    linesBorrowingFromCase: 0,
    linesDifferingFromCase: 0,
    notedDueDateRows: 0,
    blockedByReceivedAt: 0,
    blockedAllDates: 0,
    blockedByBucket: { differ: 0, "case-only": 0, "domestic-only": 0, same: 0, neither: 0 },
    receivedAtUnknown: 0,
    samples: { multiLine: [], multiDueDate: [], differ: [], blocked: [] },
  };

  for (const input of cases) {
    const verdict = classifyRequestedDueDates(input);

    survey.lines += verdict.lineCount;
    for (const line of input.lines) {
      for (const row of line.dueDates) {
        if (foldBlankToNull(row.dueDate) !== null) survey.dueDateRows += 1;
      }
    }

    survey.buckets[verdict.bucket] += 1;
    if (verdict.direction !== null) survey.directions[verdict.direction] += 1;
    if (verdict.bucket === "differ" && verdict.domesticDueDates.length >= 2) {
      survey.differWithMultipleDomesticDates += 1;
    }

    survey.multiDueDateLines += verdict.multiDueDateLines;
    survey.multiDistinctDueDateLines += verdict.multiDistinctDueDateLines;
    survey.linesBorrowingFromCase += verdict.linesBorrowingFromCase;
    survey.linesDifferingFromCase += verdict.linesDifferingFromCase;
    survey.notedDueDateRows += verdict.notedDueDateRows;

    // 🔴 「못 쟀다」를 0 에 섞지 않는다 — 인수일을 못 읽은 건은 ⑦ 로도 아닌 것으로도
    //    세지 않고 따로 센다(파일 머리말).
    if (verdict.receivedAt === null) survey.receivedAtUnknown += 1;
    if (verdict.blockedByReceivedAt) {
      survey.blockedByReceivedAt += 1;
      survey.blockedByBucket[verdict.bucket] += 1;
      if (verdict.allDatesEarlierThanReceivedAt) survey.blockedAllDates += 1;
      if (survey.samples.blocked.length < sampleLimit) {
        survey.samples.blocked.push(toSample(input, verdict));
      }
    }

    if (verdict.lineCount >= 2) {
      survey.multiLineCases += 1;
      survey.multiLineLines += verdict.lineCount;
      if (survey.samples.multiLine.length < sampleLimit) {
        survey.samples.multiLine.push(toSample(input, verdict));
      }
    }
    if (verdict.multiDueDateLines > 0) {
      survey.multiDueDateCases += 1;
      if (survey.samples.multiDueDate.length < sampleLimit) {
        survey.samples.multiDueDate.push(toSample(input, verdict));
      }
    }
    if (verdict.bucket === "differ" && survey.samples.differ.length < sampleLimit) {
      survey.samples.differ.push(toSample(input, verdict));
    }
  }

  return survey;
}

/**
 * 다섯 칸의 합이 전체 건수와 같은가. 🔴 다르면 셈이 샌 것이고, 그 수로 설계를 정하면 안 된다.
 *
 * 부르는 쪽이 이것으로 **멈춘다**. 눈으로 검산할 수 없는 수라(운영 자료) 스스로 검산할
 * 길을 하나 들고 있어야 한다 — `check-target-shipment-missing.ts` 가 ③ 과 실제 줄 수를
 * 맞대어 보고 멈추는 것과 같은 규율이다.
 */
export function bucketTotalMismatch(survey: Survey): string | null {
  const total = Object.values(survey.buckets).reduce((sum, value) => sum + value, 0);
  if (total === survey.cases) return null;
  return `칸의 합 ${total}건이 전체 ${survey.cases}건과 다릅니다 — 셈이 샜습니다.`;
}
