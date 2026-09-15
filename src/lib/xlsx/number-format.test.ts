import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExcelDateSystem } from "./excel-date";
import { builtInNumberFormat, formatNumber, formatText, koreanLongDate } from "./number-format";

/**
 * ============================================================================
 * Excel 숫자 서식 → 사람이 보는 글자
 * ============================================================================
 * 양식 파일 없이 도는 순수 시험이다. 서식 코드 몇은 **이 저장소 양식이 실제로
 * 쓰는 것**을 그대로 옮겼다(견적서의 금액 · 발행일자, 보고서의 날짜 · 연월) — 서식이
 * 「이론상」이 아니라 우리가 만날 모양으로 도는지 보려고.
 * ============================================================================
 */

function format(value: number, code: string, dateSystem: ExcelDateSystem = "1900"): string | null {
  return formatNumber(value, code, dateSystem);
}

/** 기본 제공 번호의 서식으로. 번호가 없으면 시험이 먼저 넘어진다. */
function formatBuiltIn(value: number, id: number): string | null {
  const code = builtInNumberFormat(id);
  assert.ok(code !== null, `기본 제공 ${id}번이 없습니다`);
  return format(value, code);
}

/** 제너레이터 견적서 양식의 금액 칸(`D14`) 서식 — 실측. */
const QUOTE_AMOUNT = '"₩"#,##0_);\\("₩"#,##0\\)';
/** 견적서 양식의 발행일자 칸(`D10`) 서식 — 실측. */
const QUOTE_DATE = 'yyyy"년"\\ m"월"\\ d"일";@';
/** 견적서 양식의 회계 서식(41) — 실측. */
const ACCOUNTING = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-';
/** 보고서 양식의 날짜 칸 서식(시스템 긴 날짜) — 실측. */
const SYSTEM_LONG_DATE = "[$-F800]dddd\\,\\ mmmm\\ dd\\,\\ yyyy";

/** 2026-08-28(금) 의 1900 체계 일련번호. 견적서 채우개 시험이 같은 값을 쓴다. */
const AUG_28_2026 = 46262;

// ── 숫자 ─────────────────────────────────────────────────────────────────

test("천 단위 콤마", () => {
  assert.equal(format(3_500_000, "#,##0"), "3,500,000");
  assert.equal(format(1000, "#,##0"), "1,000");
  assert.equal(format(999, "#,##0"), "999");
  assert.equal(format(0, "#,##0"), "0");
  // 소수는 사사오입한다.
  assert.equal(format(1_234_567.5, "#,##0"), "1,234,568");
  // `#` 뿐이면 0 은 비운다 — Excel 도 빈칸으로 그린다.
  assert.equal(format(3_500_000, "#,###"), "3,500,000");
  assert.equal(format(0, "#,###"), "");
});

test("소수 자릿수 — `0` 은 늘, `#` 은 필요할 때만, `?` 는 빈칸", () => {
  assert.equal(format(1234.5, "#,##0.00"), "1,234.50");
  assert.equal(format(2.5, "0.##"), "2.5");
  // Excel 도 소수점을 남긴다.
  assert.equal(format(5, "0.##"), "5.");
  assert.equal(format(0.5, "#.00"), ".50");
  assert.equal(format(1.5, "0.0?"), "1.5 ");
  assert.equal(format(0.125, "0.0"), "0.1");
});

/**
 * 🔴 `toFixed` 로 하면 틀리는 자리. `1.005` 는 이진수로 `1.00499999…` 라
 * `(1.005).toFixed(2)` 는 「1.00」이지만 Excel 은 15자리로 먼저 고른 뒤 사사오입해
 * 「1.01」을 그린다. 금액 칸이 원 단위 반올림에서 1 어긋나면 합계가 틀려 보인다.
 */
test("🔴 반올림이 Excel 과 같다 — 이진 소수의 찌꺼기에 휘둘리지 않는다", () => {
  assert.equal(format(1.005, "0.00"), "1.01");
  assert.equal(format(0.15, "0.0"), "0.2");
  assert.equal(format(2.675, "0.00"), "2.68");
  assert.equal(format(9.995, "0.00"), "10.00");
  assert.equal(format(999_999.5, "#,##0"), "1,000,000");
});

