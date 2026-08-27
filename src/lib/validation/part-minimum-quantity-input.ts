import { STOCK_OWNER_CODES, stockOwnerLabels, type StockOwner } from "@/lib/domain/inventory-types";

/**
 * ============================================================================
 * 한계수량 입력 검증 — 형식만 본다
 * ============================================================================
 * weekly-report-goal-input.ts 와 같은 자리의 파일이다. **DB 도 세션도 여기서
 * 만지지 않는다** — 순수 함수만 두어야 단위 테스트가 붙고, 그래야 "어떤 값을
 * 받아들이는가"라는 규칙이 실제로 검증된다. 그 부품이 있는지는 자료의 문제라
 * mutation 이, 누가 적을 수 있는가는 정책이라 mutation 의 권한 검사가 맡는다.
 *
 * ── 🔴 빈 값은 0 이 아니다 ──────────────────────────────────────────────
 * 칸을 비운 것은 "한계수량을 정하지 않았다"는 뜻이고, 저장 쪽에서 그 줄을
 * **지우는** 신호다(null 로 돌려준다). 0 으로 바꿔 저장하면 "정하지 않음"을
 * 다시 표현할 방법이 사라지고, 0 이 원래 갖는 뜻("하나도 없으면 알려 달라")과도
 * 섞인다. 이 구별의 근거는 schema/part-minimum-quantities.ts 머리말에 있다.
 *
 * ── 받아들이는 값 ───────────────────────────────────────────────────────
 *   · 빈 문자열 · 공백만 · null · undefined  → null (한계 없음)
 *   · "0" 이상의 정수 문자열, 또는 0 이상의 정수 → 그 수
 *   · 음수 · 소수 · 숫자가 아닌 글자 · 1e3 같은 지수 표기 → 거절
 *
 * 문자열로 오는 것은 <input> 에서 온 값이기 때문이고, 숫자로 오는 것은 이미
 * 파싱된 값이 다시 들어오는 경우다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 **소유자 코드**다. 화면이 그 키로 해당 줄의 입력칸 밑에
 * 문장을 붙인다. 소유자 자체가 잘못된 경우는 붙일 칸이 없으므로 `owner` 키를
 * 쓴다.
 * ============================================================================
 */

/**
 * minimum_quantity 는 integer 컬럼이다. 자바스크립트에서 통과시켜 놓고 DB 에서
 * 터지면 사용자에게는 "저장할 수 없습니다"만 보이므로 여기서 잘라 준다.
 */
const MAX_MINIMUM_QUANTITY = 2_147_483_647;

/** 한계수량 한 칸. `minimumQuantity: null` 은 "정하지 않음" — 저장 쪽이 그 줄을 지운다. */
export type PartMinimumQuantityEntry = {
  owner: StockOwner;
  minimumQuantity: number | null;
};

export type ValidatePartMinimumQuantitiesResult =
  | { ok: true; data: PartMinimumQuantityEntry[] }
  | { ok: false; fieldErrors: Record<string, string> };

export function isStockOwner(value: unknown): value is StockOwner {
  return typeof value === "string" && (STOCK_OWNER_CODES as readonly string[]).includes(value);
}

/**
 * 칸 하나분의 값. 화면도 이 함수를 그대로 불러 저장 단추를 잠그므로, 화면에서
 * 통과한 값이 서버에서 거절당하는 일이 없다.
 */
export function parseMinimumQuantityValue(
  raw: unknown
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  if (typeof raw === "number") {
    if (!Number.isInteger(raw)) return { ok: false, message: "한계수량은 0 이상의 정수여야 합니다." };
    if (raw < 0) return { ok: false, message: "한계수량은 0 이상의 정수여야 합니다." };
    if (raw > MAX_MINIMUM_QUANTITY) {
      return { ok: false, message: `한계수량은 ${MAX_MINIMUM_QUANTITY.toLocaleString("ko-KR")}을 넘을 수 없습니다.` };
    }
    return { ok: true, value: raw };
  }

  if (typeof raw !== "string") return { ok: false, message: "한계수량 값을 확인할 수 없습니다." };

  const trimmed = raw.trim();
  // 비운 칸 — 한계 없음. 이 줄은 저장되지 않고 지워진다.
  if (trimmed === "") return { ok: true, value: null };

  // 숫자만. "-1"·"1.5"·"1e3"·"１" 같은 것은 여기서 전부 걸린다 — Number() 에
  // 맡기면 "1e3" 이 1000 으로, " " 가 0 으로 조용히 통과한다.
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "한계수량은 0 이상의 정수여야 합니다." };

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return { ok: false, message: "한계수량은 0 이상의 정수여야 합니다." };
  if (parsed > MAX_MINIMUM_QUANTITY) {
    return { ok: false, message: `한계수량은 ${MAX_MINIMUM_QUANTITY.toLocaleString("ko-KR")}을 넘을 수 없습니다.` };
  }
  return { ok: true, value: parsed };
}

/**
 * 화면이 한 번에 보내는 소유자 넷(또는 그 일부)을 통째로 검증한다.
 *
 * 넷을 한 번에 저장하기 때문에 **하나라도 틀리면 전부 거절한다** — 반쯤 저장되면
 * 어느 기준이 살아 있는지 화면과 DB 가 달라진다. 같은 소유자가 두 번 오는 것도
 * 거절한다: 어느 쪽이 뜻인지 알 수 없고, 뒤엣것으로 덮어쓰면 화면에서 본 것과
 * 다른 값이 저장될 수 있다(saveNotificationSettings 가 같은 판단을 한다).
 */
export function validatePartMinimumQuantityEntries(raw: unknown): ValidatePartMinimumQuantitiesResult {
  const fieldErrors: Record<string, string> = {};

  if (!Array.isArray(raw)) {
    return { ok: false, fieldErrors: { owner: "한계수량 입력을 확인할 수 없습니다." } };
  }

  const entries: PartMinimumQuantityEntry[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      fieldErrors.owner = "한계수량 입력을 확인할 수 없습니다.";
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

    const parsed = parseMinimumQuantityValue((item as { minimumQuantity?: unknown }).minimumQuantity);
    if (!parsed.ok) {
      fieldErrors[owner] = parsed.message;
      continue;
    }

    entries.push({ owner, minimumQuantity: parsed.value });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, data: entries };
}
