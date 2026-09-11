/**
 * ============================================================================
 * 내자 정리 머리말 — 기본 문구 · 자리 표시 · 줄과 들여쓰기 · 입력 검증
 * ============================================================================
 * 순수 함수만 둔다. 화면(DomesticOrderListScreen 의 SheetHeading)과 서버(액션 ·
 * mutation)가 **같은 것을** 부른다 — 한쪽만 규칙을 가지면 화면이 통과시킨 글을
 * 서버가 막거나, 저장된 글이 화면에서 다르게 그려진다.
 *
 * ── 🔴 기본 문구는 여기 한 곳이다 ────────────────────────────────────────
 * 머리말 설정 표(domestic_order_sheet_settings)에 행이 없으면 이 문구가 그대로
 * 답한다. **표를 만들었다는 이유로 화면이 한 글자라도 달라지면 안 된다** — 그래서
 * 아래 두 상수는 이 기능 전 SheetHeading 에 박혀 있던 JSX 의 글자를 그대로 옮겼고,
 * 시험이 그 글자와 줄마다 대조한다(domestic-order-sheet-heading.test.ts).
 *
 * 둘째 줄의 날짜 자리만 달라졌다. JSX 에서는 `{asOfDate}` 였고 여기서는
 * `{기준일}` 이다 — 그릴 때 서버가 정한 기준일로 바뀌므로 결과는 전과 같다.
 *
 * ── 들여쓰기 규칙 ────────────────────────────────────────────────────────
 * 전에는 「2)」「3)」 줄에만 pl-4 가 붙어 있었다. 저장 문구에서는 **줄 앞 공백이
 * 들여쓰기가 된다**: 공백 두 칸마다 한 단, 세 단까지(그 이상은 세 단에 머문다).
 *  - 반각 공백 1칸 = 폭 1, 탭 · 전각 공백(U+3000) = 폭 2. 한국어 입력기에서 전각
 *    공백이 섞여 들어오는 일이 흔하고, 탭은 복사해 붙인 글에서 온다.
 *  - 공백 **한 칸**은 들여쓰지 않는다 — 실수로 들어간 한 칸에 줄이 밀리면 사람은
 *    왜 밀렸는지 찾을 수가 없다.
 *  - 들여쓰기를 정한 뒤 줄 앞 공백은 걷는다. 화면의 들여쓰기는 공백 글자가 아니라
 *    단 수(pl-4 · pl-8 · pl-12)로 그린다 — 비례 글꼴에서 공백 폭은 믿을 수 없다.
 * 기본 문구의 「2)」「3)」 줄은 공백 두 칸이라 한 단 = pl-4 로, 전과 똑같다.
 *
 * 줄 번호(「1.」「2)」)는 사람이 글자 그대로 적는다. 자동으로 매기면 원본 엑셀의
 * 번호 체계(1. 2. 다음이 2) 3))를 옮길 방법이 없다.
 *
 * ── 저장 전 정규화 ──────────────────────────────────────────────────────
 * 줄바꿈을 \n 으로 통일하고, 줄 끝 공백을 걷고, 맨 앞·맨 뒤의 빈 줄을 걷는다.
 * 줄 **앞** 공백은 들여쓰기이므로 남긴다. 가운데 빈 줄은 남긴다(문서의 빈 줄이다).
 * 눈에 보이지 않는 차이(줄 끝 공백 · 끝의 빈 줄)가 저장값에 남으면 "기본 문구와
 * 같은가"를 판정할 수 없게 된다.
 * ============================================================================
 */

/** 인사문 · 메모 안에서 서버가 정한 기준일로 바뀌는 자리 표시. */
export const DOMESTIC_ORDER_SHEET_AS_OF_DATE_PLACEHOLDER = "{기준일}";

/**
 * 기본 인사문 — 이 기능 전 SheetHeading 의 <ol> 네 줄 그대로다.
 * 「2)」「3)」 줄 앞 공백 두 칸이 그 줄의 pl-4 였다.
 */
export const DEFAULT_DOMESTIC_ORDER_SHEET_GREETING = [
  "1. 귀사의 일익 번창하심을 기원합니다.",
  `2. 납품 및 수리 관련하여 ${DOMESTIC_ORDER_SHEET_AS_OF_DATE_PLACEHOLDER}자 진행 상황입니다.`,
  "  2) 수리품 반입/반출 및 기타 변동이 있을 경우 김유진 과장에게 전달해 주세요.",
  "  3) 본 내용 변경을 요하거나 의견 있으면 주세요.",
].join("\n");

/**
 * 기본 내부 메모 — 이 기능 전 메모 상자의 글에서 앞의 "내부 메모 — " 이름표를 뺀
 * 것이다. 이름표는 화면이 붙인다(사람이 매번 적게 하면 빠뜨린 날 메모가 인사문처럼
 * 읽힌다).
 */
