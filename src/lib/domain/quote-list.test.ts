import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  approvedQuoteIdsForCurrentContent,
  buildQuoteSummaryLine,
  formatQuoteSupplyAmount,
  isQuoteAmountItemLine,
  quoteSupplyAmountOf,
  sumQuoteSupplyAmount,
  toAmount,
  type QuoteAmountLine,
  type QuoteApprovalRowForList,
} from "./quote-list";

const SAMPLE = {
  quoteNumber: "DSS 2026-077",
  customerName: "ICD",
  modelName: "CFK300FH-IC2",
  lotNumber: "WU8042",
  serialNumber: "1612027",
  faultDescription: "Bias Fwd Drop 발생",
};

test("목록 한 줄 — 사용자가 준 예시와 글자까지 같다", () => {
  assert.equal(
    buildQuoteSummaryLine(SAMPLE),
    "DSS 2026-077 ICD CFK300FH-IC2 WU8042 1612027 Bias Fwd Drop 발생"
  );
});

/**
 * 이 시험이 이 파일에서 제일 중요하다. 값의 모양(WU 접두 vs 숫자만)으로 짐작하면
 * 반대로 붙고, 견적서 양식에 박혀 있던 예시가 정확히 그 반대로 읽히게 생겼다.
 * 실제로 한 번 틀렸던 자리다.
 */
test("L/N 이 S/N 보다 앞이다 — 값 모양으로 짐작하지 않는다", () => {
  const line = buildQuoteSummaryLine(SAMPLE);
  assert.ok(
    line.indexOf("WU8042") < line.indexOf("1612027"),
    "WU8042(L/N)가 1612027(S/N)보다 앞에 와야 한다"
  );
});

test("빈 칸은 자리를 남기지 않고 통째로 빠진다", () => {
  assert.equal(
    buildQuoteSummaryLine({ ...SAMPLE, lotNumber: null, faultDescription: null }),
    "DSS 2026-077 ICD CFK300FH-IC2 1612027"
  );
  // 공백만 적힌 값도 없는 것으로 접는다.
  assert.equal(
    buildQuoteSummaryLine({ ...SAMPLE, modelName: "   ", serialNumber: "" }),
    "DSS 2026-077 ICD WU8042 Bias Fwd Drop 발생"
  );
  assert.ok(!buildQuoteSummaryLine({ ...SAMPLE, modelName: null }).includes("  "));
});

test("연결된 수리 건이 없어 정보가 번호와 고객사뿐일 때도 줄이 만들어진다", () => {
  assert.equal(
    buildQuoteSummaryLine({
      quoteNumber: "DSS 2026-078",
      customerName: "INVENIA",
      modelName: null,
      lotNumber: null,
      serialNumber: null,
      faultDescription: null,
    }),
    "DSS 2026-078 INVENIA"
  );
});

test("공급가 = 부품비 + 작업비", () => {
  assert.equal(
    sumQuoteSupplyAmount(
      [
        { quantity: 1, unitPrice: "1850000.00" },
        { quantity: 2, unitPrice: "1100000.00" },
        { quantity: 1, unitPrice: "45000.00" },
      ],
      "1200000.00"
    ),
    5_295_000
  );
  assert.equal(sumQuoteSupplyAmount([], "0"), 0);
});

// ── 설명 줄은 합계에 들어가지 않는다 (2026-09-16 케이블 견적서) ──────────────

/** 품목 둘 + 작업비. 아래 시험들이 전부 이 금액을 기준으로 「그대로인가」를 본다. */
const PARTS: QuoteAmountLine[] = [
  { kind: "ITEM", quantity: 1, unitPrice: "1850000.00" },
  { kind: "ITEM", quantity: 3, unitPrice: "45000.00" },
];
const PARTS_TOTAL = 1_850_000 + 45_000 * 3 + 1_200_000;

test("🔴 설명 줄(NOTE)은 합계에 들어가지 않는다 — 품목 줄만 더한다", () => {
  const withNote: QuoteAmountLine[] = [
    PARTS[0],
    { kind: "NOTE", quantity: null, unitPrice: null },
    PARTS[1],
  ];
  assert.equal(sumQuoteSupplyAmount(withNote, "1200000.00"), PARTS_TOTAL);
  // 설명 줄만 있는 장은 작업비뿐이다 — 0원짜리 품목이 하나 있는 것이 아니다.
  assert.equal(
    sumQuoteSupplyAmount([{ kind: "NOTE", quantity: null, unitPrice: null }], "1200000.00"),
    1_200_000
  );
});