test("앞뒤 글자 — ₩ · 원 · 통화 대괄호", () => {
  assert.equal(format(3_500_000, '"₩"#,##0'), "₩3,500,000");
  assert.equal(format(3_500_000, '#,##0"원"'), "3,500,000원");
  // 따옴표 없이 적힌 한글도 글자로 찍는다.
  assert.equal(format(3_500_000, "#,##0원"), "3,500,000원");
  assert.equal(format(1234, "[$¥-411]#,##0;[Red][$¥-411]#,##0"), "¥1,234");
  assert.equal(format(1234, "[$₩-412]#,##0"), "₩1,234");
});

test("음수 — 구역이 하나면 맨 앞에 `-`, 음수 구역이 있으면 그 구역이 부호를 정한다", () => {
  assert.equal(format(-5000, '"₩"#,##0'), "-₩5,000");
  assert.equal(format(-1234, "#,##0;(#,##0)"), "(1,234)");
  assert.equal(format(-1234, '"₩"#,##0;[Red]\\-"₩"#,##0'), "-₩1,234");
  // 음수 구역에 부호가 없으면 부호 없이 — Excel 은 빨간 글자로만 가른다.
  assert.equal(format(-1234, "[$¥-411]#,##0;[Red][$¥-411]#,##0"), "¥1,234");
  // 보고서 양식의 `0_);[Red]\(0\)` — `_)` 는 괄호 폭의 빈자리다.
  assert.equal(format(-5, "0_);[Red]\\(0\\)"), "(5)");
  assert.equal(format(5, "0_);[Red]\\(0\\)"), "5 ");
  assert.equal(format(-3_500_000, QUOTE_AMOUNT), "(₩3,500,000)");
});

test("0 구역 — 구역이 셋이면 0 은 셋째로, 둘이면 첫째로", () => {
  assert.equal(format(0, '#,##0;-#,##0;"-"'), "-");
  assert.equal(format(0, "#,##0;(#,##0)"), "0");
  // 비운 구역은 빈칸이다.
  assert.equal(format(-3, "0;;"), "");
});

test("백분율 · 천 단위 나눔", () => {
  assert.equal(format(0.075, "0%"), "8%");
  assert.equal(format(0.075, "0.00%"), "7.50%");
  assert.equal(format(1, "0.0%"), "100.0%");
  assert.equal(format(3_500_000, '#,##0,"천원"'), "3,500천원");
  assert.equal(formatBuiltIn(0.1, 9), "10%");
});

/**
 * 회계 서식은 `_x`(x 만큼의 빈자리)를 공백 한 칸으로, `*x`(칸 채우기)는 뺀다.
 * 0 은 「-」로 그린다 — 견적서의 빈 금액 줄이 그렇게 보인다.
 */
test("회계 서식 — `_x` 는 공백, `*x` 채움은 무시, 0 은 「-」", () => {
  assert.equal(format(3_500_000, ACCOUNTING), " 3,500,000 ");
  assert.equal(format(-1234, ACCOUNTING), "-1,234 ");
  assert.equal(format(0, ACCOUNTING), " - ");
  assert.equal(formatBuiltIn(3_500_000, 42), " ₩3,500,000 ");
  assert.equal(formatBuiltIn(1234.5, 43), " 1,234.50 ");
  assert.equal(formatBuiltIn(0, 43), " -   ");
});

test("견적서 양식의 금액 칸 서식 — 실측 서식 그대로", () => {
  assert.equal(format(3_500_000, QUOTE_AMOUNT), "₩3,500,000 ");
  assert.equal(format(3_500_000, '"₩"#,##0;[Red]"₩"#,##0'), "₩3,500,000");
});

test("General — 정수는 그대로, 부동소수점 찌꺼기만 걷는다", () => {
  assert.equal(format(3_500_000, "General"), "3500000");
  assert.equal(format(-5, "General"), "-5");
  assert.equal(format(0.1 + 0.2, "General"), "0.3");
  assert.equal(format(5, 'General"개"'), "5개");
  // 🔴 보고서 양식의 제조년도 칸(`AK19`)은 숫자에 `@` 서식이다 — Excel 은 General 로 그린다.
  assert.equal(format(2019, "@"), "2019");
  // 지수 표기가 되는 수는 모른다 — 날 값.
  assert.equal(format(1e21, "General"), null);
});

// ── 날짜 · 시각 ──────────────────────────────────────────────────────────

