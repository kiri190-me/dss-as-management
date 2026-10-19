import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { quoteKindLabels as coreQuoteKindLabels } from "@dss/core/ui/quotes/quote-list-rows";

import { STORED_QUOTE_KINDS, quoteKindLabels } from "./quote-input";

/**
 * ============================================================================
 * 🔴 견적서 종류의 이름표가 **두 벌 다 같은 글자인가**
 * ============================================================================
 * 사람에게 보이는 종류 이름표를 적어 둔 자리가 이 저장소에 둘이다.
 *
 *   src/lib/validation/quote-input.ts          새 견적서 팝업의 라디오 ·
 *   (`quoteKindLabels`)                        수정 화면의 종류 select · 엑셀 안내
 *
 *   vendor/dss-core/src/ui/quotes/             견적서 **목록 화면의 종류 딱지**
 *   quote-list-rows.ts (`quoteKindLabels`)     (QuoteListScreen.tsx 의 KindTag).
 *                                              A/S 의 QuoteListSlots.tsx 가 그
 *                                              화면을 가져다 쓴다.
 *
 * 둘로 갈라져 있는 까닭은 공용 묶음(vendor/dss-core)이 **브라우저 묶음에 실리는
 * 화면 한 벌**이라서다 — 그쪽은 이 저장소의 검증 모듈을 끌어오지 않는다
 * (quote-list-rows.ts 의 STORED_QUOTE_KINDS 머리말).
 *
 * ── 🔴 실제로 갈라졌다 (2026-10-19) ─────────────────────────────────────
 * `CABLE` 의 이름표를 「케이블 견적서」 → 「기타 견적서」 로 바꾸는 작업에서
 * **A/S 쪽 한 벌만 바뀌어 같은 작업 안에서 갈라졌다.** 그래서 같은 견적서가 새
 * 견적서 팝업에서는 「기타 견적서」, 목록의 딱지에서는 「케이블 견적서」 로
 * 보였다(커밋 하나 뒤에 발견해 바로잡았고 운영에는 안 나갔다). 타입은
 * 양쪽 다 `Record<StoredQuoteKind, string>` 이라 **컴파일러가 아무 말도 하지
 * 않았고**, 이것을 잡는 시험도 없었다. 그 갈라짐을 막는 자리가 여기다.
 *
 * ── 🔴 기대값을 글자로 적지 않는다 ──────────────────────────────────────
 * 「DOMESTIC 은 '내자 견적서'」 처럼 적어 두면 **둘 다 안 바뀐 채로도 통과하는**
 * 시험이 된다(갈라짐이 아니라 옛 글자를 굳히게 된다). 그래서 양쪽을 들여와
 * 서로 맞춰 본다 — 어느 쪽이든 한쪽만 고치는 날 이 시험이 깨진다.
 * ============================================================================
 */

describe("견적서 종류 이름표 — 두 벌이 같은 글자인가", () => {
  test("🔴 A/S 의 이름표와 공용 묶음(목록 딱지)의 이름표가 같다", () => {
    assert.deepEqual(quoteKindLabels, coreQuoteKindLabels);
  });

  test("DB 가 내줄 수 있는 종류마다 공용 묶음에도 이름표가 있다 — 목록은 읽어 온 값을 그대로 그린다", () => {
    for (const kind of STORED_QUOTE_KINDS) {
      const label = (coreQuoteKindLabels as Record<string, string | undefined>)[kind];
      assert.ok(label && label.trim() !== "", `${kind} 의 이름표가 공용 묶음에 없다`);
    }
  });
});
