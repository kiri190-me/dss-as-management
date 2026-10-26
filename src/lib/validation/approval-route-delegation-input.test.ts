import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isValidUserId,
  validateDelegationPeriod,
  validateDelegationReason,
} from "./approval-route-delegation-input";
import {
  validateReasonFormat,
  validateDelegationDateRange,
} from "./shipment-delegation-input";

/**
 * ============================================================================
 * 결재선 단계 위임 — 들어온 값의 모양 검사
 * ============================================================================
 * 이 묶음이 옛 위임(shipment-delegation-input.ts)의 복사본이 아니라는 것을 여기서
 * 못 박는다. 🔴 **두 함수가 같은 입력에 다른 답을 주고, 그 차이가 전부 의도다** —
 * 복사본으로 되돌려 놓아도 `tsc` 는 아무 말을 하지 않으므로 시험이 지킬 수밖에 없다.
 *
 *   · 사유 — 이 표의 `reason` 은 NOT NULL DEFAULT '' 이라 **빈 글자**를 준다.
 *     옛 쪽은 `null` 을 준다. 널이 들어가면 깨끗한 결과가 아니라 날것의 DB 오류다.
 *   · 기간 — 둘 다 「끝이 시작보다 뒤」를 요구한다. 이쪽이 그 경계를 **지켜야 하는
 *     까닭**은 끝을 포함하지 않는 구간이라서다(한순간도 살아 있지 않은 위임이 생긴다).
 * ============================================================================
 */

describe("isValidUserId", () => {
  test("uuid 만 통과한다 — 포털 번호·빈 글자·딴 것은 전부 거절", () => {
    assert.equal(isValidUserId("3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c"), true);
    // 대문자도 같은 값이다(표의 uuid 는 대소문자를 가리지 않는다).
    assert.equal(isValidUserId("3F2A1B4C-5D6E-4F7A-8B9C-0D1E2F3A4B5C"), true);
    for (const bad of ["", "   ", "12345", "abc", null, undefined, 42, {}]) {
      assert.equal(isValidUserId(bad), false, `${JSON.stringify(bad)} 가 통과했다`);
    }
  });
});

describe("validateDelegationReason", () => {
  test("🔴 안 적으면 빈 글자다 — 널이 아니다(옛 위임과 다른 점)", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const result = validateDelegationReason(empty);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.reason, "", `${JSON.stringify(empty)} 의 답이 빈 글자가 아니다`);
    }

    // 표본이 비어 공짜로 통과하지 않게, **옛 함수는 널을 준다**는 것을 함께 못 박는다.
    // 이 줄이 깨지면 둘 중 하나가 상대 쪽으로 끌려간 것이므로 사람이 봐야 한다.
    const old = validateReasonFormat("");
    assert.equal(old.ok, true);
    if (old.ok) assert.equal(old.reason, null, "옛 위임의 사유 검사가 더 이상 널을 주지 않는다");
  });

  test("앞뒤 공백은 떼고, 너무 길면 거절한다", () => {
    const trimmed = validateDelegationReason("  연차  ");
    assert.equal(trimmed.ok, true);
    if (trimmed.ok) assert.equal(trimmed.reason, "연차");

    assert.equal(validateDelegationReason("가".repeat(2000)).ok, true);
    assert.equal(validateDelegationReason("가".repeat(2001)).ok, false);
    assert.equal(validateDelegationReason(42).ok, false);
  });
});

describe("validateDelegationPeriod", () => {
  test("ISO 글자 둘을 Date 둘로 바꾼다", () => {
    const result = validateDelegationPeriod("2026-10-26T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.startsAt.toISOString(), "2026-10-26T00:00:00.000Z");
    assert.equal(result.endsAt.toISOString(), "2026-11-01T00:00:00.000Z");
  });

  test("🔴 끝이 시작과 같으면 거절한다 — 한순간도 살아 있지 않은 위임이 된다", () => {
    const same = "2026-10-26T00:00:00.000Z";
    const result = validateDelegationPeriod(same, same);
    assert.equal(result.ok, false);

    // 같은 경계를 옛 함수도 지킨다 — 이 한 줄은 두 쪽이 갈린 곳과 갈리지 않은 곳을
    // 함께 보여 준다(사유는 다르고 기간 경계는 같다).
    assert.equal(validateDelegationDateRange(same, same).ok, false);
  });

  test("끝이 시작보다 앞이거나, 글자가 아니거나, 날짜로 안 읽히면 거절한다", () => {
    assert.equal(
      validateDelegationPeriod("2026-11-01T00:00:00.000Z", "2026-10-26T00:00:00.000Z").ok,
      false
    );
    assert.equal(validateDelegationPeriod("어제", "내일").ok, false);
    assert.equal(validateDelegationPeriod(null, "2026-11-01T00:00:00.000Z").ok, false);
    assert.equal(validateDelegationPeriod("2026-10-26T00:00:00.000Z", 20261101).ok, false);
  });

  test("🔵 지난 날짜는 막지 않는다 — 같은 입력이 부르는 때에 따라 다른 답을 주면 안 된다", () => {
    const result = validateDelegationPeriod("2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z");
    assert.equal(result.ok, true);
  });
});
