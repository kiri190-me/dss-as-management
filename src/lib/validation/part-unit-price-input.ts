import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";

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
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 **소유자 코드**다. 화면이 그 키로 해당 줄의 입력칸 밑에
 * 문장을 붙인다. 소유자 자체가 잘못된 경우는 붙일 칸이 없으므로 `owner` 키를 쓴다.
 * ============================================================================
 */

/**
 * numeric(15,2) — 정수부 13자리 + 소수부 2자리. 이 폭을 넘는 값을 그대로 넘기면
 * Postgres 가 22003(numeric field overflow)으로 거절하고, 그 오류는 사용자에게
 * 아무것도 설명하지 못한다. validation/quote-input.ts 와 같은 폭이다 — 이 값이
 * 그대로 견적서로 옮겨 가므로 폭이 다르면 옮기다 잘린다.
 */
const AMOUNT_PATTERN = /^\d{1,13}(?:\.\d{1,2})?$/;

/** 단가 한 칸. `unitPrice: null` 은 "정하지 않음" — 저장 쪽이 그 줄을 지운다. */
export type PartUnitPriceEntry = {
  owner: StockOwner;
  unitPrice: string | null;
};

export type ValidatePartUnitPricesResult =
  | { ok: true; data: PartUnitPriceEntry[] }
  | { ok: false; fieldErrors: Record<string, string> };


/**
 * 단가 칸의 오류 키에 붙는 접두사.
 *
 * 한계수량 검증과 이 검증이 **둘 다 소유자 코드를 오류 키로 쓴다**(한 표에서
 * 함께 편집하기 전에는 겹칠 일이 없었다). 저장 쪽이 단가 오류에만 이 접두사를
 * 붙여 내려보내고, 화면이 그것으로 어느 칸 밑에 문장을 붙일지 가른다.
 *
 * ⚠️ **이 상수는 반드시 순수 모듈에 있어야 한다.** 화면(클라이언트 컴포넌트)이
 * 읽는 값인데 mutation 파일에 두면 그 파일의 `server-only` 와 DB 드라이버가
 * 클라이언트 번들로 끌려 들어가 빌드가 통째로 깨진다(실제로 한 번 그랬다).
 */
export const UNIT_PRICE_FIELD_ERROR_PREFIX = "price:";

export function isStockOwner(value: unknown): value is StockOwner {
  return typeof value === "string" && (STOCK_OWNER_CODES as readonly string[]).includes(value);
}

/**
 * 칸 하나분의 값. 화면도 이 함수를 그대로 불러 저장 단추를 잠그므로, 화면에서
 * 통과한 값이 서버에서 거절당하는 일이 없다.
 */
export function parseUnitPriceValue(
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

/**
 * 화면이 한 번에 보내는 소유자 넷(또는 그 일부)을 통째로 검증한다.
 *
 * 넷을 한 번에 저장하기 때문에 **하나라도 틀리면 전부 거절한다** — 반쯤 저장되면
 * 어느 단가가 살아 있는지 화면과 DB 가 달라진다. 같은 소유자가 두 번 오는 것도
 * 거절한다: 어느 쪽이 뜻인지 알 수 없고, 뒤엣것으로 덮어쓰면 화면에서 본 것과
 * 다른 값이 저장될 수 있다.
 */
export function validatePartUnitPriceEntries(raw: unknown): ValidatePartUnitPricesResult {
  const fieldErrors: Record<string, string> = {};

  if (!Array.isArray(raw)) {
    return { ok: false, fieldErrors: { owner: "단가 입력을 확인할 수 없습니다." } };
  }

  const entries: PartUnitPriceEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      fieldErrors.owner = "단가 입력을 확인할 수 없습니다.";
      continue;
    }

    const owner = (item as { owner?: unknown }).owner;
    if (!isStockOwner(owner)) {
      // 알 수 없는 소유자는 붙일 칸이 없다. 조용히 버리지 않는 이유는, 화면이
      // 보낸 줄 하나가 통째로 사라지면 사람은 저장됐다고 믿기 때문이다.
      fieldErrors.owner = "소유 구분을 확인할 수 없습니다.";
      continue;
    }
    if (seen.has(owner)) {
      fieldErrors[owner] = `${stockOwnerLabels[owner]}가 두 번 들어왔습니다.`;
      continue;
    }
    seen.add(owner);

    const parsed = parseUnitPriceValue((item as { unitPrice?: unknown }).unitPrice);
    if (!parsed.ok) {
      fieldErrors[owner] = parsed.message;
      continue;
    }

    entries.push({ owner, unitPrice: parsed.value });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: entries };
}
