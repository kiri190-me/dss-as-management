/**
 * 보고서번호(repair_cases.legacy_report_number)를 자동으로 매기는 규칙만 담은
 * 순수 모듈이다. DB 를 전혀 모른다 — 받는 것은 **이미 쓰인 번호들**과 **오늘
 * 날짜**뿐이고, 내는 것은 **다음 번호 하나** 또는 **못 매긴다는 사실**이다.
 * 실제로 읽고 쓰는 일은 db/mutations/repair-cases.ts 가 한 트랜잭션 안에서
 * 한다 — 인수번호를 형식(local/intake-number.ts)과 채번(DB 할당기)으로 가른
 * 것과 같은 방식이다. 그래야 2030년·999 초과·숫자 아닌 옛 값 같은 갈림을
 * DB 없이 시험할 수 있다.
 *
 * ## 번호 모양 — 네 자리 (2026-10-18 쓰는 분 결정)
 *
 *     {앞자리}{세 자리 순번}      예) 2026년 76번째 → 6076
 *
 * - **앞자리 = 연도 − 2020**. 2021=1 · 2026=6 · 2029=9.
 * - **순번 = 올해 이미 쓰인 번호 가운데 가장 큰 것 + 1**. 하나도 없으면 001.
 * - 🔴 **해가 바뀌면 001 부터 다시 시작한다.** 2026년에 6076 까지 갔어도
 *   2027년 첫 건은 7001 이다(7077 이 아니다). 그래서 작년 번호는 올해 셈에
 *   아예 들어오지 않는다 — 앞자리가 다르면 세지 않는다.
 *
 * ## 셈에 넣는 것과 빼는 것
 *
 * **넣는다**: 앞뒤 공백을 뗀 뒤 **정확히 네 자리 숫자**이고 **앞자리가 올해
 * 것**인 값.
 *
 * **뺀다**(없는 셈 친다 — 버리지도, 고치지도, 거르지도 않는다):
 * - 비어 있는 값(null · undefined · "" · 공백만)
 * - 숫자가 아닌 옛 값 — 과거 엑셀 `목록` A열에는 `R-2026-018` 같은 글자가
 *   섞여 있다. 이 칸은 원래 그 식별자를 그대로 받아 적던 자리다.
 * - 네 자리가 아닌 값 — 세 자리(`501`)도 다섯 자리(`60761`)도 이 규칙의
 *   번호가 아니다. 섞여 있어도 다음 번호가 흔들리면 안 된다.
 * - 다른 해의 번호(앞자리가 다르다).
 *
 * ## 번호를 못 매기는 두 자리 — 🔴 지어내지 않는다
 *
 * - 🔴 **2030년 이후**: 앞자리가 10 이 되어 다섯 자리가 될지, 0 으로 돌아갈지
 *   **아직 정하지 않았다**(2026-10-18 쓰는 분 결정 — 「그때 가서 정한다」).
 *   틀린 번호를 지어내느니 비워 둔다. 2021년 이전도 같다(앞자리가 한 자리로
 *   떨어지지 않는다).
 * - 🔴 **한 해에 999건을 넘길 때**: 순번이 네 자리가 되어 모양이 깨진다.
 *
 * 둘 다 `{ ok: false, reason }` 을 낸다. **접수 자체는 그대로 성공해야 하고**
 * 보고서번호만 빈다 — 왜 비었는지는 부르는 쪽이 서버 기록에 남기고, 사람이
 * 상세 화면의 보고서번호 칸에서 손으로 적으면 된다.
 */

/** 번호를 매길 수 있는 연도 — 앞자리(연도 − 2020)가 한 자리로 떨어지는 구간이다. */
export const REPORT_NUMBER_FIRST_YEAR = 2021;
export const REPORT_NUMBER_LAST_YEAR = 2029;

/** 세 자리 순번의 한계. 이 수를 넘기면 번호 모양이 깨지므로 매기지 않는다. */
export const REPORT_NUMBER_MAX_SEQUENCE = 999;

/** 앞자리를 뽑는 기준 연도. 2026 − 2020 = 6. */
const REPORT_NUMBER_YEAR_BASE = 2020;

export type ReportNumberUnavailableReason =
  /** 2021~2029 밖 — 앞자리를 어떻게 적을지 아직 정하지 않았다(2030년). */
  | "YEAR_OUT_OF_RANGE"
  /** 그 해에 999건을 다 썼다 — 순번이 세 자리를 넘는다. */
  | "SEQUENCE_EXHAUSTED";

export type NextReportNumberResult =
  | { ok: true; reportNumber: string }
  | { ok: false; reason: ReportNumberUnavailableReason };

const FOUR_DIGITS = /^[0-9]{4}$/;
const FOUR_DIGIT_YEAR = /^[0-9]{4}$/;

/**
 * "YYYY-MM-DD" 의 연도에 해당하는 **앞자리 한 글자**. 매길 수 없는 해(2021
 * 이전 · 2030 이후)와 날짜로 읽을 수 없는 글자는 null 이다.
 *
 * 부르는 쪽이 DB 조회를 `{앞자리}%` 로 좁히는 데에도 쓴다 — 좁히는 조건과
 * 세는 조건이 갈라지지 않도록 같은 함수에서 나온다.
 */
export function reportNumberYearDigit(today: string): string | null {
  const head = today.slice(0, 4);
  if (!FOUR_DIGIT_YEAR.test(head)) return null;
  const year = Number(head);
  if (year < REPORT_NUMBER_FIRST_YEAR || year > REPORT_NUMBER_LAST_YEAR) return null;
  return String(year - REPORT_NUMBER_YEAR_BASE);
}

/**
 * 한 값이 **올해 번호**라면 그 세 자리 순번을, 아니면 null 을 낸다.
 * 위 「셈에 넣는 것과 빼는 것」이 그대로 여기 들어 있다.
 */
function sequenceOfThisYear(value: string | null | undefined, yearDigit: string): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!FOUR_DIGITS.test(trimmed)) return null;
  if (trimmed[0] !== yearDigit) return null;
  return Number(trimmed.slice(1));
}

/**
 * 다음 보고서번호. `existingReportNumbers` 는 **이미 쓰인 값 전부**를 그대로
 * 넘겨도 된다(거르는 일은 이 함수가 한다). 부르는 쪽은 휴지통에 들어간 건의
 * 번호까지 넣어야 한다 — 빼면 그 번호를 다시 쓰게 된다.
 */
export function nextReportNumber(
  existingReportNumbers: ReadonlyArray<string | null | undefined>,
  today: string
): NextReportNumberResult {
  const yearDigit = reportNumberYearDigit(today);
  if (yearDigit === null) return { ok: false, reason: "YEAR_OUT_OF_RANGE" };

  // 가장 큰 것 + 1 이다(개수 + 1 이 아니다). 가운데가 비어 있어도 — 사람이
  // 지웠거나 건너뛰었어도 — 이미 나간 번호를 다시 쓰지 않는다.
  let highest = 0;
  for (const value of existingReportNumbers) {
    const sequence = sequenceOfThisYear(value, yearDigit);
    if (sequence !== null && sequence > highest) highest = sequence;
  }

  const next = highest + 1;
  if (next > REPORT_NUMBER_MAX_SEQUENCE) return { ok: false, reason: "SEQUENCE_EXHAUSTED" };
  return { ok: true, reportNumber: `${yearDigit}${String(next).padStart(3, "0")}` };
}
