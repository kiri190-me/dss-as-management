import { excelSerialToDateOnly, type ExcelDateSystem } from "./excel-date";

/**
 * ============================================================================
 * 셀의 날 값 → **사람이 보는 글자** (Excel 숫자 서식)
 * ============================================================================
 * 시트 인쇄 격자(`sheet-print-grid.ts`)가 쓴다. 사람이 손으로 만든 견적서 엑셀은
 * 금액 칸에 `"₩"#,##0` 같은 서식이, 발행일자 칸에 날짜 서식이 걸려 있고 칸에는
 * `3500000` · `46262` 같은 **날 값**만 들어 있다. 서식을 안 읽으면 미리보기가
 * 사람이 보는 문서와 **다른 문서**가 된다.
 *
 * ── 🔴 일반적인 서식 엔진이 아니다 ──────────────────────────────────────
 * 견적서·보고서 양식이 실제로 쓰는 것과 사람이 흔히 거는 것만 다룬다:
 *
 *   다룬다   천 단위 콤마 · 소수 자릿수(`0` `#` `?`) · 앞뒤 글자(`"₩"` `"원"` `\-`
 *            `[$¥-411]`) · 구역(`양수;음수;0;글자`) · 색 이름(`[Red]` — 떼어 낸다) ·
 *            백분율 · 천 단위 나눔(끝의 `,`) · 회계 서식의 `_x`(공백 한 칸) ·
 *            `*x`(채움 — 무시) · 날짜와 시각(`yyyy` `m` `mmm` `d` `ddd` `aaa`
 *            `h` `mm` `ss` `AM/PM`) · 시스템 긴 날짜(`[$-F800]`) · 글자 구역(`@`)
 *   모른다   지수(`0.00E+00`) · 분수(`# ?/?`) · 조건(`[>=100]`) · 경과 시간(`[h]`) ·
 *            1초 아래(`ss.0`) · 한자·한글 숫자(`[DBNum1]`) · 연호(`e` `g` `b`) ·
 *            시스템 긴 시각(`[$-F400]`) · 모르는 글자가 따옴표 없이 섞인 서식
 *
 * ── 🔴 모르는 서식은 **null** 이다 — 던지지 않는다 ─────────────────────────
 * 부르는 쪽은 null 을 받으면 **날 값을 그대로** 적는다(`sheet-print-grid.ts` 머리말의
 * 「서식을 못 읽으면 밋밋하게 넘어간다」). 서식 하나 때문에 미리보기 전체가 죽으면
 * 사람이 값을 확인하는 일까지 막힌다. 반대로 **짐작해서 그럴듯한 글자를 지어내지도
 * 않는다** — 틀린 금액이 그럴듯하게 찍히는 것이 날 값보다 나쁘다.
 *
 * ── 🔴 날짜는 1900 체계의 가짜 윤일을 지키고, UTC 셈만 한다 ────────────────
 * 일련번호 → 날짜는 `excel-date.ts` 의 `excelSerialToDateOnly` 를 쓴다(1900 체계의
 * 60 이하 보정 · 1904 체계). Excel 만 아는 1900-02-29(일련번호 60)는 그 함수가
 * null 을 주므로 여기서 Excel 이 그리는 그대로 「1900-02-29」로 받는다. 요일도
 * `Date` 의 기기 시간대를 거치지 않고 일련번호로 셈한다 — 기기 시간대에 따라 하루가
 * 밀리면 고객사로 나가는 문서의 날짜가 틀린다.
 * ============================================================================
 */

// ── 기본 제공 서식 번호 ──────────────────────────────────────────────────

/**
 * `styles.xml` 에 `<numFmt>` 없이 번호만 적히는 기본 서식들.
 *
 * 🔴 날짜(14 · 22)와 회계(41~44)는 **읽는 컴퓨터의 로케일**을 따르는 번호다. 여기는
 * 사용자가 실제로 쓰는 **한국어 Windows 의 Excel** 이 그리는 모양으로 못 박는다
 * (`sheet-print-grid.ts` 가 요일을 붙이기로 한 것과 같은 판단 — 미리보기와 받은
 * 파일이 같은 칸을 다르게 보여 주면 안 된다). 파일이 같은 번호를 `<numFmt>` 로
 * 따로 적어 두었으면 그쪽이 이긴다 — 이 저장소의 견적서 양식은 41 · 42 를 그렇게
 * 적어 두었다.
 *
 * 여기 없는 번호(5~8 · 11~13 · 23~36 · 46~48 · 50 이상)는 **모른다** — null.
 */
