/**
 * ============================================================================
 * 재고 관리에서 받아 온 것을 **어떻게 읽는가** — 순수 규칙 (DB 도 망도 여기서 만지지 않는다)
 * ============================================================================
 * 2026-10-15. 수리 건 상세의 「부품 요청」 칸은 이제 A/S 제 표가 아니라 **재고 관리**를
 * 본다(사용자 결정: 「A/S 의 부품 요청은 운영에서 전혀 안 쓰고 있다. 재고 관리가 생기기를
 * 기다리는 중이었다」). 실제로 망을 타는 일은 `src/lib/server/inventory-gateway.ts` 가 하고,
 * 여기에는 **받아 온 것을 어떻게 읽는가**만 둔다 — 그래야 아래 판정에 DB 도 망도 없는
 * 시험이 붙는다. 저쪽 저장소의 `src/lib/approval/directory.ts` ↔ `as-users.ts` 와 같은 가름이다.
 *
 * ── 🔴 「못 받아 왔다」와 「하나도 없다」는 다른 말이다 ─────────────────────
 * 이 파일이 존재하는 이유가 그 한 줄이다. 주소가 없든, 늦든, 401 이든, 본문을 못 읽든
 * 전부 **「못 받아 왔다」**(`unreachable`)다. 어느 하나라도 빈 목록으로 바꾸면 화면이
 * **「재고에 부품이 하나도 없다」**고 거짓말한다 — 사람은 재고가 빈 줄 알고 전화를 걸거나,
 * 「이 건에 나간 부품이 없다」를 믿고 같은 부품을 또 올린다. 그래서 받아 온 결과를
 * 성공/실패로 **구별해서** 들고 다닌다(`InventoryResult`).
 *
 * 반대쪽도 똑같이 지킨다: 통로가 200 으로 **빈 목록**을 돌려주는 것은 「그런 것이 없다」는
 * **사실**이고 응답을 못 읽은 것은 **모름**이다. 아래 `parse*` 들이 둘을 가른다 — 모양이
 * 아니면 `null`(부르는 쪽이 `unreachable` 로 바꾼다), 모양이면 빈 배열 그대로.
 *
 * ── 🔴 상태 글자는 저쪽이 준 것을 그대로 쓴다 ────────────────────────────
 * `status.label` 은 **재고 관리 화면에 뜨는 글자 그대로**다(API.md 4-7절). 여기서 코드값을
 * 보고 한글을 다시 지어내지 않는다 — 두 화면이 다른 말을 하면 같은 신청이 다른 일로 보이고,
 * 저쪽이 말을 바꾸는 날 이쪽만 옛말을 한다. 「마감」은 상태값이 아니라 `closed` 칸이다.
 *
 * ── 부품 고르개도 여기를 지난다 (2026-10-16) ────────────────────────────
 * 견적서의 「부품 비용」과 수리 건의 「사용 부품」이 쓰는 고르개도 이제 재고 관리의 부품을
 * 본다. 받아 온 `InventoryPart` 에서 **고르개가 받는 줄**로 옮기는 자리가 아래
 * `toPartPickerRows` 이고, 거기서 재고 · 소유 · 비고를 떼어 낸다(그 함수의 머리말).
 *
 * ── 🔴 소유를 고르지 않는다 ──────────────────────────────────────────────
 * 재고 관리에서는 **소유가 다르면 부품 번호가 다르다**. 번호를 고르는 순간 소유가 정해지므로
 * 화면에는 그 부품의 소유를 **보여 주기만** 한다(A/S 옛 표의 소유구분 고르개와 다른 점이다).
 * ============================================================================
 */

/* 부품 고르개가 받는 줄의 모양. 🔴 **형만 빌린다** — 이 파일은 순수하게 남는다(고르개 쪽
   `part-picker-rows.ts` 도 react 도 DB 도 물지 않는 형 선언뿐이다). 아래 toPartPickerRows
   가 그 모양으로 옮긴다. */
import type { PartPickerPriceRow, PartPickerRow } from "@dss/core/ui/inventory/part-picker-rows";
/* 🔴 **칸에 값이 들어 있는가를 재는 자(`-` 는 값이 아니다)는 한 벌이어야 한다.** 고르개도
   이 화면도 같은 칸을 보고 「있다/없다」를 말하는데 자가 둘이면, 한쪽은 고를 수 있다고 그리고
   다른 쪽은 비었다고 말한다. 그래서 형 곁에 있는 그 함수를 **빌려 쓴다** — 그 파일은 react 도
   DB 도 물지 않는 순수 모듈이라 이 파일이 순수하게 남는다. */
/* 🔴 **보이는 차례를 적는 자리도 한 곳이다**(2026-10-16 요청 ③ — 「어디서든 같은 순서」).
   고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번의 차례와 이름표는 저 파일의
   `PART_FIELD_ORDER` · `PART_FIELD_LABELS` 가 쥔다 — 여기서 다시 적으면 언젠가 갈린다. */
import { partFieldEntries, partFieldValue } from "@dss/core/ui/inventory/part-picker-rows";

/** 못 받아 온 까닭. 🔴 전부 **「없다」가 아니라 「모른다」**다. */
export type InventoryUnreachableReason =
  | "not_configured"
  | "timeout"
  | "unauthorized"
  | "api_closed"
  | "error";

/**
 * 받아 온 것. 🔴 성공과 실패를 **구별해서** 들고 다닌다(머리말).
 *
 * 🔵 `{ status: "ok"; value: [] }` 와 `{ status: "unreachable" }` 는 **다른 값**이다. 화면은
 *    앞은 「없습니다」로, 뒤는 「불러오지 못했습니다」로 그린다.
 */
export type InventoryResult<T> =
  | { status: "ok"; value: T }
  | { status: "unreachable"; reason: InventoryUnreachableReason };

