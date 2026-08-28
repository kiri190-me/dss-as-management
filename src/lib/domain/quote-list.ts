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

/** 빈 값·못 읽는 값은 0 으로 본다. 목록의 합계가 통째로 안 그려지는 것보다 낫다. */
export function toAmount(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