test("🔴 거르는 잣대는 **줄 종류**다 — 설명 줄에 숫자가 남아 있어도 더하지 않는다", () => {
  // DB 는 이런 줄을 CHECK 로 막는다(quote_items_amounts_item_line_only). 그래도
  // 여기서 못 박는 것은, 이 셈이 「값이 비었는가」가 아니라 「무슨 줄인가」로
  // 가른다는 사실 자체다. 값으로 가르면 0원짜리 품목과 설명 줄이 같아진다.
  const sneaky: QuoteAmountLine[] = [...PARTS, { kind: "NOTE", quantity: 5, unitPrice: "999999.00" }];
  assert.equal(sumQuoteSupplyAmount(sneaky, "1200000.00"), PARTS_TOTAL);
});

test("🔴 모르는 줄 종류는 합계 밖에 선다 — `!== NOTE` 가 아니라 `=== ITEM` 이다", () => {
  // 줄 종류가 하나 더 생기는 날 그것이 조용히 합계에 섞이면 안 된다. 0101 의
  // CHECK 도 같은 방향이다(`kind = 'ITEM' OR 금액이 없다`).
  const future = { kind: "DISCOUNT", quantity: 1, unitPrice: "500000.00" } as unknown as QuoteAmountLine;
  assert.equal(sumQuoteSupplyAmount([...PARTS, future], "1200000.00"), PARTS_TOTAL);
  assert.equal(isQuoteAmountItemLine(future), false);
});

test("🔴 종류를 적지 않은 줄은 품목 줄이다 — 옛 금액이 한 푼도 바뀌지 않는다", () => {
  // 수정 화면 · 미리보기가 입력 중인 값을 종류 없이 넘긴다(그 줄은 전부 품목 줄이다).
  // DB 칸의 DEFAULT 'ITEM' 과 같은 규칙이라, 이 조각 전후로 금액이 같아야 한다.
  const withoutKind = [
    { quantity: 1, unitPrice: "1850000.00" },
    { quantity: 3, unitPrice: "45000.00" },
  ];
  assert.equal(sumQuoteSupplyAmount(withoutKind, "1200000.00"), PARTS_TOTAL);
  assert.equal(sumQuoteSupplyAmount(withoutKind, "1200000.00"), sumQuoteSupplyAmount(PARTS, "1200000.00"));
  assert.equal(
    quoteSupplyAmountOf({
      isExcelOnly: false,
      manualSupplyAmount: null,
      items: withoutKind,
      workCost: "1200000.00",
    }),
    PARTS_TOTAL
  );
});

test("금액 문자열: 못 읽는 값은 0 으로 본다 — 합계가 통째로 안 그려지는 것보다 낫다", () => {
  assert.equal(toAmount("1234.50"), 1234.5);
  assert.equal(toAmount(""), 0);
  assert.equal(toAmount("   "), 0);
  assert.equal(toAmount(null), 0);
  assert.equal(toAmount(undefined), 0);
  assert.equal(toAmount("숫자아님"), 0);
});

// ── 공급가액 한 곳 — 엑셀 전용 견적서 (2026-09-15 Q2) ─────────────────────────

const ITEMS = [
  { quantity: 2, unitPrice: "45000.00" },
  { quantity: 1, unitPrice: "10000.00" },
];

test("일반 견적서의 공급가액은 예전 셈법 그대로다 — 부품 줄 합 + 작업비", () => {
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: false, manualSupplyAmount: null, items: ITEMS, workCost: "1200000.00" }),
    sumQuoteSupplyAmount(ITEMS, "1200000.00")
  );
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: false, manualSupplyAmount: null, items: ITEMS, workCost: "1200000.00" }),
    1_300_000
  );
});

test("엑셀 전용 견적서의 공급가액은 손으로 적은 값이다 — 품목 · 작업비는 보지 않는다", () => {
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "3456789.50", items: ITEMS, workCost: "1200000.00" }),
    3_456_789.5
  );
  // 0 은 무상 견적이라는 실제 값이다 — null 과 다르다.
  assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "0", items: [], workCost: "0" }), 0);
});

test("🔴 엑셀 전용인데 금액이 비어 있으면 null — 0 으로 접지 않는다(화면은 「—」)", () => {
  assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: null, items: [], workCost: "0" }), null);
  assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "  ", items: [], workCost: "0" }), null);
  // 작업비가 남아 있어도 그 값으로 메우지 않는다.
  assert.equal(
    quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: null, items: ITEMS, workCost: "1200000.00" }),
    null
  );
});

test("감사 스냅숏 · 내자 정리 금액 칸의 모양 — 소수 둘째 자리, 모르면 null", () => {
  assert.equal(formatQuoteSupplyAmount(1_300_000), "1300000.00");
  assert.equal(formatQuoteSupplyAmount(0), "0.00");
  assert.equal(formatQuoteSupplyAmount(3_456_789.5), "3456789.50");
  assert.equal(formatQuoteSupplyAmount(null), null);
});