const BUILT_IN_NUMBER_FORMATS: ReadonlyMap<number, string> = new Map<number, string>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [14, "yyyy-mm-dd"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "yyyy-mm-dd h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [41, '_-* #,##0_-;-* #,##0_-;_-* "-"_-;_-@_-'],
  [42, '_-"₩"* #,##0_-;-"₩"* #,##0_-;_-"₩"* "-"_-;_-@_-'],
  [43, '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-'],
  [44, '_-"₩"* #,##0.00_-;-"₩"* #,##0.00_-;_-"₩"* "-"??_-;_-@_-'],
  [45, "mm:ss"],
  [49, "@"],
]);

/** 기본 제공 번호의 서식 코드. 모르는 번호는 null. */
export function builtInNumberFormat(id: number): string | null {
  return BUILT_IN_NUMBER_FORMATS.get(id) ?? null;
}

// ── 들어가는 문 ──────────────────────────────────────────────────────────

/**
 * 숫자 칸의 값을 서식대로 적는다. **모르는 서식이면 null** — 부르는 쪽이 날 값을 쓴다.
 *
 * 구역 고르기는 Excel 의 규칙 그대로다: `양수;음수;0;글자`. 구역이 하나뿐이면 음수는
 * 그 구역에 `-` 를 앞에 붙이고, 음수 구역이 따로 있으면 **부호 없이** 그 구역으로
 * 그린다(괄호나 `\-` 는 서식이 스스로 적는다). 마지막 구역에 `@` 가 있으면 그것은
 * 글자 구역이라 숫자 구역에서 뺀다 — 보고서 양식의 `yyyy"年"m"月";@` 가 그 모양이다.
 */
export function formatNumber(value: number, formatCode: string, dateSystem: ExcelDateSystem): string | null {
  try {
    if (!Number.isFinite(value) || formatCode === "") return null;

    const chosen = chooseNumberSection(splitSections(formatCode), value);
    if (chosen === null) return null;
    if (chosen === "general") return generalNumber(value);

    const parsed = tokenizeSection(chosen.section);
    if (parsed === null) return null;

    if (isDateSection(parsed)) {
      // 음수 날짜는 Excel 도 `####` 로 그린다 — 지어내지 않는다.
      if (value < 0) return null;
      return formatDate(value, parsed, dateSystem);
    }

    const body = formatDecimal(Math.abs(value), parsed.tokens);
    if (body === null) return null;
    return chosen.negativeSign ? `-${body}` : body;
  } catch {
    return null;
  }
}

/**
 * 글자 칸의 값을 서식의 **글자 구역**대로 적는다(`@" 귀하"` → 「가나다 귀하」).
 *
 * 글자 구역이 없는 서식(`#,##0` · `General`)이면 Excel 은 글자를 **그대로** 보여
 * 준다 — 그때도 null 을 돌려주고 부르는 쪽이 그대로 쓴다. 모르는 서식도 null 이다.
 */
export function formatText(text: string, formatCode: string): string | null {
  try {
    const sections = splitSections(formatCode);
    if (sections.length > 4) return null;

    const last = sections[sections.length - 1];
    const section = sections.length === 4 ? sections[3] : hasTextPlaceholder(last) ? last : null;
    if (section === null) return null;

    const parsed = tokenizeSection(section);
    if (parsed === null) return null;

    let out = "";
    for (const token of parsed.tokens) {
      if (token.kind === "text") out += text;
      else if (token.kind === "literal") out += token.text;
      else return null; // 글자 구역에 숫자 자리표 · 날짜 — 모른다
    }
    return out;
  } catch {
    return null;
  }
}

// ── 요일 · 한국어 긴 날짜 ────────────────────────────────────────────────

/**
 * 요일 이름. **코드에 못 박는다.**
 *
 * 🔴 `toLocaleDateString()` 도 `Intl.DateTimeFormat("ko-KR", { weekday })` 도 쓰지
 * 않는다. 앞의 것은 **읽는 컴퓨터의 로케일**을 따라가고(같은 문서가 기기마다 다른
 * 글자로 보인다), 뒤의 것은 로케일을 못 박아도 **그 컴퓨터의 Node 에 한국어 ICU 가
 * 들어 있어야** 한다 — small-icu 로 빌드된 Node 는 조용히 「Wednesday」를 돌려준다.
 * 그 어긋남은 오류를 내지 않아서 아무도 모른 채 문서에 찍힌다.
 *
 * `date-only.ts` 와 `service-report-draft.ts` 가 시간대를 KST 로 못 박은 것과 같은
 * 판단이다 — **보이는 글자를 기기에 맡기지 않는다.**
 */
