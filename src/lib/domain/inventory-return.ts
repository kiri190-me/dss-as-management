import { MAX_STOCK_REQUEST_LINES, MAX_STOCK_REQUEST_QUANTITY } from "./inventory-gateway";

/**
 * ============================================================================
 * 부품 **반환** — 「얼마나 돌려줄 수 있나」와 「무엇을 올리나」 (2026-11-26)
 * ============================================================================
 * 가져갔던 부품을 되돌려 보내는 길이다. 올리는 주소도 토큰도 반출 신청과 **같고**
 * (`POST /api/v1/stock-requests`, 쓰기 토큰), 달라지는 것은 `type: "RETURN"` 과 줄의
 * 생김새뿐이다(저쪽 API.md 4-11절). 그런데 그 「생김새」의 차이가 작지 않아서, 반출 쪽
 * 모듈(`inventory-stock-request-cart.ts` · `inventory-gateway.ts` 의 줄 검사)에 끼워 넣지
 * 않고 **제 파일**로 둔다 —
 *
 *  ㉠ 🔴 **유상/무상을 보내지 않는다.** 돈이 걸린 값은 **나갈 때** 정해졌고 돌아오는 것에
 *     다시 매기지 않는다(API.md 4-11절). 반출 쪽 `parseStockRequestLines` 는 그 값이 없으면
 *     **거절하는** 것이 일이라, 한 함수로 합치면 둘 중 하나가 반드시 틀린 말을 한다.
 *  ㉡ 🔴 **사유(`reason`)를 보내지 않는다 — 비어 있지 않으면 400 이다.** 저쪽 반환 기록에는
 *     사유 칸이 **아예 없어서**, 받아 두면 적어 보낸 말이 그대로 사라진다. 적을 말은 `note` 다.
 *  ㉢ 🔴 **원장 줄 번호를 보내지 않는다.** 「어느 불출 줄에 되돌려 붙일지」는 재고 관리가
 *     정한다(먼저 나간 줄부터). A/S 는 저쪽 내부 번호를 보관하지 않는다(2026-10-15 결정).
 *
 * ── 🔴 최댓값은 `remaining` 이다 — `taken` 이 아니다 ─────────────────────
 * A/S 가 아는 것은 「이 건으로 얼마가 나갔나」뿐이고, **「이미 얼마가 돌아왔나」는 재고 관리에만
 * 있다**(원장의 반환 줄). 나간 수량(`taken`)을 그대로 수량 칸의 최댓값으로 그리면 **같은 부품을
 * 두 번 돌려주는 신청**이 서고, 그것은 재고 담당자가 확인하는 순간까지 아무도 모른다. 그래서
 * 돌려줄 수 있는 수는 **저쪽이 세어 준다**(`GET /api/v1/return-candidates`, API.md 8절) —
 * 🔴 `taken − returned` 로 **여기서 다시 빼지 않는다**: 그러면 이미 올려 둔 신청(`pending`)이
 * 빠지지 않아 한 번 더 올릴 수 있게 된다(API.md 8-4절).
 *
 * ── 🔵 마지막 울타리는 이 파일이 아니다 ─────────────────────────────────
 * 넘치는 반환을 실제로 거절하는 자리는 재고 관리의 원장이다(잠그고 다시 센다). 여기 검사는
 * **헛걸음을 줄이는 것**이고, 빠져나간 줄은 저쪽이 「N개까지 돌려줄 수 있습니다」로 거절한다 —
 * 🔴 그 문구는 **그대로** 사람에게 보인다(손으로 다시 적지 않는다).
 * ============================================================================
 */

/**
 * 보내는 본문의 `type` 칸. 🔴 **이 글자가 곧 저쪽이 읽는 글자다** — 안 보내면 「사용」(반출)
 * 으로 읽히고, 반출 신청이 한 줄 선다(API.md 4-11절의 표). 🔵 반출 쪽은 이 칸을 **아예 안
 * 보낸다** — 지금까지 쓰던 호출을 한 글자도 고치지 않으려고 저쪽이 그렇게 열었다.
 */
export const INVENTORY_RETURN_REQUEST_TYPE = "RETURN";

/**
 * 돌려줄 수 있는 부품 한 줄 — `GET /api/v1/return-candidates` 가 주는 모양(API.md 8-2절).
 *
 * 🔵 앞의 여섯 칸(`no`~`owner`)은 **부품 목록과 이름이 같다** — 그래서 화면이 부품 줄을 그릴 때
 *    쓰는 도메인 함수(`inventoryPartCustomerName` · `inventoryPartIdLabels` · `inventoryPartSpec`)
 *    를 **그대로** 쓸 수 있다. 같은 부품이 두 화면에서 다른 차례로 보이지 않게 하는 길이다.
 */
