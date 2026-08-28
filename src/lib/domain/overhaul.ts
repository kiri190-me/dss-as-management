/**
 * ============================================================================
 * O/H(오버홀) 대상 판정 — S/N 에 적힌 생산 연월으로
 * ============================================================================
 * 사용자가 알려 준 업무 규칙(2026-08-28):
 *
 *   · O/H 대상 = 생산월로부터 **4년** 경과, **또는** OP TIME **5만 시간** 초과
 *   · S/N `1904097` = **2019년 04월**에 만든 **097번째** 제품
 *
 * ── 🔴 표시일 뿐 분기가 아니다 ──────────────────────────────────────────
 * O/H 대상이어도 **일반 견적서와 OH 견적서를 모두 발행한다**(사용자 확인).
 * 그러니 이 판정으로 화면이 갈라지거나 견적서 종류가 정해지면 안 된다 —
 * 접수 건 상세와 견적서 작성 화면에 "O/H 대상품"이라고 **알려 주기만** 한다.
 * 무엇을 발행할지는 사람이 정한다.
 *
 * ── OP TIME 은 아직 시스템에 없다 ───────────────────────────────────────
 * 5만 시간 기준을 판정할 칸이 repair_cases 에도 products 에도 없다. 그래서
 * 지금 판정은 **생산월 기준 하나뿐**이고, 결과에 그 사실을 함께 담는다
 * (`opTimeUnknown`). 화면은 "OP TIME 은 확인할 수 없습니다"라고 밝힌다 —
 * 판정 근거가 반쪽인 것을 감추면, 5만 시간을 넘긴 4년 미만 장비를 시스템이
 * "대상 아님"이라고 잘라 말하는 셈이 된다.
 *
 * ── 모든 S/N 이 이 형식은 아니다 ────────────────────────────────────────
 * `WU8042` 처럼 문자 접두가 붙은 S/N 이 실제로 있다(다른 체계). 그런 값은
 * **판정 불가**로 돌려주고, 화면은 아무 말도 하지 않는다 — 형식이 다르다고
 * "대상 아님"이라고 답하면 그건 틀린 답이다.
 * ============================================================================
 */

/** 생산월로부터 이 개월 수가 지나면 O/H 대상. 4년 = 48개월(사용자 확인). */
export const OVERHAUL_MONTHS = 48;

/** OP TIME 기준. 지금은 판정에 쓰지 못하지만(위 항목) 값은 여기 한 곳에 둔다. */
export const OVERHAUL_OPERATING_HOURS = 50_000;

export type SerialProduction = {
  /** 2019 처럼 네 자리. */
  year: number;
  /** 1~12. */
  month: number;
  /** 그 달의 몇 번째인가. 판정에는 쓰지 않지만 화면이 보여 줄 수 있다. */
  sequence: number;
};

/**
 * S/N → 생산 연월. 형식이 다르면 null 이다(위 '모든 S/N 이 이 형식은 아니다').
 *
 * 두 자리 연도는 **70 을 경계로** 편다: 70~99 는 19xx, 00~69 는 20xx. 이 장비들은
 * 2000년대 것이라 실제로는 늘 20xx 로 풀리지만, 경계를 두지 않으면 `99` 가
 * 2099년(미래)이 되어 "생산되지 않은 장비"가 만들어진다.
 */
export function parseSerialProduction(serialNumber: string | null | undefined): SerialProduction | null {
  if (typeof serialNumber !== "string") return null;
  const trimmed = serialNumber.trim();
  // 앞 2자리 연도 + 2자리 월 + 나머지 일련번호. 전부 숫자여야 한다.
  const match = /^(\d{2})(\d{2})(\d+)$/.exec(trimmed);
  if (!match) return null;

  const yy = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { year: yy >= 70 ? 1900 + yy : 2000 + yy, month, sequence: Number(match[3]) };
}

export type OverhaulAssessment =
  | {
      /** S/N 형식이 달라 생산월을 알 수 없다. 화면은 아무 말도 하지 않는다. */
      kind: "UNKNOWN";
    }
  | {
      kind: "ASSESSED";
      production: SerialProduction;
      /** 기준일까지 지난 개월 수. */
      monthsElapsed: number;
      /** 생산월 기준으로 O/H 대상인가. */
      isDue: boolean;
      /**
       * OP TIME 기준은 보지 못했다는 표시. 지금은 **언제나 true** 다 — 그 값을
       * 담는 칸이 아직 없다(파일 머리말). 칸이 생기면 이 자리에서 함께 판정한다.
       */
      opTimeUnknown: true;
    };

/**
 * 생산월과 기준일로 O/H 대상 여부를 본다.
 *
 * `referenceDate` 를 인자로 받는 이유: 오늘을 함수 안에서 읽으면 시험할 수 없고,
 * 서버와 화면이 각자 다른 시각을 보게 된다(이 저장소가 날짜를 다루는 방식).
 */
export function assessOverhaul(
  serialNumber: string | null | undefined,
  referenceDate: Date
): OverhaulAssessment {
  const production = parseSerialProduction(serialNumber);
  if (!production) return { kind: "UNKNOWN" };

  const monthsElapsed =
    (referenceDate.getFullYear() - production.year) * 12 +
    (referenceDate.getMonth() + 1 - production.month);

  return {
    kind: "ASSESSED",
    production,
    monthsElapsed,
    isDue: monthsElapsed >= OVERHAUL_MONTHS,
    opTimeUnknown: true,
  };
}

/** "2019년 4월 (97번째)" — 화면이 근거를 보여 줄 때 쓴다. */
export function formatProduction(production: SerialProduction): string {
  return `${production.year}년 ${production.month}월 (${production.sequence}번째)`;
}

/** "6년 3개월 경과" — 판정 근거 한 줄. */
export function formatElapsed(monthsElapsed: number): string {
  if (monthsElapsed < 0) return "생산 예정";
  const years = Math.floor(monthsElapsed / 12);
  const months = monthsElapsed % 12;
  if (years === 0) return `${months}개월 경과`;
  if (months === 0) return `${years}년 경과`;
  return `${years}년 ${months}개월 경과`;
}
