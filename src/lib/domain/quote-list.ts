/**
 * ============================================================================
 * 견적서 목록의 한 줄
 * ============================================================================
 * 사용자가 정한 표기다:
 *
 *     DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생
 *     └견적서번호─┘ └고객사┘ └─모델명──┘ └L/N─┘ └─S/N─┘ └──신고증상──┘
 *
 * 같은 모델에서 견적서가 여러 장 나오기 때문에(재견적·항목 조정) 번호만으로는
 * 어느 것인지 알 수 없고, 모델명만으로도 알 수 없다. 이 여섯을 한 줄에 붙여야
 * 목록에서 눈으로 골라낼 수 있다.
 *
 * ── ⚠️ L/N 이 먼저고 S/N 이 나중이다 ────────────────────────────────────
 * 값의 모양으로 짐작하면 틀린다. 위 예시에서 `WU8042` 가 **L/N**, `1612027` 이
 * **S/N** 이다 — WU 접두가 붙었다고 시리얼이 아니다. 견적서 양식(D24)에 예시로
 * 박혀 있던 문구가 `S/N:WU2576, L/N:1508009` 라서 정확히 반대로 읽히게 생겼고,
 * 실제로 그 짐작으로 한 번 틀렸다. 순서는 사용자가 준 예시가 정하고,
 * **그것을 시험으로 못 박아 둔다**(quote-list.test.ts).
 *
 * ── 왜 순수 함수인가 ────────────────────────────────────────────────────
 * 서버(목록 조회)와 클라이언트(표·카드)가 같은 문자열을 만들어야 하고, 나중에
 * 검색을 붙이면 그 대상도 이 문자열이다. 세 곳이 각자 join 하면 언젠가 한 곳만
 * 다른 순서로 붙는다.
 * ============================================================================
 */

// 🔴 결재 상태 규칙은 **가져다 쓴다** — 아래 approvedQuoteIdsForCurrentContent 머리말.
//    형제 파일이라 상대 경로다(domain/quote-approval-rules.ts 가 이웃을 부르는 방식과 같다).
import { resolveQuoteApprovalState, type QuoteApprovalStatus } from "./quote-approval-rules";

export type QuoteSummaryParts = {
  quoteNumber: string;
  customerName: string;
  modelName: string | null;
  /** L/N — 위 '⚠️' 항목 참조. 목록에서 S/N 보다 **앞**이다. */
  lotNumber: string | null;
  /** S/N */
  serialNumber: string | null;
  faultDescription: string | null;
};

/**
 * 빈 칸은 통째로 뺀다 — 자리를 비워 두면 두 칸 띄어쓰기가 남아 "무언가 빠졌다"가
 * 아니라 "글자가 깨졌다"로 읽힌다. 공백만 적힌 값도 없는 것으로 접는다
 * (domestic-order-list.ts 가 같은 규칙을 쓴다).
 */
export function buildQuoteSummaryLine(parts: QuoteSummaryParts): string {
  return [
    parts.quoteNumber,
    parts.customerName,
    parts.modelName,
    parts.lotNumber,
    parts.serialNumber,
    parts.faultDescription,
  ]
    .map((piece) => piece?.trim() ?? "")
    .filter((piece) => piece.length > 0)
    .join(" ");
}

/**
 * ============================================================================
 * 합계가 읽는 한 줄 — **품목 줄만 금액을 낸다** (2026-09-16 케이블 견적서)
 * ============================================================================
 * quote_items 한 줄의 종류다(schema/quotes.ts 의 quoteItemKindEnum). 케이블
 * 견적서의 품목 표에는 금액이 없는 **설명 줄**이 낀다 — 예: `* 20kW RFG
 * 부속케이블 Parts 3종`. 뒤따르는 품목 몇 줄이 무엇인지 알려 주는 글이고,
 * 수량도 단가도 없으며 **합계에 들어가지 않는다.**
 * ============================================================================
 */
export const QUOTE_ITEM_KINDS = ["ITEM", "NOTE"] as const;
export type QuoteItemKind = (typeof QUOTE_ITEM_KINDS)[number];

