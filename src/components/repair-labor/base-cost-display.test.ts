import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { describeBaseCost } from "./base-cost-display";

/**
 * ============================================================================
 * 기본 작업비 표시 — 세 몫의 합, 그리고 **비어 있는 몫**
 * ============================================================================
 * 사람이 적는 칸이 아니라 `조사 몫 + 통전 몫 + 서류 몫` 이다(2026-09-16). 여기서 못
 * 박는 것은 넷이다.
 *
 *  1. **개발 DB 의 값이 그대로 보인다** — 제너레이터·매쳐 3,500,000 · T/C 2,200,000.
 *     화면을 열었을 때 사람이 볼 숫자가 이것이다.
 *  2. **🔴 NULL 인 몫은 합계에 들어가지 않고, 그 사실을 말한다.** 조용히 0 으로 접으면
 *     사람은 합계가 세 몫을 다 담은 값인 줄 안다.
 *  3. **🔴 셋 다 NULL 이면 「아직 정하지 않았습니다」** 이고 `₩0` 이 아니다.
 *  4. **🔴 서류의 `0` 은 실제 값이다** — 「서류작업이 없는 장비」라서 합계에 0원으로
 *     들어가고, "정하지 않았다"고 말하지 않는다.
 *
 * 금액 자체는 여기서 새로 셈하지 않는다 — domain/quote-labor-cost.ts 가 낸 값을
 * 그대로 쓴다(base-cost-display.ts 머리말). 두 곳이 갈리면 이 화면과 견적서가 다른
 * 금액을 말하게 된다.
 * ============================================================================
 */

const RATE = "100000.00";

describe("개발 DB 의 값이 그대로 보인다", () => {
  test("제너레이터 · 매쳐 — 조사 21 · 통전 14 · 서류 없음 → ₩3,500,000", () => {
    const display = describeBaseCost({
      hourlyRate: RATE,
      investigationHours: 21,
      powerTestHours: 14,
      documentHours: null,
    });
    assert.equal(display.amount, 3_500_000);
    assert.equal(display.amountText, "₩3,500,000");
    assert.deepEqual(display.shares.map((share) => share.text), [
      "조사 21시간 → ₩2,100,000",
      "통전 14시간 → ₩1,400,000",
      "서류 — 공수시간을 정하지 않았습니다",
    ]);
    // 🔴 빠진 몫이 있다는 것을 말한다.
    assert.equal(
      display.unsetNote,
      "서류 몫은 아직 셀 수 없어 위 금액에 들어 있지 않습니다."
    );
  });

  test("Total Controller — 조사 22 만 정해져 있다 → ₩2,200,000", () => {
    const display = describeBaseCost({
      hourlyRate: RATE,
      investigationHours: 22,
      powerTestHours: null,
      documentHours: null,
    });
    assert.equal(display.amount, 2_200_000);
    assert.equal(display.amountText, "₩2,200,000");
    assert.deepEqual(display.shares.map((share) => share.text), [
      "조사 22시간 → ₩2,200,000",
      "통전 — 공수시간을 정하지 않았습니다",
      "서류 — 공수시간을 정하지 않았습니다",
    ]);
    assert.equal(
      display.unsetNote,
      "통전 · 서류 몫은 아직 셀 수 없어 위 금액에 들어 있지 않습니다."
    );
  });
});

test("🔴 셋 다 정하지 않았으면 「아직 정하지 않았습니다」 — ₩0 이 아니다", () => {
  const display = describeBaseCost({
    hourlyRate: RATE,
    investigationHours: null,
    powerTestHours: null,
    documentHours: null,
  });
  // 🔴 "무상"과 "모른다"는 다른 말이다.
  assert.equal(display.amount, null);
  assert.equal(display.amountText, "아직 정하지 않았습니다");
  assert.equal(
    display.unsetNote,
    "조사 · 통전 · 서류 몫은 아직 셀 수 없어 위 금액에 들어 있지 않습니다."
  );
});

test("🔴 서류의 0 은 실제 값이다 — 0원 몫으로 합계에 들어가고 안내가 붙지 않는다", () => {
  const display = describeBaseCost({
    hourlyRate: RATE,
    investigationHours: 21,
    powerTestHours: 14,
    documentHours: 0,
  });
  assert.equal(display.amount, 3_500_000, "0시간짜리 서류작업은 더해도 금액이 그대로다");
  assert.equal(display.amountText, "₩3,500,000");
  assert.equal(
    display.shares[2].text,
    "서류 0시간 → ₩0",
    "「서류작업이 없는 장비」는 '정하지 않았다'가 아니다"
  );
  assert.equal(display.unsetNote, null, "빠진 몫이 없으므로 안내가 없다");
});

test("시간당 작업비를 읽을 수 없으면 그 사실을 말한다 — 「정하지 않았다」와 다른 말이다", () => {
  for (const rate of ["", "   ", "모름"]) {
    const display = describeBaseCost({
      hourlyRate: rate,
      investigationHours: 21,
      powerTestHours: 14,
      documentHours: 0,
    });
    assert.equal(display.amount, null, `${JSON.stringify(rate)} 로 금액이 나오면 안 된다`);
    assert.equal(display.amountText, "아직 정하지 않았습니다");
    assert.deepEqual(display.shares.map((share) => share.text), [
      "조사 21시간 → 시간당 작업비를 읽을 수 없습니다",
      "통전 14시간 → 시간당 작업비를 읽을 수 없습니다",
      "서류 0시간 → 시간당 작업비를 읽을 수 없습니다",
    ]);
  }
});

test("단가가 오르면 세 몫이 함께 따라 오른다 — 금액을 저장해 두지 않는 까닭", () => {
  const display = describeBaseCost({
    hourlyRate: "120000",
    investigationHours: 21,
    powerTestHours: 14,
    documentHours: null,
  });
  assert.equal(display.amount, 4_200_000);
  assert.equal(display.amountText, "₩4,200,000");
});
