/**
 * ============================================================================
 * 단가 입력 검증 — 형식만 본다
 * ============================================================================
 * part-minimum-quantity-input.ts 와 같은 자리, 같은 규칙이다. **DB 도 세션도
 * 여기서 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙는다. 그 부품이
 * 있는지는 자료의 문제라 mutation 이, 누가 적을 수 있는가는 정책이라 mutation 의
 * 권한 검사가 맡는다.
 *
 * ── 🔴 빈 값은 0 이 아니다 ──────────────────────────────────────────────
 * 칸을 비운 것은 "단가를 정하지 않았다"는 뜻이고, 저장 쪽에서 그 줄을 **지우는**
 * 신호다(null 로 돌려준다). 0 으로 바꿔 저장하면 "정하지 않음"을 다시 표현할
 * 방법이 사라지고, **견적서가 정하지 않은 부품을 0원으로 청구하게 된다.**
 * 0 은 그 자체로 "무상 부품"이라는 뜻이다(schema/part-unit-prices.ts 머리말).
 *
 * ── 금액은 문자열로 오간다 ──────────────────────────────────────────────
 * numeric(15,2) 컬럼이라 Number 를 거치지 않는다 — 0.1 을 더하는 것만으로도
 * 오차가 쌓이고, 그 오차가 견적서 합계와 세금계산서 사이의 1원 차이가 된다.
 * 검증도 **문자열 그대로 통과시켜** 저장까지 문자열로 간다.
 *
 * ── 받아들이는 값 ───────────────────────────────────────────────────────
 *   · 빈 문자열 · 공백만 · null · undefined  → null (정하지 않음)
 *   · "125000" · "1,250,000" · "1250.50" · 숫자 125000 → 정규화된 문자열
 *   · 음수 · 소수 세 자리 이상 · 정수부 14자리 이상 · 글자 · "1e3" → 거절
 *
 * 쉼표를 지우는 것은 사람이 금액을 그렇게 치기 때문이다. 지수 표기를 막는 것은
 * Number() 에 맡기면 "1e3" 이 1000 으로 조용히 통과하기 때문이다.
 *
 * ── 🔴 단가는 부품마다 하나다 (2026-09-17 사용자 정정) ──────────────────
 * 소유구분(owner)을 보지 않는다. 같은 부품이면 DSS 것이든 교산 것이든 청구하는
 * 값이 같다는 것이 업무상 사실이고, 그래서 표에서도 그 축을 없앴다
 * (schema/part-unit-prices.ts 머리말). 소유구분별로 넷을 받던 배열 검증
 * (validatePartUnitPriceEntries)이 값 하나 검증으로 바뀐 것이 그 결과다.
 * 🔴 **한계수량은 그대로 소유구분별이다** — 그쪽 검증은 손대지 않았다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 UNIT_PRICE_FIELD_ERROR_KEY 하나다. 화면이 그 키로 단가
 * 입력칸 밑에 문장을 붙인다.
 * ============================================================================
 */

/**
 * numeric(15,2) — 정수부 13자리 + 소수부 2자리. 이 폭을 넘는 값을 그대로 넘기면
 * Postgres 가 22003(numeric field overflow)으로 거절하고, 그 오류는 사용자에게
 * 아무것도 설명하지 못한다. validation/quote-input.ts 와 같은 폭이다 — 이 값이
 * 그대로 견적서로 옮겨 가므로 폭이 다르면 옮기다 잘린다.
 */
const AMOUNT_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

/**
 * ── 🔴 금액 한 칸의 규칙은 여기 한 벌만 있다 ────────────────────────────
 * 단가(이 파일)와 O/H 단가(part-overhaul-unit-price-input.ts)가 **이 함수를 함께
 * 쓴다.** 쉼표 처리·자릿수·지수 표기 거절 같은 규칙이 두 파일에 갈라져 있으면,
 * 한쪽만 고쳐지는 날 견적서 금액이 조용히 어긋난다 — 두 값이 같은 견적서의 같은
 * 칸으로 흘러가기 때문에 어긋나도 눈에 띄지 않는다.
 *
 * 부품 id 같은 **줄을 가리키는 값은 여기서 보지 않는다.** 이 함수가 아는 것은
 * 금액 한 칸뿐이고, 그래서 성격이 다른 여러 금액 칸이 그대로 나눠 쓸 수 있다
 * (일반 단가 · O/H 단가 · 수리 작업의 시간당 단가).
 *
 * 받아들이는 값은 이 파일 머리말의 "받아들이는 값"과 같다. 쉼표를 지우는 것은
 * 사람이 금액을 그렇게 치기 때문이고, 지수 표기를 막는 것은 Number() 에 맡기면
 * "1e3" 이 1000 으로 조용히 통과하기 때문이다.
 */
