/**
 * ============================================================================
 * 금액 입력 칸 — 세 자리마다 콤마를 붙여 보여 주고, 값은 콤마 없이 들고 다닌다
 * ============================================================================
 * 2026-09-15 개선 요청(견적서): 「견적서 비용 관련된 모든 숫자들 세자리수마다
 * 콤마(,)가 표시되도록」. 화면에 **표시되는** 금액은 이미 `Intl.NumberFormat` 을
 * 거치고 있었고, 콤마 없이 보이던 것은 **입력 칸**(부품 단가 · 작업비)이었다.
 *
 * ── 🔴 콤마는 보이는 글자에만 있다 ──────────────────────────────────────
 * 화면이 들고 있는 값·저장하는 값은 지금까지처럼 **콤마 없는 숫자 글자**다
 * (`"3500000"`, `"12000.50"`). 그래서 합계를 셈하는 곳(domain/quote-list.ts 의
 * toAmount)도, 저장 검증(validation/quote-input.ts 의 normalizeAmount)도 한 줄도
 * 바뀌지 않는다. 콤마를 붙이고 떼는 일은 이 파일과 입력 부품
 * (components/common/AmountInput.tsx)만 한다.
 *
 * 받는 모양은 저장 검증과 같다 — **0 이상, 소수 둘째 자리까지.** 음수는 받지
 * 않는다(검증의 AMOUNT_PATTERN 이 받지 않는다).
 *
 * 이 파일은 브라우저를 모른다 — 커서를 실제로 옮기는 일은 입력 부품이 하고,
 * 여기는 "어디로 옮길지"만 셈한다. 그래서 규칙이 Node 시험으로 그대로 돈다.
 * ============================================================================
 */

/** 소수 자릿수 상한. 저장 칸이 numeric(15,2) 이고 검증도 두 자리까지 받는다. */
export const AMOUNT_INPUT_MAX_DECIMALS = 2;

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** 금액을 이루는 글자인가 — 숫자와 점. 콤마·공백·그 밖은 아니다. */
function isAmountChar(ch: string): boolean {
  return isDigit(ch) || ch === ".";
}

/**
 * 사람이 친 글자 → 콤마 없는 값.
 *
 * 숫자와 **첫 번째** 점만 남기고, 소수는 둘째 자리까지 자른다. 앞자리 0 은 하나만
 * 남긴다(`"007"` → `"7"`, `"0"` 은 그대로). 점으로 시작하면 앞에 0 을 붙인다
 * (`"."` → `"0."`) — 치는 중인 끝의 점은 지우지 않는다. 지우면 `12.` 에서 다음
 * 숫자를 칠 수가 없다.
 */
export function parseAmountInput(text: string): string {
  let integer = "";
  let fraction: string | null = null;
  for (const ch of text) {
    if (isDigit(ch)) {
      if (fraction === null) integer += ch;
      else if (fraction.length < AMOUNT_INPUT_MAX_DECIMALS) fraction += ch;
    } else if (ch === "." && fraction === null) {
      fraction = "";
    }
  }
  integer = integer.replace(/^0+(?=\d)/, "");
  if (fraction === null) return integer;
  return `${integer === "" ? "0" : integer}.${fraction}`;
}

/**
 * 콤마 없는 값 → 칸에 보일 글자. **정수부만** 세 자리마다 끊는다 — 소수부와
 * 끝의 점은 그대로 둔다(`"1234.5"` → `"1,234.5"`, `"1234."` → `"1,234."`).
 */
export function formatAmountInput(raw: string): string {
  if (raw === "") return "";
  const dot = raw.indexOf(".");
  const integer = dot === -1 ? raw : raw.slice(0, dot);
  const rest = dot === -1 ? "" : raw.slice(dot);
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
}

/**
 * 다시 서식한 글자에서 커서를 둘 자리.
 *
 * 콤마는 치는 도중에 생기고 없어진다 — 커서를 글자 수로 옮기면 가운데를 고칠 때마다
 * 커서가 한 칸씩 어긋나거나 끝으로 튄다. 그래서 **커서 앞에 있던 금액 글자(숫자·점)
 * 수**를 세어, 서식한 글자에서 같은 수의 금액 글자 바로 뒤에 둔다. 버려진 글자
 * (문자·두 번째 점·셋째 소수 자리)가 있으면 그만큼 모자라게 셀 뿐이라, 넘치면 끝이다.
 */
export function caretAfterReformat(typed: string, caret: number, formatted: string): number {
  let significant = 0;
  for (const ch of typed.slice(0, Math.max(0, caret))) {
    if (isAmountChar(ch)) significant += 1;
  }
  if (significant === 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (!isAmountChar(formatted[index])) continue;
    seen += 1;
    if (seen === significant) return index + 1;
  }
  return formatted.length;
}
