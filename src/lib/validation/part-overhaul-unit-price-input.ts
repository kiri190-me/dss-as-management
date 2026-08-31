import { parseAmountValue } from "./part-unit-price-input";

/**
 * ============================================================================
 * O/H 단가 입력 검증 — 형식만 본다
 * ============================================================================
 * part-unit-price-input.ts 와 같은 자리, 같은 규칙이다. **DB 도 세션도 여기서
 * 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙는다. 그 부품이 있는지는
 * 자료의 문제라 mutation 이, 누가 적을 수 있는가는 정책이라 mutation 의 권한
 * 검사가 맡는다. 여기서 부품 id 에 대해 보는 것은 **모양이 uuid 인가**뿐이다.
 *
 * ── 🔴 금액 규칙을 두 벌로 만들지 않았다 ────────────────────────────────
 * 쉼표 처리·자릿수·지수 표기 거절은 part-unit-price-input.ts 의 parseAmountValue
 * 한 곳에 있고 이 파일은 그것을 **부른다.** 규칙이 두 파일에 갈라져 있으면 한쪽만
 * 고쳐지는 날 견적서 금액이 조용히 어긋난다 — 일반 단가와 O/H 단가는 같은 견적서
 * 양식의 같은 칸으로 흘러가므로, 어긋나도 눈에 띄지 않는다.
 *
 * ── 🔴 빈 값은 0 이 아니다 ──────────────────────────────────────────────
 * 칸을 비운 것은 "O/H 단가를 정하지 않았다"는 뜻이고, 저장 쪽에서 그 줄을
 * **지우는** 신호다(null 로 돌려준다). 0 으로 바꿔 저장하면 "정하지 않음"을 다시
 * 표현할 방법이 사라지고, **O/H 견적서가 정하지 않은 부품을 0원으로 청구하게
 * 된다.** 0 은 그 자체로 "오버홀 때는 무상으로 주는 부품"이라는 뜻이다
 * (schema/part-overhaul-unit-prices.ts 머리말).
 *
 * ── 오류 키는 부품 id 다 ────────────────────────────────────────────────
 * 형제 검증이 **소유자 코드**를 키로 쓰는 것과 같은 발상이다 — 화면이 그 키로
 * 해당 줄의 입력칸 밑에 문장을 붙인다. 이 표에는 소유구분 축이 없고 줄을 가리키는
 * 것이 부품 id 뿐이라, 키도 부품 id 다. 부품 id 자체가 잘못된 경우는 붙일 줄이
 * 없으므로 `partId` 키를 쓴다(형제 검증의 `owner` 키에 해당한다).
 * ============================================================================
 */

/** 저장소 다른 검증 파일들과 같은 모양. 부품 id 는 uuid 다. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** O/H 단가 한 칸. `unitPrice: null` 은 "정하지 않음" — 저장 쪽이 그 줄을 지운다. */
export type PartOverhaulUnitPriceEntry = {
  partId: string;
  unitPrice: string | null;
};

export type ValidatePartOverhaulUnitPricesResult =
  | { ok: true; data: PartOverhaulUnitPriceEntry[] }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * O/H 단가 칸의 오류 키에 붙는 접두사.
 *
 * O/H 부품 템플릿 화면은 **템플릿 칸과 단가 칸을 한 폼에서** 편집한다. 두 검증이
 * 서로 다른 것을 키로 쓰지만(템플릿은 칸 이름, 단가는 부품 id) 한 자루에 담기면
 * 화면은 어느 쪽 오류인지 가릴 수 없다. 그래서 단가 오류에만 이 접두사를 붙인다 —
 * part-unit-price-input.ts 의 UNIT_PRICE_FIELD_ERROR_PREFIX 와 같은 장치이고,
 * 그쪽이 `"price:"` 이므로 겹치지 않게 다른 글자를 쓴다.
 */
export const OVERHAUL_UNIT_PRICE_FIELD_ERROR_PREFIX = "ohPrice:";

/**
 * 칸 하나분의 값. 화면도 이 함수를 그대로 불러 저장 단추를 잠그므로, 화면에서
 * 통과한 값이 서버에서 거절당하는 일이 없다. 규칙은 일반 단가와 **글자 하나까지
 * 같다** — 같은 금액을 두 규칙으로 재면 어느 쪽이 옳은지 아무도 답할 수 없다.
 */
export function parseOverhaulUnitPriceValue(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  return parseAmountValue(raw);
}

/**
 * 화면이 한 번에 보내는 여러 부품의 O/H 단가를 통째로 검증한다.
 *
 * O/H 부품 템플릿 화면은 부품 열몇 개의 단가를 **한 표에서 한 단추로** 저장한다.
 * 그래서 **하나라도 틀리면 전부 거절한다** — 반쯤 저장되면 어느 부품의 단가가
 * 살아 있는지 화면과 DB 가 달라진다. 같은 부품이 두 번 오는 것도 거절한다:
 * 어느 쪽이 뜻인지 알 수 없고, 뒤엣것으로 덮어쓰면 화면에서 본 것과 다른 값이
 * 저장될 수 있다(그리고 이 표는 부품마다 한 줄이라, 두 값 중 하나는 반드시
 * 사라진다).
 */
export function validatePartOverhaulUnitPriceEntries(
  raw: unknown
): ValidatePartOverhaulUnitPricesResult {
  const fieldErrors: Record<string, string> = {};

  if (!Array.isArray(raw)) {
    return { ok: false, fieldErrors: { partId: "O/H 단가 입력을 확인할 수 없습니다." } };
  }

  const entries: PartOverhaulUnitPriceEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      fieldErrors.partId = "O/H 단가 입력을 확인할 수 없습니다.";
      continue;
    }

    const partId = (item as { partId?: unknown }).partId;
    if (!isUuid(partId)) {
      // 알 수 없는 부품은 붙일 줄이 없다. 조용히 버리지 않는 이유는, 화면이 보낸
      // 줄 하나가 통째로 사라지면 사람은 저장됐다고 믿기 때문이다.
      fieldErrors.partId = "부품을 확인할 수 없습니다.";
      continue;
    }
    if (seen.has(partId)) {
      fieldErrors[partId] = "같은 부품이 두 번 들어왔습니다.";
      continue;
    }
    seen.add(partId);

    const parsed = parseOverhaulUnitPriceValue((item as { unitPrice?: unknown }).unitPrice);
    if (!parsed.ok) {
      fieldErrors[partId] = parsed.message;
      continue;
    }

    entries.push({ partId, unitPrice: parsed.value });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: entries };
}
