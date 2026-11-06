import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  resolveQuoteDomesticOrderLine,
  type QuoteRowForDomesticOrderLine,
} from "./quote-domestic-order-line";
import { STORED_QUOTE_KINDS } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 기타 견적서를 만들면 내자 정리에 줄이 하나 — **규칙**을 값으로 잰다 (2026-11-06)
 * ============================================================================
 * 실제로 줄이 서는지는 시험 DB 가 본다
 * (db/mutations/quote-domestic-order-line.integration.test.ts). 끼운 자리 —
 * 만들 때만 부르고 고칠 때는 안 부른다 — 는 소스로 지킨다
 * (db/mutations/quote-domestic-order-line-source.test.ts). 여기서 재는 것은 그
 * 둘로는 싸게 못 재는 **판정**이다:
 *
 *  ① 🔴 **CABLE 일 때만** 줄이 선다 — 종류 셋을 전부 넣어 본다.
 *  ② 🔴 **품명이 형식(model_name_text)에 간다** — 이 조각의 요구 그대로다.
 *  ③ 🔴 **채우는 칸이 정확히 여섯**이다 — 칸 이름을 하나씩이 아니라 **묶음째**
 *     맞대어 본다. 하나씩 보면 칸이 몰래 늘어도 통과한다.
 *  ④ 🔴 **살아 있는 줄이 이미 있으면 안 만든다**, 휴지통에 든 줄은 세지 않는다
 *     (그 판단은 부르는 쪽이 `hasLiveLine` 을 어떻게 세느냐로 들어온다 — 여기서는
 *     「세어 온 값이 거짓이면 만든다」를 못 박는다).
 *  ⑤ 🔴 **공급처가 null 이어도 선다** — 견적서는 고객사를 안 이어도 저장된다.
 *
 * 🔵 **표본이 비어 공짜로 통과하지 않게** 먼저 못을 박는다: 종류 표본이 DB 가 내줄
 *    수 있는 종류를 **빠짐없이** 덮는지(STORED_QUOTE_KINDS 와 대조), 그리고 그
 *    표본에서 CREATE 가 난 종류가 **정확히 하나**인지를 센다. 「전부 SKIP」인
 *    구현도, 「전부 CREATE」인 구현도 이 두 줄에서 멈춘다.
 * ============================================================================
 */