export type InventoryReturnCandidate = {
  no: number;
  name: string;
  name2: string;
  customerName: string;
  kyosanPartNo: string;
  drawingNo: string;
  owner: { code: string; label: string };
  /** 이 인수번호로 **나간** 수량의 합. 🔴 **최댓값이 아니다**(머리말). */
  taken: number;
  /** 그중 **이미 돌아온** 수량의 합. */
  returned: number;
  /** **대기 중인 반환 신청**에 적힌 수량의 합 — 올려 두고 아직 확인 안 된 몫이다. */
  pending: number;
  /** 🔴 지금 **돌려줄 수 있는** 수량(`taken − returned − pending`). **이것이 최댓값이다.** */
  remaining: number;
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function codeLabel(value: unknown): { code: string; label: string } {
  if (!value || typeof value !== "object") return { code: "", label: "" };
  const o = value as { code?: unknown; label?: unknown; name?: unknown };
  return { code: str(o.code), label: str(o.label) || str(o.name) };
}

/** 0 이상의 정수만 수로 본다 — 모양이 아니면 0 이다(세는 칸이라 「모름」이 없다). */
function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * 통로 응답(JSON) → 돌려줄 수 있는 부품 목록. **모양이 아니면 `null`** 이다 —
 * 부르는 쪽(`lib/server/inventory-gateway.ts` 의 `finishRead`)이 그것을 「못 받아 왔다」로
 * 접는다. 🔴 **빈 목록으로 바꾸지 않는다**: 「돌려줄 것이 없다」와 「확인하지 못했다」는
 * 사람이 다르게 행동하는 말이다.
 *
 * 🔴 **`remaining` 이 1 미만인 줄은 버린다.** 저쪽도 애초에 빼고 보내지만(API.md 8-2절),
 *    여기서 한 번 더 거른다 — 0 인 줄이 화면에 서면 사람이 거기에 수를 적고 거절당한다.
 * 🔵 번호나 품명이 빈 줄을 버리는 것은 부품 목록 파서와 **같은 규율**이다(가리킬 수 없는 줄은
 *    고르개에 올려 봐야 쓸 데가 없다).
 */
export function parseInventoryReturnCandidatesResponse(json: unknown): InventoryReturnCandidate[] | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) return null;

  const candidates: InventoryReturnCandidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const no = typeof o.no === "number" && Number.isInteger(o.no) && o.no >= 1 ? o.no : null;
    const name = str(o.name);
    const remaining = count(o.remaining);
    if (no === null || name === "" || remaining < 1) continue;
    candidates.push({
      no,
      name,
      name2: str(o.name2),
      customerName: str(o.customerName),
      kyosanPartNo: str(o.kyosanPartNo),
      drawingNo: str(o.drawingNo),
      owner: codeLabel(o.owner),
      taken: count(o.taken),
      returned: count(o.returned),
      pending: count(o.pending),
      remaining,
    });
  }
  return candidates;
}

/**
 * 🔴 **왜 최댓값이 그 수인지**를 사람이 읽을 수 있게 한 줄로 적는다.
 *
 * 수량 칸 옆에 「최대 7」만 떠 있으면, 아홉 개를 가져간 것을 아는 사람은 **화면이 틀렸다고
 * 생각한다**(실제로는 둘이 이미 신청에 걸려 있다). 세 수를 함께 보이면 그 자리에서 납득된다.
 * 🔵 글자를 화면이 아니라 여기서 짓는 까닭: 부품 요청 칸은 클라이언트 컴포넌트라 이 환경에서
 *    그려 볼 수 없어서(그 파일 짝 시험의 머리말), 화면에 적은 말은 아무도 돌려 보지 못한다.
 */
export function returnCandidateBreakdownText(
  candidate: Pick<InventoryReturnCandidate, "taken" | "returned" | "pending" | "remaining">
): string {
  return `나간 ${candidate.taken} · 돌아간 ${candidate.returned} · 신청 중 ${candidate.pending} → 돌려줄 수 있는 수 ${candidate.remaining}`;
}

/**
 * 🔴 **이미 나간 건에는 반환 요청을 올릴 수 없다**(쓰는 분 결정, 2026-11-26).
 *
 * 🔴 **단추를 숨기지 않는다** — 사라지면 사람은 「그런 기능이 없다」로 읽고 담당자를 찾아
 *    다닌다. 못 누르게 하고 **까닭을 글로** 적는다. 그 글자가 여기 한 곳에 있는 까닭은
 *    **서버도 같은 말로 거절**하기 때문이다(`createInventoryReturnRequestAction`) — 두 벌로
 *    적으면 화면이 막는 까닭과 서버가 막는 까닭이 다른 말로 보인다.
 */