test("날짜 여러 모양", () => {
  assert.equal(format(AUG_28_2026, "yyyy-mm-dd"), "2026-08-28");
  assert.equal(format(AUG_28_2026, 'yyyy"년" m"월" d"일"'), "2026년 8월 28일");
  assert.equal(format(AUG_28_2026, "m/d"), "8/28");
  assert.equal(format(AUG_28_2026, "mm/dd/yy"), "08/28/26");
  assert.equal(format(AUG_28_2026, "d-mmm-yy"), "28-Aug-26");
  assert.equal(format(AUG_28_2026, "mmmm d, yyyy"), "August 28, 2026");
  assert.equal(format(AUG_28_2026, "yyyy.mm.dd (aaa)"), "2026.08.28 (금)");
  assert.equal(format(AUG_28_2026, "aaaa"), "금요일");
  assert.equal(format(AUG_28_2026, "dddd"), "Friday");
  assert.equal(format(AUG_28_2026, "ddd"), "Fri");
  assert.equal(format(AUG_28_2026, "[$-412]dddd"), "금요일");
  assert.equal(format(AUG_28_2026, "YYYY-MM-DD"), "2026-08-28");
  assert.equal(formatBuiltIn(AUG_28_2026, 14), "2026-08-28");
});

test("🔴 이 저장소 양식들의 날짜 서식 — 견적서 발행일자 · 보고서 연월 · 보고서 긴 날짜", () => {
  assert.equal(format(AUG_28_2026, QUOTE_DATE), "2026년 8월 28일");
  assert.equal(format(AUG_28_2026, 'yyyy"年"m"月";@'), "2026年8月");
  // 시스템 긴 날짜는 한국어 Windows 의 Excel 이 그리는 모양 — 보고서의 ISO 날짜 칸과 같다.
  assert.equal(format(AUG_28_2026, SYSTEM_LONG_DATE), "2026년 8월 28일 금요일");
  assert.equal(format(AUG_28_2026, SYSTEM_LONG_DATE), koreanLongDate(2026, 8, 28));
});

test("시각 — 시 뒤의 `m` 은 분, 초 앞의 `m` 도 분", () => {
  assert.equal(format(0.5, "h:mm"), "12:00");
  assert.equal(format(0.75, "h:mm AM/PM"), "6:00 PM");
  assert.equal(format(0.25, "h:mm AM/PM"), "6:00 AM");
  assert.equal(format(0, "h:mm AM/PM"), "12:00 AM");
  assert.equal(format(0.75, "[$-412]AM/PM h:mm"), "오후 6:00");
  assert.equal(format(AUG_28_2026 + 0.5, "yyyy-mm-dd h:mm:ss"), "2026-08-28 12:00:00");
  assert.equal(format(AUG_28_2026 + 0.5 + 30 / 1440, "mm:ss"), "30:00");
  assert.equal(format(AUG_28_2026 + 13 / 24 + 5 / 1440, "hh:mm"), "13:05");
  assert.equal(format(AUG_28_2026, "yyyy-mm"), "2026-08");
  // 23:59:59.6 은 반올림으로 다음 날 자정이 된다 — 날짜도 함께 넘어가야 한다.
  assert.equal(format(AUG_28_2026 + 86_399.6 / 86_400, "yyyy-mm-dd hh:mm:ss"), "2026-08-29 00:00:00");
});

/**
 * 🔴 Excel 은 1900 년을 윤년으로 잘못 센다. 일련번호 60 은 **있지도 않은**
 * 1900-02-29 이고, 그 앞은 하루씩 당겨 센다. 이것을 모르면 61 이후 모든 날짜가
 * 하루씩 밀린다.
 */
test("🔴 1900 체계의 가짜 윤일 — 60 은 1900-02-29, 61 부터 실제 달력", () => {
  assert.equal(format(1, "yyyy-mm-dd"), "1900-01-01");
  assert.equal(format(59, "yyyy-mm-dd"), "1900-02-28");
  assert.equal(format(60, "yyyy-mm-dd"), "1900-02-29");
  assert.equal(format(61, "yyyy-mm-dd"), "1900-03-01");
  // 1900-01-00 은 Excel 만 아는 날이다 — 지어내지 않는다.
  assert.equal(format(0, "yyyy-mm-dd"), null);
});

test("🔴 1904 체계 — 같은 날짜가 1462 작은 번호로 적힌다", () => {
  assert.equal(format(AUG_28_2026 - 1462, "yyyy-mm-dd", "1904"), "2026-08-28");
  assert.equal(format(AUG_28_2026 - 1462, "aaaa", "1904"), "금요일");
  assert.equal(format(0, "yyyy-mm-dd", "1904"), "1904-01-01");
  // 같은 번호를 1900 으로 읽으면 4년 전이다 — 체계를 안 읽으면 이만큼 틀린다.
  assert.equal(format(AUG_28_2026 - 1462, "yyyy-mm-dd", "1900"), "2022-08-27");
});