const KOREAN_WEEKDAY_NAMES = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
] as const;

const KOREAN_WEEKDAY_SHORT = ["일", "월", "화", "수", "목", "금", "토"] as const;

const ENGLISH_WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const ENGLISH_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * 「2026년 9월 2일 수요일」 — `[$-F800]`(시스템 긴 날짜)을 한국어 Windows 의 Excel 이
 * 그리는 모양 그대로(2026-09-02 사용자 결정 — `sheet-print-grid.ts` 의 `displayText`).
 *
 * 🔴 요일은 **UTC 자정으로 만든 날짜에서** 뽑는다(`date-only.ts` 의
 * `parseDateOnlyToUtcMidnight` 과 같은 수법). 그 값은 실제 시각이 아니라 달력 셈을
 * 위한 것이고, `getUTCDay()` 는 기기 시간대를 보지 않으므로 **같은 날짜면 어느
 * 컴퓨터에서도 늘 같은 요일**이다. `new Date("2026-09-02").getDay()` 로 하면 그
 * 보증이 사라진다.
 */
export function koreanLongDate(year: number, month: number, day: number): string {
  return koreanLongDateWith(year, month, day, new Date(Date.UTC(year, month - 1, day)).getUTCDay());
}

function koreanLongDateWith(year: number, month: number, day: number, weekday: number): string {
  return `${year}년 ${month}월 ${day}일 ${KOREAN_WEEKDAY_NAMES[weekday]}`;
}

// ── 구역 나누기 · 고르기 ──────────────────────────────────────────────────