/**
 * 못 받아 온 까닭을 사람 말로. 🔴 다섯 다 **「재고에 없습니다」라고 말하지 않는다** —
 * 모르는 것을 없는 것처럼 적으면 사람이 멀쩡한 재고를 두고 다른 길을 찾는다.
 *
 * 말투는 저쪽 저장소의 `AS_DIRECTORY_MESSAGES` · `LOOKUP_MESSAGES` 와 맞춘다(같은 두
 * 시스템이 서로를 못 부를 때의 말이라, 양쪽 화면이 다른 말을 하면 같은 사고가 다른 일로 보인다).
 */
export const INVENTORY_UNREACHABLE_MESSAGES: Record<InventoryUnreachableReason, string> = {
  not_configured: "재고 관리 통로가 아직 연결되지 않았습니다(주소나 토큰이 설정되지 않았습니다).",
  timeout: "재고 관리가 응답하지 않습니다.",
  unauthorized: "재고 관리가 토큰을 받지 않았습니다. 양쪽 토큰 값을 맞춰야 합니다.",
  api_closed: "재고 관리 쪽에서 통로가 닫혀 있습니다(저쪽 토큰이 설정되지 않았습니다).",
  error: "재고 관리에서 불러오지 못했습니다.",
};

export function inventoryUnreachableMessage(reason: InventoryUnreachableReason): string {
  return INVENTORY_UNREACHABLE_MESSAGES[reason];
}

// ---------------------------------------------------------------------------
// 유상 · 무상
// ---------------------------------------------------------------------------

/**
 * 🔴 **기본값이 없다.** 저쪽 통로도 빠지거나 모르는 값이면 400 으로 거절한다(API.md 4-2절) —
 * 청구에 걸리는 값이라 한쪽으로 채워 주지 않는다. 화면도 같은 잣대로 막는다.
 */
export const CHARGE_TYPES = ["PAID", "FREE"] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const CHARGE_TYPE_LABELS: Record<ChargeType, string> = {
  PAID: "유상",
  FREE: "무상",
};

export function isChargeType(value: unknown): value is ChargeType {
  return value === "PAID" || value === "FREE";
}

// ---------------------------------------------------------------------------
// 올리는 줄 — 모양 검사 (올리는 통로가 받는 모양, API.md 4-2절)
// ---------------------------------------------------------------------------

/** 한 신청에 실을 수 있는 줄 수. 저쪽 화면 폼과 같은 상한이다(API.md 4-2절). */
export const MAX_STOCK_REQUEST_LINES = 50;
/** 한 줄의 수량 상한. 저쪽이 그 위를 400 으로 거절한다. */
export const MAX_STOCK_REQUEST_QUANTITY = 1_000_000;
/** 요청 번호(`requestKey`)의 글자 수 상한. 저쪽이 이 길이로 자르고 저장한다. */
export const MAX_REQUEST_KEY_LENGTH = 100;

export type StockRequestLine = { no: number; quantity: number; chargeType: ChargeType };

export type ParseStockRequestLinesResult =
  | { ok: true; lines: StockRequestLine[] }
  | { ok: false; message: string };

function partLabel(no: number, labels?: ReadonlyMap<number, string>): string {
  const name = labels?.get(no);
  return name ? `${name}(No. ${no})` : `부품 No. ${no}`;
}

/**
 * 올릴 줄들을 **저쪽이 받는 모양인지** 본다. 화면도 서버 액션도 **이 함수 하나**를 쓴다 —
 * 두 벌로 적으면 한쪽만 고치는 날 화면은 통과시키고 저쪽이 400 으로 돌려보낸다.
 *
 * 🔴 **유상/무상이 없으면 거절한다**(머리말). 기본값으로 채우지 않는다.
 * 🔴 **숫자는 숫자다.** `"165"` 처럼 글자로 온 숫자를 조용히 고쳐 주지 않는다 — 저쪽도
 *    받지 않는다(기계가 보내는 값이라 고쳐 주는 편이 더 위험하다). 화면 입력칸의 글자는
 *    부르는 쪽(`validateStockRequestCart`)이 숫자로 바꿔 넘긴다.
 * 🔴 **같은 부품이 두 줄이면 거절한다.** 저쪽도 거절하고, 합쳐 보내야 한다.
 */
export function parseStockRequestLines(
  raw: unknown,
  labels?: ReadonlyMap<number, string>
): ParseStockRequestLinesResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "요청할 부품을 1개 이상 추가해 주세요." };
  }
  if (raw.length > MAX_STOCK_REQUEST_LINES) {
    return { ok: false, message: `한 번에 ${MAX_STOCK_REQUEST_LINES}줄까지 올릴 수 있습니다.` };
  }

  const lines: StockRequestLine[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "요청할 부품 정보를 확인할 수 없습니다." };
    }
    const o = item as { no?: unknown; quantity?: unknown; chargeType?: unknown };
    const no = o.no;
    if (typeof no !== "number" || !Number.isInteger(no) || no < 1) {
      return { ok: false, message: "재고 관리의 부품 번호를 확인할 수 없습니다." };
    }
    if (seen.has(no)) {
      return { ok: false, message: `${partLabel(no, labels)}이(가) 두 줄입니다. 한 줄로 합쳐 주세요.` };
    }
    seen.add(no);

    const quantity = o.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_STOCK_REQUEST_QUANTITY) {
      return {
        ok: false,
        message: `${partLabel(no, labels)}의 수량은 1 이상 ${MAX_STOCK_REQUEST_QUANTITY.toLocaleString("ko-KR")} 이하의 정수여야 합니다.`,
      };
    }

    // 🔴 여기가 「유상/무상을 고르지 않으면 못 올린다」가 지켜지는 자리다.
    if (!isChargeType(o.chargeType)) {
      return { ok: false, message: `${partLabel(no, labels)}의 유상/무상을 골라 주세요.` };
    }

    lines.push({ no, quantity, chargeType: o.chargeType });
  }
  return { ok: true, lines };
}