export const RETURN_AFTER_SHIPMENT_MESSAGE =
  "이미 출하 완료된 수리 건이라 부품 반환을 요청할 수 없습니다 — 재고 관리 담당자에게 말씀해 주세요.";

/**
 * 돌려줄 것이 하나도 없을 때 그 자리에 적는 말.
 *
 * 🔴 **빈 창을 띄우지 않는다.** 목록만 비어 있으면 사람은 불러오다 만 줄 알고 다시 누른다.
 * 🔴 **「없다」는 말은 저쪽에서 **잘 받아 왔을 때만** 한다** — 못 받아 왔을 때는 이 글이 아니라
 *    「확인하지 못했다」가 떠야 한다(부르는 화면이 그 둘을 다른 갈래로 그린다).
 */
export const RETURN_CANDIDATES_EMPTY_NOTICE =
  "이 수리 건에서 돌려줄 수 있는 부품이 없습니다 — 나간 적이 없거나, 이미 다 돌아왔거나, 올려 둔 반환 신청이 아직 처리 중입니다.";

/** 한 줄도 안 적고 올리려 할 때. 🔴 **0 인 줄은 보내지 않는다**(아래 `validateReturnCart`). */
export const RETURN_NOTHING_TO_SEND_MESSAGE =
  "돌려줄 수량을 1개 이상 적어 주세요 — 0개인 줄은 올리지 않습니다.";

/**
 * [반환 요청] 단추를 **못 누르게 하는 까닭**. 누를 수 있으면 `null` 이다.
 *
 * 🔵 차례가 「출하 완료 → 포털 번호」인 까닭: 둘 다 걸리는 사람에게 더 바꿀 수 없는 쪽을
 *    먼저 말해 준다(포털 번호는 포털로 한 번 들어오면 생기지만, 나간 건은 되돌아오지 않는다).
 * 🔵 포털 번호 쪽 글자를 여기서 짓지 않는 까닭: 그 말은 서버가 이미 들고 내려온다
 *    (`requesterGate.message`). 같은 말을 두 곳에서 지으면 한쪽만 바뀌는 날이 온다.
 */
export function returnRequestBlockReason(input: {
  shipmentFinished: boolean;
  /** 올릴 수 없는 사람이면 그 까닭, 올릴 수 있으면 `null`. */
  requesterMessage: string | null;
}): string | null {
  if (input.shipmentFinished) return RETURN_AFTER_SHIPMENT_MESSAGE;
  if (input.requesterMessage !== null) return input.requesterMessage;
  return null;
}

// ---------------------------------------------------------------------------
// 올리는 줄 — 모양 검사 (🔴 화면도 서버 액션도 **이 함수 하나**를 쓴다)
// ---------------------------------------------------------------------------

/**
 * 반환 신청에 실리는 줄 하나. 🔴 **이 객체가 그대로 본문에 실린다** — 칸 이름이 곧 저쪽이
 * 받는 글자다(`lib/server/inventory-gateway.ts` 가 `lines: input.lines` 로 넘긴다).
 * 🔴 **칸이 둘뿐인 것이 이 타입의 요점이다**(머리말 ㉠㉡㉢).
 */
export type ReturnRequestLine = { no: number; quantity: number };

export type ParseReturnRequestLinesResult =
  | { ok: true; lines: ReturnRequestLine[] }
  | { ok: false; message: string };

/**
 * 🔵 이름표가 있으면 「AMP-…(No. 7)」로, 없으면 「부품 No. 7」로 말한다. 반출 쪽
 * `parseStockRequestLines` 가 같은 모양을 쓰는데 그 함수는 **내보내지 않는** 안쪽 도우미라
 * (`inventory-gateway.ts`) 여기 한 벌을 둔다 — 🔴 말투가 갈리지 않게 **글자를 맞춰 두었다.**
 */
function partLabel(no: number, labels?: ReadonlyMap<number, string>): string {
  const name = labels?.get(no);
  return name ? `${name}(No. ${no})` : `부품 No. ${no}`;
}