/**
 * 합계가 받는 한 줄.
 *
 * ── 수량 · 단가가 비어 있을 수 있다 ─────────────────────────────────────
 * 설명 줄 때문이다(0101). DB 는 「품목 줄 ⇒ 수량·단가가 반드시 있다 / 그 밖의 줄
 * ⇒ 둘 다 NULL」을 CHECK 둘로 보증한다(quote_items_item_line_amounts_required ·
 * quote_items_amounts_item_line_only). **그 보증이 아래 isQuoteAmountItemLine 의
 * 전제**다.
 *
 * ── 🔴 종류를 적지 않은 줄은 품목 줄이다 ────────────────────────────────
 * `kind` 가 없을 수 있는 것은 아직 설명 줄을 만들 줄 모르는 자리가 있어서다 —
 * 수정 화면의 합계 미리보기와 미리보기 화면이 **입력 중인 값**으로 이 셈을
 * 부르는데, 그 줄들은 전부 품목 줄이다. DB 칸의 `DEFAULT 'ITEM'` 과 같은 규칙이고,
 * 같은 이유로 안전하다: 없으면 합계에 들어가므로 **금액이 조용히 빠지는 일은
 * 생기지 않는다.**
 */
export type QuoteAmountLine = {
  kind?: QuoteItemKind;
  quantity: number | null;
  unitPrice: string | null;
};

/**
 * 이 줄이 합계에 들어가는가 — **품목 줄만 들어간다.**
 *
 * 🔴 **`=== "ITEM"` 으로 쓴 것은 일부러다.** `!== "NOTE"` 로 쓰면 줄 종류가 하나 더
 * 생기는 날 그 종류가 **조용히 합계에 섞인다.** 0101 의 CHECK 도 같은 방향으로 썼다
 * (`kind = 'ITEM' OR 금액이 없다`) — 새 종류는 일단 합계 밖에 서고, 넣으려면 사람이
 * 이 자리를 보게 된다.
 *
 * 🔴 뒤의 두 조건(NULL 아님)은 **거르는 조건이 아니라 타입을 좁히는 손잡이**다. 품목
 * 줄의 수량·단가는 위 CHECK 가 이미 보증하므로 여기서 실제로 걸러지는 줄은 없다.
 * 이렇게 두는 것은 `quantity ?? 0` 으로 접지 않기 위해서다 — 접으면 설명 줄이
 * 「0원짜리 품목 줄」로 합계에 들어간 것과 구별되지 않고, 종류가 늘어나는 날 그
 * 구별이 없다는 사실조차 드러나지 않는다.
 */
export function isQuoteAmountItemLine<T extends QuoteAmountLine>(
  line: T
): line is T & { quantity: number; unitPrice: string } {
  return (line.kind ?? "ITEM") === "ITEM" && line.quantity !== null && line.unitPrice !== null;
}

/**
 * 견적서 한 장의 합계(공급가). 부가세는 여기서 셈하지 않는다 — 세율은 시점에
 * 따라 달라지는 값이고, 실제 문서에서는 양식의 `=I55*0.1` 이 계산한다.
 *
 * **품목 줄만 더한다**(위 isQuoteAmountItemLine). 설명 줄은 0 을 보태는 것이 아니라
 * 셈에 아예 들어오지 않는다 — 둘은 값이 같아 보여도 뜻이 다르고, 그 차이가
 * 드러나야 나중에 줄 종류가 늘어날 때 이 자리를 보게 된다.
 *
 * 금액은 DB 에서 **문자열로 온다**(numeric 을 Drizzle 이 그렇게 읽는다). 숫자로
 * 바꾸는 자리를 여기 하나로 모아 두면, 화면마다 제각기 parseFloat 하다가 한
 * 군데만 NaN 을 그리는 일이 없다.
 */
export function sumQuoteSupplyAmount(items: readonly QuoteAmountLine[], workCost: string): number {
  const itemsTotal = items
    .filter(isQuoteAmountItemLine)
    .reduce((sum, item) => sum + item.quantity * toAmount(item.unitPrice), 0);
  return itemsTotal + toAmount(workCost);
}