/** 요청 번호의 모양. 저쪽이 1~100자 글자를 받는다(API.md 4-2절). */
export function isValidRequestKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_REQUEST_KEY_LENGTH;
}

// ---------------------------------------------------------------------------
// 부품 목록 (`GET /api/v1/parts`)
// ---------------------------------------------------------------------------

/**
 * 재고 관리의 부품 한 줄. 🔴 **바깥에서 부품을 가리키는 값은 `no`** 다(UUID 가 아니다).
 *
 * 🔵 `owner` 와 `note` 를 함께 들고 다니는 까닭: 같은 품명·도번·소유인 부품이 16묶음 있고
 *    (API.md 2절), 고르개에 품명만 보이면 똑같은 줄이 둘 뜬다. 구분 글자는 **비고**에 있다.
 */
export type InventoryPart = {
  no: number;
  name: string;
  name2: string;
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  quantity: number;
  note: string;
  /** 🔴 **보여 주기만 한다.** 번호를 고르는 순간 정해지는 값이지 고르는 값이 아니다(머리말). */
  owner: { code: string; label: string };
  /**
   * 견적가(언제나 원). 🔴 **`null` 은 「아직 정하지 않았다」이고 `0`(무상)과 다르다** —
   * 저쪽 API.md 2절이 그 둘을 갈라 적어 두었다. `?? 0` 으로 뭉개면 정하지 않은 부품이
   * 0원으로 청구되고, 받은 사람은 무상으로 약속받은 것으로 읽는다.
   */
  quotePrice: number | null;
  /** O/H 견적가(원). 같은 규칙이고, 🔴 없을 때 **견적가로 때우지 않는다**(아래 고르개 쪽). */
  overhaulQuotePrice: number | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function codeLabel(value: unknown): { code: string; label: string } {
  if (!value || typeof value !== "object") return { code: "", label: "" };
  const o = value as { code?: unknown; label?: unknown; name?: unknown };
  return { code: str(o.code), label: str(o.label) || str(o.name) };
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * 금액 한 칸. 🔴 **`0` 과 「없음」을 가른다** — 숫자면 그대로(0 도 값이다), 숫자가 아니면
 * (빠졌거나 `null` 이거나 글자면) 「정하지 않았다」다. `|| null` 꼴을 쓰면 무상으로 정해 둔
 * `0` 이 「안 정함」으로 뒤집힌다(저쪽 API.md 2절이 둘 다 못 박았다).
 */
function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 통로 응답(JSON) → 부품 목록. **모양이 아니면 `null`** 이다(머리말).
 *
 * 번호나 품명이 빈 줄은 **버린다** — 고르개에 올려 봐야 가리킬 수 없고, 올리면 저쪽이
 * 통째로 400 으로 돌려보낸다. 🔵 칸 이름이 바뀌면 이 함수 하나만 고친다.
 */
export function parseInventoryPartsResponse(json: unknown): InventoryPart[] | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as { parts?: unknown }).parts;
  if (!Array.isArray(raw)) return null;

  const parts: InventoryPart[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const no = positiveInt(o.no);
    const name = str(o.name);
    if (no === null || name === "") continue;
    parts.push({
      no,
      name,
      name2: str(o.name2),
      customerName: str(o.customerName),
      kyosanPartNo: str(o.kyosanPartNo),
      drawingNo: str(o.drawingNo),
      quantity: typeof o.quantity === "number" && Number.isFinite(o.quantity) ? o.quantity : 0,
      note: typeof o.note === "string" ? o.note : "",
      owner: codeLabel(o.owner),
      // 🔴 `?? 0` 도 `|| null` 도 쓰지 않는다 — 가르는 일은 money 한 곳에서 한다.
      quotePrice: money(o.quotePrice),
      overhaulQuotePrice: money(o.overhaulQuotePrice),
    });
  }
  return parts;
}