/** `;` 로 구역을 나눈다. 따옴표 · `\x` · `_x` · `*x` · `[…]` 안의 `;` 는 구역 경계가 아니다. */
function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = "";

  for (let index = 0; index < code.length; index += 1) {
    const ch = code[index];
    if (ch === '"' || ch === "[") {
      const close = code.indexOf(ch === '"' ? '"' : "]", index + 1);
      const stop = close === -1 ? code.length : close + 1;
      current += code.slice(index, stop);
      index = stop - 1;
    } else if (ch === "\\" || ch === "_" || ch === "*") {
      current += code.slice(index, index + 2);
      index += 1;
    } else if (ch === ";") {
      sections.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  sections.push(current);
  return sections;
}

/** 따옴표 · 탈출 글자 · 대괄호 **밖에** `@` 가 있는가 — 그 구역은 글자 구역이다. */
function hasTextPlaceholder(section: string): boolean {
  return /@/.test(section.replace(/"[^"]*"?|\\.|_.|\*.|\[[^\]]*\]?/g, ""));
}

type NumberSectionChoice = { section: string; negativeSign: boolean };

/**
 * 값에 맞는 숫자 구역. 구역 규칙은 SheetJS SSF 의 `choose_fmt` 와 같다 — 그쪽이
 * Excel 과 견줘 다듬어 온 규칙이라 따로 짓지 않았다.
 *
 *   · 구역 넷      → 앞의 셋이 숫자 구역
 *   · 마지막에 `@` → 그것을 뺀 나머지가 숫자 구역(하나뿐이면 숫자는 `General`)
 *   · 음수         → 숫자 구역이 둘 이상이면 둘째(부호 없이), 아니면 첫째에 `-`
 *   · 0            → 숫자 구역이 셋이면 셋째
 */
function chooseNumberSection(
  sections: readonly string[],
  value: number
): NumberSectionChoice | "general" | null {
  if (sections.length > 4) return null;

  let numberSections = sections;
  if (sections.length === 4) {
    numberSections = sections.slice(0, 3);
  } else if (hasTextPlaceholder(sections[sections.length - 1])) {
    if (sections.length === 1) return "general";
    numberSections = sections.slice(0, -1);
  }

  if (numberSections.length === 1 && /^\s*general\s*$/i.test(numberSections[0])) return "general";

  if (value < 0 && numberSections.length >= 2) return { section: numberSections[1], negativeSign: false };
  if (value === 0 && numberSections.length >= 3) return { section: numberSections[2], negativeSign: false };
  return { section: numberSections[0], negativeSign: value < 0 };
}

/**
 * `General` — 날 값에서 **부동소수점 찌꺼기**만 걷어 낸다(`0.30000000000000004` →
 * `0.3`). Excel 이 15자리까지만 보는 것과 같다. 정수는 한 글자도 바뀌지 않는다.
 * 지수 표기가 되는 큰 수 · 작은 수는 모른다 — null(날 값).
 */
function generalNumber(value: number): string | null {
  const text = String(Number(value.toPrecision(15)));
  return /e/i.test(text) ? null : text;
}

// ── 구역 하나를 조각으로 ─────────────────────────────────────────────────

type DigitPlaceholder = "0" | "#" | "?";

type DatePart =
  | "year"
  | "month-or-minute"
  | "day"
  | "hour"
  | "second"
  | "korean-weekday"
  | "am-pm"
  | "a-p"
  | "korean-am-pm";

type Token =
  | { kind: "literal"; text: string }
  | { kind: "digit"; placeholder: DigitPlaceholder }
  | { kind: "point" }
  | { kind: "comma" }
  | { kind: "percent" }
  | { kind: "slash" }
  | { kind: "text" }
  | { kind: "general" }
  | { kind: "date"; part: DatePart; length: number };

type ParsedSection = {
  tokens: Token[];
  /** `[$-412]` · `[$-ko-KR]` — 요일 · 달 이름 · 오전/오후를 한국어로. */
  korean: boolean;
  /** `[$-F800]` · `[$-x-sysdate]` — 나머지를 보지 않고 시스템 긴 날짜로. */
  systemLongDate: boolean;
};

/** 따옴표 없이 적혀도 **그대로 찍히는** 글자들(Excel 규칙). */
const LITERAL_CHARACTERS = new Set([..."$-+():!^&'~{}<>= "]);

const COLOR_NAMES = new Set(["black", "blue", "cyan", "green", "magenta", "red", "white", "yellow"]);

/** 구역 하나를 조각들로. 모르는 것을 만나면 null — 서식 전체를 모르는 것으로 친다. */
function tokenizeSection(section: string): ParsedSection | null {
  const tokens: Token[] = [];
  let korean = false;
  let systemLongDate = false;

  const literal = (text: string): void => {
    if (text === "") return;
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.kind === "literal") last.text += text;
    else tokens.push({ kind: "literal", text });
  };

  let index = 0;
  while (index < section.length) {
    const ch = section[index];
    const lower = ch.toLowerCase();
    const rest = section.slice(index, index + 7).toLowerCase();

    if (ch === '"') {
      const close = section.indexOf('"', index + 1);
      if (close === -1) return null;
      literal(section.slice(index + 1, close));
      index = close + 1;
      continue;
    }
    if (ch === "\\" || ch === "_" || ch === "*") {
      if (index + 1 >= section.length) return null;
      // `\x` 는 그 글자, `_x` 는 x 만큼의 빈자리(공백 한 칸), `*x` 는 칸을 채우는
      // 반복이라 미리보기에서는 뺀다.
      if (ch === "\\") literal(section[index + 1]);
      else if (ch === "_") literal(" ");
      index += 2;
      continue;
    }
    if (ch === "[") {
      const close = section.indexOf("]", index + 1);
      if (close === -1) return null;
      const bracket = readBracket(section.slice(index + 1, close));
      if (bracket === null) return null;
      literal(bracket.literal);
      korean ||= bracket.korean;
      systemLongDate ||= bracket.systemLongDate;
      index = close + 1;
      continue;
    }
    if (rest.startsWith("general")) {
      tokens.push({ kind: "general" });
      index += 7;
      continue;
    }
    if (rest.startsWith("am/pm")) {
      tokens.push({ kind: "date", part: "am-pm", length: 5 });
      index += 5;
      continue;
    }
    if (rest.startsWith("a/p")) {
      tokens.push({ kind: "date", part: "a-p", length: 3 });
      index += 3;
      continue;
    }
    if (section.startsWith("오전/오후", index)) {
      tokens.push({ kind: "date", part: "korean-am-pm", length: 5 });
      index += 5;
      continue;
    }
    if (ch === "0" || ch === "#" || ch === "?") {
      tokens.push({ kind: "digit", placeholder: ch });
      index += 1;
      continue;
    }
    if (ch === ".") tokens.push({ kind: "point" });
    else if (ch === ",") tokens.push({ kind: "comma" });
    else if (ch === "%") tokens.push({ kind: "percent" });
    else if (ch === "/") tokens.push({ kind: "slash" });
    else if (ch === "@") tokens.push({ kind: "text" });
    else if (lower === "y" || lower === "m" || lower === "d" || lower === "h" || lower === "s" || lower === "a") {
      let end = index;
      while (end < section.length && section[end].toLowerCase() === lower) end += 1;
      const length = end - index;
      if (lower === "a") {
        // `aaa` · `aaaa` 는 한국어 Excel 의 요일(월 · 월요일). `a` · `aa` 는 모른다.
        if (length < 3) return null;
        tokens.push({ kind: "date", part: "korean-weekday", length });
      } else {
        const part: DatePart =
          lower === "y"
            ? "year"
            : lower === "m"
              ? "month-or-minute"
              : lower === "d"
                ? "day"
                : lower === "h"
                  ? "hour"
                  : "second";
        tokens.push({ kind: "date", part, length });
      }
      index = end;
      continue;
    } else if (LITERAL_CHARACTERS.has(ch) || ch.charCodeAt(0) > 127) {
      // 따옴표 없이 적힌 한글(`#,##0원`)도 Excel 은 글자로 찍는다.
      literal(ch);
    } else {
      // 지수 `E+` · 연호 `e` `g` `b` · 그 밖에 모르는 글자.
      return null;
    }
    index += 1;
  }

  return { tokens, korean, systemLongDate };
}

/**
 * `[…]` 하나. 색 이름은 떼어 내고(글자 색은 서식이 아니라 글꼴에서 읽는다),
 * `[$₩-412]` 는 통화 글자 「₩」와 로케일로 나눈다. 조건 · 경과 시간 · DBNum 은 모른다.
 */
function readBracket(inner: string): { literal: string; korean: boolean; systemLongDate: boolean } | null {
  const lower = inner.toLowerCase();
  if (COLOR_NAMES.has(lower) || /^color\s*\d+$/.test(lower)) {
    return { literal: "", korean: false, systemLongDate: false };
  }
  if (!inner.startsWith("$")) return null;

  const body = inner.slice(1);
  const dash = body.indexOf("-");
  const currency = dash === -1 ? body : body.slice(0, dash);
  const locale = dash === -1 ? "" : body.slice(dash + 1).toLowerCase();

  if (locale === "f400" || locale === "x-systime") return null;
  if (locale === "f800" || locale === "x-sysdate") {
    return { literal: currency, korean: true, systemLongDate: true };
  }

  let korean = locale === "ko" || locale === "ko-kr";
  if (/^[0-9a-f]{1,8}$/.test(locale)) {
    const id = Number.parseInt(locale, 16);
    // 위 16비트는 달력 · 숫자 모양(한자 숫자 등)이다 — 모른다.
    if (id >>> 16 !== 0) return null;
    korean = (id & 0xffff) === 0x412;
  }
  return { literal: currency, korean, systemLongDate: false };
}

function isDateSection(parsed: ParsedSection): boolean {
  return parsed.systemLongDate || parsed.tokens.some((token) => token.kind === "date");
}

// ── 숫자 ─────────────────────────────────────────────────────────────────

/**
 * 숫자 구역으로 **절댓값**을 적는다(부호는 부르는 쪽이 붙인다).
 *
 *   · 콤마가 정수 자리표 **사이**에 있으면 천 단위 구분, 마지막 자리표 **바로 뒤**에
 *     이어 붙어 있으면 하나에 1000 으로 나눈다(`#,##0,"천원"`).
 *   · `%` 하나에 100 을 곱한다.
 *   · 반올림은 Excel 처럼 **15자리로 먼저 고른 뒤 사사오입**한다 — `1.005` 가
 *     `toFixed(2)` 로는 「1.00」이지만 Excel 은 「1.01」이다.
 */
function formatDecimal(value: number, tokens: readonly Token[]): string | null {
  let generalText: string | null = null;
  for (const token of tokens) {
    if (token.kind === "text" || token.kind === "slash" || token.kind === "date") return null;
    if (token.kind === "general") generalText = generalNumber(value);
  }
  const digitIndexes: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === "digit") digitIndexes.push(index);
  });
  if (tokens.some((token) => token.kind === "general")) {
    // `General"원"` 처럼 General 에 글자만 붙인 것까지. 자리표와 섞이면 모른다.
    if (digitIndexes.length > 0 || generalText === null) return null;
  }

  const pointAt = tokens.findIndex((token) => token.kind === "point");
  const integerEnd = pointAt === -1 ? tokens.length : pointAt;
  const integerDigits = digitIndexes.filter((index) => index < integerEnd);
  const fractionDigits = digitIndexes.filter((index) => index > integerEnd);

  const scalingCommas = new Set<number>();
  if (digitIndexes.length > 0) {
    for (let index = digitIndexes[digitIndexes.length - 1] + 1; tokens[index]?.kind === "comma"; index += 1) {
      scalingCommas.add(index);
    }
  }
  const groupingCommas = new Set<number>();
  if (integerDigits.length > 1) {
    for (let index = integerDigits[0] + 1; index < integerDigits[integerDigits.length - 1]; index += 1) {
      if (tokens[index].kind === "comma") groupingCommas.add(index);
    }
  }

  let scaled = value;
  for (const token of tokens) if (token.kind === "percent") scaled *= 100;
  for (let count = 0; count < scalingCommas.size; count += 1) scaled /= 1000;

  const rounded = roundDecimal(scaled, fractionDigits.length);
  if (rounded === null) return null;

  const placeholders = integerDigits.map((index) => placeholderAt(tokens, index));
  const digits = rounded.integer === "0" ? "" : rounded.integer;
  const slots = fillIntegerSlots(digits, placeholders);
  // 자리표 사이에 글자가 끼어 있으면(`000-0000`) 자리마다 따로 적고 콤마는 안 넣는다.
  const interleaved =
    integerDigits.length > 0 &&
    tokens
      .slice(integerDigits[0], integerDigits[integerDigits.length - 1] + 1)
      .some((token) => token.kind === "literal");
  const integerText = interleaved
    ? ""
    : groupingCommas.size > 0
      ? groupThousands(slots.join(""))
      : slots.join("");

  const lastNonZero = rounded.fraction.replace(/0+$/, "").length - 1;

  let out = "";
  let integerSlot = 0;
  let fractionSlot = 0;
  tokens.forEach((token, index) => {
    switch (token.kind) {
      case "literal":
        out += token.text;
        return;
      case "percent":
        out += "%";
        return;
      case "general":
        out += generalText ?? "";
        return;
      case "comma":
        if (!groupingCommas.has(index) && !scalingCommas.has(index)) out += ",";
        return;
      case "point":
        // 정수 자리표가 없는 `.00` 이어도 정수 부분은 사라지지 않는다.
        if (index === pointAt && integerDigits.length === 0) out += digits;
        out += ".";
        return;
      case "digit":
        if (index < integerEnd) {
          if (interleaved) out += slots[integerSlot];
          else if (integerSlot === 0) out += integerText;
          integerSlot += 1;
        } else {
          const placeholder = token.placeholder;
          if (fractionSlot <= lastNonZero) out += rounded.fraction[fractionSlot];
          else out += placeholder === "0" ? "0" : placeholder === "?" ? " " : "";
          fractionSlot += 1;
        }
        return;
      default:
        return;
    }
  });
  return out;
}