/** 기타 견적서 한 장. 바꿔 보고 싶은 칸만 덮어쓴다. */
function cableQuote(
  overrides: Partial<QuoteRowForDomesticOrderLine> = {}
): QuoteRowForDomesticOrderLine {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "CABLE",
    isDeleted: false,
    subject: "RF 케이블 ASSY 2.5m",
    quoteNumber: "DSS-2611-001",
    quoteDate: "2026-11-06",
    customerId: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

describe("기타 견적서에 딸린 내자 줄 — 만들 것인가", () => {
  test("🔴 CABLE 일 때만 만든다 — 종류 셋을 전부 넣어 본다", () => {
    const seen = STORED_QUOTE_KINDS.map((kind) => ({
      kind,
      plan: resolveQuoteDomesticOrderLine({ quote: cableQuote({ kind }), hasLiveLine: false }),
    }));

    // 🔵 표본이 비지 않았는가 — DB 가 내줄 수 있는 종류를 빠짐없이 넣었는가.
    assert.deepEqual(
      seen.map((entry) => entry.kind),
      [...STORED_QUOTE_KINDS],
      "종류 표본이 DB 가 내줄 수 있는 목록과 다르다"
    );
    assert.ok(seen.length >= 3, "종류 표본이 셋보다 적다 — 가르는 것이 없다");

    // 🔴 만들어지는 종류가 **정확히 하나**이고 그것이 CABLE 이다.
    assert.deepEqual(
      seen.filter((entry) => entry.plan.kind === "CREATE").map((entry) => entry.kind),
      ["CABLE"],
      "🔴 기타 견적서가 아닌 갈래에서도 줄이 선다 — 기존 흐름이 깨진다"
    );
    for (const entry of seen) {
      if (entry.kind === "CABLE") continue;
      assert.equal(entry.plan.kind, "SKIP");
      if (entry.plan.kind !== "SKIP") return;
      // 🔴 까닭까지 본다 — 「이미 줄이 있다」로 건너뛰면 CABLE 관문이 깨진 날
      //    증상이 같은 모양이라 눈치채지 못한다.
      assert.equal(entry.plan.reason, "KIND_NOT_CABLE", `${entry.kind} 가 다른 까닭으로 건너뛴다`);
    }
  });

  test("🔴 품명이 형식(model_name_text)에 적히고, 채우는 칸은 정확히 여섯이다", () => {
    const plan = resolveQuoteDomesticOrderLine({
      quote: cableQuote({ subject: "RF 케이블 ASSY 2.5m" }),
      hasLiveLine: false,
    });
    assert.equal(plan.kind, "CREATE");
    if (plan.kind !== "CREATE") return;

    // 🔴 이 조각의 요구 그 자체 — 「기타 견적서의 [품명]이 내자정리의 [형식]에」.
    assert.equal(plan.values.modelNameText, "RF 케이블 ASSY 2.5m");

    // 🔴 칸을 **묶음째** 맞댄다. 하나씩 보면 칸이 몰래 늘어도 통과한다 —
    //    늘어난 칸은 사람이 고쳐 둔 값을 덮을 수 있는 자리가 된다.
    assert.deepEqual(plan.values, {
      quoteId: "11111111-1111-4111-8111-111111111111",
      repairCaseId: null,
      modelNameText: "RF 케이블 ASSY 2.5m",
      quoteNumber: "DSS-2611-001",
      quoteIssuedDate: "2026-11-06",
      customerId: "22222222-2222-4222-8222-222222222222",
    });
    // 순번은 **없다** — 사람이 매긴 표시 순서라 기계가 짓지 않는다.
    assert.equal(Object.hasOwn(plan.values, "displayOrder"), false, "순번을 지어낸다");
    // 기타 건이다 — 수리 건 연결은 없음을 적는다.
    assert.equal(plan.values.repairCaseId, null);
  });

  test("🔴 공급처가 null 이어도 선다 — 안 이어도 저장되는 칸이다", () => {
    const plan = resolveQuoteDomesticOrderLine({
      quote: cableQuote({ customerId: null }),
      hasLiveLine: false,
    });
    assert.equal(plan.kind, "CREATE", "🔴 공급처를 안 이은 기타 견적서에서 줄이 안 선다");
    if (plan.kind !== "CREATE") return;
    assert.equal(plan.values.customerId, null);
    // 나머지 칸은 그대로 들어간다 — null 하나가 다른 칸까지 비우지 않는다.
    assert.equal(plan.values.modelNameText, "RF 케이블 ASSY 2.5m");
    assert.equal(plan.values.quoteNumber, "DSS-2611-001");
    assert.equal(plan.values.quoteIssuedDate, "2026-11-06");
  });

  test("🔴 살아 있는 줄이 이미 있으면 안 만든다 — 한 견적서에 줄 하나", () => {
    const plan = resolveQuoteDomesticOrderLine({ quote: cableQuote(), hasLiveLine: true });
    assert.equal(plan.kind, "SKIP");
    if (plan.kind !== "SKIP") return;
    assert.equal(plan.reason, "ALREADY_LINKED");

    // 🔵 짝: 같은 장이 **없을 때는** 선다. 이 줄이 없으면 「늘 SKIP」인 구현도 통과한다.
    assert.equal(
      resolveQuoteDomesticOrderLine({ quote: cableQuote(), hasLiveLine: false }).kind,
      "CREATE"
    );
  });

  test("🔴 종류 관문이 「이미 있다」보다 앞이다 — 까닭이 뒤섞이지 않는다", () => {
    // 내자 견적서에 이미 줄이 걸려 있는 것은 **정상**이다. 그 장을 ALREADY_LINKED 로
    // 적으면, CABLE 관문이 깨진 날에도 낱말이 그대로라 시험이 가려내지 못한다.
    const plan = resolveQuoteDomesticOrderLine({
      quote: cableQuote({ kind: "DOMESTIC" }),
      hasLiveLine: true,
    });
    assert.equal(plan.kind, "SKIP");
    if (plan.kind !== "SKIP") return;
    assert.equal(plan.reason, "KIND_NOT_CABLE");
  });

  test("견적서가 없거나 휴지통에 있으면 할 일이 없다", () => {
    const missing = resolveQuoteDomesticOrderLine({ quote: null, hasLiveLine: false });
    assert.equal(missing.kind, "SKIP");
    if (missing.kind !== "SKIP") return;
    assert.equal(missing.reason, "QUOTE_NOT_FOUND");

    const deleted = resolveQuoteDomesticOrderLine({
      quote: cableQuote({ isDeleted: true }),
      hasLiveLine: false,
    });
    assert.equal(deleted.kind, "SKIP");
    if (deleted.kind !== "SKIP") return;
    assert.equal(deleted.reason, "QUOTE_DELETED");
  });
});