/** 비고의 **첫 줄**. 같은 품명이 여럿일 때 사람이 가르는 단서다(API.md 2절). */
export function inventoryPartNoteFirstLine(part: Pick<InventoryPart, "note">): string {
  return part.note.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

// ---------------------------------------------------------------------------
// 부품 요청 칸에 **그 부품의 모든 것**을 보인다 (2026-10-16 사용자 요청 B·C)
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 * 「값이 있는 것만」 — 🔴 `-` 는 값이 아니다
 * ============================================================================
 * 사용자 요청: 「부품 요청에 뜨는 정보가 그 부품의 **모든 것**(고객사 품명 · 품명 · 품명2 ·
 * 교산 품번 · 도번)이면 좋겠다.」 그대로 다 적으면 줄이 길어져 **아무것도 안 읽히는** 쪽으로
 * 망가진다. 그래서 거는 조건이 둘이다 —
 *
 *  ㉠ 🔴 **빈 칸은 그리지 않는다.** 「교산 품번 없음 · 도번 없음」이 줄줄이 적히면 정작 있는
 *     값이 묻힌다. 이 자료는 엑셀에서 넘어와 **빈칸 대신 `-` 가 적힌 줄이 많아서**, 다듬은
 *     글자가 비었는가만 봐서는 모자라다 — `-` 만 적힌 칸도 **없는 칸**으로 센다
 *     (`@dss/core` 의 `partFieldValue`. 재고 관리도 같은 자를 쓴다 — 저쪽 `DASH_ONLY`).
 *  ㉡ **이름표를 단다.** `KY-7788 · DWG-1001` 처럼 값만 이으면 어느 것이 교산 품번이고 어느
 *     것이 도번인지 모른다. 사람이 그 둘을 서로 다른 데 쓰므로 한 글자씩 붙여 둔다.
 *
 * 🔵 **그리는 모양은 화면이 정한다.** 여기서는 「무엇을 · 어떤 이름표로 · 어떤 차례로」까지만
 *    정하고, 줄을 어떻게 나눌지는 PartRequestSection 이 정한다 — 그 덕에 이 규칙에 React 가
 *    없는 시험이 붙는다.
 * ============================================================================
 */
export type InventoryPartLabel = { label: string; value: string };

/**
 * 그 부품의 **고객사 품명**. 없으면 빈 글자다 — 🔴 `-` 만 적힌 칸도 없는 것으로 센다(위 ㉠).
 *
 * 🔴 **우리 품명으로 때우지 않는다.** 이 값이 비었는지가 견적서에서 고를 수 있는지를 가르고
 *    (고르개의 `canPickPartOption`), 채워 넣는 길을 그릴지도 가른다. 때우면 둘 다 조용히
 *    막히거나 조용히 열린다.
 */
export function inventoryPartCustomerName(part: Pick<InventoryPart, "customerName">): string {
  return partFieldValue(part.customerName);
}

/**
 * 품명 곁에 적는 **나머지 이름들** — 교산 품번 · 도번. 값이 있는 것만 차례대로.
 *
 * 🔵 품명과 품명2 가 빠져 있는 까닭: 그 둘은 줄의 **머리**라 화면이 맨 앞에 따로 그린다
 *    (`품명 · 품명2`). 고객사 품명도 빠져 있다 — 그것만 **채워 넣는 길**이 딸려 있어서
 *    화면이 제 줄에 따로 그린다(위 `inventoryPartCustomerName`).
 */
export function inventoryPartIdLabels(
  part: Pick<InventoryPart, "kyosanPartNo" | "drawingNo">
): InventoryPartLabel[] {
  /* 🔴 **차례도 이름표도 여기서 짓지 않는다** — `PART_FIELD_ORDER` 가 정한 그대로다(요청 ③).
     🔵 넘기지 않은 칸은 빈 값이라 저쪽이 알아서 뺀다 — 여기서 거를 것이 없다. */
  return partFieldEntries({
    kyosanPartNo: part.kyosanPartNo,
    drawingNo: part.drawingNo,
  }).map((entry) => ({ label: entry.label, value: entry.value }));
}

/** 품명2(규격). 🔴 여기도 `-` 는 없는 것이다 — 품명 뒤에 ` · -` 가 붙으면 읽는 눈을 뺏는다. */
export function inventoryPartSpec(part: Pick<InventoryPart, "name2">): string {
  return partFieldValue(part.name2);
}

/**
 * ============================================================================
 * 🔴 재고 수는 **「지금 이 순간」이 아니다** (2026-10-16 요청 ④)
 * ============================================================================
 * 이 수는 화면을 **열 때** 재고 관리에서 한 번 받아 온 값이다. 그 뒤로 다른 사람이 같은
 * 부품을 가져갔을 수 있고, 이 화면은 그것을 모른다(`router.refresh()` 가 돌기 전까지).
 *
 * 🔴 **숫자만 적으면 「지금 3개 있다」로 읽힌다.** 그 수를 믿고 요청 수량을 정했다가 막상
 *    나갈 때 모자라면, 사람은 재고 관리가 틀렸다고 생각한다 — 틀린 것은 **이 화면이 그 수를
 *    언제 잰 것인지 말하지 않은 것**이다. 그래서 숫자 **바로 옆**에 적는다(칸 위 안내문에
 *    한 번 적어 두면 줄을 훑는 눈에는 안 닿는다).
 * 🔵 「현재 재고」라고 적지 않는 까닭도 같다 — 그것은 더 틀린 말이다.
 *
 * 🔵 찾은 줄과 담은 줄이 **같은 글자**를 쓴다. 한쪽만 꼬리말을 달면 「담은 줄의 수는 옛
 *    것이고 찾은 줄은 지금 것」으로 읽힌다 — 둘 다 같은 한 번의 응답에서 온 같은 값이다.
 * ============================================================================
 */
export const INVENTORY_STOCK_AS_OF_NOTE = "불러온 때 기준";

/** 줄에 적는 재고 글자. 🔴 **언제 잰 값인지가 숫자에 붙어 있다**(위 머리말). */
export function inventoryStockText(part: Pick<InventoryPart, "quantity">): string {
  return `재고 ${part.quantity}개(${INVENTORY_STOCK_AS_OF_NOTE})`;
}

/**
 * 고객사 품명이 **비어 있을 때** 그 자리에 적는 말. 🔴 「없음」으로 끝내지 않고 **채울 수 있다는
 * 것**까지 적는다 — 견적서에서 이 부품이 막히는 까닭이 바로 이 칸이고, 사람은 여기서 그것을
 * 고칠 수 있다(아래 채우기 단추). 까닭 없이 「없음」만 적으면 담당자를 찾아다니게 된다.
 */
export const CUSTOMER_NAME_EMPTY_NOTICE = "고객사 품명 없음 — 견적서에서 이 부품을 고를 수 없습니다";

/**
 * 채우기가 **덮지 않고 돌아왔을 때** 할 말(저쪽 `filled: false`). 🔴 **거절과 다른 말이다** —
 * 거절은 「보낸 값이 틀렸다」이고 이것은 「벌써 누가 채워 뒀다」라서, 사람이 할 일이 다르다
 * (앞은 고쳐 보내는 일, 뒤는 그대로 쓰면 되는 일). 🔵 지금 값은 **저쪽이 돌려준 그 값**이다 —
 * 우리가 보낸 값이 아니다(저쪽 API.md 7-3절).
 */
export function customerNameAlreadySetLines(part: { no: number; name: string; customerName: string }): string[] {
  return [
    `No. ${part.no} ${part.name} 의 고객사 품명은 이미 적혀 있습니다 — 「${part.customerName}」`,
    "덮어쓰지 않았습니다. 이 이름을 고쳐야 하면 재고 관리 담당자에게 말씀해 주세요.",
  ];
}

/**
 * 화면에서 거르기. 🔴 **저쪽 `q` 와 같은 규칙으로 잰다** — 품명 · 품명2 · 고객사 품명 ·
 * 교산 품번 · 도번에 낱말이 **모두** 들어 있는 줄(띄어쓰기로 여러 낱말, API.md 2절).
 *
 * 🔵 같은 규칙으로 적어 둔 까닭: 언젠가 `q` 를 서버에 넘기는 쪽으로 갈아타도 **나오는 줄이
 *    달라지지 않는다.** 규칙이 다르면 「재고 조회에서 되던 글자가 여기서는 안 된다」가 된다.
 *
 * 빈 글자는 **빈 목록**이다 — 수백 개를 통째로 펼쳐 놓지 않는다(지금 화면과 같다).
 */
export function filterInventoryParts(parts: readonly InventoryPart[], term: string): InventoryPart[] {
  const words = term.trim().toLowerCase().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [];
  return parts.filter((part) => {
    const haystack = [part.name, part.name2, part.customerName, part.kyosanPartNo, part.drawingNo]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

// ---------------------------------------------------------------------------
// 부품 고르개로 넘기는 줄 — 견적서의 「부품 비용」 · 수리 건의 「사용 부품」 (2026-10-16)
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 * 재고 관리의 부품 → 부품 고르개가 받는 줄
 * ============================================================================
 * 고르개(`@dss/core/ui/inventory/part-picker.tsx`)는 **줄을 받아 그리기만** 한다. 그 줄을
 * 어디서 읽어 오는가가 2026-10-16 에 바뀌었다 — A/S 제 부품 표(`parts`)에서 **재고 관리**로.
 * 부품 마스터를 재고 관리 하나로 모으기로 한 2026-10-02 결정이고, A/S 의 재고 표는 다음
 * 조각에서 걷어낸다. 그때 고르개가 그 표를 보고 있으면 **견적서와 사용 부품이 함께 멈춘다.**
 *
 * ── 🔴 **여기가 경계다** — 재고 · 소유 · 비고는 이 줄에 담지 않는다 ────────
 * `InventoryPart` 에는 수량 · 소유 · 비고가 들어 있다(부품 요청 칸이 쓰는 값이다). 그 셋은
 * 재고 담당의 정보라 견적서 · 사용 부품 화면으로 **내보내지 않는다** — 화면에서 안 그리는
 * 것으로는 모자라다. props 는 브라우저로 그대로 나가므로, **여기서 떼어 내야** 안 나간다
 * (고르개 머리말이 처음부터 못 박아 둔 그 경계다).
 *
 * ── 🔴 `id` 는 **재고 관리의 부품 번호(No.)** 다 ─────────────────────────
 * 바깥에서 부품을 가리키는 값이 그것이다(저쪽 API.md 2절 — UUID 는 내주지 않는다). 글자로
 * 담는 까닭은 고르개의 열쇠가 글자이기 때문이고, 단가 줄의 열쇠(`partId`)도 같은 값이다.
 * 🔴 **이 값은 A/S 의 `parts.id` 가 아니다.** 그래서 폼이 이것을 `part_id`(FK)에 넣지
 *    않는다 — 넣으면 저장이 거절된다(validation 이 UUID 를 본다).
 * ============================================================================
 */
export function toPartPickerRows(parts: readonly InventoryPart[]): PartPickerRow[] {
  return parts.map(toPartPickerRow);
}

/**
 * 부품 **하나**를 옮긴다. 🔴 **경계를 긋는 자리는 여기 하나다** — 위 머리말의 셋(재고 ·
 * 소유 · 비고)을 떼어 내는 일이 이 함수에서만 일어나야, 줄을 하나씩 옮기는 쪽
 * (`quote-intake-parts.ts` 의 출고 부품 · O/H 템플릿 줄)이 제 손으로 칸을 적다가
 * **실수로 하나를 더 실어 보내는** 일이 생기지 않는다.
 */
export function toPartPickerRow(part: InventoryPart): PartPickerRow {
  return {
    id: String(part.no),
    partName: part.name,
    partSpec: part.name2,
    /** 🔴 2026-10-16 에 거르는 칸으로 들어간 그 이름(저쪽 API.md 2절의 `customerName`). */
    customerPartName: part.customerName,
    drawingNo: part.drawingNo,
    kyosanPartNo: part.kyosanPartNo,
  };
}

/**
 * 받아 온 결과를 **갈래째** 옮긴다. 🔴 **못 받아 온 것을 빈 목록으로 바꾸지 않는다** —
 * 바꾸면 화면이 「고를 부품이 하나도 없다」고 거짓말하고, 사람은 그 말을 믿고 손으로 적는
 * 대신 「부품이 없어졌다」고 생각한다(이 파일 머리말의 그 규칙 그대로다).
 */
export function toPartPickerOptions(
  result: InventoryResult<InventoryPart[]>
): InventoryResult<PartPickerRow[]> {
  return result.status === "ok" ? { status: "ok", value: toPartPickerRows(result.value) } : result;
}

/**
 * 단가 줄 — 고르면 **단가 칸까지 채우는** 데 쓴다(견적서에만 있다).
 *
 * 🔴 **`null` 은 「정하지 않았다」라서 그대로 `null` 로 옮긴다.** 0 으로 채우면 그 부품이
 *    0원으로 청구되고, 빈칸과 달리 아무도 눈치채지 못한다. `0`(무상)은 `"0"` 으로 남는다.
 * 🔴 **둘 다 없는 부품은 아예 빼고 보낸다** — 고르개는 「줄이 없다 = 정하지 않았다」로 읽고
 *    단가 칸을 비워 둔다(고르개의 `partPickUnitPrice`). 수백 줄 중 단가가 있는 것만 실린다.
 * 🔵 숫자를 글자로 옮기는 까닭은 고르개가 DB 의 numeric(글자로 읽힌다)과 **같은 길**로
 *    다루기 때문이다 — `toPriceFieldValue` 가 소수점을 지워 칸에 넣는다.
 *
 * 🔴 **이 목록은 단가 칸이 있는 화면에만 넘긴다.** 사용 부품 칸은 금액을 다루지 않으므로
 *    받지 않는다 — 안 주면 고르개가 단가를 채우지 않는다(그 규약이 선택인 까닭).
 */
export function toPartPickerPriceRows(parts: readonly InventoryPart[]): PartPickerPriceRow[] {
  const rows: PartPickerPriceRow[] = [];
  for (const part of parts) {
    if (part.quotePrice === null && part.overhaulQuotePrice === null) continue;
    rows.push({
      partId: String(part.no),
      unitPrice: part.quotePrice === null ? null : String(part.quotePrice),
      overhaulUnitPrice: part.overhaulQuotePrice === null ? null : String(part.overhaulQuotePrice),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// O/H 부품 템플릿 (`GET /api/v1/oh-templates`)
// ---------------------------------------------------------------------------

export type InventoryOhTemplateItem = {
  displayOrder: number;
  /** 재고 마스터의 부품 번호. **`null` 이 정상이다** — 아래 `linked` */
  no: number | null;
  /** 템플릿에 적혀 있는 이름 그대로. 언제나 있다 — 안 이어진 줄에서 사람에게 보여 줄 이름이다. */
  name: string;
  /** 이어진 재고 부품의 **지금 품명**. 안 이어진 줄이면 `null`. 위 `name` 과 다를 수 있다. */
  partName: string | null;
  quantity: number;
  /**
   * 🔴 **재고 마스터에 이어져 있는가.** 거짓인 줄은 **담기지 않고 그 사실을 사람에게 알린다** —
   * 담은 줄만 보고 「다 담겼다」고 믿으면 정작 필요한 부품을 빠뜨린 채 요청이 나간다
   * (API.md 6-4절, 그리고 이 화면이 예전부터 해 오던 말 그대로).
   */
  linked: boolean;
};

export type InventoryOhTemplate = {
  id: string;
  name: string;
  note: string;
  items: InventoryOhTemplateItem[];
};

/**
 * 통로 응답(JSON) → 템플릿. 모양이 아니면 `null`.
 *
 * 🔴 **「템플릿이 없다」(`template: null`)는 오류가 아니다**(API.md 6-3절). 그래서 돌려주는
 *    값을 한 겹 싸서 「못 읽었다(`null`)」와 「이어 둔 템플릿이 없다(`{ template: null }`)」를 가른다.
 * 🔴 `linked` 는 번호가 있을 때만 참으로 본다. 저쪽은 둘이 언제나 같다고 적어 두었지만
 *    (6-4절), 그 약속이 깨지는 날 번호 `null` 을 담으려다 올리기가 통째로 400 이 된다.
 */
export function parseInventoryOhTemplateResponse(
  json: unknown
): { template: InventoryOhTemplate | null } | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as { template?: unknown }).template;
  if (raw === null || raw === undefined) return { template: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const o = raw as Record<string, unknown>;
  const rawItems = o.items;
  if (!Array.isArray(rawItems)) return null;

  const items: InventoryOhTemplateItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = str(e.name);
    if (name === "") continue;
    const no = positiveInt(e.no);
    const quantity = positiveInt(e.quantity) ?? 1;
    items.push({
      displayOrder: typeof e.displayOrder === "number" ? e.displayOrder : items.length + 1,
      no,
      name,
      partName: str(e.partName) === "" ? null : str(e.partName),
      quantity,
      linked: e.linked === true && no !== null,
    });
  }

  return {
    template: {
      id: str(o.id),
      name: str(o.name),
      note: typeof o.note === "string" ? o.note : "",
      items,
    },
  };
}

// ---------------------------------------------------------------------------
// 올린 신청의 지금 상태 (`GET /api/v1/stock-requests?intake=…`)
// ---------------------------------------------------------------------------

export type InventoryStockRequestLine = {
  /** 그 사이 재고 쪽에서 지워진 부품이면 `null` 이고 이름이 「(지워진 부품)」이다. */
  no: number | null;
  name: string;
  quantity: number;
  issued: number;
};

export type InventoryStockRequest = {
  /**
   * 🔴 **`null` 이면 재고 관리에서 직접 올린 신청이다**(A/S 쪽 요청 번호가 애초에 없다).
   * 그것도 그 수리 건에 나간 부품이라 **함께 보여 주되 그 사실이 보이게** 한다 —
   * 가려 내면 「이 건에 나간 부품」을 반만 보여 주게 된다(API.md 4-7절).
   */
  requestKey: string | null;
  id: string;
  intakeNumber: string;
  /** 🔴 `label` 은 **저쪽 화면에 뜨는 글자 그대로** 쓴다(머리말). */
  status: { code: string; label: string };
  /** 마감 — 「준 것은 그대로 두고 남은 것만 접은」 것. 상태값이 아니라 이 칸으로 가른다. */
  closed: boolean;
  requestedAt: string;
  lines: InventoryStockRequestLine[];
  decision: { byName: string; at: string; note: string } | null;
  hold: { reason: string; byName: string; at: string } | null;
  /**
   * 올린 사람. 🔴 **가리는 값은 포털 번호(`sub`)뿐이다** — 이름은 겹친다(같은 이름이 둘이면
   * 남의 신청을 제 것으로 본다). 그래서 `sub` 이 없으면 통째로 `null` 이고, 그런 줄은
   * 「누가 올렸는지 모른다」로 다룬다(`toScreenStockRequests` 가 `mine: false` 로 접는다).
   *
   * 🔴 **이 값은 서버에서만 본다.** 화면으로 내려보내는 모양(`InventoryStockRequestForScreen`)
   * 에는 `sub` 이 없다 — 신원을 증명하는 값이라 props 에 실으면 브라우저로 나간다.
   */
  requester: { sub: string; name: string } | null;
};

/**
 * 화면에 내려보내는 신청 한 줄. 🔴 **포털 번호가 빠져 있다** — 대신 서버가 「내 것인가」를
 * 미리 재어 `mine` 한 칸으로 넣는다(위 `requester` 머리말).
 */
export type InventoryStockRequestForScreen = Omit<InventoryStockRequest, "requester"> & {
  /** 올린 사람 이름. 없을 수 있다(저쪽이 안 주거나, 재고 관리에서 직접 올린 신청). */
  requesterName: string;
  /** 🔴 **지금 보고 있는 사람이 올린 신청인가.** 서버가 포털 번호로 잰 값이다. */
  mine: boolean;
};

function parseDecision(value: unknown): { byName: string; at: string; note: string } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const at = str(o.at);
  if (at === "") return null;
  return { byName: str(o.byName), at, note: typeof o.note === "string" ? o.note : "" };
}

/**
 * 올린 사람. 🔴 **포털 번호가 없으면 통째로 `null`** 이다 — 이름만으로 사람을 가르지 않는다.
 * 같은 이름이 둘이면 남의 신청에 [요청 취소]를 그려 주게 되고, 그 단추는 저쪽에서 거절당해
 * 「왜 내 신청을 못 거두지」가 된다.
 */
function parseRequester(value: unknown): { sub: string; name: string } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as { sub?: unknown; name?: unknown };
  const sub = str(o.sub);
  if (sub === "") return null;
  return { sub, name: str(o.name) };
}

function parseHold(value: unknown): { reason: string; byName: string; at: string } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const at = str(o.at);
  if (at === "") return null;
  return { reason: typeof o.reason === "string" ? o.reason : "", byName: str(o.byName), at };
}

/**
 * 통로 응답(JSON) → 신청 목록. 모양이 아니면 `null`(머리말).
 *
 * 🔵 **차례를 다시 매기지 않는다.** 저쪽이 「신청한 시각이 늦은 것이 위」로 주고(API.md 4-7절),
 *    수리 건 상세는 「방금 뭘 더 달라고 했지」를 맨 위에서 보는 화면이다. 여기서 또 정렬하면
 *    저쪽이 차례를 고치는 날 두 규칙이 싸운다.
 * 🔵 `notFound` 는 읽지 않는다 — 인수번호로 물을 때는 **언제나 빈 목록**이고, 그 칸은 열쇠로
 *    물을 때만 뜻이 있다(API.md 4-7절). 우리는 열쇠를 저장하지 않으므로 열쇠로 묻지 않는다.
 */
export function parseInventoryStockRequestsResponse(json: unknown): InventoryStockRequest[] | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as { requests?: unknown }).requests;
  if (!Array.isArray(raw)) return null;

  const requests: InventoryStockRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = str(o.id);
    if (id === "") continue;

    const rawLines = Array.isArray(o.lines) ? o.lines : [];
    const lines: InventoryStockRequestLine[] = [];
    for (const entry of rawLines) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      lines.push({
        no: positiveInt(e.no),
        name: str(e.name),
        quantity: typeof e.quantity === "number" ? e.quantity : 0,
        issued: typeof e.issued === "number" ? e.issued : 0,
      });
    }

    const requestKey = str(o.requestKey);
    requests.push({
      requestKey: requestKey === "" ? null : requestKey,
      id,
      intakeNumber: str(o.intakeNumber),
      status: codeLabel(o.status),
      closed: o.closed === true,
      requestedAt: str(o.requestedAt),
      lines,
      decision: parseDecision(o.decision),
      hold: parseHold(o.hold),
      requester: parseRequester(o.requester),
    });
  }
  return requests;
}