function placeholderAt(tokens: readonly Token[], index: number): DigitPlaceholder {
  const token = tokens[index];
  return token.kind === "digit" ? token.placeholder : "#";
}

/**
 * 정수 자리들을 **오른쪽부터** 채운다. 남는 자리는 `0` 이면 「0」, `?` 면 빈칸,
 * `#` 이면 비운다. 자리표보다 긴 수는 맨 왼쪽 자리가 나머지를 다 받는다.
 */
function fillIntegerSlots(digits: string, placeholders: readonly DigitPlaceholder[]): string[] {
  const slots = placeholders.map(() => "");
  let cursor = digits.length;
  for (let slot = placeholders.length - 1; slot >= 0; slot -= 1) {
    if (slot === 0 && cursor > 0) {
      slots[0] = digits.slice(0, cursor);
      cursor = 0;
    } else if (cursor > 0) {
      cursor -= 1;
      slots[slot] = digits[cursor];
    } else {
      const placeholder = placeholders[slot];
      slots[slot] = placeholder === "0" ? "0" : placeholder === "?" ? " " : "";
    }
  }
  return slots;
}

/** 「3500000」 → 「3,500,000」. `?` 가 남긴 앞 빈칸은 그대로 둔다. */
function groupThousands(text: string): string {
  const found = /^( *)(\d*)$/.exec(text);
  if (!found) return text;
  return found[1] + found[2].replace(/\B(?=(\d{3})+$)/g, ",");
}

