/**
 * ============================================================================
 * [새 견적서]의 발행번호 칸에 **다음 번호를 미리 적어 둔다** — 화면 쪽 (2026-10-06)
 * ============================================================================
 * 통로(GET /api/quotes/next-number)에 한 번 묻고, 쓸 수 있는 번호가 오면 그것을 돌려준다.
 * 폼(QuoteEditForm)은 그 값을 **빈 번호 칸의 처음 값**으로만 쓴다.
 *
 * ── 🔴 제안이지 채번이 아니다 ──────────────────────────────────────────────
 * 견적서 번호는 **사람이 손으로 적는 자유 텍스트**다(승인된 결정 —
 * vendor/dss-core/src/schema/quotes.ts 의 quoteNumber 주석 · lib/storage/quote-number-suggestion.ts
 * 머리말). 그래서 이 모듈이 돌려주는 값은 **제안**이고, 받는 쪽은 다음 셋을 지켜야 한다:
 *   · 칸을 읽기 전용으로 만들지 않는다 — 번호 칸은 여전히 자유 입력이다.
 *   · 사람이 적은 값을 덮지 않는다 — 채우는 것은 **빈 칸일 때뿐**이다(fillQuoteNumberIfEmpty).
 *   · 저장할 때 이 값과 견주어 거절하지 않는다 — 중복은 지금처럼 DB 의 부분 unique 인덱스가 막는다.
 *
 * ── 🔴 못 받아도 조용하다 ──────────────────────────────────────────────────
 * 공유폴더 설정이 없거나(`disabled`) · 느리거나 읽지 못했거나(`failed`) · 권한이 없거나 ·
 * 네트워크가 끊겼으면 **null** 이다. 던지지 않고, 사유도 돌려주지 않는다 — 부르는 쪽이 알릴
 * 것이 없기 때문이다. 번호를 못 받은 것은 사람이 할 일을 막지 않는다(손으로 적으면 된다).
 * 그래서 화면은 오류 상자를 띄우지 않고 지금까지처럼 **빈 칸**으로 둔다.
 *
 * ── 알려진 칸만 읽는다 ────────────────────────────────────────────────────
 * 응답에서 보는 것은 `status` 와 `quoteNumber` 둘뿐이다. 근거 숫자 넷(훑은 폴더 수 등)은
 * 읽지 않는다 — 화면에 쓸 데가 없다. 모양이 다르면 null 로 본다.
 *
 * 네트워크 없이 값으로 시험한다(quote-next-number.test.ts) — fetch 를 바꿔 끼울 수 있다.
 * ============================================================================
 */

/** 쓰는 것만 적은 응답 — 바꿔 끼운 fetch 도 이 셋만 주면 된다. */
type NextNumberResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/** 부르는 쪽이 바꿔 끼울 수 있는 fetch(GET). */
export type QuoteNextNumberFetch = (url: string) => Promise<NextNumberResponse>;

/** 통로 — 견적서 id 가 없는 정적 주소다(아직 만들어지지 않은 장의 번호라 id 가 없다). */
export const QUOTE_NEXT_NUMBER_URL = "/api/quotes/next-number";

/**
 * 채워 둔 번호 아래에 붙는 곁말. 🔴 **고쳐도 된다는 것을 드러내는 것이 이 줄의 일이다** —
 * 칸이 저절로 채워져 있으면 손대면 안 되는 값으로 보이기 쉽다.
 */
export const QUOTE_NUMBER_SUGGESTION_HINT_TEXT =
  "공유폴더에서 읽은 다음 번호입니다 — 그대로 쓰시거나 고치셔도 됩니다";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 응답 본문에서 쓸 수 있는 번호만 꺼낸다. `ready` 가 아니거나 · 번호가 글자가 아니거나 ·
 * 앞뒤 공백을 걷어 비면 **null** 이다(그때는 칸을 비워 둔다).
 */
export function readSuggestedQuoteNumber(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (payload.status !== "ready") return null;
  if (typeof payload.quoteNumber !== "string") return null;
  const quoteNumber = payload.quoteNumber.trim();
  return quoteNumber === "" ? null : quoteNumber;
}

/**
 * 다음 번호를 **한 번** 묻는다. 🔴 **던지지 않는다** — 못 받으면 전부 null 이다(머리말).
 * 되풀이하지 않는다: 한 번 못 받았으면 사람이 적을 차례다.
 */
export async function fetchSuggestedQuoteNumber({
  fetchImpl = (url: string) => fetch(url),
}: { fetchImpl?: QuoteNextNumberFetch } = {}): Promise<string | null> {
  let response: NextNumberResponse;
  try {
    response = await fetchImpl(QUOTE_NEXT_NUMBER_URL);
  } catch {
    // 네트워크가 끊겼다 — 알리지 않는다(머리말).
    return null;
  }
  // 401 · 403(로그인 · 권한 · 저장 모드)도 조용히 지나간다 — 번호 칸은 비어 있으면 된다.
  if (!response.ok) return null;

  const payload = await response.json().catch(() => null);
  return readSuggestedQuoteNumber(payload);
}

/**
 * 🔴 **빈 칸일 때만** 제안을 넣는다. 사람이 이미 적어 둔 값(받아 오는 동안 치기 시작한 값도
 * 포함)은 **그대로 돌려준다** — 덮지 않는다. 앞뒤 공백뿐인 칸은 빈 칸으로 본다(저장 검증 ·
 * 엑셀 자동 채우기와 같은 눈금이다).
 *
 * 상태를 넣는 쪽이 `setQuoteNumber((current) => …)` 로 **그 순간의 값**을 받아 이 함수에
 * 넘기는 것이 요점이다. 효과가 시작될 때의 값으로 재면, 기다리는 사이에 친 글자를 덮는다.
 */
export function fillQuoteNumberIfEmpty(current: string, suggested: string): string {
  return current.trim() === "" ? suggested : current;
}
