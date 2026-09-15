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
 * 견적서 한 장의 합계(공급가). 부가세는 여기서 셈하지 않는다 — 세율은 시점에
 * 따라 달라지는 값이고, 실제 문서에서는 양식의 `=I55*0.1` 이 계산한다.
 *
 * 금액은 DB 에서 **문자열로 온다**(numeric 을 Drizzle 이 그렇게 읽는다). 숫자로
 * 바꾸는 자리를 여기 하나로 모아 두면, 화면마다 제각기 parseFloat 하다가 한
 * 군데만 NaN 을 그리는 일이 없다.
 */
export function sumQuoteSupplyAmount(
  items: readonly { quantity: number; unitPrice: string }[],
  workCost: string
): number {
  const itemsTotal = items.reduce((sum, item) => sum + item.quantity * toAmount(item.unitPrice), 0);
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
 * ============================================================================
 */
export function quoteSupplyAmountOf(quote: {
  isExcelOnly: boolean;
  manualSupplyAmount: string | null;
  items: readonly { quantity: number; unitPrice: string }[];
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