/**
 * 올린 신청 한 건이 **지금 끝난 것인가**. 끝난 것은 더 기다릴 일이 없다는 뜻이다.
 * 🔵 코드값 목록은 API.md 4-3절의 것이고, 모르는 코드는 **끝나지 않은 것으로** 본다 —
 *    저쪽이 상태를 더하는 날 조용히 「끝남」으로 접어 두는 것보다 낫다.
 */
export function isInventoryRequestSettled(request: Pick<InventoryStockRequest, "status">): boolean {
  return request.status.code === "CONFIRMED" || request.status.code === "REJECTED" || request.status.code === "CANCELLED";
}

// ---------------------------------------------------------------------------
// 거두기 — `POST /api/v1/stock-requests/cancel` (2026-10-16 에 통로가 열렸다)
// ---------------------------------------------------------------------------

/**
 * 🔴 **거둘 수 있는 상태는 「대기」 하나뿐이다.** 재고 담당자가 한 번이라도 손을 댄 신청
 * (일부 나감 · 확인 · 반려 · 보류 뒤 처리)은 낸 쪽이 되돌릴 수 없다 — 이미 창고에서 물건이
 * 움직였을 수 있기 때문이다.
 *
 * 🔵 **모르는 코드는 「못 거둔다」로 본다.** 위 `isInventoryRequestSettled` 는 반대쪽으로
 *    (모르면 「안 끝났다」) 접는데, 그쪽은 **보여 주는** 판정이고 이쪽은 **되돌릴 수 없는 일을
 *    여는** 판정이라 안전한 방향이 서로 반대다. 저쪽이 상태를 더하는 날 이 단추는 조용히
 *    안 그려지고, 사람은 담당자에게 말하면 된다(아래 안내 문구).
 */
