/**
 * ============================================================================
 * 통문증 글자 인식 — 읽어낸 글자에서 **통문번호**를 뽑고 날짜로 검산한다.
 * ============================================================================
 * 글자 인식기가 내놓는 것은 띠 하나를 통째로 읽은 **여러 줄의 글자**다. 거기서
 * 통문번호를 가려내고, 같은 서류의 「통문작성일」과 **날짜가 맞는지** 본다.
 *
 * ── 🔴 날짜 검산이 핵심이다 ─────────────────────────────────────────────
 * 통문번호는 「영문 대문자 2 + 숫자 10」이고, 숫자 앞 여섯 자리가 `YYMMDD` 다.
 * 같은 서류의 통문작성일(`18-SEP-26` 꼴)과 그 날짜가 **같아야 한다.** 이 검산이
 * 실제로 「글자 하나가 끼어든」 오독을 잡아냈다(2026-10-01 측정). 숫자 열 개가
 * 형식만 맞으면 통문번호처럼 보이기 때문에, 형식만으로는 틀린 값을 자신 있게
 * 내놓게 된다 — 그래서 이 검산을 **떼지 마라.**
 *
 * ── 🔴 첫 번째로 걸린 것을 쓴다 ─────────────────────────────────────────
 * 여러 개가 걸리면 글자 차례로 가장 앞선 것을 쓴다. 14장 측정에서 이 규칙이
 * 14/14 였다. 「날짜가 맞는 것을 고른다」로 바꾸면 검산이 **고르는 장치**가 되어
 * 더 이상 틀린 값을 걸러내지 못한다(언제나 맞는 것만 고르니 늘 통과한다).
 *
 * ── 왜 바코드를 쓰지 않는가 ─────────────────────────────────────────────
 * 통문증에는 바코드도 있지만 **쓰지 않기로 했다**(사용자 결정 2026-10-01).
 * 측정에서 한 장이 `EK2609110029` 로 읽혔는데 실제 값은 `EK2609180029` 였다 —
 * 틀린 값을 오류 없이 내놓았고, 속도도 글자 인식의 열 배가 걸렸다.
 * ============================================================================
 */

/**
 * 통문번호 — 영문 대문자 2 + 숫자 10.
 *
 * 글자와 숫자 사이의 `\s?` 는 인식기가 그 자리에 공백 하나를 끼워 읽는 일이
 * 잦아서다(찾은 뒤 붙여서 돌려준다). 🔴 측정에 쓴 그대로이므로 고치지 마라.
 */
const PASS_NUMBER_PATTERN = /\b([A-Z]{2})\s?([0-9]{10})\b/g;

/**
 * 통문작성일 — `18-SEP-26` 꼴. 가운데 구분자(대시·마침표·빗금)가 사진마다 달리
 * 보이고 아예 안 보이기도 해서 넓게 받는다.
 */
const WRITTEN_DATE_PATTERN =
  /\b([0-3]?[0-9])\s*[-–—./]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*[-–—./]?\s*([0-9]{2})\b/gi;

/**
 * 🔴 **줄바꿈 없는 공백**(U+00A0)과 좁은 공백(U+202F)을 보통 공백으로 바꾼다.
 * 인식기가 공백 자리에 그 글자를 내놓는 일이 있는데, 사람 눈에는 보통 공백과
 * 똑같이 보여 「왜 안 걸리지」의 원인을 영영 못 찾는다.
 */
const INVISIBLE_SPACE_PATTERN = /[  ]/g;

const MONTH_NUMBER: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

export type PassSlipReading = {
  /** 읽어낸 통문번호. 못 찾았으면 null. */
  passNumber: string | null;
  /** 읽어낸 통문작성일들(`18-SEP-26` 꼴). 중복 없이 나온 차례대로. */
  writtenDates: string[];
  /** 통문번호 안에 든 날짜 여섯 자리(YYMMDD). 통문번호를 못 찾았으면 null. */
  dateInNumber: string | null;
  /** 🔴 통문번호의 날짜와 통문작성일이 맞는가. 맞아야 믿을 수 있다. */
  dateVerified: boolean;
};

/** `18-SEP-26` → `260918`. 모양이 다르면 null. */
export function writtenDateToYyMmDd(date: string): string | null {
  const matched = /^([0-3][0-9])-([A-Z]{3})-([0-9]{2})$/.exec(date);
  if (!matched) return null;
  const month = MONTH_NUMBER[matched[2]];
  if (!month) return null;
  return matched[3] + month + matched[1];
}

/** 글자에서 통문작성일을 전부 뽑는다(중복 없이, 나온 차례대로). */
export function extractWrittenDates(text: string): string[] {
  const found: string[] = [];
  // 🔴 전역 정규식은 lastIndex 를 들고 다닌다 — 모듈 상수를 쓰므로 매번 되돌린다.
  WRITTEN_DATE_PATTERN.lastIndex = 0;
  let matched = WRITTEN_DATE_PATTERN.exec(text);
  while (matched) {
    const normalized = `${matched[1].padStart(2, "0")}-${matched[2].toUpperCase()}-${matched[3]}`;
    if (!found.includes(normalized)) found.push(normalized);
    matched = WRITTEN_DATE_PATTERN.exec(text);
  }
  return found;
}

/** 글자에서 통문번호 후보를 전부 뽑는다(나온 차례대로, 중복 그대로). */
export function extractPassNumberCandidates(text: string): string[] {
  const found: string[] = [];
  PASS_NUMBER_PATTERN.lastIndex = 0;
  let matched = PASS_NUMBER_PATTERN.exec(text);
  while (matched) {
    found.push(matched[1] + matched[2]);
    matched = PASS_NUMBER_PATTERN.exec(text);
  }
  return found;
}

/** 인식한 글자 한 덩어리에서 통문번호를 뽑고 날짜로 검산한다. */
export function readPassSlipNumber(text: string): PassSlipReading {
  const normalized = (text ?? "").replace(INVISIBLE_SPACE_PATTERN, " ");
  const candidates = extractPassNumberCandidates(normalized);
  const passNumber = candidates[0] ?? null;
  const writtenDates = extractWrittenDates(normalized);
  const dateInNumber = passNumber ? passNumber.slice(2, 8) : null;
  const dateVerified =
    dateInNumber !== null &&
    writtenDates.some((date) => writtenDateToYyMmDd(date) === dateInNumber);
  return { passNumber, writtenDates, dateInNumber, dateVerified };
}