/**
 * ============================================================================
 * 견적서 한 장의 공급가액 — **서버가 금액을 셈하는 단 한 곳** (2026-09-15 Q2)
 * ============================================================================
 * 엑셀 전용 견적서(schema/quotes.ts 의 is_excel_only)는 품목이 없고 공급가액을 사람이
 * 손으로 적는다(manual_supply_amount). 그래서 「부품 줄 합 + 작업비」만으로는 그 장의
 * 금액이 나오지 않는다 — 그대로 두면 엑셀 전용 견적서가 목록에서 ₩0 으로 보이고, 그
 * 장이 연결된 내자 정리 줄에서는 "0.00" 이 손으로 적은 금액을 가린다.
 *
 * 서버 쪽에서 공급가액을 내는 곳 — 견적서 목록 · 수리 건의 견적서 탭(둘은 한 몸통,
 * queries/quotes.ts) · 내자 정리의 연결 금액(queries/domestic-orders.ts) · PURGE
 * 스냅숏(quote-trash.ts · master-data-purge.ts) — 이 모두 이 함수를 부른다. 한 곳이라도
 * sumQuoteSupplyAmount 를 직접 부르면 그 화면만 엑셀 전용 장을 ₩0 으로 보인다.
 * (sumQuoteSupplyAmount 는 일반 견적서의 셈법으로 남는다 — 편집 화면이 입력 중인 값으로
 * 합계를 보일 때 쓴다.)
 *
 * ── null 은 「금액을 알 수 없다」이다 ─────────────────────────────────────
 * 엑셀 전용인데 수기 금액이 비어 있으면 **null** 을 돌려준다 — 0 이 아니다. 0 은 「무상
 * 견적」이라는 실제 값이고(CHECK 가 허용한다), 비어 있는 값을 0 으로 접으면 화면이
 * 「₩0 견적서」라고 단정한다. 부르는 쪽이 null 을 「—」로 그린다. 검증이 엑셀 전용 장의
 * 금액을 필수로 받으므로(validation/quote-input.ts) 정상 경로로는 생기지 않는다 — 검증을
 * 거치지 않은 행(손으로 넣은 SQL)에 대한 대비다.
 *
 * 엑셀 전용 장의 품목 · 작업비는 **보지 않는다.** 검증이 엑셀 전용 장의 줄을 비워 두게
 * 막지만(작업비 칸은 막지 않는다), 남아 있더라도 이 장의 금액은 사람이 적은 공급가액이다.
 *
 * 일반 견적서의 셈은 sumQuoteSupplyAmount 에 그대로 맡긴다 — **설명 줄을 빼는 일도
 * 거기 한 곳에서 일어난다.**
 * ============================================================================
 */
export function quoteSupplyAmountOf(quote: {
  isExcelOnly: boolean;
  manualSupplyAmount: string | null;
  items: readonly QuoteAmountLine[];
  workCost: string;
}): number | null {
  if (quote.isExcelOnly) {
    if (quote.manualSupplyAmount === null || quote.manualSupplyAmount.trim() === "") return null;
    return toAmount(quote.manualSupplyAmount);
  }
  return sumQuoteSupplyAmount(quote.items, quote.workCost);
}

/**
 * 감사 스냅숏 · 내자 정리 금액 칸과 같은 모양(numeric 문자열, 소수 둘째 자리)으로. 금액을
 * 알 수 없으면(위 null) null 이다 — "0.00" 으로 접지 않는다.
 */
export function formatQuoteSupplyAmount(amount: number | null): string | null {
  return amount === null ? null : amount.toFixed(2);
}

