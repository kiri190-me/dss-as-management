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
import { partFieldEntries, partFieldValue, type PartFieldEntry } from "@dss/core/ui/inventory/part-picker-rows";

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

/**
 * 올릴 줄 하나.
 *
 * 🔴 **`fromOhTemplate` 는 통로로 나가는 칸 이름 그대로다** (2026-10-22). 이 객체가 그대로
 *    `POST /api/v1/stock-requests` 의 본문에 실리므로(`lib/server/inventory-gateway.ts` 가
 *    `lines: input.lines` 로 넘긴다), **여기 적은 글자가 곧 저쪽이 받는 글자**다. 그 글자를
 *    정해 둔 자리는 `lib/domain/inventory-contract.ts` 의 `INVENTORY_OH_LINE_FIELD` 하나이고,
 *    재고 관리가 같은 글자를 쓰는지는 `scripts/check-inventory-contract.ts` 가 두 저장소를
 *    맞대어 잰다 — 🔴 어긋나도 **아무 오류가 안 난다**(저쪽이 못 읽은 칸을 조용히 거짓으로
 *    떨어뜨려 딱지만 영영 안 뜬다).
 */
export type StockRequestLine = {
  no: number;
  quantity: number;
  chargeType: ChargeType;
  /**
   * **[O/H 부품 한 번에 담기]로 담긴 줄인가** — 담긴 **그 순간**의 사실이다(스냅샷).
   *
   * 🔴 **나중에 다시 계산하지 않는다.** 「지금 O/H 템플릿에 그 부품이 있나」로 재면 템플릿이
   *    바뀐 날 옛 신청의 표시가 조용히 달라지고, 같은 부품을 **손으로** 담은 줄까지 O/H 로
   *    보이게 된다. 쓰는 분의 말이 「**[O/H 부품 한 번에 담기]를 하면**」이다.
   * 🔵 **거짓도 그대로 보낸다**(칸을 빼지 않는다) — 수리 건의 종류(`workflowKind`)와 다르다:
   *    저쪽은 「모른다」가 있지만 여기는 아니다. 담은 자리가 어디였는지는 화면이 언제나 안다.
   */
  fromOhTemplate: boolean;
};

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
    const o = item as { no?: unknown; quantity?: unknown; chargeType?: unknown; fromOhTemplate?: unknown };
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

    /**
     * 🔴 **O/H 표시는 「고르지 않으면 못 올린다」가 아니다**(위 유상/무상과 일부러 다르다).
     *    참이 아니면 전부 거짓으로 눕힌다 — 이 값으로 달라지는 일이 **화면의 딱지 하나뿐**이고,
     *    여기서 거절하면 담지도 않은 사람이 부품을 못 받는다. 저쪽도 같은 쪽으로 눕힌다.
     * 🔵 **칸은 언제나 선다** — 거짓도 그대로 실려 나간다(위 타입 주석).
     */
    lines.push({ no, quantity, chargeType: o.chargeType, fromOhTemplate: o.fromOhTemplate === true });
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

/**
 * 같은 모양이되 🔴 **「없음」을 `null` 로 가른다.**
 *
 * 🔵 위 `codeLabel` 은 **언제나 있는 칸**(부품의 소유처럼)에 쓴다 — 거기서는 빈 글자가 와도
 *    화면이 그냥 비워 두면 그만이다. 이쪽은 **없는 것이 정상인 칸**에 쓴다(지워진 부품의
 *    소유 · 반출이 아닌 줄의 유상/무상). 🔴 그 둘을 한 함수로 다루면 `{ code: "", label: "" }`
 *    이 「값이 있다」로 세어져 **글자 없는 빈 딱지**가 화면에 선다 — 이 조각이 지키려는
 *    「값이 없으면 빈 자리를 만들지 않는다」가 바로 거기서 깨진다.
 * 🔴 **코드가 없으면 통째로 `null`** 이다. 글자만 오고 코드가 없는 값은 가릴 수도 그릴 수도
 *    없는 값이라(`parseRequester` 가 포털 번호에 거는 그 잣대와 같다) 없는 것으로 본다.
 */