export function parseAmountValue(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  const text = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : raw;
  if (typeof text !== "string") return { ok: false, message: "단가 값을 확인할 수 없습니다." };

  // 사람이 금액을 "1,250,000" 으로 친다. 쉼표만 지우고 나머지는 그대로 본다.
  const trimmed = text.trim().replace(/,/g, "");
  // 비운 칸 — 정하지 않음. 이 줄은 저장되지 않고 지워진다.
  if (trimmed === "") return { ok: true, value: null };

  if (!AMOUNT_PATTERN.test(trimmed)) {
    return { ok: false, message: "단가는 0 이상의 금액(소수점 두 자리까지)이어야 합니다." };
  }
  return { ok: true, value: trimmed };
}

/** `unitPrice: null` 은 "정하지 않음" — 저장 쪽이 그 줄을 지운다. */
export type ValidatePartUnitPriceResult =
  | { ok: true; unitPrice: string | null }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * 단가 칸의 오류 키.
 *
 * 단가와 한계수량은 **같은 표, 같은 저장 단추**에서 함께 편집되고 오류도 한
 * 뭉치로 내려온다. 한계수량 쪽 키는 소유자 코드(`DSS`…)와 `owner` 라서, 단가
 * 키가 그 목록과 겹치지 않아야 한다 — 겹치면 단가가 틀렸는데 빨간 글씨가
 * 한계수량 칸 밑에 붙는다.
 *
 * 🔴 소유구분 축이 없어지면서 단가 칸이 **하나뿐**이 되었다. 예전에는 소유자
 * 코드에 `price:` 접두사를 붙여 갈랐지만(UNIT_PRICE_FIELD_ERROR_PREFIX), 이제는
 * 붙일 줄 자체가 하나라 키 하나로 충분하다.
 *
 * ⚠️ **이 상수는 반드시 순수 모듈에 있어야 한다.** 화면(클라이언트 컴포넌트)이
 * 읽는 값인데 mutation 파일에 두면 그 파일의 `server-only` 와 DB 드라이버가
 * 클라이언트 번들로 끌려 들어가 빌드가 통째로 깨진다(실제로 한 번 그랬다).
 */
export const UNIT_PRICE_FIELD_ERROR_KEY = "unitPrice";

/**
 * 칸 하나분의 값. 화면도 이 함수를 그대로 불러 저장 단추를 잠그므로, 화면에서
 * 통과한 값이 서버에서 거절당하는 일이 없다.
 *
 * 규칙 자체는 위 parseAmountValue 한 곳에 있다 — 이 이름은 단가 화면·저장이
 * 부르는 자리로 남겨 둔다(부르는 곳이 여럿이라 이름을 옮기면 그만큼 흔들린다).
 */
export function parseUnitPriceValue(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  return parseAmountValue(raw);
}

/**
 * 화면이 보내는 단가 한 칸을 검증한다.
 *
 * 🔴 부품 하나에 단가 하나이므로 받는 것도 값 하나다. 소유자를 함께 받아 넷을
 * 검증하던 시절에는 "하나라도 틀리면 전부 거절"이 중요한 규칙이었는데, 칸이
 * 하나가 되면서 그 자리가 사라졌다 — 대신 **한계수량과 한 트랜잭션**이라는
 * 규칙이 남아 있고(mutations/part-minimum-quantities.ts), 그쪽이 반쪽 저장을 막는다.
 *
 * 거절할 때 키를 UNIT_PRICE_FIELD_ERROR_KEY 로 고정하는 이유는 위 상수의 주석과
 * 같다 — 한계수량 오류와 같은 뭉치로 내려가므로 겹치면 안 된다.
 */
export function validatePartUnitPrice(raw: unknown): ValidatePartUnitPriceResult {
  const parsed = parseUnitPriceValue(raw);
  if (!parsed.ok) {
    return { ok: false, fieldErrors: { [UNIT_PRICE_FIELD_ERROR_KEY]: parsed.message } };
  }
  return { ok: true, unitPrice: parsed.value };
}