const CANCELLABLE_STATUS_CODE = "PENDING";

/**
 * 이 줄에 [요청 취소]를 그릴 것인가. 넷이 모두 맞아야 한다 —
 *  ㉠ **내가 올린 것**(`mine`) · ㉡ **A/S 에서 올린 것**(`requestKey !== null`) ·
 *  ㉢ **아직 대기**(위) · ㉣ **마감되지 않은 것**.
 *
 * 🔴 **이것은 편의일 뿐 울타리가 아니다.** 진짜로 막는 자리는 둘이다 — 서버 액션(세션의
 * 포털 번호로 묻고, 그 열쇠가 **이 수리 건**의 것인지 본다)과 재고 관리 통로(없는 신청 ·
 * 본인 아님 · 대기 아님을 **각각 다른 말**로 거절한다). 이 함수는 「누르면 거절당할 단추」를
 * 미리 안 그려 주는 일만 한다.
 *
 * 🔵 `requestKey` 가 `null` 인 줄은 **재고 관리에서 직접 올린 신청**이라 우리가 거둘 열쇠가
 *    애초에 없다. 그 줄은 `mine` 도 참일 수 없지만(저쪽이 올린 사람을 그렇게 적을 리 없다)
 *    둘을 **따로** 본다 — 한쪽 약속이 바뀌어도 남의 신청이 열리지 않게.
 */