function codeLabelOrNull(value: unknown): { code: string; label: string } | null {
  if (!value || typeof value !== "object") return null;
  const o = value as { code?: unknown; label?: unknown; name?: unknown };
  const code = str(o.code);
  if (code === "") return null;
  return { code, label: str(o.label) || str(o.name) };
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

/**
 * 올린 신청의 줄 하나.
 *
 * ── 🔴 **부품의 것과 줄의 것이 섞여 있다. 뭉뚱그리지 마라** (2026-10-21) ──
 * **소유구분은 부품을 따라간다** — 어느 신청에서 보든 같은 값이다. **유상/무상은 그 줄의
 * 값이다** — 같은 부품이라도 신청마다, 한 신청 안에서도 **줄마다 다를 수 있다.** 그래서
 * 아래 딱지를 만드는 함수 둘은 **받는 칸이 갈려 있다**(`Pick<…, "owner">` ↔
 * `Pick<…, "chargeType">`): 소유만 들고 유상/무상을 물을 수 없고 그 반대도 안 된다.
 * 🔴 한 함수로 합치면 「이 **부품**은 유상인가요?」라는 **답이 없는 물음**이 생기고, 틀리면
 *    비용이 잘못 간다. 재고 관리도 같은 가름을 타입으로 세워 두었다(저쪽 API.md 4-7절).
 */
export type InventoryStockRequestLine = {
  /** 그 사이 재고 쪽에서 지워진 부품이면 `null` 이고 이름이 「(지워진 부품)」이다. */
  no: number | null;
  name: string;
  quantity: number;
  issued: number;
  /**
   * 그 부품을 **알아보는 값 넷** (2026-10-21 에 저쪽 통로가 넓어졌다).
   *
   * 🔵 **왜 필요한가**: 같은 품명인 부품 묶음이 16개 있어서(저쪽 API.md 2절) 신청 줄에
   *    품명만 떠 있으면 **어느 것인지 가릴 수 없었다.** 재고 관리 화면은 2026-10-16 부터
   *    이 넷을 그리고 있었는데, A/S 로 나오는 통로만 네 칸을 안 옮겨 적고 있었다.
   * 🔴 **없으면 빈 글자**이고, 지워진 부품이면 넷 다 빈 글자다.
   * 🔴 **`-` 만 적힌 칸은 저쪽도 다듬지 않고 그대로 준다** — 값으로 셀지 말지는 보는 쪽이
   *    정하는 일이고, 그 자는 이 저장소에 이미 하나 있다(`partFieldValue`). 아래
   *    `stockRequestLineCustomerName`·`stockRequestLineDetails` 가 그것을 쓴다.
   */
  customerName: string;
  name2: string;
  kyosanPartNo: string;
  drawingNo: string;
  /**
   * **소유구분** — 🔴 **부품의 속성이다**(위 머리말).
   *
   * 🔴 **지워진 부품이면 `null`** 이다. 저쪽이 「DSS」 같은 기본값을 지어내지 않고, 이쪽도
   *    그때 **아무것도 안 그린다** — `-` 를 적으면 「소유가 없는 부품」처럼 읽히는데 참말은
   *    「부품을 못 찾았다」이고 그것은 품명 칸이 이미 말하고 있다.
   * 🔵 `{ code, label }` 모양은 부품 목록의 `owner` 와 같다 — 글자는 **저쪽이 준 것을 그대로**
   *    쓴다(이 파일 머리말).
   */
  owner: { code: string; label: string } | null;
  /**
   * **유상/무상** — 🔴 **그 줄의 값이다**(위 머리말).
   *
   * 🔴 **`null` 이 정상인 자리가 있다** — 반출이 아닌 신청(재고 관리에서 올린 대여·폐기)의
   *    줄에는 처음부터 없는 칸이다. **못 찾은 것이 아니라 없는 것**이라, 그때 딱지도 안 선다.
   * 🔵 A/S 가 올리는 신청은 전부 반출이고 줄마다 이 값을 반드시 실어 보내므로(`parseStockRequestLines`),
   *    우리가 올린 신청에서는 언제나 들어 있다.
   */
  chargeType: { code: string; label: string } | null;
  /**
   * **[O/H 부품 한 번에 담기]로 담긴 줄인가** — 🔴 **올릴 때 우리가 보낸 값을 되받은 것**이다
   * (2026-10-22, 쓰는 분 요청).
   *
   * ── 🔴 **왜 되받아야 하는가** ───────────────────────────────────────────
   * A/S 는 재고에 관한 것을 **제 표에 하나도 저장하지 않는다**(이 모듈 머리말). 올리고 나면 장바구니는
   * 비워지고, 아래 「이 수리 건의 반출 신청」 목록은 전부 저쪽에서 받은 것으로 그린다 — 되받지
   * 못하면 **담는 중에는 보이던 딱지가 올리는 순간 사라진다.**
   *
   * ── 🔴 **없으면 「O/H 아님」이고, 그것이 깨짐이 아니다** ─────────────────
   * 2026-10-22 전에 올라간 신청, 재고 관리에서 직접 올린 신청, 반출이 아닌 신청에는 이 칸이
   * 아예 없다. 위 `owner`·`chargeType` 처럼 `null` 로 가르지 않는 까닭: **가를 수 있어도 화면이
   * 하는 일이 같다**(어느 쪽이든 딱지를 안 그린다). 🔴 **「일반」 딱지를 만들지 않는 까닭도
   * 그것이다** — 값이 없던 때의 신청이 「확인해 보니 일반 부품」으로 단정돼 보인다.
   */
  fromOhTemplate: boolean;
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
  /**
   * **요청 비고** — 🔴 **요청한 사람이 신청할 때 적은 말**이다 (2026-10-22).
   *
   * ── 🔴 **없으면 `null` 이 아니라 빈 글자다** ─────────────────────────────
   * 이웃한 `decision`·`hold` 는 **「일어났나 안 일어났나」**라서 안 일어났으면 `null` 이지만,
   * 이 값은 **적힌 말**이다. 「안 적었다」와 「빈 글을 적었다」는 사람에게 같은 일이라, 받는
   * 쪽이 `null` 검사와 빈 글자 검사를 **둘 다** 하게 만들 까닭이 없다 — 한 가지로 묻는다.
   * 🔵 **빈 것이 정상인 자리가 많다**: 안 적고 올린 신청, 비고 칸이 생기기 전(2026-10-22)에
   *    올라간 옛 신청, 재고 관리에서 직접 올린 신청은 전부 빈 글자다.
   *
   * ── 🔴 **`decision.note` 와 다른 사람의 말이다** ─────────────────────────
   * 이쪽은 **요청한 사람**이 적은 말이고, 저쪽은 **재고 담당자**가 적은 말이다(반려·마감 사유).
   * 한 신청에 **둘 다** 있을 수 있어서 화면이 제목을 붙여 가른다 — 재고 관리도 같은 까닭으로
   * 제 화면에 「요청 비고 (신청한 사람이 적은 말)」이라고 적는다(저쪽 `IssueApprovalScreen`).
   *
   * 🔵 **저쪽이 아직 이 칸을 안 보내도 안 터진다** — 아래 파서가 빈 글자로 떨어뜨린다.
   */
  note: string;
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
        /* 🔵 **다듬지 않고 그대로 담는다**(`str` 은 앞뒤 공백만 뗀다) — `-` 를 값으로 셀지는
           그리는 자리의 일이고, 그 자는 `partFieldValue` 하나다(위 타입 주석). */
        customerName: str(e.customerName),
        name2: str(e.name2),
        kyosanPartNo: str(e.kyosanPartNo),
        drawingNo: str(e.drawingNo),
        /* 🔴 **없는 것과 빈 것을 가른다** — 지워진 부품의 소유도, 반출이 아닌 줄의 유상/무상도
           `null` 이 참말이다. 빈 `{ code, label }` 로 두면 글자 없는 딱지가 선다. */
        owner: codeLabelOrNull(e.owner),
        chargeType: codeLabelOrNull(e.chargeType),
        /* 🔴 **참일 때만 참이다** — 칸이 없는 옛 신청도, 글자 `"true"` 도 전부 거짓으로 눕는다.
           이 글자(`fromOhTemplate`)가 저쪽이 보내는 칸 이름과 어긋나면 **오류 없이 딱지만
           영영 안 뜬다** — 그래서 점검 도구가 두 저장소를 맞대어 잰다(`inventory-contract.ts`). */
        fromOhTemplate: e.fromOhTemplate === true,
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
      /* 🔵 **이미 있는 자를 쓴다** — `str` 하나가 셋을 다 한다: 글자가 아니거나 칸이 없으면
         빈 글자, 있으면 **앞뒤 공백만** 뗀다(가운데 줄바꿈은 적은 사람의 것이라 살려 둔다).
         🔴 `decision`·`hold` 처럼 `null` 로 가르지 않는 까닭은 위 타입 주석에 있다. */
      note: str(o.note),
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

/**
 * ============================================================================
 * 🔴 「이 수리 건에 부품 요청 흔적이 있는가」 — **있다 · 없다 · 모른다** (2026-10-28)
 * ============================================================================
 * 쓰는 분의 판정 그대로다: 「수리건 상세의 [부품 요청] 칸에 **반출신청된 어떤 흔적이라도**
 * 있으면 부품요청을 했었다고 판단한다.」 연락서 이식이 교체 부품을 사용 부품 칸에 덮어쓸지
 * 말지를 이 판정 하나로 가른다(`server/services/kyosan-report-import.ts`).
 *
 * ── 🔴 상태로 거르지 않는다 ──────────────────────────────────────────────
 * 취소된 신청도 반려된 신청도 **흔적**이다. 「이 건에 무엇이 나갔나」를 보는 그 칸이 상태를
 * 가리지 않고 **전부 그리기** 때문이고(`PartRequestSection` 의 목록), 사람이 그 칸에서 보는
 * 것과 서버가 세는 것이 다르면 「요청한 적이 있는데 왜 덮어썼지」가 된다.
 * 🔵 그래서 이 함수는 **줄의 내용을 한 칸도 쳐다보지 않는다** — 형이 `T` 인 까닭이 그것이다.
 *    화면이 받는 모양(`…ForScreen`)과 서버가 받는 모양이 달라도 **같은 자**로 잰다.
 *
 * ── 🔴 「모른다」를 「없다」로 바꾸지 않는다 ──────────────────────────────
 * 이 파일 머리말의 그 규칙이 **가장 비싸게** 걸리는 자리다. 저쪽이 잠깐 멈춘 사이에 「없다」로
 * 읽으면 **이미 부품을 받아 간 건의 사용 부품이 연락서 내용으로 덮어써진다** — 지워진 줄을
 * 되짚는 길은 감사 이력뿐이고, 아무도 그 사고를 신고하지 않는다(오류가 안 난다). 그래서
 * 갈래가 둘이 아니라 셋이다.
 * ============================================================================
 */
export type InventoryPartRequestTrace =
  /** 신청이 한 건이라도 있다. 🔴 상태는 보지 않는다(취소·반려도 든다). */
  | { kind: "present"; count: number }
  /** 저쪽이 **빈 목록**을 주었다 — 「없다」는 사실이다. */
  | { kind: "absent" }
  /** 🔴 못 물어봤다. **「없다」가 아니다.** */
  | { kind: "unknown"; reason: InventoryUnreachableReason };

export function resolveInventoryPartRequestTrace<T>(
  requests: InventoryResult<readonly T[]>
): InventoryPartRequestTrace {
  if (requests.status !== "ok") return { kind: "unknown", reason: requests.reason };
  return requests.value.length === 0
    ? { kind: "absent" }
    : { kind: "present", count: requests.value.length };
}

/**
 * ============================================================================
 * 🔴 「**실제로 나간 것**이 있는가」 — 바로 위와 **다른 자**다 (2026-10-29 사용자 결정)
 * ============================================================================
 * 위 `resolveInventoryPartRequestTrace` 가 재는 것은 **「요청한 적이 있나」**다(취소된
 * 신청도 반려된 신청도 흔적이다). 이것이 재는 것은 **「물건이 나갔나」**다 — 줄의 불출
 * 수량(`issued`)이 **1 이상인 줄**이 하나라도 있나.
 *
 * ── 🔴 왜 자가 둘이어야 하는가 ──────────────────────────────────────────
 * **서로 다른 물음**이기 때문이다. 연락서 이식은 「사람이 부품 요청을 했었나」를 묻고(했으면
 * 그 건의 교체 부품은 요청서 쪽 기록이라 덮지 않는다), [사용 부품] 칸의 문지기는 「이미 나간
 * 부품이 또 세어질까」를 묻는다. **반려·취소만 되고 한 개도 안 나간 건**은 앞 물음에 「예」,
 * 뒤 물음에 「아니오」다 — 한 자로 두 물음에 답하면 그 건에서 반드시 한쪽이 틀린다.
 *
 * 🔴 그 건을 뒤 물음에서도 「있다」로 읽으면 **그 건의 부품이 어디에도 안 잡히고 적을 자리도
 *    없는 구멍**이 된다: 나간 것이 없으니 [고장 부품] 그래프의 반출 입력에도 안 들어가고
 *    (그쪽도 `issued >= 1` 로 센다 — `domain/product-model-fault-parts.ts` 의
 *    `issuedPartRowsOf`), 손으로 적을 칸은 막혀 있다. A/S 옛 표 쪽 판정
 *    (`db/queries/repair-case-used-parts.ts` 의 `livePartRequestCondition`)이 `REJECTED` ·
 *    `CANCELLED` 를 빼 온 까닭이 처음부터 그 구멍이었다 — 이 자가 두 시스템의 잣대를
 *    **같은 뜻**으로 맞춘다(둘 다 「실제로 효력이 있는 것만」).
 *
 * ── 🔴 상태로 거르지 않는다 — **줄로** 가른다 ───────────────────────────
 * `PARTIAL`(일부 나감)인 **한 신청 안에서도 나간 줄과 안 나간 줄이 섞여 있다.** 신청 단위로
 * 가리면 그런 신청에서 둘 중 한쪽을 반드시 틀린다. 🔵 `REJECTED` · `CANCELLED` 는 나간 것이
 * 없으므로 **저절로 빠진다** — 뺄 상태 목록을 여기 적지 않는 까닭이고, 저쪽이 상태를 더하는
 * 날에도 이 자는 안 어긋난다.
 *
 * ── 🔴 「모른다」는 **그대로 셋째 갈래**다 ───────────────────────────────
 * 위 자와 같다(이 파일 머리말). 못 물어본 것을 「안 나갔다」로 눕히면 이미 나간 부품을 손으로
 * 또 적는 길이 열리고, 그 중복은 오류 없이 그래프의 **조용히 틀린 수**로만 드러난다.
 *
 * 🔵 **형을 돌려 쓰지 않고 따로 세운 까닭**: 갈래 이름은 같아도 `present` 가 **다른 것을
 *    센다**(신청 건수 ↔ 나간 줄 수). 한 형으로 두면 두 자를 서로 바꿔 넣어도 tsc 가 침묵하고,
 *    그날 [사용 부품] 칸은 「요청만 해도 막히는」 옛 자로 조용히 돌아간다.
 * ============================================================================
 */
export type InventoryIssuedPartsTrace =
  /** 🔴 **나간 줄이 있다.** `issuedLineCount` 는 그 **줄 수**다(나간 수량의 합이 아니다). */
  | { kind: "present"; issuedLineCount: number }
  /** 신청이 있든 없든 **한 개도 안 나갔다** — 저쪽이 200 으로 준 **사실**이다. */
  | { kind: "absent" }
  /** 🔴 못 물어봤다. **「안 나갔다」가 아니다.** */
  | { kind: "unknown"; reason: InventoryUnreachableReason };

/**
 * 🔵 **줄의 `issued` 하나만 본다** — 그래서 형이 `T` 로 열려 있다. 화면이 받는 모양
 * (`InventoryStockRequestForScreen`)이든 서버가 받는 모양(`InventoryStockRequest`)이든
 * **같은 자**로 재야, 화면이 여는 조건과 서버가 받아 주는 조건이 갈리지 않는다.
 */
export function resolveInventoryIssuedPartsTrace<
  T extends { lines: readonly { issued: number }[] },
>(requests: InventoryResult<readonly T[]>): InventoryIssuedPartsTrace {
  if (requests.status !== "ok") return { kind: "unknown", reason: requests.reason };

  let issuedLineCount = 0;
  for (const request of requests.value) {
    for (const line of request.lines) {
      /* 🔴 **거르는 식**은 [고장 부품] 그래프와 같다(`issuedPartRowsOf` — `issued >= 1`).
         🔴 **세는 자는 다르다**: 여기는 **줄 수**라 5개가 나간 줄도 한 줄이고, 그래프는
            2026-10-29 부터 **수량**을 센다(사용자 요청). 이 값이 하는 일은 「사용 부품 칸을
            열까 말까」 하나뿐이라 몇 개가 나갔는지가 상관없고, 그래프가 답하는 물음은
            「몇 개가 나갔나」다. 🔵 거르는 식만 같으면 두 자리가 **같은 줄 집합**을 본다. */
      if (line.issued >= 1) issuedLineCount += 1;
    }
  }
  return issuedLineCount === 0 ? { kind: "absent" } : { kind: "present", issuedLineCount };
}

// ---------------------------------------------------------------------------
// 반출 신청 줄의 **꾸밈** — 상태 배지 · 수량 · 부품 덩어리 (2026-10-21 쓰는 분 요청 셋)
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 * 🔴 수리 건 상세의 「이 수리 건의 반출 신청」이 **너무 수수하다** (2026-10-21)
 * ============================================================================
 * 쓰는 분이 화면을 눈으로 보고 짚은 것 셋 —
 *  ① **부품별 구분감이 없다** — 부품 하나가 석 줄까지 늘어나는데 간격만으로 벌려 뒀다.
 *  ② **요청·불출 수량이 안 띈다** — 그 줄의 요점이 숫자인데 이름과 같은 크기·같은 색이다.
 *  ③ **지금 상태가 안 띈다** — 「대기」·「반려」·「마감」이 그냥 굵은 글씨다.
 *
 * ── 🔵 **꾸밈이 왜 화면이 아니라 여기 사는가** ──────────────────────────
 * 부르는 자리가 서버 액션을 부르는 클라이언트 컴포넌트라 이 환경에서 **그려 볼 수 없다**
 * (`part-request-section-wiring.test.ts` 머리말). 꾸밈을 화면 안에 흩으면 「색 말고도
 * 갈리는가」·「다크 짝이 붙어 있는가」를 **아무도 돌려 보지 못한다.** 바로 아래 딱지 둘이
 * 같은 까닭으로 여기 살고, 이 셋도 그 결을 따른다.
 *
 * ── 🔴 **고르는 자리는 한 곳** ──────────────────────────────────────────
 * 화면은 상수를 그대로 붙이거나 `stockRequestStatusBadge` 를 부르기만 한다. 한 군데라도
 * 화면에서 덧칠하기 시작하면 「색 말고도 갈리는가」를 재는 자리가 둘로 쪼개진다.
 * ============================================================================
 */

/**
 * 상태 배지의 **뼈대** — 색이 들어가기 전의 모양.
 *
 * 🔵 한 곳에 둔 까닭: 크기·둥글기를 색표마다 따로 적으면 배지가 저마다 다른 치수로 갈린다.
 * 🔵 `text-[11px]` 인 까닭: 이 칸은 수리 건 상세 안의 **좁은 구역**이라, 배지를 키우면 같은
 *    줄에 선 날짜와 [요청 취소] 단추가 다음 줄로 밀린다(머리줄이 `flex-wrap` 이다).
 */
export const STOCK_REQUEST_STATUS_BADGE_SHAPE =
  "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-tight";

/** 저쪽이 쓰는 상태 코드(API.md 4-3절). 🔵 **배지 색표의 열쇠**이자 「모르는 값」을 가르는 자다. */
const STOCK_REQUEST_STATUS_CODES = [
  "PENDING",
  "IN_APPROVAL",
  "CONFIRMING",
  "PARTIAL",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
  "ON_HOLD",
] as const;
export type StockRequestStatusCode = (typeof STOCK_REQUEST_STATUS_CODES)[number];

/**
 * 상태별 배지 색 — 🔴 **재고 관리와 같은 색조**, 다만 **베낀 것이 아니다**.
 *
 * ── 🔵 왜 맞추는가 ──────────────────────────────────────────────────────
 * **같은 신청을 두 화면이 그린다**(저쪽 [부품 요청] 관리 화면 · 이쪽 [부품 요청] 칸). 색조가
 * 어긋나면 두 화면을 오가는 사람이 같은 것을 다른 것으로 읽는다. 그래서 색조는 저쪽 표를
 * 읽고 맞췄다 — `dss-inventory/src/lib/stock/codes.ts` 의 `REQUEST_STATUS_BADGE`(2026-10-21 판):
 * 대기 **주황** · 결재 중 **남색** · 처리 중 **회색** · 일부 나감 **파랑** · 확인됨 **초록** ·
 * 반려 **빨강** · 취소 **옅은 회색** · 보류 **보라**.
 *
 * ── 🔴 왜 글자값까지 베끼지는 않는가 ────────────────────────────────────
 * 저쪽은 **다크 모드가 없고**(그 표 머리말에 「`dark:` 만 뺐다」고 적혀 있다) 이쪽은 있다.
 * `bg-amber-100 text-amber-800` 을 그대로 옮기면 어두운 화면에서 글자가 배경에 잠긴다.
 * 그래서 **뜻(색조)만 가져오고 값은 이 집 말로 다시 지었다** — 다크 짝까지 한 줄에 묶어서.
 *
 * ── 🔴 **색 말고도 갈린다 — 「아직 도는 신청」은 바탕이 차 있고 굵다** ────
 * 끝난 신청(확인됨 · 반려 · 취소)은 **바탕을 비우고 보통 굵기**로 둔다. 색을 전부 지워도
 * ⓐ 바탕이 차 있나 ⓑ 굵은가가 남고, 저쪽이 준 글자(「대기」·「반려」)까지 셋이 남는다.
 * 🔵 뜻도 맞는다 — 올린 사람이 이 목록에서 훑는 것은 「**뭐가 아직 안 나왔나**」이고, 칠해진
 *    배지만 눈에 걸리면 그 물음에 바로 답이 된다.
 * 🔴 가름을 **표에 구워 둔다**(함수가 다시 재지 않는다) — 저쪽이 글자와 색을 한 함수에서
 *    함께 고르는 것과 같은 까닭이다(「마감인데 초록」 같은 짝을 막는다). 대신 구워 둔 값이
 *    **이미 있는 자**(`isInventoryRequestSettled`)와 어긋나지 않는지를 시험이 **전수로** 본다.
 */
export const STOCK_REQUEST_STATUS_BADGE_CLASS: Record<StockRequestStatusCode, string> = {
  PENDING:
    "border-amber-300 bg-amber-100 font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
  IN_APPROVAL:
    "border-indigo-300 bg-indigo-100 font-semibold text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-200",
  CONFIRMING:
    "border-zinc-300 bg-zinc-200 font-semibold text-zinc-800 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100",
  PARTIAL:
    "border-blue-300 bg-blue-100 font-semibold text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
  CONFIRMED: "border-green-300 text-green-800 dark:border-green-700 dark:text-green-300",
  REJECTED: "border-red-300 text-red-700 dark:border-red-700 dark:text-red-300",
  CANCELLED: "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
  ON_HOLD:
    "border-violet-300 bg-violet-100 font-semibold text-violet-900 dark:border-violet-700 dark:bg-violet-950/60 dark:text-violet-200",
};

/**
 * **마감**된 신청의 배지 — 🔴 **상태값이 아니라 `closed` 칸으로 가린다.**
 *
 * 🔴 **색도 글자를 따라가야 한다.** 마감이면 저쪽이 `label` 자체를 「마감」으로 바꿔 보내면서
 *    (상태 코드는 `CONFIRMED` **그대로**다) **색도 함께** 바꾼다 — 글자와 색을 한 함수에서
 *    고르는 까닭이 「마감인데 초록」 같은 짝을 막는 것이다(저쪽 `requestStatusDisplay` 주석).
 *    여기서 `closed` 를 안 보면 **「마감」이라 쓰인 배지가 확인됨의 초록**으로 떠서, 같은
 *    신청을 두 저장소가 다른 색으로 그리게 된다. 그래서 이 칸을 **맨 먼저** 본다.
 * 🔵 색조는 저쪽 `CLOSED_REQUEST_BADGE`(주황) 그대로다. 바탕을 비우는 것은 **끝난 신청**이기
 *    때문이고(위 머리말), 덕분에 「대기」(찬 주황)와 「마감」(빈 주황)이 같은 색조 안에서도
 *    갈린다 — 색약인 눈에도 한쪽만 칠해져 있는 것은 보인다.
 * 🔴 **글자는 여기서 짓지 않는다** — 「마감」이라는 말은 저쪽이 보낸 `label` 에 이미 들어 있다.
 *    여기서 또 적으면 「마감 (마감)」이 된다(2026-10-21 에 실제로 그랬다).
 */
export const STOCK_REQUEST_STATUS_BADGE_CLOSED =
  "border-amber-400 text-amber-800 dark:border-amber-600 dark:text-amber-300";

/**
 * 🔴 **모르는 상태 코드의 배지** — 저쪽이 상태를 하나 더 만드는 날 쓰인다.
 *
 * 🔵 **테두리를 점선으로** 둔다 — 색이 아니라 **선의 모양**이라 흑백에서도 보이고, 「우리가
 *    모르는 값이다」가 한눈에 드러난다(아래 유상/무상 딱지가 쓰는 길과 같다).
 * 🔴 어느 쪽으로도 칠하지 않는 까닭: 모르는 상태를 「끝남」이나 「대기」처럼 칠하면 사람이
 *    **없는 사실**을 읽는다. 글자는 저쪽이 준 것을 그대로 그린다.
 */
export const STOCK_REQUEST_STATUS_BADGE_UNKNOWN =
  "border-dashed border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-200";

function isStockRequestStatusCode(code: string): code is StockRequestStatusCode {
  return (STOCK_REQUEST_STATUS_CODES as readonly string[]).includes(code);
}

/**
 * 이 신청의 상태 배지에 붙일 **꾸밈 한 줄**(뼈대 + 색).
 *
 * 🔴 **차례를 글자로 못 박는다 — ① 마감 ② 상태 표 ③ 모르는 값.** 저쪽이 같은 차례로 고른다
 *    (`requestStatusDisplay`). 적어 두지 않으면 마감된 줄이 「확인됨」 색으로 새는 날이 온다.
 * 🔴 **글자는 건드리지 않는다.** 이 함수가 돌려주는 것은 꾸밈뿐이고, 무슨 글자를 그릴지는
 *    `request.status.label || request.status.code` — 저쪽이 준 것 그대로다.
 * 🔵 **「실행 대기」는 못 가린다** — 저쪽은 결재가 끝나 실행만 남은 신청을 청록으로 그리는데
 *    (2026-10-21, `AWAITING_EXECUTION_REQUEST_BADGE`), 그것을 가르는 값은 결재건 잠금이고
 *    **통로가 그 칸을 내주지 않는다**(우리가 받는 것은 `status` 와 `closed` 둘뿐이다).
 *    그래서 이쪽에서는 「결재 중」과 같은 남색으로 선다 — 🔴 **글자는 저쪽이 보낸 「실행 대기」
 *    그대로**라 사람이 읽는 말은 틀리지 않는다. 색까지 맞추려면 통로가 칸을 하나 더 내줘야
 *    하고, 그것은 **저쪽과 약속을 고치는 일**이라 꾸밈 조각에서 할 일이 아니다.
 */
export function stockRequestStatusBadge(request: Pick<InventoryStockRequest, "status" | "closed">): string {
  const tone = request.closed
    ? STOCK_REQUEST_STATUS_BADGE_CLOSED
    : isStockRequestStatusCode(request.status.code)
      ? STOCK_REQUEST_STATUS_BADGE_CLASS[request.status.code]
      : STOCK_REQUEST_STATUS_BADGE_UNKNOWN;
  return `${STOCK_REQUEST_STATUS_BADGE_SHAPE} ${tone}`;
}

/**
 * 신청 줄의 **요청·불출 숫자** 꾸밈 — 🔴 **숫자에만** 들어간다 (요청 ②).
 *
 * 🔴 **글자는 한 자도 안 바뀐다.** 「요청」·「불출」도, 사이의 `/` 도, 앞의 `—` 도 그대로
 *    있다 — 바뀌는 것은 **어떻게 보이는가**뿐이다.
 * 🔴 **색만으로 가르지 않는다**: 숫자는 ⓐ **굵고** ⓑ 색이 들어가고, 이름표는 ⓒ **옅어진다**.
 *    색을 전부 지워도 「굵은 숫자 + 옅은 이름표」가 남는다.
 * 🔵 `tabular-nums` 인 까닭: 신청 하나에 부품이 대여섯 줄 붙을 수 있어서, 자릿수가 다른
 *    숫자가 들쭉날쭉하면 훑어 내리는 눈이 자꾸 멎는다.
 * 🔵 색은 **이 칸이 이미 「짚어 볼 값」에 쓰는 파랑**이다(찾은 줄의 도번 · 재고 수,
 *    2026-10-19 사용자 결정). 새 색을 들이면 같은 화면 안에서 파랑의 뜻이 둘이 된다.
 */
export const STOCK_REQUEST_QUANTITY_VALUE_CLASS = "font-semibold tabular-nums text-blue-700 dark:text-blue-400";

/**
 * 위 숫자를 받치는 **이름표**(「— 요청」 · 「/ 불출」).
 * 🔵 이름표가 옅어져야 숫자가 선다 — 이 줄에서 이름표는 「무슨 수인지」만 알려 주면 된다
 *    (바로 아래 자세한 내용 줄이 이름표를 다루는 방식과 같다).
 */
export const STOCK_REQUEST_QUANTITY_LABEL_CLASS = "text-zinc-400 dark:text-zinc-500";

/**
 * 신청 줄 **부품 한 덩이**를 묶는 꾸밈 — 🔴 왼쪽 세로 선 하나 (요청 ①).
 *
 * 🔵 부품 하나가 **넉 줄까지** 늘어난다(머리줄 · 고객사 품명 · 딱지 · 나머지). 쓰는 분 말이
 *    「간격만으로는 어디서 끊기는지 안 보인다」였다.
 * 🔴 **줄마다 상자를 두르지 않았다.** 대여섯 줄이 붙는 좁은 칸이라 네 변을 다 두르면
 *    답답해지고 안쪽 여백까지 먹어 글이 더 좁아진다. 세로 선 하나는 ⓐ 여러 줄을 **한 덩이로
 *    묶고** ⓑ 다음 부품과 **갈라 주면서** ⓒ **폭을 거의 안 먹는다**.
 * 🔵 색을 입히지 않는 까닭: 이 선은 **구분선**이지 뜻을 나르는 자리가 아니다. 뜻을 나르는
 *    색은 이 줄 안에 이미 셋이다(상태 배지 · 유상/무상 딱지 · 수량).
 */
export const STOCK_REQUEST_LINE_BLOCK_CLASS = "border-l-2 border-zinc-200 pl-2 dark:border-zinc-700";

// ---------------------------------------------------------------------------
// 신청 줄에 **어느 부품인지**를 보인다 (2026-10-21)
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 * 🔴 「No. 165 AMP-… — 요청 2 / 불출 0」만으로는 **어느 부품인지 모른다**
 * ============================================================================
 * 같은 품명인 부품 묶음이 16개 있다(저쪽 API.md 2절). 재고 관리의 [부품 요청]·[승인 요청건]
 * 화면은 2026-10-21 에 같은 자리를 이렇게 바꿨고, A/S 의 반출 신청 줄도 **같은 규칙**을 따른다.
 *
 * ── 지키는 규칙 셋 — 🔴 **베끼는 것이 아니라 맞추는 것이다** ───────────────
 *  ㉠ **고객사 품명을 앞세운다.** 고객사와 말을 주고받을 때 쓰는 이름이라 **눈으로 훑어 찾는
 *     값**이 이것이다. 넷을 같은 크기로 늘어놓으면 매번 뒤져야 한다.
 *  ㉡ **값이 없는 칸은 아예 안 그린다.** 「교산 품번 없음 · 도번 없음」이 줄줄이 깔리면 정작
 *     있는 값이 묻힌다. 🔴 `-` 만 적힌 칸도 **없는 칸**이다(자료가 엑셀에서 넘어왔다) —
 *     재는 자는 이 저장소에 이미 있는 `partFieldValue` 하나이고, 재고 관리도 같은 자를 쓴다.
 *  ㉢ **딱지 둘은 성격이 다르다** — 소유구분은 부품의 것, 유상/무상은 그 줄의 것
 *     (`InventoryStockRequestLine` 머리말). 그래서 **함수가 둘**이고 받는 칸도 갈라 둔다.
 *
 * 🔵 **그리는 모양이 아니라 「무엇을 어떤 차례로」만 여기서 정한다** — 줄을 어떻게 나눌지는
 *    `PartRequestSection` 이 정한다. 그 덕에 이 규칙에 React 없는 시험이 붙는다(이 파일의
 *    `inventoryPartIdLabels` 머리말과 같은 가름이다).
 * ============================================================================
 */

/**
 * 줄에서 **앞세우는 값** — 고객사 품명. 없으면 **빈 글자**이고, 그때 화면은 그 줄을 안 그린다.
 *
 * 🔴 **품명으로 대신 세우지 않는다.** 바로 윗줄이 이미 `No. 165 <품명>` 을 그리고 있어서,
 *    대신 세우면 같은 글자가 두 줄에 걸쳐 나오고 **그 복사본이 줄에서 가장 굵은 글자**가 된다.
 *    앞세우기는 「훑을 값을 하나 고르는 일」인데 윗줄과 같은 값을 고르면 고른 것이 없는 것과 같다.
 * 🔵 **부품 찾기 줄과 같은 자를 쓴다**(`inventoryPartCustomerName` 도 `partFieldValue` 다) —
 *    한쪽만 `-` 를 값으로 세면 같은 부품이 두 자리에서 다르게 보인다.
 */
export function stockRequestLineCustomerName(line: Pick<InventoryStockRequestLine, "customerName">): string {
  return partFieldValue(line.customerName);
}

/**
 * 줄에 **작게 늘어놓는 나머지** — 품명2 · 교산 품번 · 도번. 🔴 **값이 있는 것만** 차례대로.
 *
 * 🔴 **차례도 이름표도 여기서 짓지 않는다** — `PART_FIELD_ORDER` 가 쥔다(2026-10-16 요청 ③:
 *    「어디서든 같은 순서」). 부품 찾기 줄·견적서 고르개도 같은 표를 보고 그린다.
 * 🔵 **고객사 품명은 빠져 있다** — 바로 위에서 제 줄로 따로 세운다. 품명도 빠져 있다 — 줄의
 *    머리가 이미 그 값이다.
 */
export function stockRequestLineDetails(
  line: Pick<InventoryStockRequestLine, "name2" | "kyosanPartNo" | "drawingNo">
): PartFieldEntry[] {
  /* 🔵 넘기지 않은 칸은 빈 값이라 저쪽이 알아서 뺀다 — 여기서 거를 것이 없다. */
  return partFieldEntries({
    partSpec: line.name2,
    kyosanPartNo: line.kyosanPartNo,
    drawingNo: line.drawingNo,
  });
}

/**
 * 줄에 붙는 **딱지** 하나.
 *
 * 🔴 **글자와 꾸밈을 한 자리에서 함께 고른다.** 따로 두면 한쪽만 늘어나고, 그때 색약인 사람에게
 *    모든 딱지가 같아 보인다. **색을 빼도 말이 되어야 한다**(이 저장소와 재고 관리 양쪽의 규약).
 * 🔵 이 모듈에 꾸밈이 사는 까닭: 이 화면은 서버 액션을 부르는 클라이언트 컴포넌트라 이 환경에서
 *    **그려 볼 수 없다**(`part-request-section-wiring.test.ts` 머리말). 꾸밈을 화면 안에 두면
 *    「색 말고도 갈리는가」를 **아무도 돌려 보지 못한다.**
 */
export type StockRequestLineTag = {
  /** 어느 값인가. 🔵 화면의 `key` 이자, 시험이 「섞이지 않았나」를 짚는 이름이다. */
  key: "owner" | "chargeType" | "oh";
  /**
   * 값 앞에 붙는 작은 글자. 🔵 **빈 글자일 수 있다** — 값 자체가 이미 말이 되는 딱지는 라벨을
   * 달지 않는다(아래 유상/무상). 🔴 그 있고 없음이 두 딱지를 가르는 **「색 아닌」 표식 하나**다.
   */
  label: string;
  value: string;
  /** 상자 꾸밈. 🔴 위 머리말 — 색만 담지 않고, 🔴 **다크 짝이 붙어 있어야 한다**. */
  className: string;
};

/** 소유구분 딱지의 라벨. 🔵 값(`DSS`·`KYOSAN`·`보수부재`)만으로는 무슨 칸인지 모른다 — 그래서 붙인다. */
export const STOCK_REQUEST_OWNER_TAG_LABEL = "소유";

/**
 * 소유구분 딱지의 꾸밈 — **중립색 · 보통 굵기**.
 *
 * 🔵 **일부러 눈에 덜 띄게 둔다.** 이 줄에서 돈이 걸린 값은 아래 유상/무상이고, 둘을 같은 세기로
 *    그리면 그쪽이 묻힌다. 소유는 「어느 재고에서 빠지나」를 확인하는 값이라 보이면 충분하다.
 */
export const STOCK_REQUEST_OWNER_TAG_CLASS =
  "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/**
 * **부품의 소유구분** 딱지. 없으면 `null` 이고, 그때 화면은 **아무것도 안 그린다.**
 *
 * 🔴 **받는 칸이 `owner` 하나다** — 유상/무상을 들고는 이 함수를 부를 수 없다. 그 가름이 이
 *    조각의 뜻이다(`InventoryStockRequestLine` 머리말).
 * 🔴 **빈 자리를 만들지 않는다.** 부품을 못 찾은 줄에 `-` 를 적으면 「소유가 없는 부품」처럼
 *    읽히는데, 참말은 **부품을 못 찾았다**이고 그것은 품명 칸이 이미 말하고 있다.
 * 🔵 글자는 **저쪽이 준 것을 그대로** 쓰고, 없으면 코드를 그린다 — 이 저장소가 상태 배지와
 *    부품 찾기 줄에서 쓰는 그 `label || code` 그대로다. 우리 표로 다시 지으면 두 화면이 다른
 *    말을 하고, 저쪽이 말을 바꾸는 날 이쪽만 옛말을 한다.
 */
export function stockRequestLineOwnerTag(
  line: Pick<InventoryStockRequestLine, "owner">
): StockRequestLineTag | null {
  if (line.owner === null) return null;
  return {
    key: "owner",
    label: STOCK_REQUEST_OWNER_TAG_LABEL,
    value: line.owner.label || line.owner.code,
    className: STOCK_REQUEST_OWNER_TAG_CLASS,
  };
}

/**
 * 유상/무상 딱지의 꾸밈 — 🔴 **둘이 색 말고도 갈린다.**
 *
 *  ① **글자가 다르다**(「유상」 ↔ 「무상」). 색을 전부 지워도 이 가름은 남는다.
 *  ② **바탕이 차 있나**가 다르다(연노랑 ↔ 카드와 같은 바탕). 흑백으로 찍어도, 색약인 눈에도
 *     **한쪽만 칠해져 있다**는 것은 보인다.
 *
 * 🔴 **둘 다 굵다**(`font-semibold`). 돈이 걸린 값이라 흘려 적어서 놓치는 일이 없어야 하고,
 *    소유구분 딱지가 보통 굵기인 것과 함께 **두 딱지를 가르는 「색 아닌」 표식**이 된다.
 * 🔴 **다크 짝이 붙어 있다** — 밝은 쪽만 적으면 어두운 화면에서 글자가 배경에 잠긴다
 *    (이 화면의 이웃 꾸밈들도 전부 짝이 있다).
 * 🔵 유상에 노랑을 고른 까닭: 이 화면에서 주황·노랑은 「사람이 더 볼 것이 있다」는 뜻으로 쓰인다
 *    (고객사 품명 없음 안내 · 못 불러옴 상자). 유상은 **청구가 따라붙는** 줄이다.
 */
export const STOCK_REQUEST_CHARGE_TAG_CLASS: Record<ChargeType, string> = {
  PAID: "border-amber-300 bg-amber-50 font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
  FREE: "border-zinc-300 bg-white font-semibold text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200",
};

/**
 * 🔴 **모르는 코드의 꾸밈** — 저쪽이 유상/무상을 하나 더 만드는 날 쓰인다.
 *
 * 🔵 **테두리를 점선으로** 둔다. 색이 아니라 **선의 모양**이라 흑백에서도 보이고, 「우리가 모르는
 *    값이다」가 한눈에 드러난다. 🔴 둘 중 아무 쪽으로도 칠하지 않는 까닭: 모르는 값을 무상처럼
 *    칠하면 **청구가 따라붙는 줄이 안 붙는 줄로 보인다.** 글자는 저쪽이 준 것을 그대로 그린다.
 */
export const STOCK_REQUEST_CHARGE_TAG_UNKNOWN_CLASS =
  "border-dashed border-zinc-400 bg-white font-semibold text-zinc-700 dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-200";

/**
 * **그 줄의 유상/무상** 딱지. 없으면 `null` 이고, 그때 화면은 **아무것도 안 그린다.**
 *
 * 🔴 **받는 칸이 `chargeType` 하나다** — 소유를 들고는 부를 수 없다. 「이 **부품**은 유상인가요?」는
 *    답이 없는 물음이기 때문이다(`InventoryStockRequestLine` 머리말).
 * 🔴 **라벨을 달지 않는다.** 「유상」·「무상」이 그 자체로 무슨 칸인지까지 말하는 낱말이라, 앞에
 *    「유상/무상」을 또 적으면 같은 말이 두 번 나오고 딱지가 길어져 **오히려 묻힌다.**
 * 🔵 **비어 있는 것이 정상인 자리가 있다** — 재고 관리에서 올린 대여·폐기 줄에는 이 값이 처음부터
 *    없다. 그래서 「없으면 안 그린다」가 여기서는 **빠뜨림이 아니라 참말**이다.
 */
export function stockRequestLineChargeTag(
  line: Pick<InventoryStockRequestLine, "chargeType">
): StockRequestLineTag | null {
  if (line.chargeType === null) return null;
  const code = line.chargeType.code;
  return {
    key: "chargeType",
    label: "",
    value: line.chargeType.label || code,
    className: isChargeType(code) ? STOCK_REQUEST_CHARGE_TAG_CLASS[code] : STOCK_REQUEST_CHARGE_TAG_UNKNOWN_CLASS,
  };
}

/**
 * **O/H 딱지에 적히는 글자** (2026-10-22, 쓰는 분 요청).
 *
 * 🔴 **이 저장소에서 그 말을 적는 자리는 여기 하나다.** 화면 둘(담는 중 · 올린 뒤)이 전부
 *    `stockRequestOhTag` 를 지나므로 화면에 손으로 적을 자리가 없다 — 적어 두면 말을 바꾸는 날
 *    한쪽만 옛말을 한다.
 * 🔴 **「오버홀」로 풀지 않는다.** 두 저장소가 쓰는 낱말이 「O/H」다(「O/H 부품 템플릿」·「O/H 단가」).
 * 🔴 **재고 관리도 같은 글자를 쓴다**(저쪽 `REQUEST_ITEM_OH_TAG_VALUE`). 같은 딱지가 네 화면에
 *    서는데 글자가 두 저장소에 나뉘어 있어 **어느 쪽도 혼자서는 어긋난 것을 알지 못한다** —
 *    그래서 `scripts/check-inventory-contract.ts` 가 두 저장소의 그 글자를 맞대어 잰다.
 */
export const STOCK_REQUEST_OH_TAG_VALUE = "O/H";

/**
 * O/H 딱지의 꾸밈 — 🔴 **이웃한 두 딱지와 색 말고도 갈린다.**
 *
 *  ① **글자가 다르다**(「O/H」). 소유(`DSS`·`KYOSAN`)와도 유상/무상과도 섞일 수 없는 낱말이라,
 *     색을 전부 지워도 무엇인지 알 수 있다.
 *  ② **바탕이 차 있고 굵다.** 소유(연회색·보통 굵기)와 갈리고, 무상(흰 바탕)과도 갈린다.
 *
 * 🔵 보라를 고른 까닭: **사람이 일부러 그렇게 해 둔 것**에 쓰는 색이다(이 화면의 보류 사유 상자가
 *    같은 계열이고, 재고 관리도 보류 배지에 보라를 쓴다). O/H 로 담긴 줄도 [한 번에 담기]를 눌러
 *    **그렇게 담긴** 줄이다. 🔴 유상의 노랑과 겹치지 않는 계열이라, 둘이 나란히 서도 **어느 쪽이
 *    돈 이야기인지** 흐려지지 않는다.
 * 🔴 **다크 짝이 붙어 있다** — 밝은 쪽만 적으면 어두운 화면에서 글자가 배경에 잠긴다.
 */
export const STOCK_REQUEST_OH_TAG_CLASS =
  "border-violet-300 bg-violet-50 font-semibold text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200";

/**
 * **그 줄이 O/H 템플릿에서 담긴 줄인가** 딱지. 아니면 `null` 이고, 그때 화면은 **아무것도 안 그린다.**
 *
 * 🔴 **「일반」 같은 딱지를 만들지 않는다**(쓰는 분 지시). 줄마다 딱지가 하나 더 서면 목록이
 *    시끄러워지고, 무엇보다 **옛 신청**(칸이 없어 거짓인 줄)이 「확인해 보니 일반 부품」으로
 *    단정돼 보인다 — 참말은 「그때는 그 값을 적지 않았다」다.
 * 🔴 **받는 칸이 `fromOhTemplate` 하나다** — 이웃 둘과 같은 관례다(소유만 들고 유상/무상을 물을 수
 *    없고, 그 반대도 안 된다). 🔵 그 덕에 **담는 중인 장바구니 줄**도 같은 함수를 부른다: 그쪽은
 *    아직 저쪽에서 받아 온 줄이 아니지만 **같은 칸 하나**를 들고 있다. 두 화면이 같은 딱지를
 *    그려야 하므로 함수를 둘로 두지 않는다.
 */
export function stockRequestOhTag(line: { fromOhTemplate: boolean }): StockRequestLineTag | null {
  if (!line.fromOhTemplate) return null;
  return {
    key: "oh",
    // 🔴 라벨을 달지 않는다 — 「O/H」가 그 자체로 무슨 뜻인지까지 말한다(유상/무상과 같은 까닭).
    label: "",
    value: STOCK_REQUEST_OH_TAG_VALUE,
    className: STOCK_REQUEST_OH_TAG_CLASS,
  };
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

// ---------------------------------------------------------------------------
// 결정 사유 상자의 머리글 — 셋으로 갈린다 (2026-10-21)
// ---------------------------------------------------------------------------

/**
 * ============================================================================
 * 🔴 결정 사유에도 **제목을 단다** — 보류 사유에는 있는데 여기만 없었다
 * ============================================================================
 * 보류 사유 상자에는 「보류 사유」라는 제목이 붙어 있는데 결정 사유 상자에는 없어서,
 * 사람이 **상태 배지를 보고 유추**해야 했다. 같은 카드 안에서 한쪽만 말이 없으면 읽는
 * 사람은 그것이 무슨 글인지부터 짐작한다.
 *
 * ── 🔴 **셋으로 가른다 — 재고 관리와 같은 규칙이다** ─────────────────────
 * 저쪽이 2026-10-21 에 같은 자리를 먼저 그렇게 했다(`lib/stock/codes.ts` 의
 * `requestDecisionNote`). **베끼는 것이 아니라 규칙을 맞추는 것**이다 — 두 화면이 같은
 * 자료를 다른 말로 부르면 오가는 사람이 다른 것인 줄 안다.
 *
 * 🔴 **가르는 차례가 상태 배지와 같다 — ① 마감 ② 반려 ③ 그 밖.** 상자 위에 선 배지가
 *    「마감」인데 상자가 「반려 사유」라고 하면 같은 줄이 두 말을 한다. 차례를 적어 두지
 *    않으면 마감된 반려 건이 하나라도 생기는 날 두 화면이 서로 다른 이름을 부른다.
 * 🔵 ③은 지금 도달하지 않는다 — 저쪽이 사유를 적는 자리가 반려와 마감 둘뿐이다. 그래도
 *    두는 까닭은 「반려」로 뭉개면 나중에 사유를 적는 자리가 하나 더 생겼을 때 **그 줄이
 *    반려라고 거짓말을 하기** 때문이다.
 *
 * 🔴 **「취소」에는 사유라는 개념이 아예 없다.** 저쪽 거두는 함수가 사유를 받지 않아
 *    `decision.note` 가 빈 글자다 — 안 보이는 것이 아니라 **처음부터 없다**.
 * 🔴 **마감은 상태값이 아니라 `closed` 칸이다.** 통로가 그 칸을 내주고 있고(저쪽
 *    `ApiRequestStatus.closed`) 이 파일의 파서가 받아 두었다 — `status.code` 로는
 *    「다 나감」과 구별되지 않는다(둘 다 `CONFIRMED`).
 * ============================================================================
 */
export const STOCK_REQUEST_DECISION_LABEL_CLOSED = "마감 사유";
export const STOCK_REQUEST_DECISION_LABEL_REJECTED = "반려 사유";
export const STOCK_REQUEST_DECISION_LABEL_OTHER = "결정 사유";

/** 🔴 상태 배지와 **같은 차례**로 가른다(위 머리말) — ① 마감 ② 반려 ③ 그 밖. */
export function stockRequestDecisionLabel(
  request: Pick<InventoryStockRequest, "status" | "closed">
): string {
  if (request.closed) return STOCK_REQUEST_DECISION_LABEL_CLOSED;
  if (request.status.code === "REJECTED") return STOCK_REQUEST_DECISION_LABEL_REJECTED;
  return STOCK_REQUEST_DECISION_LABEL_OTHER;
}