/**
 * 음이 아닌 수를 소수 `decimals` 자리로 사사오입한 **숫자 글자**.
 *
 * 먼저 유효숫자 15자리로 고른다(`toExponential(14)`) — Excel 이 보여 주는 정밀도가
 * 그만큼이고, 이진 소수의 찌꺼기(`1.00499999…`)가 반올림을 뒤집지 않게 된다.
 * 그다음은 글자로 셈한다. 수로 다시 셈하면 찌꺼기가 되살아난다.
 */
function roundDecimal(value: number, decimals: number): { integer: string; fraction: string } | null {
  if (!Number.isFinite(value) || value < 0) return null;

  const [mantissa, exponentText] = value.toExponential(14).split("e");
  const significant = mantissa.replace(".", "");
  const pointPosition = Number(exponentText) + 1;

  let integer: string;
  let fraction: string;
  if (pointPosition <= 0) {
    integer = "0";
    fraction = "0".repeat(-pointPosition) + significant;
  } else if (pointPosition >= significant.length) {
    integer = significant + "0".repeat(pointPosition - significant.length);
    fraction = "";
  } else {
    integer = significant.slice(0, pointPosition);
    fraction = significant.slice(pointPosition);
  }

  if (fraction.length <= decimals) {
    return { integer: stripLeadingZeros(integer), fraction: fraction.padEnd(decimals, "0") };
  }

  let kept = integer + fraction.slice(0, decimals);
  if (fraction.charCodeAt(decimals) >= "5".charCodeAt(0)) kept = incrementDigits(kept);
  const integerLength = kept.length - decimals;
  return {
    integer: stripLeadingZeros(kept.slice(0, integerLength)),
    fraction: kept.slice(integerLength),
  };
}