/**
 * 올릴 줄들을 **저쪽이 받는 모양인지** 본다.
 *
 * 🔴 **남은 수(`remaining`)를 여기서 보지 않는다** — 이 함수는 **서버 액션도** 쓰는데, 서버는
 *    그 수를 모른다(알려면 통로를 한 번 더 두드려야 하고, 그렇게 받아 온 수도 보내는 순간
 *    이미 옛것이다). 남은 수를 넘겼는지 가리는 자리는 둘이다 — **화면의 장바구니 검사**
 *    (아래 `validateReturnCart`, 헛걸음을 줄인다)와 **재고 관리의 원장**(진짜 울타리).
 * 🔴 **유상/무상도 사유도 받지 않는다**(머리말 ㉠㉡). 받는 칸이 없어야 실수로 실리지 않는다.
 * 🔴 **같은 부품이 두 줄이면 거절한다** — 저쪽도 거절하고, 한 줄로 합쳐 보내야 한다.
 * 🔵 상한 둘(줄 수 · 수량)은 반출 쪽과 **같은 상수**를 본다 — 저쪽에서도 같은 통로가 받는다.
 */
export function parseReturnRequestLines(
  raw: unknown,
  labels?: ReadonlyMap<number, string>
): ParseReturnRequestLinesResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: RETURN_NOTHING_TO_SEND_MESSAGE };
  }
  if (raw.length > MAX_STOCK_REQUEST_LINES) {
    return { ok: false, message: `한 번에 ${MAX_STOCK_REQUEST_LINES}줄까지 올릴 수 있습니다.` };
  }

  const lines: ReturnRequestLine[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, message: "돌려줄 부품 정보를 확인할 수 없습니다." };
    }
    const o = item as { no?: unknown; quantity?: unknown };
    const no = o.no;
    if (typeof no !== "number" || !Number.isInteger(no) || no < 1) {
      return { ok: false, message: "재고 관리의 부품 번호를 확인할 수 없습니다." };
    }
    if (seen.has(no)) {
      return { ok: false, message: `${partLabel(no, labels)}이(가) 두 줄입니다. 한 줄로 합쳐 주세요.` };
    }
    seen.add(no);

    const quantity = o.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_STOCK_REQUEST_QUANTITY
    ) {
      return {
        ok: false,
        message: `${partLabel(no, labels)}의 수량은 1 이상 ${MAX_STOCK_REQUEST_QUANTITY.toLocaleString("ko-KR")} 이하의 정수여야 합니다.`,
      };
    }

    // 🔴 **칸을 더 싣지 않는다** — 유상/무상도 사유도 원장 줄 번호도(머리말 ㉠㉡㉢).
    lines.push({ no, quantity });
  }
  return { ok: true, lines };
}

// ---------------------------------------------------------------------------
// 창 안의 줄 — 🔴 **기본은 0 개**이고, 0 인 줄은 올리지 않는다
// ---------------------------------------------------------------------------

/**
 * 반환 창에 서는 줄 하나.
 *
 * 🔴 **저쪽이 준 줄을 통째로 들고 있는다**(칸을 골라 베끼지 않는다). 베끼면 ① 최댓값을
 *    `remaining` 이 아닌 다른 칸에서 가져오는 길이 열리고 ② 「왜 최댓값이 그 수인가」를 적을
 *    세 수(`taken`·`returned`·`pending`)가 화면에서 사라지며 ③ 부품을 가리는 글자(고객사 품명 ·
 *    품명2 · 교산 품번 · 도번)를 그릴 수 없어, 같은 품명인 부품 묶음에서 어느 것인지 못 가른다.
 * 🔴 **수량만 글자 그대로 따로 든다** — 입력칸이 주는 것이 글자이기 때문이다. 숫자로 바꾸는
 *    자리는 `validateReturnCart` 하나다(반출 쪽 장바구니와 같은 규율).
 */
export type ReturnCartLine = {
  /** 🔴 **최댓값도 「왜 그 수인지」도 전부 여기서 나온다** — 저쪽이 준 그 줄 그대로다. */
  candidate: InventoryReturnCandidate;
  /** 🔴 **기본은 `"0"`**(쓰는 분 결정) — 창을 열자마자 전부 돌려주는 신청이 되면 안 된다. */
  quantity: string;
};

/** 🔴 **기본 수량.** 빈 칸이 아니라 `0` 인 까닭: 빈 칸은 「아직 안 봤다」로도 읽힌다. */
export const RETURN_QUANTITY_DEFAULT = "0";

/**
 * 받아 온 후보를 창의 줄로 바꾼다. 🔴 **차례를 여기서 바꾸지 않는다** — 저쪽이 부품 No.
 * 오름차순으로 주고(API.md 8-2절), 새로고침해도 줄이 안 바뀌는 것이 그 차례의 뜻이다.
 */