export function canCancelStockRequest(
  request: Pick<InventoryStockRequestForScreen, "requestKey" | "mine" | "status" | "closed">
): boolean {
  return (
    request.mine &&
    request.requestKey !== null &&
    request.status.code === CANCELLABLE_STATUS_CODE &&
    !request.closed
  );
}

/**
 * 받아 온 신청들을 **화면 모양으로** 바꾼다 — 🔴 포털 번호를 떼어 내고 「내 것인가」만 남긴다.
 *
 * `mySub` 이 `null`(포털로 들어온 적 없는 계정)이면 **전부 남의 것**이다. 비교할 값이 없는데
 * 참으로 두면 모든 줄에 단추가 그려지고, 누를 때마다 저쪽이 거절한다.
 */
export function toScreenStockRequests(
  requests: readonly InventoryStockRequest[],
  mySub: string | null
): InventoryStockRequestForScreen[] {
  const mine = typeof mySub === "string" && mySub.trim() !== "" ? mySub.trim() : null;
  return requests.map(({ requester, ...rest }) => ({
    ...rest,
    requesterName: requester?.name ?? "",
    mine: mine !== null && requester !== null && requester.sub === mine,
  }));
}

/**
 * 🔴 **그 열쇠가 이 수리 건의 신청인가.** 거두는 통로는 `requestKey` 하나로 신청을 찾으므로
 * (수리 건을 받지 않는다) **다른 건의 열쇠를 적어 보내면 저쪽은 그것을 거둬 준다.** 그 울타리는
 * 이쪽에만 둘 수 있다 — 서버 액션이 이 건의 인수번호로 신청 목록을 다시 받아 이 함수로 거른다.
 *
 * 🔵 `requestKey` 가 `null` 인 줄(재고 관리에서 직접 올린 신청)과는 **절대 맞지 않는다**.
 */