/**
 * ============================================================================
 * 목록 줄의 결재 체크 — 🔴 **`APPROVED` 하나에만 붙는다** (2026-10-08)
 * ============================================================================
 * 사용자 요구는 「결재 승인된 견적서에 체크 표시」이고, 사용자 결정은
 * 🔴 **`APPROVED_OUTDATED` 에는 붙이지 않는다** 이다 — 승인을 받은 **뒤에 견적서가
 * 바뀐** 장이라 체크를 붙이면 화면이 「승인 완료」라고 거짓말을 한다.
 *
 * 그리는 쪽(공용 화면이 이 값을 받아 ✔️ 를 그리는가)은
 * components/quotes/quote-list-approved-check.test.tsx 가 **실제로 그려 보고** 잰다.
 * ============================================================================
 */
describe("목록 줄의 결재 체크 — approvedQuoteIdsForCurrentContent", () => {
  const AT = (iso: string) => new Date(iso);
  const QUOTE = { id: "q1", version: 3 };

  /** 그 견적서의 결재 줄 하나. 안 적은 칸은 「지금 판에 대한 요청」이 기본이다. */
  const approval = (over: Partial<QuoteApprovalRowForList> = {}): QuoteApprovalRowForList => ({
    quoteId: "q1",
    status: "APPROVED",
    quoteVersionAtRequest: 3,
    requestedAt: AT("2026-10-08T01:00:00.000Z"),
    ...over,
  });

  test("🔴 지금 판에 대한 승인에만 체크가 붙는다", () => {
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([approval()], [QUOTE])], ["q1"]);
  });

  test("🔴 APPROVED_OUTDATED 에는 붙지 않는다 — 승인 뒤에 견적서가 바뀐 장이다", () => {
    // 2판에 대한 승인인데 지금은 3판이다.
    const outdated = approval({ quoteVersionAtRequest: 2 });
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([outdated], [QUOTE])], []);
  });

  test("🔴 PENDING · REJECTED · NOT_REQUESTED 에도 붙지 않는다", () => {
    for (const status of ["REQUESTED", "REJECTED"] as const) {
      assert.deepEqual(
        [...approvedQuoteIdsForCurrentContent([approval({ status })], [QUOTE])],
        [],
        `${status} 인 장에 체크가 붙었다`
      );
    }
    // 한 번도 올린 적이 없으면 결재 줄 자체가 없다 — 그것이 NOT_REQUESTED 다.
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([], [QUOTE])], []);
  });

  test("🔴 가장 최근 줄 하나가 답을 정한다 — 1단계 승인 + 2단계 대기는 아직 승인이 아니다", () => {
    const rows = [
      // 부르는 쪽이 requested_at 내림차순으로 넘긴다(queries/quotes.ts).
      approval({ status: "REQUESTED", requestedAt: AT("2026-10-08T02:00:00.000Z") }),
      approval({ status: "APPROVED", requestedAt: AT("2026-10-08T01:00:00.000Z") }),
    ];
    assert.deepEqual([...approvedQuoteIdsForCurrentContent(rows, [QUOTE])], []);
    // 차례를 뒤집어 넘겨도 「가장 최근」의 답은 같다 — 시각으로 고르기 때문이다.
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([...rows].reverse(), [QUOTE])], []);
  });

  test("🔴 여러 장을 **한 뭉치**로 받아 한 번에 가린다 — 장수만큼 묻지 않는다", () => {
    const quotes = [
      { id: "approved", version: 1 },
      { id: "outdated", version: 5 },
      { id: "pending", version: 1 },
      { id: "never", version: 1 },
    ];
    // 🔴 질의 한 번이 내놓는 그 모양 — 장별로 나뉘어 있지 않은 납작한 한 배열이다.
    const flatResultSet: QuoteApprovalRowForList[] = [
      approval({ quoteId: "pending", status: "REQUESTED", quoteVersionAtRequest: 1 }),
      approval({ quoteId: "outdated", quoteVersionAtRequest: 4 }),
      approval({ quoteId: "approved", quoteVersionAtRequest: 1 }),
    ];
    assert.deepEqual([...approvedQuoteIdsForCurrentContent(flatResultSet, quotes)], ["approved"]);
  });

  test("🔴 견적서가 완전 삭제돼 연결이 풀린 이력(quote_id IS NULL)은 건너뛴다", () => {
    const orphan = approval({ quoteId: null });
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([orphan], [QUOTE])], []);
    // 그 줄이 섞여 있어도 살아 있는 장의 판정은 그대로다.
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([orphan, approval()], [QUOTE])], ["q1"]);
  });

  test("목록에 없는 장의 결재 줄은 답에 끼어들지 않는다", () => {
    const other = approval({ quoteId: "not-in-list" });
    assert.deepEqual([...approvedQuoteIdsForCurrentContent([other], [QUOTE])], []);
  });
});
