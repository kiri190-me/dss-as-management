import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { hasQuoteArchiveProductKeys } from "./quote-archive-product-keys";

/**
 * ============================================================================
 * 「같은 장비의 지난 견적서」 구역을 그릴지 가르는 판정 (2026-10-06)
 * ============================================================================
 * 이 시험은 QuoteArchiveProductFolderSection.test.tsx 에 있던 것을 **그대로 옮겨 온 것**이다.
 * 함수가 `"use client"` 인 화면 파일에서 중립 파일로 나왔기 때문이다(서버 컴포넌트가 그것을
 * 부른다 — 까닭은 quote-archive-product-keys.ts 머리말). 구역이 **무엇을 그리는가**는 그대로
 * 그 파일이 본다.
 *
 * 🔴 L/N · S/N 은 가짜다(저장소가 공개다).
 * ============================================================================
 */

describe("🔴 L/N · S/N 이 둘 다 있어야 구역을 그린다", () => {
  test("둘 다 있으면 참", () => {
    assert.equal(hasQuoteArchiveProductKeys("AB1234", "1234567"), true);
  });

  test("🔴 하나라도 비면 거짓 — 빈 칸 자리의 `-` 도 빈 것으로 본다", () => {
    for (const [lot, serial] of [
      ["", "1234567"],
      ["AB1234", ""],
      ["   ", "1234567"],
      ["-", "1234567"],
      ["AB1234", "-"],
      ["-", "-"],
      [null, "1234567"],
      ["AB1234", undefined],
    ] as ReadonlyArray<[string | null | undefined, string | null | undefined]>) {
      assert.equal(hasQuoteArchiveProductKeys(lot, serial), false, `${lot} / ${serial}`);
    }
  });
});