export const DEFAULT_DOMESTIC_ORDER_SHEET_MEMO =
  "발주 받으면 인사회신 잊지말기 (회신 前 수리소완성일 확인 必!) · 2023.08.23";

/** 인사문 상한(글자 = 코드 포인트). DB CHECK 와 같은 수다(schema 주석). */
export const DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS = 2000;
/** 내부 메모 상한(글자 = 코드 포인트). DB CHECK 와 같은 수다. */
export const DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS = 500;

/** 들여쓰기 단의 최댓값. 화면이 단마다 클래스를 하나씩 갖는다(0 · 1 · 2 · 3). */
export const DOMESTIC_ORDER_SHEET_MAX_INDENT_LEVEL = 3;

export type SheetIndentLevel = 0 | 1 | 2 | 3;

/** 화면이 그릴 인사문 한 줄. */
export type SheetGreetingLine = {
  /** 줄 앞 공백을 걷고 `{기준일}` 을 바꾼 글. 빈 줄이면 "" 다. */
  text: string;
  indentLevel: SheetIndentLevel;
};

export type DomesticOrderSheetHeadingText = {
  greetingText: string;
  internalMemo: string;
};

/** 코드의 기본 머리말. 행이 없을 때 조회가 이것을 돌려준다. */
export const DEFAULT_DOMESTIC_ORDER_SHEET_HEADING: DomesticOrderSheetHeadingText = {
  greetingText: DEFAULT_DOMESTIC_ORDER_SHEET_GREETING,
  internalMemo: DEFAULT_DOMESTIC_ORDER_SHEET_MEMO,
};

/**
 * 전각 공백(U+3000)과 탭. 소스에 글자 그대로 적으면 반각 공백과 눈으로 구별되지
 * 않아 코드 값으로 만든다.
 */
export const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const TAB = String.fromCharCode(0x09);

/** 들여쓰기로 읽는 글자 — 반각 공백 · 탭 · 전각 공백. */
function isIndentChar(char: string): boolean {
  return char === " " || char === TAB || char === IDEOGRAPHIC_SPACE;
}

/** 줄 앞의 들여쓰기 글자들. */
function leadingIndentOf(line: string): string {
  let end = 0;
  while (end < line.length && isIndentChar(line[end])) end += 1;
  return line.slice(0, end);
}

/** 줄 끝의 들여쓰기 글자(공백 · 탭 · 전각 공백)를 걷는다. */
function trimTrailingIndent(line: string): string {
  let end = line.length;
  while (end > 0 && isIndentChar(line[end - 1])) end -= 1;
  return line.slice(0, end);
}

/**
 * 저장하지 않는 제어 문자가 있는가. 줄바꿈(\n)과 탭(\t)만 허락한다 — \r 은 정규화가
 * 먼저 걷는다. NUL 은 Postgres text 가 받지 않아 저장이 DB 오류로 끝나고, 나머지는
 * 눈에 안 보이는 채로 "기본 문구와 같은가"를 어긋나게 한다.
 *
 * 정규식 대신 코드를 센다 — 제어 문자 범위를 정규식에 적으면 lint(no-control-regex)가
 * 막는다.
 */
function hasDisallowedControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x0a || code === 0x09) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * 저장 전 정규화(파일 머리말). 여러 번 불러도 결과가 같다.
 */
export function normalizeSheetHeadingText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(trimTrailingIndent);
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

/**
 * 글자 수 — **코드 포인트**로 센다. DB CHECK 의 char_length 와 같은 잣대다.
 * String.length(UTF-16 단위)로 세면 이모지 하나가 2로 세여 검증과 DB 가 어긋난다.
 */
export function countSheetHeadingChars(text: string): number {
  return Array.from(text).length;
}

/** `{기준일}` 을 모두 바꾼다. 정규식을 쓰지 않는다 — 날짜 글자에 `$` 가 섞여도 그대로 들어간다. */
export function fillSheetAsOfDate(text: string, asOfDate: string): string {
  return text.split(DOMESTIC_ORDER_SHEET_AS_OF_DATE_PLACEHOLDER).join(asOfDate);
}

/** 줄 앞 공백의 폭을 들여쓰기 단으로(파일 머리말의 규칙). */
export function sheetIndentLevelOf(line: string): SheetIndentLevel {
  let width = 0;
  for (const char of leadingIndentOf(line)) width += char === " " ? 1 : 2;
  return Math.min(Math.floor(width / 2), DOMESTIC_ORDER_SHEET_MAX_INDENT_LEVEL) as SheetIndentLevel;
}

/**
 * 인사문을 화면이 그릴 줄들로 편다. 저장값이 아직 정규화를 안 지난 것이어도(예:
 * \r\n) 같은 결과가 나오게 여기서도 정규화한다.
 */
