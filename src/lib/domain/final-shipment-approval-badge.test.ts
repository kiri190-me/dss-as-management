import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FINAL_SHIPMENT_APPROVED_LABEL,
  isFinalShipmentApproved,
} from "./final-shipment-approval-badge";
import type { ShipmentApprovalState } from "./local/workflow/shipment-approval-checklist";
import { MISC_CASE_STATUS_LABELS } from "./misc-case-status";
import { DOMESTIC_ORDER_APPROVAL_REQUESTABLE_STATES } from "./domestic-order-approval-rules";

/**
 * ============================================================================
 * 🔴 [최종 출하 승인 완료] — **글자 하나와 판정 하나** (2026-11-08)
 * ============================================================================
 * 화면 다섯 자리가 이 둘을 나눠 쓴다. 여기서 재는 것은 값이고, 그 값이 실제로
 * 화면에 나오는지는 components/approvals/final-shipment-approved-badge-screens.test.tsx
 * 가 그려 본다.
 *
 * 🔴 **가장 중요한 단언은 「안 붙는 쪽」이다** — `STALE` 에 붙으면 「승인 완료」라고
 * 적힌 줄의 바로 옆 단추가 「승인이 안 됐습니다」로 거절한다. 그래서 다섯 상태를
 * **빠짐없이** 센다: 새 상태가 생기는 날 이 시험이 먼저 빨개져야 한다.
 * ============================================================================
 */

/**
 * 🔴 **다섯 상태를 손으로 적는다.** 타입에서 뽑아 돌리면 상태가 하나 늘어도 조용히
 * 지나가고, 그때 새 상태의 배지 여부는 **아무도 정하지 않은 채** 거짓이 된다.
 */
const ALL_STATES: readonly ShipmentApprovalState[] = [
  "NOT_REQUESTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "STALE",
];

test("🔵 못 — 상태 다섯을 빠짐없이 세고 있는가", () => {
  // 어휘가 늘었는지는 **다른 파일이 이미 다섯을 세고 있는 것**과 맞대어 본다.
  // 승인을 다시 올릴 수 있는 상태 셋 + 올릴 수 없는 둘(PENDING · APPROVED)이 전부다.
  const requestable = new Set<ShipmentApprovalState>(DOMESTIC_ORDER_APPROVAL_REQUESTABLE_STATES);
  assert.equal(requestable.size, 3, "다시 올릴 수 있는 상태의 수가 달라졌다 — 어휘가 바뀌었다");
  assert.equal(new Set(ALL_STATES).size, 5, "이 시험이 세는 상태가 다섯이 아니다");
  for (const state of requestable) {
    assert.ok(ALL_STATES.includes(state), `목록에 ${state} 가 빠져 있다`);
  }
});

describe("🔴 글자 — 사용자가 못 박은 그대로", () => {
  test("「최종 출하 승인 완료」 다섯 자 그대로다", () => {
    // 2026-11-08 사용자 원문: 「[최종 출하 승인 완료]라는 베찌」.
    // 🔴 코드는 이 글자를 승인 이름표에서 만들어 쓴다(글자를 두 곳에 적지 않는 규칙).
    //    그 이름표가 바뀌는 날 이 줄이 빨개져야 한다 — 조용히 따라가면 안 된다.
    assert.equal(FINAL_SHIPMENT_APPROVED_LABEL, "최종 출하 승인 완료");
  });

  test("🔴 이웃한 상태 배지의 글자와 **겹치지 않는다** — 둘이 한 줄에 선다", () => {
    for (const label of Object.values(MISC_CASE_STATUS_LABELS)) {
      assert.notEqual(
        label,
        FINAL_SHIPMENT_APPROVED_LABEL,
        `상태 배지와 글자가 같다(${label}) — 같은 자리에 두 배지가 서면 하나로 읽힌다`
      );
    }
    // 🔵 못 — 비교 대상이 실제로 있었는가.
    assert.ok(Object.values(MISC_CASE_STATUS_LABELS).length >= 6);
  });
});

describe("🔴 판정 — `APPROVED` 하나만이다", () => {
  test("승인이 지금 내용에 유효하면 붙는다", () => {
    assert.equal(isFinalShipmentApproved("APPROVED"), true);
  });

  test("🔴 나머지 넷에는 안 붙는다 — 특히 `STALE`", () => {
    for (const state of ALL_STATES) {
      if (state === "APPROVED") continue;
      assert.equal(
        isFinalShipmentApproved(state),
        false,
        `${state} 에 배지가 붙는다 — 화면은 「승인 완료」인데 단추는 거절한다`
      );
    }
    // 🔵 못 — 위 반복이 **넷**을 실제로 돌았는가(목록이 비면 공짜로 통과한다).
    assert.equal(ALL_STATES.filter((state) => state !== "APPROVED").length, 4);
  });

  test("기록이 한 줄도 없는 건(null · undefined)에도 안 붙는다", () => {
    assert.equal(isFinalShipmentApproved(null), false);
    assert.equal(isFinalShipmentApproved(undefined), false);
  });
});