function incrementDigits(digits: string): string {
  const chars = [...digits];
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index] !== "9") {
      chars[index] = String(Number(chars[index]) + 1);
      return chars.join("");
    }
    chars[index] = "0";
  }
  return `1${chars.join("")}`;
}

function stripLeadingZeros(digits: string): string {
  const stripped = digits.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

// ── 날짜 · 시각 ──────────────────────────────────────────────────────────

/** 9999-12-31. 이보다 크면 Excel 도 `####` 로 그린다. */
const MAX_SERIAL: Record<ExcelDateSystem, number> = { "1900": 2958465, "1904": 2957003 };

const SECONDS_PER_DAY = 86_400;

/**
 * 일련번호를 날짜 구역대로 적는다.
 *
 * 🔴 `Date` 의 기기 시간대를 거치지 않는다 — 날짜는 `excelSerialToDateOnly`(UTC 셈),
 * 시각은 소수 부분을 초로 바꿔 셈하고, 요일은 일련번호에서 바로 셈한다.
 */
function formatDate(serial: number, parsed: ParsedSection, dateSystem: ExcelDateSystem): string | null {
  const tokens = parsed.tokens;
  for (const token of tokens) {
    if (token.kind === "digit" || token.kind === "percent" || token.kind === "text" || token.kind === "general") {
      return null; // `ss.0` 같은 1초 아래 · 숫자와 섞인 날짜 — 모른다
    }
  }
  if (serial > MAX_SERIAL[dateSystem]) return null;

  let wholeDays = Math.floor(serial);
  let seconds = Math.round((serial - wholeDays) * SECONDS_PER_DAY);
  if (seconds >= SECONDS_PER_DAY) {
    wholeDays += 1;
    seconds -= SECONDS_PER_DAY;
  }

  const minuteAt = minuteTokenIndexes(tokens);
  // 시각만 적는 서식(`h:mm`)은 날짜를 셈하지 않는다 — 0.5(정오)처럼 1 보다 작은
  // 일련번호도 시각으로는 멀쩡하다.
  const needsDate =
    parsed.systemLongDate ||
    tokens.some(
      (token, index) =>
        token.kind === "date" &&
        (token.part === "year" ||
          token.part === "day" ||
          token.part === "korean-weekday" ||
          (token.part === "month-or-minute" && !minuteAt.has(index)))
    );
  const date = needsDate ? serialToDate(wholeDays, dateSystem) : { year: 1900, month: 1, day: 1 };
  if (date === null) return null;

  // Excel 의 요일 셈. 1900 체계는 일련번호 1(1900-01-01)을 일요일로 센다 — 가짜 윤일
  // 탓에 61 부터가 실제 달력과 맞는다. 1904 체계의 0 은 1904-01-01 금요일이다.
  const weekday = dateSystem === "1904" ? (wholeDays + 5) % 7 : (wholeDays + 6) % 7;

  if (parsed.systemLongDate) return koreanLongDateWith(date.year, date.month, date.day, weekday);

  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  const twelveHour = tokens.some(
    (token) => token.kind === "date" && (token.part === "am-pm" || token.part === "a-p" || token.part === "korean-am-pm")
  );

  let out = "";
  tokens.forEach((token, index) => {
    if (token.kind === "literal") {
      out += token.text;
      return;
    }
    if (token.kind === "point") {
      out += ".";
      return;
    }
    if (token.kind === "comma") {
      out += ",";
      return;
    }
    if (token.kind === "slash") {
      out += "/";
      return;
    }
    if (token.kind !== "date") return;

    const length = token.length;
    switch (token.part) {
      case "year":
        out += length <= 2 ? pad2(date.year % 100) : String(date.year);
        return;
      case "month-or-minute":
        if (minuteAt.has(index)) out += length === 1 ? String(minute) : pad2(minute);
        else out += monthText(date.month, length, parsed.korean);
        return;
      case "day":
        if (length === 1) out += String(date.day);
        else if (length === 2) out += pad2(date.day);
        else if (length === 3) out += parsed.korean ? KOREAN_WEEKDAY_SHORT[weekday] : ENGLISH_WEEKDAY_NAMES[weekday].slice(0, 3);
        else out += parsed.korean ? KOREAN_WEEKDAY_NAMES[weekday] : ENGLISH_WEEKDAY_NAMES[weekday];
        return;
      case "korean-weekday":
        out += length === 3 ? KOREAN_WEEKDAY_SHORT[weekday] : KOREAN_WEEKDAY_NAMES[weekday];
        return;
      case "hour": {
        const shown = twelveHour ? hour % 12 || 12 : hour;
        out += length === 1 ? String(shown) : pad2(shown);
        return;
      }
      case "second":
        out += length === 1 ? String(second) : pad2(second);
        return;
      case "am-pm":
        out += parsed.korean ? (hour < 12 ? "오전" : "오후") : hour < 12 ? "AM" : "PM";
        return;
      case "a-p":
        out += hour < 12 ? "A" : "P";
        return;
      case "korean-am-pm":
        out += hour < 12 ? "오전" : "오후";
        return;
    }
  });
  return out;
}

/**
 * `m` · `mm` 가 **분**인 자리. 바로 앞의 날짜 조각이 시(`h`)이거나 바로 뒤가
 * 초(`s`)이면 분이고, 아니면 달이다(Excel 규칙). `mmm` 이상은 늘 달이다.
 */
function minuteTokenIndexes(tokens: readonly Token[]): Set<number> {
  const dateIndexes = tokens.flatMap((token, index) => (token.kind === "date" ? [index] : []));
  const minutes = new Set<number>();
  dateIndexes.forEach((tokenIndex, position) => {
    const token = tokens[tokenIndex];
    if (token.kind !== "date" || token.part !== "month-or-minute" || token.length > 2) return;
    const previous = position > 0 ? tokens[dateIndexes[position - 1]] : undefined;
    const next = position + 1 < dateIndexes.length ? tokens[dateIndexes[position + 1]] : undefined;
    if (
      (previous?.kind === "date" && previous.part === "hour") ||
      (next?.kind === "date" && next.part === "second")
    ) {
      minutes.add(tokenIndex);
    }
  });
  return minutes;
}

function monthText(month: number, length: number, korean: boolean): string {
  if (length === 1) return String(month);
  if (length === 2) return pad2(month);
  if (korean) return `${month}월`;
  const name = ENGLISH_MONTH_NAMES[month - 1];
  return length === 3 ? name.slice(0, 3) : length === 4 ? name : name.slice(0, 1);
}

/**
 * 일련번호의 날짜. 1900 체계의 60 은 Excel 만 아는 1900-02-29 이고, 1 보다 작은
 * 수(1900-01-00)는 모른다.
 */
function serialToDate(
  wholeDays: number,
  dateSystem: ExcelDateSystem
): { year: number; month: number; day: number } | null {
  if (dateSystem === "1900") {
    if (wholeDays < 1) return null;
    if (wholeDays === 60) return { year: 1900, month: 2, day: 29 };
  }
  const iso = excelSerialToDateOnly(wholeDays, dateSystem);
  const found = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!found) return null;
  return { year: Number(found[1]), month: Number(found[2]), day: Number(found[3]) };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