/**
 * 🔴 **날짜가 기기 시간대에 휘둘리지 않는다.** 기기 시간대를 보는 `Date` 로 셈하면
 * 서버가 선 곳에 따라 발행일자가 하루 밀린 견적서가 그려진다 — 오류가 안 나서 아무도
 * 모른다(`sheet-print-grid.test.ts` 의 같은 시험과 같은 판단).
 *
 * `delete process.env.TZ` 로는 원래 시간대로 돌아오지 않는다(그 시험의 실측) —
 * 지금 쓰이는 시간대를 이름으로 받아 두었다가 그것으로 되돌린다.
 */
test("🔴 날짜 · 요일 · 시각이 기기 시간대에 휘둘리지 않는다", () => {
  const original = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    for (const timeZone of ["UTC", "Asia/Seoul", "Pacific/Kiritimati", "Pacific/Niue"]) {
      process.env.TZ = timeZone;
      assert.equal(format(AUG_28_2026, "yyyy-mm-dd aaaa"), "2026-08-28 금요일", `${timeZone} 에서 어긋났다`);
      assert.equal(format(AUG_28_2026 + 0.75, "yyyy-mm-dd hh:mm"), "2026-08-28 18:00", `${timeZone} 에서 어긋났다`);
      assert.equal(format(AUG_28_2026, SYSTEM_LONG_DATE), "2026년 8월 28일 금요일", `${timeZone} 에서 어긋났다`);
      assert.equal(koreanLongDate(2026, 9, 2), "2026년 9월 2일 수요일", `${timeZone} 에서 어긋났다`);
    }
  } finally {
    process.env.TZ = original;
  }
});

// ── 모르는 서식 ──────────────────────────────────────────────────────────

/**
 * 🔴 **모르는 서식은 null** — 부르는 쪽이 날 값을 그대로 쓴다. 던지면 미리보기가
 * 죽고, 짐작해서 그리면 틀린 글자가 그럴듯하게 찍힌다.
 */
test("🔴 모르는 서식은 null 이다 — 던지지도, 지어내지도 않는다", () => {
  for (const code of [
    "0.00E+00",
    "# ?/?",
    "[>=100]0",
    "[h]:mm",
    "[DBNum1]0",
    "hh:mm:ss.0",
    "[$-F400]h:mm:ss",
    "ge.m.d",
    "abc",
    '"닫히지 않은 따옴표',
    "0;0;0;@;0",
  ]) {
    assert.equal(format(1234, code), null, `${code} 를 안다고 했다`);
  }
  // 음수 날짜 · 9999년 뒤는 Excel 도 `####` 로 그린다.
  assert.equal(format(-1, "yyyy-mm-dd"), null);
  assert.equal(format(3_000_000, "yyyy-mm-dd"), null);
  assert.equal(format(Number.POSITIVE_INFINITY, "0"), null);
  assert.equal(format(5, ""), null);
});

// ── 글자 칸 ──────────────────────────────────────────────────────────────

test("글자 칸 — 글자 구역이 있으면 그 모양으로, 없으면 그대로(null)", () => {
  assert.equal(formatText("가나다", '@" 귀하"'), "가나다 귀하");
  assert.equal(formatText("가나다", '0;-0;0;"["@"]"'), "[가나다]");
  assert.equal(formatText("가나다", "@"), "가나다");
  // 보고서 양식의 연월 칸 — 글자 구역이 `@` 하나라 글자가 그대로다.
  assert.equal(formatText("가나다", 'yyyy"年"m"月";@'), "가나다");
  // 회계 서식의 글자 구역에도 빈자리가 있다.
  assert.equal(formatText("공 급 가", ACCOUNTING), " 공 급 가 ");
  // 글자 구역이 없는 서식 — Excel 은 글자를 그대로 보여 준다.
  assert.equal(formatText("가나다", "#,##0"), null);
  assert.equal(formatText("가나다", "General"), null);
  assert.equal(formatText("가나다", QUOTE_AMOUNT), null);
});

test("기본 제공 번호", () => {
  assert.equal(builtInNumberFormat(0), "General");
  assert.equal(builtInNumberFormat(3), "#,##0");
  assert.equal(builtInNumberFormat(14), "yyyy-mm-dd");
  assert.equal(builtInNumberFormat(49), "@");
  // 모르는 번호 — 로케일마다 다른 통화(5~8) · 지수(11) 등.
  assert.equal(builtInNumberFormat(5), null);
  assert.equal(builtInNumberFormat(11), null);
  assert.equal(builtInNumberFormat(200), null);
});