/** 빈 값·못 읽는 값은 0 으로 본다. 목록의 합계가 통째로 안 그려지는 것보다 낫다. */
export function toAmount(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * ============================================================================
 * 목록 줄의 결재 체크 — **여러 장을 한 번에** 가린다 (2026-10-08 사용자 요구)
 * ============================================================================
 * 「결재 승인된 견적서에 체크 표시가 보이게 해 달라」는 요구의 판정 자리다. 체크가
 * 붙는 상태는 **`APPROVED` 하나**이고, 🔴 **`APPROVED_OUTDATED` 에는 붙지 않는다**
 * (2026-10-08 사용자 결정) — 승인을 받은 **뒤에 견적서가 바뀐** 장이라, 체크를 붙이면
 * 화면이 「승인 완료」라고 거짓말을 한다(domain/quote-approval-rules.ts 의 머리말).
 *
 * ── 🔴 규칙을 다시 적지 않는다 ─────────────────────────────────────────
 * 상태를 정하는 일은 그대로 `resolveQuoteApprovalState` 가 한다. 이 함수가 더하는
 * 것은 **여러 장을 한꺼번에** 가리는 일뿐이다 — 「가장 최근 행 하나」를 고르는 규칙도
 * 「판 번호가 다르면 낡은 승인」이라는 규칙도 여기서 베끼지 않는다.
 *
 * ── 🔴 받는 것이 **질의 한 번의 결과**다 ────────────────────────────────
 * 결재 행들을 장별로 나눠 받지 않고 **납작한 한 뭉치**로 받는다. 그래야 부르는 쪽이
 * 「목록 장수만큼 질의」(N+1)를 만들 길 자체가 없다 — queries/quotes.ts 의 부품 줄 ·
 * 첨부 칸이 같은 모양을 쓰는 이유와 같다.
 *
 * ── 끊긴 이력은 건너뛴다 ────────────────────────────────────────────────
 * `quote_approvals.quote_id` 는 **ON DELETE SET NULL** 이다(schema/quote-approvals.ts) —
 * 견적서를 완전 삭제해도 결재 이력은 남고, 그 줄의 견적서 연결만 풀린다. 목록은 살아
 * 있는 장만 보므로 그런 줄은 애초에 어느 장의 것도 아니다.
 * ============================================================================
 */

/** 결재 한 줄에서 이 판정이 실제로 보는 칸만. 조회가 더 많이 읽을 이유가 없다. */
export type QuoteApprovalRowForList = {
  /** 🔴 `null` 은 견적서가 완전 삭제돼 연결이 풀린 이력이다(위 머리말). */
  quoteId: string | null;
  status: QuoteApprovalStatus;
  quoteVersionAtRequest: number;
  requestedAt: Date;
};

/**
 * 지금 내용 그대로 승인된 **견적서 id 들**.
 *
 * 🔴 **동점일 때는 먼저 온 줄이 이긴다.** 부르는 쪽이 `requested_at` 내림차순으로
 * 읽어 넘기므로 먼저 온 줄이 곧 가장 최근 줄이고, 이것은 한 장을 묻는
 * `getQuoteApprovalProgress`(같은 정렬 + limit 1)와 **같은 답**이 되게 하려는 것이다.
 * 애초에 동점은 생기지 않는다 — 사슬을 잇는 저장 경로가 `requested_at` 을 물려받지
 * 않는 이유가 그 조회를 정해지게 하기 위해서다(queries/quote-approvals.ts).
 */
export function approvedQuoteIdsForCurrentContent(
  approvals: readonly QuoteApprovalRowForList[],
  quotes: readonly { id: string; version: number }[]
): Set<string> {
  const latestByQuoteId = new Map<string, QuoteApprovalRowForList>();
  for (const approval of approvals) {
    if (approval.quoteId === null) continue;
    const kept = latestByQuoteId.get(approval.quoteId);
    if (kept === undefined || approval.requestedAt.getTime() > kept.requestedAt.getTime()) {
      latestByQuoteId.set(approval.quoteId, approval);
    }
  }

  const approved = new Set<string>();
  for (const quote of quotes) {
    const latest = latestByQuoteId.get(quote.id) ?? null;
    if (resolveQuoteApprovalState(latest, quote.version) === "APPROVED") approved.add(quote.id);
  }
  return approved;
}