export function resolveSheetGreetingLines(greetingText: string, asOfDate: string): SheetGreetingLine[] {
  const normalized = normalizeSheetHeadingText(greetingText);
  if (normalized === "") return [];
  return normalized.split("\n").map((line) => ({
    text: fillSheetAsOfDate(line.slice(leadingIndentOf(line).length), asOfDate),
    indentLevel: sheetIndentLevelOf(line),
  }));
}

/**
 * 메모 상자에 적을 글. **비어 있으면 null — 그때 화면은 메모 상자를 그리지 않는다.**
 * 여러 줄이면 줄바꿈을 그대로 둔다(화면이 whitespace-pre-line 으로 그린다).
 */
export function resolveSheetInternalMemo(internalMemo: string, asOfDate: string): string | null {
  const normalized = normalizeSheetHeadingText(internalMemo);
  if (normalized === "") return null;
  return fillSheetAsOfDate(normalized, asOfDate);
}

/**
 * 코드의 기본 머리말과 같은가. 정규화를 지난 값끼리 비교한다 — 줄 끝 공백 하나
 * 차이로 "기본과 다름"이 되면 기본 문구로 되돌렸는데도 행이 남는다.
 */
export function isDefaultDomesticOrderSheetHeading(value: DomesticOrderSheetHeadingText): boolean {
  return (
    normalizeSheetHeadingText(value.greetingText) === DEFAULT_DOMESTIC_ORDER_SHEET_GREETING &&
    normalizeSheetHeadingText(value.internalMemo) === DEFAULT_DOMESTIC_ORDER_SHEET_MEMO
  );
}

export type DomesticOrderSheetHeadingFieldErrors = Partial<
  Record<keyof DomesticOrderSheetHeadingText, string>
>;

export type ValidateDomesticOrderSheetHeadingResult =
  | { ok: true; data: DomesticOrderSheetHeadingText }
  | { ok: false; fieldErrors: DomesticOrderSheetHeadingFieldErrors };

/**
 * 머리말 입력 검증. 통과하면 **정규화된** 값을 돌려준다 — 저장하는 값은 언제나
 * 이것이다.
 *
 *  - 인사문은 **비울 수 없다.** 이 화면은 고객사에 보내는 문서이기도 하고(SheetHeading
 *    주석), 인사문이 사라지면 표만 남아 이 자료가 무엇을 위한 것인지가 사라진다.
 *    처음 문구가 필요하면 [기본 문구로]가 있다.
 *  - 메모는 비워도 된다 — 비우면 메모 상자가 보이지 않는다.
 *  - 길이는 코드 포인트로 센다(countSheetHeadingChars). DB CHECK 와 같은 잣대라,
 *    여기를 통과한 값이 CHECK 에 걸리는 일이 없다.
 */
export function validateDomesticOrderSheetHeadingInput(
  raw: unknown
): ValidateDomesticOrderSheetHeadingResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, fieldErrors: { greetingText: "입력을 읽을 수 없습니다." } };
  }
  const input = raw as Record<string, unknown>;
  const fieldErrors: DomesticOrderSheetHeadingFieldErrors = {};

  const greetingText =
    typeof input.greetingText === "string" ? normalizeSheetHeadingText(input.greetingText) : null;
  if (greetingText === null) {
    fieldErrors.greetingText = "인사문을 읽을 수 없습니다.";
  } else if (greetingText === "") {
    fieldErrors.greetingText =
      "인사문을 한 줄 이상 적어 주세요. 처음 문구로 돌아가려면 [기본 문구로]를 누르세요.";
  } else if (countSheetHeadingChars(greetingText) > DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS) {
    fieldErrors.greetingText = `인사문은 ${DOMESTIC_ORDER_SHEET_GREETING_MAX_CHARS}자까지 적을 수 있습니다.`;
  } else if (hasDisallowedControl(greetingText)) {
    fieldErrors.greetingText = "인사문에 쓸 수 없는 제어 문자가 들어 있습니다.";
  }

  const internalMemo =
    typeof input.internalMemo === "string" ? normalizeSheetHeadingText(input.internalMemo) : null;
  if (internalMemo === null) {
    fieldErrors.internalMemo = "내부 메모를 읽을 수 없습니다.";
  } else if (countSheetHeadingChars(internalMemo) > DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS) {
    fieldErrors.internalMemo = `내부 메모는 ${DOMESTIC_ORDER_SHEET_MEMO_MAX_CHARS}자까지 적을 수 있습니다.`;
  } else if (hasDisallowedControl(internalMemo)) {
    fieldErrors.internalMemo = "내부 메모에 쓸 수 없는 제어 문자가 들어 있습니다.";
  }

  if (greetingText === null || internalMemo === null || Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, data: { greetingText, internalMemo } };
}