export function toReturnCartLines(candidates: readonly InventoryReturnCandidate[]): ReturnCartLine[] {
  return candidates.map((candidate) => ({ candidate, quantity: RETURN_QUANTITY_DEFAULT }));
}

/** 한 줄의 수량만 고친다 — 다른 줄도, 그 줄이 들고 있는 저쪽 자료도 건드리지 않는다. */
export function applyReturnCartQuantity(
  lines: readonly ReturnCartLine[],
  no: number,
  quantity: string
): ReturnCartLine[] {
  return lines.map((line) => (line.candidate.no === no ? { ...line, quantity } : line));
}

/**
 * 🔴 **손대지 않은 줄인가** — 빈 칸과 `0` 을 **같은 것**으로 본다.
 *
 * 수량 칸은 사람이 지우면 빈 글자가 된다(브라우저의 number 칸이 그렇다). 그것을 「0 과 다른
 * 값」으로 다루면 **지운 줄이 「수량이 숫자가 아닙니다」로 거절**되고, 사람은 적지도 않은 줄
 * 때문에 못 올린다. 🔵 숫자가 아닌 글자(`"abc"`)는 **손댄 것**으로 본다 — 조용히 빼면 무엇이
 * 잘못됐는지 말해 줄 기회가 사라진다(모양 검사가 그 줄을 집어 말해 준다).
 */
function isUntouchedReturnLine(line: Pick<ReturnCartLine, "quantity">): boolean {
  const typed = line.quantity.trim();
  return typed === "" || Number(typed) === 0;
}

/**
 * 🔴 **보낼 줄이 하나라도 있는가** — 올리기 단추를 열지 말지를 이것이 정한다.
 * 전부 0 이면 단추가 잠긴다(누르면 거절당할 것을 미리 막는다).
 */
export function hasReturnQuantity(lines: readonly ReturnCartLine[]): boolean {
  return lines.some((line) => !isUntouchedReturnLine(line));
}

/**
 * 창에 적힌 것을 올릴 모양으로 바꾼다 — **화면만 쓰는 검사**다.
 *
 * 하는 일 셋:
 *  ㉠ 🔴 **0 인 줄(과 빈 줄)을 뺀다.** 전부 0 이면 「1개 이상 적어 주세요」로 돌아간다. 저쪽은
 *     0 짜리 줄을 400 으로 거절하므로, 그대로 보내면 **적어 둔 다른 줄까지 통째로** 막힌다.
 *  ㉡ **남은 모양 검사는 공용 함수가 한다**(`parseReturnRequestLines`) — 서버 액션도 같은
 *     함수를 지난다. 여기서 따로 적으면 화면은 통과시키고 저쪽이 400 으로 돌려보낸다.
 *  ㉢ 🔴 **남은 수를 넘겼는지는 여기서만 본다**(공용 함수가 아니다 — 그 머리말). 넘친 줄을
 *     그대로 올리면 사람은 왕복 한 번을 버리고, 화면은 이미 그 수를 알고 있다.
 *     🔵 **이것은 울타리가 아니다**: 받아 온 뒤에 다른 사람이 먼저 올렸으면 이 수도 옛것이고,
 *        그때는 저쪽이 「N개까지 돌려줄 수 있습니다」로 거절한다 — 그 문구를 그대로 보인다.
 */
export function validateReturnCart(lines: readonly ReturnCartLine[]): ParseReturnRequestLinesResult {
  const typed = lines.filter((line) => !isUntouchedReturnLine(line));
  if (typed.length === 0) return { ok: false, message: RETURN_NOTHING_TO_SEND_MESSAGE };

  const labels = new Map(typed.map((line) => [line.candidate.no, line.candidate.name]));
  const parsed = parseReturnRequestLines(
    typed.map((line) => ({ no: line.candidate.no, quantity: Number(line.quantity.trim()) })),
    labels
  );
  if (!parsed.ok) return parsed;

  /* 🔴 **최댓값은 `remaining` 이다** — `taken`(나간 수)이 아니다. 이미 돌아온 몫과 올려 둔
     신청이 빠진 수라, 나간 수로 재면 같은 부품을 두 번 돌려주는 신청이 선다(머리말). */
  const remainingByNo = new Map(lines.map((line) => [line.candidate.no, line.candidate.remaining]));
  for (const line of parsed.lines) {
    const remaining = remainingByNo.get(line.no) ?? 0;
    if (line.quantity > remaining) {
      return {
        ok: false,
        message: `${partLabel(line.no, labels)}은(는) 지금 ${remaining}개까지 돌려줄 수 있습니다.`,
      };
    }
  }
  return parsed;
}