export function stockRequestKeyBelongsToCase(
  requests: readonly InventoryStockRequest[],
  requestKey: string
): boolean {
  const key = requestKey.trim();
  if (key === "") return false;
  return requests.some((request) => request.requestKey !== null && request.requestKey === key);
}

/** 이 건의 신청이 아닌 열쇠가 왔을 때. 🔴 「취소됐습니다」처럼 보이게 하지 않는다. */
export const STOCK_REQUEST_NOT_IN_CASE_MESSAGE =
  "이 수리 건에 올라간 신청이 아닙니다. 화면을 새로고침한 뒤 다시 눌러 주세요.";

/**
 * 거둘 수 **없는** 줄에 할 말. 🔴 **지우지 않는다** — 통로가 열렸어도 거둘 수 있는 줄은
 * 「내가 올린, 아직 대기인」 신청뿐이다(`canCancelStockRequest`). 이미 재고 담당자가 손을
 * 댄 신청과 남이 올린 신청은 여전히 이 화면에서 못 거두고, 그때 어디로 가야 하는지가 이 한
 * 줄이다. 까닭을 적지 않고 단추만 없으면 사람은 제 화면이 고장 난 줄 안다.
 */
export const STOCK_REQUEST_CANCEL_NOTICE =
  "[요청 취소]가 없는 줄은 이 화면에서 거둘 수 없습니다 — 이미 재고 관리에서 처리가 시작됐거나, 다른 사람이 올렸거나, 재고 관리에서 직접 올린 신청입니다. 그런 신청은 재고 관리 담당자에게 말씀해 주세요.";

/**
 * 포털 번호가 없는 사람에게 할 말. 🔴 **고치는 길까지 적는다** — 「올릴 수 없습니다」만
 * 적으면 사람은 제 계정이 망가진 줄 알고 담당자를 찾아다닌다(저쪽 저장소의
 * `noSsoSubjectSaveMessage` 와 같은 판단이다).
 *
 * 🔵 **순수 모듈에 둔 까닭**: 화면(서버 컴포넌트)과 서버 액션이 **같은 말**을 해야 하는데,
 *    액션 파일은 `"use server"` 라 async 함수 말고는 내보낼 수 없다. 글자를 거기 두면
 *    화면이 쓸 수 없어 두 벌이 생긴다.
 */
export const NO_PORTAL_ID_MESSAGE =
  "통합 로그인으로 들어온 적이 없는 계정이라 재고 관리에 요청을 올릴 수 없습니다. 통합 로그인으로 한 번 들어온 뒤에 다시 눌러 주세요.";
